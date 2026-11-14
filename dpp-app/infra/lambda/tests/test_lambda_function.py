"""
Offline tests for the ingestion Lambda. No network and no AWS access needed:
Yahoo, FRED, the DPP API and S3 are replaced with in-memory fakes.

    pip install pandas requests yfinance boto3 pytest
    pytest infra/lambda/tests -q
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-2")

import lambda_function as L  # noqa: E402


# ----------------------------
# Fakes
# ----------------------------

def yahoo_frame(symbols, days, empty=(), flat=False, splits=None):
    """Shape of yf.download(group_by='ticker', auto_adjust=False, actions=True)."""
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in days], name="Date")
    fields = ["Open", "High", "Low", "Close", "Adj Close", "Volume", "Dividends", "Stock Splits"]
    splits = splits or {}
    data = {}
    for n, sym in enumerate(symbols):
        for f in fields:
            if sym in empty:
                col = [float("nan")] * len(idx)
            elif f == "Dividends":
                col = [0.0] * len(idx)
            elif f == "Stock Splits":
                col = [float(splits.get((sym, d), 0.0)) for d in days]
            else:
                base = 100.0 + 10 * n
                col = [base + i + (0.0 if f != "Adj Close" else -0.5) for i in range(len(idx))]
            data[(sym, f)] = col
    df = pd.DataFrame(data, index=idx)
    df.columns = pd.MultiIndex.from_tuples(df.columns, names=["Ticker", "Price"])
    if flat:
        df = df[symbols[0]]
    return df


class FakeS3:
    def __init__(self, keys=(), page_size=1000, deny_list=False):
        self.keys = sorted(keys)
        self.puts = []
        self.page_size = page_size
        self.deny_list = deny_list
        self.list_calls = 0

    def put_object(self, Bucket, Key, Body, ContentType):
        self.puts.append((Key, Body.decode("utf-8")))
        self.keys = sorted(set(self.keys) | {Key})

    def list_objects_v2(self, Bucket, Prefix, Delimiter, StartAfter=None, ContinuationToken=None):
        if self.deny_list:
            raise RuntimeError("AccessDenied")
        self.list_calls += 1
        prefixes = sorted({
            k[: k.index("/", len(Prefix)) + 1]
            for k in self.keys
            if k.startswith(Prefix) and (StartAfter is None or k > StartAfter)
        })
        start = int(ContinuationToken) if ContinuationToken else 0
        page = prefixes[start:start + self.page_size]
        resp = {"CommonPrefixes": [{"Prefix": p} for p in page], "IsTruncated": start + self.page_size < len(prefixes)}
        if resp["IsTruncated"]:
            resp["NextContinuationToken"] = str(start + self.page_size)
        return resp


class FakeResponse:
    def __init__(self, status=200, body=None, text=None):
        self.status_code = status
        self._body = body
        self.text = text if text is not None else json.dumps(body or {})

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


def fred_csv(series_id, days):
    rows = ["observation_date," + series_id]
    for i, d in enumerate(days):
        rows.append(f"{d},{4.0 + 0.01 * i:.2f}")
    return "\n".join(rows) + "\n"


class Harness:
    """Wires every external dependency of run_once to fakes and records calls."""

    def __init__(self, monkeypatch, now_utc, trading_days, s3_keys=(), empty_symbols=(), api_status=200,
                 splits=None, history_outage=False):
        self.calls = []
        self.posted = []
        self.s3 = FakeS3(keys=s3_keys)
        self.trading_days = trading_days
        self.empty_symbols = set(empty_symbols)
        self.api_status = api_status
        self.splits = splits or {}
        self.history_outage = history_outage
        self.downloads = []

        class FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return now_utc if tz else now_utc.replace(tzinfo=None)

        monkeypatch.setattr(L, "datetime", FrozenDatetime)
        monkeypatch.setattr(L, "_s3_client", self.s3)
        monkeypatch.setattr(L.time, "sleep", lambda s: None)
        monkeypatch.setattr(L.yf, "download", self.download)
        monkeypatch.setattr(L.requests, "get", self.get)
        monkeypatch.setattr(L.requests, "post", self.post)
        monkeypatch.setattr(L.requests, "put", self.put)
        for k, v in {
            "DPP_API_BASE_URL": "https://example.test/api",
            "DPP_INGEST_KEY": "k",
            "DPP_S3_BUCKET": "bucket",
            "DPP_S3_PREFIX": "raw",
            "DPP_LOOKBACK_DAYS": "10",
            "DPP_TICKERS": "AAA,BBB,CCC",
        }.items():
            monkeypatch.setenv(k, v)

    def download(self, tickers, start, end, **kw):
        self.downloads.append((tuple(tickers), start, end))
        assert kw.get("actions") is True and kw.get("auto_adjust") is False
        days = [d for d in self.trading_days if start <= d < end]
        if not days or (self.history_outage and start == HISTORY_START):
            return pd.DataFrame()
        return yahoo_frame(list(tickers), days, empty=self.empty_symbols, splits=self.splits)

    def get(self, url, timeout):
        sid = url.split("id=")[1]
        return FakeResponse(text=fred_csv(sid, self.trading_days[-12:]))

    def post(self, url, json, headers, timeout):
        self.calls.append(("POST", url, len(json), [k for k, _ in self.s3.puts]))
        self.posted.extend(json)
        assert headers["X-DPP-INGEST-KEY"] == "k"
        if self.api_status != 200:
            return FakeResponse(status=self.api_status, text="boom")
        return FakeResponse(body={"rowsProcessed": len(json), "inserted": len(json), "updated": 0, "deletedDuplicates": 0})

    def put(self, url, json, headers, timeout):
        self.calls.append(("PUT", url, len(json), None))
        return FakeResponse(body={"ok": True})


def weekdays(start: str, end: str):
    out, d = [], date.fromisoformat(start)
    while d <= date.fromisoformat(end):
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


SCHEDULED_NOW = datetime(2026, 11, 14, 3, 30, tzinfo=timezone.utc)  # Fri 22:30 New York
HISTORY_START = "2021-01-01"


# ----------------------------
# Unit tests
# ----------------------------

@pytest.mark.parametrize("now_utc, expected", [
    (datetime(2026, 11, 14, 3, 30, tzinfo=timezone.utc), date(2026, 11, 13)),   # scheduled run, after the close
    (datetime(2026, 11, 13, 16, 0, tzinfo=timezone.utc), date(2026, 11, 12)),   # 11:00 NY, session in progress
    (datetime(2026, 11, 13, 21, 29, tzinfo=timezone.utc), date(2026, 11, 12)),  # 16:29 NY (EST)
    (datetime(2026, 11, 13, 21, 30, tzinfo=timezone.utc), date(2026, 11, 13)),  # 16:30 NY (EST)
    (datetime(2026, 7, 1, 20, 29, tzinfo=timezone.utc), date(2026, 6, 30)),     # 16:29 NY (EDT)
    (datetime(2026, 7, 1, 20, 30, tzinfo=timezone.utc), date(2026, 7, 1)),      # 16:30 NY (EDT)
])
def test_last_complete_session_date(now_utc, expected):
    assert L.last_complete_session_date(now_utc) == expected


def test_resolve_window_modes():
    today = date(2026, 11, 14)
    w = L.resolve_window({}, today, 10, 120, watermark=date(2026, 11, 13))
    assert (w.mode, w.start, w.end_exclusive) == ("scheduled", date(2026, 11, 4), date(2026, 11, 15))

    w = L.resolve_window({}, today, 10, 120, watermark=None)
    assert (w.mode, w.start) == ("scheduled", date(2026, 11, 4))

    # Outage: last archived day is five weeks back -> widen automatically.
    w = L.resolve_window({}, today, 10, 120, watermark=date(2026, 10, 9))
    assert (w.mode, w.start) == ("auto-backfill", date(2026, 10, 7))

    # Very long outage is capped.
    w = L.resolve_window({}, today, 10, 120, watermark=date(2025, 1, 1))
    assert (w.mode, w.start) == ("auto-backfill", today - timedelta(days=120))

    w = L.resolve_window({"lookback_days": 40}, today, 10, 120, watermark=date(2026, 11, 13))
    assert (w.mode, w.start) == ("explicit", date(2026, 10, 5))

    w = L.resolve_window({"start_date": "2026-07-03", "end_date": "2026-10-08"}, today, 10, 120, None)
    assert (w.mode, w.start, w.end_exclusive) == ("explicit", date(2026, 7, 3), date(2026, 10, 9))

    # EventBridge's own payload must not be mistaken for overrides.
    eb = {"version": "0", "detail-type": "Scheduled Event", "source": "aws.events", "time": "2026-11-14T03:30:00Z", "detail": {}}
    assert L.resolve_window(eb, today, 10, 120, date(2026, 11, 13)).mode == "scheduled"

    with pytest.raises(ValueError):
        L.resolve_window({"start_date": "2026-11-10", "end_date": "2026-11-01"}, today, 10, 120, None)
    with pytest.raises(ValueError):
        L.resolve_window({"start_date": "11/10/2026"}, today, 10, 120, None)
    with pytest.raises(ValueError):
        L.resolve_window({"lookback_days": 0}, today, 10, 120, None)


def test_wide_to_long_multiindex_and_flat():
    days = ["2026-11-12", "2026-11-13"]
    long = L._yf_wide_to_long(yahoo_frame(["AAA", "BBB"], days, splits={("BBB", "2026-11-13"): 4.0}), None)
    assert list(long.columns) == ["date", "symbol", "close", "adj_close", "split"]
    assert sorted(long["symbol"].unique()) == ["AAA", "BBB"]
    assert sorted(long["date"].unique()) == days
    row = long[(long.symbol == "BBB") & (long.date == "2026-11-13")].iloc[0]
    assert (row.close, row.adj_close, row.split) == (111.0, 110.5, 4.0)
    assert L.symbols_with_splits(long, date(2026, 11, 12), date(2026, 11, 13)) == ["BBB"]
    assert L.symbols_with_splits(long, date(2026, 11, 12), date(2026, 11, 12)) == []

    # A frame without the actions columns (older yfinance, or actions unavailable) still normalizes.
    no_actions = yahoo_frame(["AAA"], days).drop(columns=[("AAA", "Stock Splits"), ("AAA", "Dividends")])
    assert (L._yf_wide_to_long(no_actions, None)["split"] == 0.0).all()

    flat = L._yf_wide_to_long(yahoo_frame(["AAA"], days, flat=True), ["AAA"])
    assert sorted(flat["symbol"].unique()) == ["AAA"] and len(flat) == 2

    assert L._yf_wide_to_long(pd.DataFrame(), None).empty


def test_build_payload_window_field_and_dedup():
    days = weekdays("2026-11-02", "2026-11-13")
    long = L._yf_wide_to_long(yahoo_frame(["AAA", "BBB"], days), None)
    long = pd.concat([long, long.tail(1)], ignore_index=True)  # duplicate row

    rows = L.build_prices_payload(long, "close", date(2026, 11, 4), date(2026, 11, 12))
    assert {r["date"] for r in rows} == set(weekdays("2026-11-04", "2026-11-12"))
    assert len(rows) == 2 * 7
    assert all(r["price"] == int(r["price"]) for r in rows)             # Close, not Adj Close

    adj = L.build_prices_payload(long, "adj_close", date(2026, 11, 4), date(2026, 11, 12))
    assert all(r["price"] != int(r["price"]) for r in adj)

    assert L.build_prices_payload(long.iloc[0:0], "close", date(2026, 11, 4), date(2026, 11, 12)) == []


def test_lake_partition_dates_paginates_and_respects_since():
    keys = [f"raw/prices_ndx50/dt={d}/prices_x.csv" for d in weekdays("2026-06-01", "2026-11-13")]
    keys += ["raw/rates_fred/dt=2026-11-13/rates_x.csv", "raw/prices_ndx50/dt=bad/x.csv"]
    s3 = FakeS3(keys=keys, page_size=7)
    L._s3_client = s3
    try:
        got = L.lake_partition_dates("bucket", "raw", "prices_ndx50", date(2026, 10, 1))
    finally:
        L._s3_client = None
    assert got == set(weekdays("2026-10-01", "2026-11-13"))
    assert s3.list_calls > 1


# ----------------------------
# End-to-end with fakes
# ----------------------------

def lake(days):
    return [f"raw/prices_ndx50/dt={d}/prices_old.csv" for d in days]


def test_scheduled_run_sends_whole_window_and_archives_only_new_days(monkeypatch):
    days = weekdays("2026-09-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(weekdays("2026-09-01", "2026-11-12")))

    out = L.run_once({"version": "0", "source": "aws.events"})

    assert out["window"]["mode"] == "scheduled"
    assert out["prices_asof"] == "2026-11-13"
    assert out["prices_first_date"] == "2026-11-04"
    assert out["prices_rows_sent"] == 3 * 8                      # 8 trading days x 3 symbols
    assert out["prices_ingest_response"]["inserted"] == 24

    price_puts = [k for k, _ in h.s3.puts if "/prices_ndx50/" in k]
    assert [k.split("dt=")[1][:10] for k in price_puts] == ["2026-11-13"]   # only the new day
    post = [c for c in h.calls if c[0] == "POST"][0]
    assert post[3] == []                                         # API accepted rows before any S3 write
    assert len([c for c in h.calls if c[0] == "PUT"]) == 2       # Base1, Base2
    manifest = json.loads([b for k, b in h.s3.puts if "/manifests/" in k][0])
    assert manifest["prices_dates_sent"] == 8 and manifest["window"]["mode"] == "scheduled"
    assert out["split_symbols"] == [] and out["split_refresh_rows"] == 0
    assert all(start != HISTORY_START for _, start, _ in h.downloads)   # no split, no history pull
    json.dumps(out)                                              # Lambda must be able to serialize the result


def test_outage_heals_itself_without_manual_backfill(monkeypatch):
    days = weekdays("2026-09-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(weekdays("2026-09-01", "2026-10-09")))

    out = L.run_once({})

    assert out["window"]["mode"] == "auto-backfill"
    assert out["prices_first_date"] == "2026-10-07"
    expected_new = weekdays("2026-10-12", "2026-11-13")
    price_puts = sorted(k.split("dt=")[1][:10] for k, _ in h.s3.puts if "/prices_ndx50/" in k)
    assert price_puts == expected_new                            # every missed day archived once
    assert out["prices_rows_sent"] == 3 * len(weekdays("2026-10-07", "2026-11-13"))


def test_explicit_backfill_fills_lake_gaps_only(monkeypatch):
    days = weekdays("2026-09-01", "2026-11-13")
    have = ["2026-10-09", "2026-11-13"]
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(have))

    out = L.run_once({"lookback_days": 40})

    assert out["window"] == {"mode": "explicit", "start": "2026-10-05", "end_exclusive": "2026-11-15", "lake_watermark": "2026-11-13"}
    wrote = sorted(k.split("dt=")[1][:10] for k, _ in h.s3.puts if "/prices_ndx50/" in k)
    assert wrote == [d for d in weekdays("2026-10-05", "2026-11-13") if d not in have]
    csv = [b for k, b in h.s3.puts if "dt=2026-10-12" in k][0]
    assert csv.splitlines()[0] == "symbol,date,price" and len(csv.splitlines()) == 4


def test_in_progress_session_is_not_ingested(monkeypatch):
    days = weekdays("2026-11-02", "2026-11-13")
    midday = datetime(2026, 11, 13, 17, 0, tzinfo=timezone.utc)   # Fri 12:00 New York
    Harness(monkeypatch, midday, days, s3_keys=lake(weekdays("2026-11-02", "2026-11-12")))
    out = L.run_once({})
    assert out["prices_asof"] == "2026-11-12"


def test_dry_run_touches_nothing(monkeypatch):
    days = weekdays("2026-10-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(weekdays("2026-10-01", "2026-11-12")))
    monkeypatch.delenv("DPP_INGEST_KEY")
    monkeypatch.delenv("DPP_API_BASE_URL")

    out = L.run_once({"dry_run": True})

    assert out["dry_run"] is True and out["prices_rows_sent"] == 24 and out["curve_points_sent"] == 12
    assert h.calls == [] and h.s3.puts == []
    json.dumps(out)


def test_partial_yahoo_failure_is_tolerated_but_reported(monkeypatch):
    days = weekdays("2026-11-02", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(days[:-1]), empty_symbols={"CCC"})
    out = L.run_once({})
    assert out["prices_missing_symbols"] == ["CCC"]
    assert out["prices_asof_symbols"] == 2
    assert (("CCC",), "2026-11-04", "2026-11-15") in h.downloads   # retried on its own


def test_widespread_yahoo_failure_fails_loudly_and_writes_nothing(monkeypatch):
    days = weekdays("2026-11-02", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(days[:-1]), empty_symbols={"BBB", "CCC"})
    monkeypatch.setenv("DPP_MAX_MISSING_SYMBOLS", "1")
    with pytest.raises(RuntimeError, match="no data for 2/3"):
        L.run_once({})
    assert h.calls == [] and h.s3.puts == []


def test_total_yahoo_outage_raises(monkeypatch):
    h = Harness(monkeypatch, SCHEDULED_NOW, trading_days=[], s3_keys=())
    monkeypatch.setenv("DPP_YF_MAX_RETRIES", "2")
    with pytest.raises(RuntimeError, match="yfinance download failed"):
        L.run_once({"skip_rates": True})
    assert h.calls == [] and h.s3.puts == []


def test_api_rejection_archives_nothing(monkeypatch):
    days = weekdays("2026-11-02", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(days[:-1]), api_status=401)
    with pytest.raises(RuntimeError, match="status=401"):
        L.run_once({})
    assert h.s3.puts == []        # no partition written, so the watermark cannot run ahead of Postgres


def test_listing_denied_falls_back_to_asof_snapshot(monkeypatch):
    days = weekdays("2026-11-02", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days)
    h.s3.deny_list = True
    out = L.run_once({})
    wrote = [k.split("dt=")[1][:10] for k, _ in h.s3.puts if "/prices_ndx50/" in k]
    assert wrote == ["2026-11-13"] and out["window"]["mode"] == "scheduled"


def test_large_backfill_is_chunked(monkeypatch):
    days = weekdays("2026-07-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days)
    monkeypatch.setenv("DPP_UPSERT_CHUNK_ROWS", "100")
    out = L.run_once({"start_date": "2026-07-03", "skip_rates": True})
    posts = [c for c in h.calls if c[0] == "POST"]
    assert len(posts) == out["prices_ingest_response"]["requests"] == -(-out["prices_rows_sent"] // 100)
    assert sum(c[2] for c in posts) == out["prices_rows_sent"]
    assert "curves_updated" not in out


# ----------------------------
# Splits and correction runs
# ----------------------------

def test_split_in_window_refreshes_full_history(monkeypatch):
    days = weekdays("2026-06-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(weekdays("2026-06-01", "2026-11-12")),
                splits={("BBB", "2026-11-10"): 25.0})

    out = L.run_once({})

    assert out["split_symbols"] == ["BBB"]
    assert (("BBB",), HISTORY_START, "2026-11-15") in h.downloads
    bbb = sorted(r["date"] for r in h.posted if r["symbol"] == "BBB")
    aaa = sorted(r["date"] for r in h.posted if r["symbol"] == "AAA")
    assert bbb == days                                   # whole history for the split name
    assert aaa == weekdays("2026-11-04", "2026-11-13")   # window only for everyone else
    assert out["split_refresh_rows"] == len(days)
    assert out["prices_rows_sent"] == len(h.posted) == len(days) + 2 * 8
    assert len({(r["symbol"], r["date"]) for r in h.posted}) == len(h.posted)   # no duplicate keys
    price_puts = [k.split("dt=")[1][:10] for k, _ in h.s3.puts if "/prices_ndx50/" in k]
    assert price_puts == ["2026-11-13"]                  # the lake still archives window days only
    manifest = json.loads([b for k, b in h.s3.puts if "/manifests/" in k][0])
    assert manifest["split_symbols"] == ["BBB"] and manifest["split_refresh_error"] == ""


def test_split_refresh_failure_ingests_everything_then_fails_the_run(monkeypatch):
    days = weekdays("2026-06-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(weekdays("2026-06-01", "2026-11-12")),
                splits={("BBB", "2026-11-10"): 25.0}, history_outage=True)
    monkeypatch.setenv("DPP_YF_MAX_RETRIES", "2")

    with pytest.raises(RuntimeError, match="split refresh failed"):
        L.run_once({})

    assert len(h.posted) == 3 * 8                                   # the normal window still landed
    assert len([c for c in h.calls if c[0] == "PUT"]) == 2          # and so did the curves
    manifest = json.loads([b for k, b in h.s3.puts if "/manifests/" in k][0])
    assert "yfinance download failed" in manifest["split_refresh_error"]


def test_split_refresh_can_be_switched_off(monkeypatch):
    days = weekdays("2026-06-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(days[:-1]), splits={("BBB", "2026-11-10"): 25.0})
    monkeypatch.setenv("DPP_AUTO_SPLIT_REFRESH", "false")
    out = L.run_once({})
    assert out["split_symbols"] == ["BBB"] and out["split_refresh_rows"] == 0
    assert len(h.posted) == 3 * 8


def test_symbols_override_is_prices_only_and_never_archived(monkeypatch):
    days = weekdays("2026-06-01", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days, s3_keys=lake(["2026-11-13"]),
                splits={("BBB", "2026-07-01"): 4.0})

    out = L.run_once({"symbols": "bbb, CCC", "start_date": "2021-01-01"})

    assert out["symbols_override"] == ["BBB", "CCC"]
    assert {r["symbol"] for r in h.posted} == {"BBB", "CCC"}
    assert len(h.posted) == 2 * len(days)
    assert out["prices_rows_by_symbol"] == {"BBB": [len(days), days[0], days[-1]], "CCC": [len(days), days[0], days[-1]]}
    assert out["split_refresh_rows"] == 0                          # the window already is the full history
    assert [c for c in h.calls if c[0] == "PUT"] == []            # curves untouched
    assert [k for k, _ in h.s3.puts if "/prices_ndx50/" in k] == []
    assert "rates_asof" not in out
    manifest = json.loads([b for k, b in h.s3.puts if "/manifests/" in k][0])
    assert manifest["symbols_override"] == ["BBB", "CCC"] and manifest["curve_names_updated"] == []
    json.dumps(out)


def test_symbols_override_rejects_names_outside_the_universe(monkeypatch):
    days = weekdays("2026-11-02", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days)
    with pytest.raises(ValueError, match="not in the configured universe"):
        L.run_once({"symbols": ["BBB", "TYPO"]})
    assert h.calls == [] and h.s3.puts == [] and h.downloads == []

    out = L.run_once({"symbols": ["NEW"], "allow_new_symbols": True, "dry_run": True})
    assert out["symbols_override"] == ["NEW"] and out["prices_rows_sent"] == 8


def test_symbols_override_can_still_refresh_rates_when_asked(monkeypatch):
    days = weekdays("2026-11-02", "2026-11-13")
    h = Harness(monkeypatch, SCHEDULED_NOW, days)
    out = L.run_once({"symbols": ["AAA"], "skip_rates": False})
    assert out["curve_points_sent"] == 12 and len([c for c in h.calls if c[0] == "PUT"]) == 2
