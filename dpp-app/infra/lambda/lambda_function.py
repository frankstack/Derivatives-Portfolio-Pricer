"""
DPP daily market-data ingestion (AWS Lambda, container image).

Each run:
  1. Downloads daily closes for the NDX-50 universe from Yahoo (yfinance).
  2. Upserts EVERY trading day in the window into the API (idempotent), so a
     missed run heals itself on the next one instead of leaving a gap.
  3. Archives raw CSV snapshots to S3, one partition per trading day.
  4. Pulls the Treasury + SOFR curve from FRED and replaces the Base curves.
  5. Writes a JSON manifest describing the run.

Window selection (first match wins):
  event {"start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}  explicit backfill
  event {"lookback_days": N}                                    explicit backfill
  scheduled run: last DPP_LOOKBACK_DAYS days, automatically widened back to the
  most recent trading day already archived in S3 (bounded by
  DPP_MAX_AUTO_BACKFILL_DAYS), so long outages also heal without manual work.

Other event flags:
  {"dry_run": true}      fetch and validate only; no API calls, no S3 writes
  {"skip_prices": true}  rates only
  {"skip_rates": true}   prices only
  {"symbols": ["BKNG"]}  correction run for a subset of the universe: prices only,
                         nothing archived to S3 (a partial day must not look complete)

Splits: stored closes are on the share basis of the day they were captured, so a
split leaves older rows on the old basis. When Yahoo reports a split (or an ADR
ratio change) inside the window, the full history of that symbol is re-pulled from
DPP_HISTORY_START and upserted in the same run. If that refresh fails, the rest of
the run still completes and the run is then reported as failed.

Manual backfill example:
  aws lambda invoke --function-name dpp-daily-ingest:prod \
      --cli-binary-format raw-in-base64-out \
      --payload '{"lookback_days": 45}' out.json

Manual history repair for one symbol:
      --payload '{"symbols": ["BKNG"], "start_date": "2021-01-01"}'
"""
from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from typing import Any, Dict, List, Optional, Set, Tuple

import boto3
import pandas as pd
import requests
import yfinance as yf


# ----------------------------
# CONFIG
# ----------------------------

# NDX top tickers list (can be overridden by env DPP_TICKERS)
DEFAULT_TICKERS: List[str] = [
    "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "AVGO", "TSLA", "ASML",
    "MU", "COST", "AMD", "PLTR", "NFLX", "LRCX", "CSCO", "AZN", "AMAT", "INTC",
    "KLAC", "LIN", "TMUS", "PEP", "TXN", "APP", "SHOP", "AMGN", "ISRG", "GILD",
    "BKNG", "QCOM", "ADI", "PDD", "HON", "INTU", "PANW", "VRTX", "ADBE", "ARM",
    "MELI", "CRWD", "SBUX", "CMCSA", "CEG", "ADP", "SNPS", "DASH", "MAR", "ORLY",
]

# FRED series map (label -> series_id) and label -> tenor (years)
FRED_SERIES: Dict[str, str] = {
    "1M": "DGS1MO",
    "3M": "DGS3MO",
    "6M": "DGS6MO",
    "1Y": "DGS1",
    "2Y": "DGS2",
    "3Y": "DGS3",
    "5Y": "DGS5",
    "7Y": "DGS7",
    "10Y": "DGS10",
    "20Y": "DGS20",
    "30Y": "DGS30",
    "SOFR": "SOFR",
}

TENOR_YEARS: Dict[str, float] = {
    "1M": 1.0 / 12.0,
    "3M": 0.25,
    "6M": 0.50,
    "1Y": 1.00,
    "2Y": 2.00,
    "3Y": 3.00,
    "5Y": 5.00,
    "7Y": 7.00,
    "10Y": 10.00,
    "20Y": 20.00,
    "30Y": 30.00,
    "SOFR": 1.0 / 360.0,
}

PRICES_DATASET = "prices_ndx50"
RATES_DATASET = "rates_fred"

# A US session's daily bar is treated as final from this New York time onward.
SESSION_FINAL_MINUTES_NY = 16 * 60 + 30


# ----------------------------
# HELPERS
# ----------------------------

def _env(name: str, default: str = "") -> str:
    v = os.getenv(name, "").strip()
    return v if v else default


def _require_env(name: str) -> str:
    v = os.getenv(name, "").strip()
    if not v:
        raise RuntimeError(f"Missing required env var: {name}")
    return v


def _api_headers(ingest_key: str) -> Dict[str, str]:
    return {"X-DPP-INGEST-KEY": ingest_key, "Content-Type": "application/json"}


def _flag(event: Dict[str, Any], name: str) -> bool:
    v = event.get(name, False)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "y")
    return bool(v)


def _parse_date(value: Any, field: str) -> date:
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except ValueError as e:
        raise ValueError(f"{field} must be YYYY-MM-DD, got {value!r}") from e


def _parse_symbols(value: Any) -> List[str]:
    if value is None:
        return []
    parts = value.split(",") if isinstance(value, str) else list(value)
    out: List[str] = []
    for p in parts:
        sym = str(p).strip().upper()
        if sym and sym not in out:
            out.append(sym)
    return out


def _sleep_backoff(attempt: int, max_sleep: float = 20.0) -> None:
    # Exponential backoff + jitter
    sleep = min(max_sleep, (2 ** (attempt - 1)) + random.random())
    time.sleep(sleep)


def last_complete_session_date(now_utc: datetime) -> date:
    """
    Latest calendar date whose US daily bar can be final at `now_utc`.

    Before 16:30 New York time Yahoo serves an in-progress bar for "today"
    (the last trade, not the close), so today is excluded until then.
    """
    now_ny = pd.Timestamp(now_utc).tz_convert("America/New_York")
    d = now_ny.date()
    if now_ny.hour * 60 + now_ny.minute < SESSION_FINAL_MINUTES_NY:
        d = d - timedelta(days=1)
    return d


# ----------------------------
# S3 (raw snapshots + manifest)
# ----------------------------

_s3_client = None


def _s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def _s3_put_text(bucket: str, key: str, body_text: str, content_type: str) -> None:
    _s3().put_object(
        Bucket=bucket,
        Key=key,
        Body=body_text.encode("utf-8"),
        ContentType=content_type,
    )


def lake_partition_dates(bucket: str, prefix: str, dataset: str, since: date) -> Set[str]:
    """
    Dates (YYYY-MM-DD) that already have a dt= partition for `dataset`,
    looking only at partitions on or after `since`.
    """
    base = f"{prefix}/{dataset}/dt="
    kwargs: Dict[str, Any] = {
        "Bucket": bucket,
        "Prefix": base,
        "Delimiter": "/",
        "StartAfter": f"{base}{(since - timedelta(days=1)).isoformat()}/~",
    }
    found: Set[str] = set()
    while True:
        resp = _s3().list_objects_v2(**kwargs)
        for cp in resp.get("CommonPrefixes", []):
            part = cp.get("Prefix", "")[len(base):].strip("/")
            if len(part) == 10:
                found.add(part)
        if not resp.get("IsTruncated"):
            break
        kwargs["ContinuationToken"] = resp["NextContinuationToken"]
    return found


# ----------------------------
# WINDOW
# ----------------------------

@dataclass(frozen=True)
class Window:
    start: date            # first calendar day requested (inclusive)
    end_exclusive: date    # yfinance-style exclusive end
    mode: str              # scheduled | auto-backfill | explicit


def resolve_window(
    event: Dict[str, Any],
    today_utc: date,
    default_lookback_days: int,
    max_auto_backfill_days: int,
    watermark: Optional[date],
) -> Window:
    end_exclusive = today_utc + timedelta(days=1)

    if event.get("start_date"):
        start = _parse_date(event["start_date"], "start_date")
        if event.get("end_date"):
            end_exclusive = _parse_date(event["end_date"], "end_date") + timedelta(days=1)
        if start >= end_exclusive:
            raise ValueError("start_date must be on or before end_date")
        return Window(start, end_exclusive, "explicit")

    if event.get("lookback_days") is not None:
        days = int(event["lookback_days"])
        if days < 1:
            raise ValueError("lookback_days must be >= 1")
        return Window(today_utc - timedelta(days=days), end_exclusive, "explicit")

    start = today_utc - timedelta(days=default_lookback_days)
    if watermark is not None:
        # Re-fetch from just before the last archived trading day.
        wanted = watermark - timedelta(days=2)
        floor = today_utc - timedelta(days=max_auto_backfill_days)
        if wanted < start:
            return Window(max(wanted, floor), end_exclusive, "auto-backfill")
    return Window(start, end_exclusive, "scheduled")


# ----------------------------
# PRICES (yfinance, batched)
# ----------------------------

@dataclass(frozen=True)
class PriceDownloadConfig:
    start_date: str
    end_date_exclusive: str
    batch_size: int = 25
    interval: str = "1d"
    auto_adjust: bool = False
    max_retries: int = 6
    sleep_between_batches_sec: float = 0.75


@dataclass(frozen=True)
class RatesDownloadConfig:
    start_date: str
    end_date: str
    timeout_sec: int = 20
    max_retries: int = 6


_LONG_COLUMNS = ["date", "symbol", "close", "adj_close", "split"]


def _yf_download_with_retry(batch: List[str], cfg: PriceDownloadConfig) -> pd.DataFrame:
    last_err: Exception | None = None

    for attempt in range(1, cfg.max_retries + 1):
        try:
            # threads=False to reduce burstiness / throttling
            df = yf.download(
                tickers=batch,
                start=cfg.start_date,
                end=cfg.end_date_exclusive,
                interval=cfg.interval,
                group_by="ticker",
                auto_adjust=cfg.auto_adjust,
                actions=True,   # adds "Stock Splits", used to detect a change of share basis
                threads=False,
                progress=False,
            )
            # yfinance swallows rate limits and returns an empty (or all-NaN) frame.
            if df is None or df.empty or df.dropna(how="all").empty:
                raise RuntimeError("yfinance returned no rows (possible Yahoo throttling).")
            return df

        except Exception as e:
            last_err = e
            print(f"[WARN] yfinance download failed attempt={attempt}/{cfg.max_retries} batch_size={len(batch)} err={e}")
            if attempt < cfg.max_retries:
                _sleep_backoff(attempt)

    raise RuntimeError("yfinance download failed after retries.") from last_err


def _yf_wide_to_long(df: pd.DataFrame, symbols_if_single: List[str] | None) -> pd.DataFrame:
    """
    Normalize yfinance output to long format:
      columns: date(str YYYY-MM-DD), symbol(str), close(float), adj_close(float|NaN),
               split(float, 0.0 when Yahoo reports no split that day)
    """
    if df is None or df.empty:
        return pd.DataFrame(columns=_LONG_COLUMNS)

    def _with_date_column(frame: pd.DataFrame, sym: str) -> pd.DataFrame:
        flat = frame.reset_index()
        flat = flat.rename(columns={flat.columns[0]: "date"})  # the index (Date) is always first
        flat["symbol"] = sym
        return flat

    if isinstance(df.columns, pd.MultiIndex):
        parts = [_with_date_column(df[sym], sym) for sym in df.columns.get_level_values(0).unique()]
        out = pd.concat(parts, ignore_index=True)
    else:
        # Single ticker case (flat columns)
        sym = symbols_if_single[0] if symbols_if_single and len(symbols_if_single) == 1 else "UNKNOWN"
        out = _with_date_column(df, sym)

    out = out.rename(columns={
        "Close": "close",
        "Adj Close": "adj_close",
        "Stock Splits": "split",
    })

    out["date"] = pd.to_datetime(out["date"], utc=True).dt.date.astype(str)
    out["symbol"] = out["symbol"].astype(str).str.upper()

    if "adj_close" not in out.columns:
        out["adj_close"] = pd.NA
    if "close" not in out.columns:
        out["close"] = pd.NA
    if "split" not in out.columns:
        out["split"] = 0.0
    out["split"] = pd.to_numeric(out["split"], errors="coerce").fillna(0.0)

    return out[_LONG_COLUMNS]


def fetch_prices_long(symbols: List[str], cfg: PriceDownloadConfig) -> Tuple[pd.DataFrame, List[str]]:
    """
    Download the window for all symbols. Returns (long dataframe, symbols with no data).
    Symbols that come back empty from a batch are retried once on their own.
    """
    parts: List[pd.DataFrame] = []

    for i in range(0, len(symbols), cfg.batch_size):
        batch = symbols[i:i + cfg.batch_size]
        raw = _yf_download_with_retry(batch, cfg)
        parts.append(_yf_wide_to_long(raw, symbols_if_single=batch if len(batch) == 1 else None))
        time.sleep(cfg.sleep_between_batches_sec)

    df = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=_LONG_COLUMNS)
    df = df.dropna(subset=["close", "adj_close"], how="all").copy()

    missing = [s for s in symbols if s not in set(df["symbol"])]
    if missing:
        print(f"[WARN] no data in batch download for {len(missing)} symbol(s): {missing}; retrying individually")
        single_cfg = PriceDownloadConfig(
            start_date=cfg.start_date,
            end_date_exclusive=cfg.end_date_exclusive,
            batch_size=1,
            interval=cfg.interval,
            auto_adjust=cfg.auto_adjust,
            max_retries=2,
            sleep_between_batches_sec=cfg.sleep_between_batches_sec,
        )
        for sym in missing:
            try:
                raw = _yf_download_with_retry([sym], single_cfg)
            except Exception as e:
                print(f"[WARN] individual retry failed symbol={sym} err={e}")
                continue
            one = _yf_wide_to_long(raw, symbols_if_single=[sym])
            one = one.dropna(subset=["close", "adj_close"], how="all")
            if not one.empty:
                df = pd.concat([df, one], ignore_index=True)
            time.sleep(cfg.sleep_between_batches_sec)
        missing = [s for s in symbols if s not in set(df["symbol"])]

    return df, missing


def build_prices_payload(
    df_long: pd.DataFrame,
    price_field: str,
    first_date: date,
    last_date: date,
) -> List[Dict[str, Any]]:
    """
    One row per (symbol, trading day) inside [first_date, last_date].

    price_field "close" (default) stores the exchange close, which Yahoo does not
    rewrite after dividends, so re-sending the window every day is idempotent.
    "adj_close" stores the dividend-adjusted close instead.
    """
    if df_long.empty:
        return []

    df = df_long.copy()
    if price_field == "adj_close":
        df["price"] = df["adj_close"].where(df["adj_close"].notna(), df["close"])
    else:
        df["price"] = df["close"].where(df["close"].notna(), df["adj_close"])

    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    df = df.dropna(subset=["price"])
    df = df[(df["date"] >= first_date.isoformat()) & (df["date"] <= last_date.isoformat())]
    df = df[df["price"] > 0]
    df = df.drop_duplicates(subset=["symbol", "date"], keep="last").sort_values(["date", "symbol"])

    return [
        {"symbol": str(r.symbol), "date": str(r.date), "price": float(r.price)}
        for r in df[["symbol", "date", "price"]].itertuples(index=False)
    ]


def symbols_with_splits(df_long: pd.DataFrame, first_date: date, last_date: date) -> List[str]:
    """Symbols for which Yahoo reports a split (any non-zero ratio) inside [first_date, last_date]."""
    if df_long.empty or "split" not in df_long.columns:
        return []
    df = df_long[(df_long["date"] >= first_date.isoformat()) & (df_long["date"] <= last_date.isoformat())]
    return sorted(df.loc[df["split"] != 0, "symbol"].unique().tolist())


def merge_price_rows(base: List[Dict[str, Any]], extra: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Union of two payloads keyed by (symbol, date); rows in `extra` win."""
    merged = {(r["symbol"], r["date"]): r for r in base}
    merged.update({(r["symbol"], r["date"]): r for r in extra})
    return sorted(merged.values(), key=lambda r: (r["date"], r["symbol"]))


def post_prices(api_base: str, ingest_key: str, rows: List[Dict[str, Any]], chunk_rows: int) -> Dict[str, int]:
    """Upsert rows in chunks. The endpoint is idempotent per (symbol, date)."""
    url = f"{api_base}/Underlyings/HistoricalPrices/UpsertBySymbol"
    totals = {"requests": 0, "rowsProcessed": 0, "inserted": 0, "updated": 0, "deletedDuplicates": 0}

    for i in range(0, len(rows), chunk_rows):
        chunk = rows[i:i + chunk_rows]
        rp = requests.post(url, json=chunk, headers=_api_headers(ingest_key), timeout=120)
        if rp.status_code != 200:
            raise RuntimeError(f"Prices ingest failed status={rp.status_code} body={rp.text[:1500]}")
        totals["requests"] += 1
        try:
            body = rp.json()
        except ValueError:
            body = {}
        for k in ("rowsProcessed", "inserted", "updated", "deletedDuplicates"):
            totals[k] += int(body.get(k, 0) or 0)

    return totals


def snapshot_prices(
    bucket: str,
    prefix: str,
    rows: List[Dict[str, Any]],
    run_id: str,
    asof_date: str,
    existing_partitions: Optional[Set[str]],
) -> List[str]:
    """
    Archive one CSV per trading day under prices_ndx50/dt=YYYY-MM-DD/.

    Only days that have no partition yet are written, so the daily re-send of the
    window does not duplicate files. If the existing partitions are unknown
    (listing failed), fall back to writing the as-of day only.
    """
    df = pd.DataFrame(rows, columns=["symbol", "date", "price"])
    keys: List[str] = []

    for d, part in df.groupby("date", sort=True):
        d = str(d)
        if existing_partitions is None:
            if d != asof_date:
                continue
        elif d in existing_partitions:
            continue
        key = f"{prefix}/{PRICES_DATASET}/dt={d}/prices_{run_id}.csv"
        _s3_put_text(bucket, key, part.to_csv(index=False), "text/csv")
        keys.append(key)

    return keys


# ----------------------------
# RATES (FRED)
# ----------------------------

def _fetch_fred_csv_with_retry(series_id: str, cfg: RatesDownloadConfig) -> pd.DataFrame:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    last_err: Exception | None = None

    for attempt in range(1, cfg.max_retries + 1):
        try:
            r = requests.get(url, timeout=cfg.timeout_sec)
            r.raise_for_status()
            df = pd.read_csv(StringIO(r.text))
            df.columns = ["date", "value"]
            df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True)
            df["value"] = pd.to_numeric(df["value"], errors="coerce")
            df = df.dropna(subset=["date"]).copy()
            return df
        except Exception as e:
            last_err = e
            print(f"[WARN] FRED fetch failed attempt={attempt}/{cfg.max_retries} series={series_id} err={e}")
            if attempt < cfg.max_retries:
                _sleep_backoff(attempt)

    raise RuntimeError(f"FRED fetch failed for {series_id}") from last_err


def build_latest_curve_payload(cfg: RatesDownloadConfig) -> Tuple[str, List[Dict[str, Any]]]:
    start = pd.to_datetime(cfg.start_date, utc=True)
    end = pd.to_datetime(cfg.end_date, utc=True)

    frames = []
    for label, series_id in FRED_SERIES.items():
        df = _fetch_fred_csv_with_retry(series_id, cfg)
        df = df.rename(columns={"value": label})
        df = df[(df["date"] >= start) & (df["date"] <= end)].copy()
        frames.append(df)

    if not frames:
        return ("", [])

    wide = frames[0]
    for f in frames[1:]:
        wide = wide.merge(f, on="date", how="outer")

    wide = wide.sort_values("date").set_index("date")

    # Convert percent -> decimal for all columns (SOFR is also percent in FRED)
    for col in wide.columns:
        wide[col] = wide[col] / 100.0

    wide = wide.ffill()

    required = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y"]
    idx = wide[required].dropna().index
    if idx.empty:
        return ("", [])

    asof_dt = idx.max()
    asof_date = pd.to_datetime(asof_dt, utc=True).date().isoformat()

    snap = wide.loc[asof_dt]

    points: List[Dict[str, Any]] = []
    for label, tenor in TENOR_YEARS.items():
        if label not in snap.index:
            continue
        val = snap[label]
        if pd.isna(val):
            continue
        points.append({"tenor": float(tenor), "rate": float(val)})

    points = sorted(points, key=lambda x: x["tenor"])
    return (asof_date, points)


# ----------------------------
# INGEST
# ----------------------------

def run_once(event: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    event = event if isinstance(event, dict) else {}
    dry_run = _flag(event, "dry_run")
    skip_prices = _flag(event, "skip_prices")
    symbols_override = _parse_symbols(event.get("symbols"))
    # A correction run for a few symbols is about prices; leave the curves alone unless asked.
    skip_rates = _flag(event, "skip_rates") or (bool(symbols_override) and "skip_rates" not in event)

    if dry_run:
        api_base = _env("DPP_API_BASE_URL").rstrip("/")
        ingest_key = _env("DPP_INGEST_KEY")
        bucket = _env("DPP_S3_BUCKET")
        prefix = _env("DPP_S3_PREFIX", "raw").strip("/")
    else:
        api_base = _require_env("DPP_API_BASE_URL").rstrip("/")
        ingest_key = _require_env("DPP_INGEST_KEY")
        bucket = _require_env("DPP_S3_BUCKET")
        prefix = _require_env("DPP_S3_PREFIX").strip("/")

    curve_names_raw = _env("DPP_RATE_CURVE_NAMES", "Base1,Base2")
    curve_names = [x.strip() for x in curve_names_raw.split(",") if x.strip()]

    tickers_raw = _env("DPP_TICKERS", "")
    universe = [t.strip().upper() for t in tickers_raw.split(",") if t.strip()] if tickers_raw else list(DEFAULT_TICKERS)
    symbols = universe
    if symbols_override:
        unknown = [s for s in symbols_override if s not in universe]
        if unknown and not _flag(event, "allow_new_symbols"):
            # The API creates an underlying for any symbol it has not seen; a typo must not do that.
            raise ValueError(f"symbols not in the configured universe: {unknown}")
        symbols = symbols_override

    lookback_days = int(_env("DPP_LOOKBACK_DAYS", "10"))
    max_auto_backfill_days = int(_env("DPP_MAX_AUTO_BACKFILL_DAYS", "120"))
    max_missing_symbols = int(_env("DPP_MAX_MISSING_SYMBOLS", "5"))
    price_field = _env("DPP_PRICE_FIELD", "close").lower()
    chunk_rows = int(_env("DPP_UPSERT_CHUNK_ROWS", "2000"))
    history_start = _parse_date(_env("DPP_HISTORY_START", "2021-01-01"), "DPP_HISTORY_START")
    auto_split_refresh = _env("DPP_AUTO_SPLIT_REFRESH", "true").lower() in ("1", "true", "yes", "y")

    now_utc = datetime.now(timezone.utc)
    today_utc = now_utc.date()
    run_id = now_utc.strftime("%Y%m%dT%H%M%SZ")
    run_date = today_utc.isoformat()
    s3_keys: Dict[str, Any] = {}
    result: Dict[str, Any] = {"run_id": run_id, "dry_run": dry_run}
    if symbols_override:
        result["symbols_override"] = symbols_override
    split_refresh_error = ""

    # Trading days already archived in the lake: drives auto-backfill and avoids duplicate snapshots.
    existing_partitions: Optional[Set[str]] = None
    if bucket and not skip_prices:
        try:
            since = today_utc - timedelta(days=max(max_auto_backfill_days, lookback_days) + 30)
            if event.get("start_date"):
                since = min(since, _parse_date(event["start_date"], "start_date"))
            if event.get("lookback_days") is not None:
                since = min(since, today_utc - timedelta(days=int(event["lookback_days"])))
            existing_partitions = lake_partition_dates(bucket, prefix, PRICES_DATASET, since)
        except Exception as e:
            print(f"[WARN] could not list existing price partitions (snapshots fall back to as-of day only): {e}")

    watermark: Optional[date] = None
    if existing_partitions:
        watermark = _parse_date(max(existing_partitions), "watermark")

    window = resolve_window(event, today_utc, lookback_days, max_auto_backfill_days, watermark)
    result["window"] = {
        "mode": window.mode,
        "start": window.start.isoformat(),
        "end_exclusive": window.end_exclusive.isoformat(),
        "lake_watermark": watermark.isoformat() if watermark else None,
    }
    print(f"[INFO] run_id={run_id} window={result['window']} dry_run={dry_run}")

    # 1) Prices
    prices_asof = ""
    prices_payload: List[Dict[str, Any]] = []
    if not skip_prices:
        price_cfg = PriceDownloadConfig(
            start_date=window.start.isoformat(),
            end_date_exclusive=window.end_exclusive.isoformat(),
            batch_size=int(_env("DPP_PRICE_BATCH_SIZE", "25")),
            auto_adjust=False,
            max_retries=int(_env("DPP_YF_MAX_RETRIES", "6")),
            sleep_between_batches_sec=float(_env("DPP_SLEEP_BETWEEN_BATCHES_SEC", "0.75")),
        )

        df_long, missing_symbols = fetch_prices_long(symbols, price_cfg)
        if len(missing_symbols) > max_missing_symbols:
            raise RuntimeError(
                f"Yahoo returned no data for {len(missing_symbols)}/{len(symbols)} symbols "
                f"(limit {max_missing_symbols}): {missing_symbols}"
            )

        last_final = min(last_complete_session_date(now_utc), window.end_exclusive - timedelta(days=1))
        prices_payload = build_prices_payload(df_long, price_field, window.start, last_final)
        if not prices_payload:
            raise RuntimeError("No prices payload produced.")

        # A split inside the window means every older stored row is on the old share basis.
        split_symbols = symbols_with_splits(df_long, window.start, last_final)
        refresh_rows: List[Dict[str, Any]] = []
        if split_symbols and auto_split_refresh and window.start > history_start:
            print(f"[WARN] split reported inside the window for {split_symbols}; refreshing full history from {history_start}")
            try:
                hist_cfg = PriceDownloadConfig(
                    start_date=history_start.isoformat(),
                    end_date_exclusive=window.end_exclusive.isoformat(),
                    batch_size=price_cfg.batch_size,
                    auto_adjust=False,
                    max_retries=price_cfg.max_retries,
                    sleep_between_batches_sec=price_cfg.sleep_between_batches_sec,
                )
                df_hist, hist_missing = fetch_prices_long(split_symbols, hist_cfg)
                if hist_missing:
                    raise RuntimeError(f"no history returned for {hist_missing}")
                refresh_rows = build_prices_payload(df_hist, price_field, history_start, last_final)
            except Exception as e:
                split_refresh_error = f"{type(e).__name__}: {e}"
                print(f"[ERROR] split refresh failed for {split_symbols}: {split_refresh_error}")
        api_payload = merge_price_rows(prices_payload, refresh_rows)

        dates_sent = sorted({r["date"] for r in prices_payload})
        prices_asof = dates_sent[-1]
        asof_symbols = sum(1 for r in prices_payload if r["date"] == prices_asof)

        result.update({
            "prices_asof": prices_asof,
            "prices_first_date": dates_sent[0],
            "prices_dates_sent": len(dates_sent),
            "prices_rows_sent": len(api_payload),
            "prices_asof_symbols": asof_symbols,
            "prices_missing_symbols": missing_symbols,
            "price_field": price_field,
            "split_symbols": split_symbols,
            "split_refresh_rows": len(refresh_rows),
        })
        if split_refresh_error:
            result["split_refresh_error"] = split_refresh_error
        if len(symbols) <= 10:
            by_symbol: Dict[str, List[Any]] = {}
            for r in api_payload:
                entry = by_symbol.setdefault(r["symbol"], [0, r["date"], r["date"]])
                entry[0] += 1
                entry[2] = r["date"]
            result["prices_rows_by_symbol"] = by_symbol

        if not dry_run:
            # API first: a day is archived to S3 only after Postgres has accepted it,
            # so the newest S3 partition is a safe watermark for auto-backfill.
            result["prices_ingest_response"] = post_prices(api_base, ingest_key, api_payload, chunk_rows)
            # Archive window days only, and never from a partial universe.
            written = [] if symbols_override else snapshot_prices(
                bucket, prefix, prices_payload, run_id, prices_asof, existing_partitions
            )
            s3_keys["prices_snapshots"] = written
            s3_keys["prices_snapshot"] = written[-1] if written else ""
            result["prices_snapshots_written"] = len(written)

    # 2) Rates
    rates_asof = ""
    curve_payload: List[Dict[str, Any]] = []
    if not skip_rates:
        rates_cfg = RatesDownloadConfig(
            start_date=(today_utc - timedelta(days=max(lookback_days, 10))).isoformat(),
            end_date=today_utc.isoformat(),
            timeout_sec=int(_env("DPP_FRED_TIMEOUT_SEC", "20")),
            max_retries=int(_env("DPP_FRED_MAX_RETRIES", "6")),
        )

        rates_asof, curve_payload = build_latest_curve_payload(rates_cfg)
        if not curve_payload:
            raise RuntimeError("No curve payload produced from FRED window.")

        result.update({"rates_asof": rates_asof, "curve_points_sent": len(curve_payload)})

        if not dry_run:
            df_rates = pd.DataFrame(curve_payload)
            df_rates.insert(0, "asof_date", rates_asof)
            rates_key = f"{prefix}/{RATES_DATASET}/dt={rates_asof}/rates_{run_id}.csv"
            _s3_put_text(bucket, rates_key, df_rates.to_csv(index=False), "text/csv")
            s3_keys["rates_snapshot"] = rates_key

            curve_results = []
            for curve_name in curve_names:
                url = f"{api_base}/RateCurves/ByName/{curve_name}/RatePoints/Replace"
                rr = requests.put(url, json=curve_payload, headers=_api_headers(ingest_key), timeout=90)
                if rr.status_code != 200:
                    raise RuntimeError(f"Curve ingest failed curve={curve_name} status={rr.status_code} body={rr.text[:1500]}")
                curve_results.append({"curve": curve_name, "status": rr.status_code, "body": rr.text})
            result["curves_updated"] = curve_results

    if dry_run:
        result["curve_points_preview"] = curve_payload
        result["prices_sample"] = prices_payload[:3] + prices_payload[-3:]
        print(f"[INFO] DRY RUN summary={json.dumps({k: v for k, v in result.items() if k not in ('curve_points_preview', 'prices_sample')})}")
        return result

    manifest = {
        "run_id": run_id,
        "run_date_utc": run_date,
        "window": result["window"],
        "prices_asof": prices_asof,
        "prices_first_date": result.get("prices_first_date", ""),
        "prices_dates_sent": result.get("prices_dates_sent", 0),
        "prices_rows_sent": result.get("prices_rows_sent", 0),
        "prices_missing_symbols": result.get("prices_missing_symbols", []),
        "price_field": price_field,
        "symbols_override": symbols_override,
        "split_symbols": result.get("split_symbols", []),
        "split_refresh_rows": result.get("split_refresh_rows", 0),
        "split_refresh_error": split_refresh_error,
        "rates_asof": rates_asof,
        "curve_points_sent": len(curve_payload),
        "curve_names_updated": curve_names if not skip_rates else [],
        "tickers_count": len(symbols),
        "s3_keys": s3_keys,
    }

    manifest_key = f"{prefix}/manifests/dt={run_date}/manifest_{run_id}.json"
    _s3_put_text(bucket, manifest_key, json.dumps(manifest, indent=2), "application/json")
    s3_keys["manifest"] = manifest_key
    result["s3_keys"] = s3_keys

    print(f"[INFO] run complete summary={json.dumps({k: v for k, v in result.items() if k not in ('curves_updated', 's3_keys')})}")
    if split_refresh_error:
        # Everything else is ingested and recorded; fail the invocation so the error alarm fires
        # and Lambda retries (the upserts are idempotent).
        raise RuntimeError(f"split refresh failed for {result.get('split_symbols')}: {split_refresh_error}")
    return result


def lambda_handler(event, context):
    return run_once(event)


if __name__ == "__main__":
    import sys

    cli_event: Dict[str, Any] = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run_once(cli_event), indent=2, default=str))
