from __future__ import annotations

import os
import time
import random
import json
import boto3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import List, Dict, Any, Tuple

import pandas as pd
import requests
import yfinance as yf


# ----------------------------
# CONFIG (matches your scratch intent)
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


# ----------------------------
# S3 (Step 9: raw snapshots + manifest)
# ----------------------------

_s3 = boto3.client("s3")


def _s3_bucket() -> str:
    return _require_env("DPP_S3_BUCKET").strip()


def _s3_prefix() -> str:
    p = _require_env("DPP_S3_PREFIX").strip()
    return p.strip("/")


def _s3_put_text(bucket: str, key: str, body_text: str, content_type: str) -> None:
    _s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body_text.encode("utf-8"),
        ContentType=content_type,
    )


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


def _sleep_backoff(attempt: int, max_sleep: float = 20.0) -> None:
    # Exponential backoff + jitter
    sleep = min(max_sleep, (2 ** (attempt - 1)) + random.random())
    time.sleep(sleep)


# ----------------------------
# PRICES (yfinance batching like your scratch)
# ----------------------------

def _yf_download_with_retry(batch: List[str], cfg: PriceDownloadConfig) -> pd.DataFrame:
    last_err: Exception | None = None

    for attempt in range(1, cfg.max_retries + 1):
        try:
            # IMPORTANT: threads=False to reduce burstiness / throttling
            df = yf.download(
                tickers=batch,
                start=cfg.start_date,
                end=cfg.end_date_exclusive,
                interval=cfg.interval,
                group_by="ticker",
                auto_adjust=cfg.auto_adjust,
                actions=False,
                threads=False,
                progress=False,
            )
            if df is None or df.empty:
                raise RuntimeError("yfinance returned empty dataframe (possible throttling).")
            return df

        except Exception as e:
            last_err = e
            print(f"[WARN] yfinance download failed attempt={attempt}/{cfg.max_retries} batch_size={len(batch)} err={e}")
            _sleep_backoff(attempt)

    raise RuntimeError("yfinance download failed after retries.") from last_err


def _yf_wide_to_long(df: pd.DataFrame, symbols_if_single: List[str] | None) -> pd.DataFrame:
    """
    Normalize yfinance output to long format:
      columns: date(str YYYY-MM-DD), symbol(str), close(float), adj_close(float|NaN)
    """
    if df is None or df.empty:
        return pd.DataFrame(columns=["date", "symbol", "close", "adj_close"])

    if isinstance(df.columns, pd.MultiIndex):
        parts = []
        for sym in df.columns.levels[0]:
            sub = df[sym].copy()
            sub["symbol"] = sym
            parts.append(sub.reset_index())
        out = pd.concat(parts, ignore_index=True)

        out = out.rename(columns={
            "Date": "date",
            "Close": "close",
            "Adj Close": "adj_close",
        })

        out["date"] = pd.to_datetime(out["date"], utc=True).dt.date.astype(str)

        if "adj_close" not in out.columns:
            out["adj_close"] = pd.NA
        if "close" not in out.columns:
            out["close"] = pd.NA

        return out[["date", "symbol", "close", "adj_close"]]

    # Single ticker case (flat columns)
    sym = symbols_if_single[0] if symbols_if_single and len(symbols_if_single) == 1 else "UNKNOWN"
    out = df.reset_index().copy()
    out["symbol"] = sym

    out = out.rename(columns={
        "Date": "date",
        "Close": "close",
        "Adj Close": "adj_close",
    })

    out["date"] = pd.to_datetime(out["date"], utc=True).dt.date.astype(str)

    if "adj_close" not in out.columns:
        out["adj_close"] = pd.NA
    if "close" not in out.columns:
        out["close"] = pd.NA

    return out[["date", "symbol", "close", "adj_close"]]


def build_latest_prices_payload(symbols: List[str], cfg: PriceDownloadConfig) -> Tuple[str, List[Dict[str, Any]]]:
    parts: List[pd.DataFrame] = []

    for i in range(0, len(symbols), cfg.batch_size):
        batch = symbols[i:i + cfg.batch_size]
        raw = _yf_download_with_retry(batch, cfg)
        part = _yf_wide_to_long(raw, symbols_if_single=batch if len(batch) == 1 else None)
        parts.append(part)
        time.sleep(cfg.sleep_between_batches_sec)

    df = pd.concat(parts, ignore_index=True)
    df = df.dropna(subset=["close"]).copy()

    if df.empty:
        return ("", [])

    asof_date = df["date"].max()
    df_latest = df[df["date"] == asof_date].copy()

    # Prefer adj_close where available; else close
    df_latest["price"] = df_latest["adj_close"].where(df_latest["adj_close"].notna(), df_latest["close"])
    df_latest = df_latest.dropna(subset=["price"]).copy()

    payload = [
        {"symbol": str(r.symbol).upper(), "date": str(r.date), "price": float(r.price)}
        for r in df_latest[["symbol", "date", "price"]].itertuples(index=False)
    ]

    return (asof_date, payload)


# ----------------------------
# RATES (FRED like your scratch-rates)
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

def run_once() -> Dict[str, Any]:
    api_base = _require_env("DPP_API_BASE_URL").rstrip("/")
    ingest_key = _require_env("DPP_INGEST_KEY")

    curve_names_raw = _env("DPP_RATE_CURVE_NAMES", "Base1,Base2")
    curve_names = [x.strip() for x in curve_names_raw.split(",") if x.strip()]

    tickers_raw = _env("DPP_TICKERS", "")
    symbols = [t.strip().upper() for t in tickers_raw.split(",") if t.strip()] if tickers_raw else DEFAULT_TICKERS

    lookback_days = int(_env("DPP_LOOKBACK_DAYS", "10"))
    end_excl = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    start = (datetime.now(timezone.utc).date() - timedelta(days=lookback_days)).isoformat()

    bucket = _s3_bucket()
    prefix = _s3_prefix()

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_date = datetime.now(timezone.utc).date().isoformat()
    s3_keys: Dict[str, str] = {}

    # 1) Prices
    price_cfg = PriceDownloadConfig(
        start_date=start,
        end_date_exclusive=end_excl,
        batch_size=int(_env("DPP_PRICE_BATCH_SIZE", "25")),
        auto_adjust=False,
        max_retries=int(_env("DPP_YF_MAX_RETRIES", "6")),
        sleep_between_batches_sec=float(_env("DPP_SLEEP_BETWEEN_BATCHES_SEC", "0.75")),
    )

    prices_asof, prices_payload = build_latest_prices_payload(symbols, price_cfg)
    if not prices_payload:
        raise RuntimeError("No prices payload produced.")

    df_prices = pd.DataFrame(prices_payload)
    prices_key = f"{prefix}/prices_ndx50/dt={prices_asof}/prices_{run_id}.csv"
    _s3_put_text(bucket, prices_key, df_prices.to_csv(index=False), "text/csv")
    s3_keys["prices_snapshot"] = prices_key

    prices_url = f"{api_base}/Underlyings/HistoricalPrices/UpsertBySymbol"
    rp = requests.post(prices_url, json=prices_payload, headers=_api_headers(ingest_key), timeout=90)
    if rp.status_code != 200:
        raise RuntimeError(f"Prices ingest failed status={rp.status_code} body={rp.text[:1500]}")

    # 2) Rates
    rates_cfg = RatesDownloadConfig(
        start_date=start,
        end_date=datetime.now(timezone.utc).date().isoformat(),
        timeout_sec=int(_env("DPP_FRED_TIMEOUT_SEC", "20")),
        max_retries=int(_env("DPP_FRED_MAX_RETRIES", "6")),
    )

    rates_asof, curve_payload = build_latest_curve_payload(rates_cfg)
    if not curve_payload:
        raise RuntimeError("No curve payload produced from FRED window.")

    df_rates = pd.DataFrame(curve_payload)
    df_rates.insert(0, "asof_date", rates_asof)
    rates_key = f"{prefix}/rates_fred/dt={rates_asof}/rates_{run_id}.csv"
    _s3_put_text(bucket, rates_key, df_rates.to_csv(index=False), "text/csv")
    s3_keys["rates_snapshot"] = rates_key

    curve_results = []
    for curve_name in curve_names:
        url = f"{api_base}/RateCurves/ByName/{curve_name}/RatePoints/Replace"
        rr = requests.put(url, json=curve_payload, headers=_api_headers(ingest_key), timeout=90)
        if rr.status_code != 200:
            raise RuntimeError(f"Curve ingest failed curve={curve_name} status={rr.status_code} body={rr.text[:1500]}")
        curve_results.append({"curve": curve_name, "status": rr.status_code, "body": rr.text})

    manifest = {
        "run_id": run_id,
        "run_date_utc": run_date,
        "prices_asof": prices_asof,
        "prices_rows_sent": len(prices_payload),
        "rates_asof": rates_asof,
        "curve_points_sent": len(curve_payload),
        "curve_names_updated": curve_names,
        "tickers_count": len(symbols),
        "s3_keys": s3_keys,
    }

    manifest_key = f"{prefix}/manifests/dt={run_date}/manifest_{run_id}.json"
    _s3_put_text(bucket, manifest_key, json.dumps(manifest, indent=2), "application/json")
    s3_keys["manifest"] = manifest_key

    return {
        "run_id": run_id,
        "prices_asof": prices_asof,
        "prices_rows_sent": len(prices_payload),
        "prices_ingest_response": rp.text[:2000],
        "rates_asof": rates_asof,
        "curve_points_sent": len(curve_payload),
        "curves_updated": curve_results,
        "s3_keys": s3_keys,
    }


def lambda_handler(event, context):
    return run_once()


if __name__ == "__main__":
    out = run_once()
    print(out)
