// DPP AI, the part that runs in the browser: the client for the AI service and
// the tools the model may ask for. Tools work on the data the screens already
// hold and call the same API functions the tickets use, so whatever the
// assistant does shows up in the app like a change made by hand.

import { api, day, today, liveCurve, curveKind, curvePoints, nearestRate, rateAt, OPTION_TYPES, BARRIER_TYPES } from './api';
import type { OptionEntity, OptionBody, RateCurve, RatePoint, Trade, TradeValuation, UStats, ValuationRequest, Price } from './api';
import type { Ctx } from './shell';

// ---------------------------------------------------------------- service client

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Json }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type WireMessage = { role: 'user' | 'assistant'; content: Block[] };
export type AiStatus = { enabled: boolean; model: string; ownerSetUp: boolean; resting: string };
export type StreamEvent =
  | { t: 'text'; d: string }
  | { t: 'tool'; id: string; name: string; input: Json }
  | { t: 'done'; stop: string; dropped: number }
  | { t: 'error'; code: string; message: string };
export type Json = { [key: string]: unknown };

export class AiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const BASE = '/api/ai';
const UNREACHABLE = 'DPP AI could not be reached. Check the connection and try again.';

async function refusal(res: Response): Promise<AiError> {
  try {
    const j = await res.json();
    if (j && typeof j.message === 'string') return new AiError(String(j.code || 'error'), j.message);
  } catch (e) {
    // not JSON: fall through to the generic sentence
  }
  return new AiError('error', res.status === 404 || res.status === 502 ? 'DPP AI is not available right now.' : 'DPP AI answered ' + res.status + '. Try again.');
}

export async function aiStatus(): Promise<AiStatus | null> {
  try {
    const res = await fetch(BASE + '/status');
    if (!res.ok) return null;
    const j = await res.json();
    return { enabled: Boolean(j.enabled), model: String(j.model || ''), ownerSetUp: Boolean(j.ownerSetUp), resting: String(j.resting || '') };
  } catch (e) {
    return null;
  }
}

export async function aiUnlock(passcode: string): Promise<{ token: string; expiresAt: number }> {
  let res: Response;
  try {
    res = await fetch(BASE + '/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: passcode }) });
  } catch (e) {
    throw new AiError('unreachable', UNREACHABLE);
  }
  if (!res.ok) throw await refusal(res);
  const j = await res.json();
  return { token: String(j.token), expiresAt: Number(j.expiresAt) };
}

// One model call. Events arrive as they are produced; the promise settles when the stream ends.
export async function aiChat(
  body: { messages: WireMessage[]; context: Json; ownerToken?: string },
  onEvent: (ev: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(BASE + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new AiError('unreachable', UNREACHABLE);
  }
  if (!res.ok || !res.body) throw await refusal(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const feed = (line: string) => {
    const text = line.trim();
    if (!text) return;
    try {
      onEvent(JSON.parse(text) as StreamEvent);
    } catch (e) {
      // a broken line: skip it, the stream's last line tells how it ended
    }
  };
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });
    let cut = buffer.indexOf('\n');
    while (cut >= 0) {
      feed(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 1);
      cut = buffer.indexOf('\n');
    }
  }
  feed(buffer + decoder.decode());
}

// ---------------------------------------------------------------- tools: shared pieces

export type ToolCtx = Pick<
  Ctx,
  'underlyings' | 'stats' | 'options' | 'trades' | 'curves' | 'valuation' | 'reload' | 'go' | 'setSelUnderlying' | 'setSelOption' | 'section' | 'selUnderlying' | 'selOption'
>;

export type Done = { result: Json; summary: string };
// A change, described before it happens: the person confirms it, then apply() carries it out.
export type Plan = { title: string; lines: string[]; danger: boolean; apply: () => Promise<Done> };

// A request the tool cannot carry out. The sentence goes back to the model as the tool's answer.
export class ToolError extends Error {}

const TYPE_KEYS = ['', 'european', 'asian', 'digital', 'barrier', 'lookback', 'range'];
const BARRIER_KEYS = ['', 'up_and_in', 'up_and_out', 'down_and_in', 'down_and_out'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MS = 365 * 86400000;

const str = (a: Json, k: string): string => (typeof a[k] === 'string' ? (a[k] as string).trim() : typeof a[k] === 'number' ? String(a[k]) : '');
const num = (a: Json, k: string): number | null => {
  const v = a[k];
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const flag = (a: Json, k: string, fallback: boolean): boolean => (typeof a[k] === 'boolean' ? (a[k] as boolean) : fallback);
const round = (x: number | null | undefined, d: number): number | null => {
  if (x === null || x === undefined || !isFinite(x)) return null;
  const m = Math.pow(10, d);
  return Math.round(x * m) / m;
};
const pct = (x: number | null | undefined, d = 2): number | null => (x === null || x === undefined ? null : round(x * 100, d));
const money = (x: number): string => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function isoDay(a: Json, k: string, what: string): string {
  const v = str(a, k);
  if (!v) return '';
  if (!ISO_DAY.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))) throw new ToolError(what + ' must be a date like 2026-11-13.');
  return v;
}

function loaded<T>(v: T | null, what: string): T {
  if (v === null) throw new ToolError(what + ' are still loading. Try again in a few seconds.');
  return v;
}

function underlyingBy(ctx: ToolCtx, symbol: string): UStats {
  loaded(ctx.underlyings, 'Prices');
  const key = symbol.trim().toUpperCase();
  if (!key) throw new ToolError('Say which underlying, by its ticker.');
  const hit = ctx.stats.find((s) => s.symbol.toUpperCase() === key);
  if (hit) return hit;
  const near = ctx.stats.filter((s) => s.symbol.toUpperCase().indexOf(key) >= 0 || s.name.toUpperCase().indexOf(key) >= 0).slice(0, 6).map((s) => s.symbol);
  throw new ToolError('There is no underlying with the ticker ' + symbol + '.' + (near.length ? ' Close matches: ' + near.join(', ') + '.' : ''));
}

function optionBy(ctx: ToolCtx, symbol: string): OptionEntity {
  const all = loaded(ctx.options, 'Derivatives');
  const key = symbol.trim().toUpperCase();
  if (!key) throw new ToolError('Say which contract, by its symbol.');
  const hit = all.find((o) => o.symbol.toUpperCase() === key);
  if (hit) return hit;
  const near = all.filter((o) => o.symbol.toUpperCase().indexOf(key) >= 0).slice(0, 6).map((o) => o.symbol);
  throw new ToolError('There is no contract with the symbol ' + symbol + '.' + (near.length ? ' Close matches: ' + near.join(', ') + '.' : ''));
}

// Empty text means the live curve. Otherwise the exact name, or the only curve that contains the text.
function curveBy(ctx: ToolCtx, text: string): RateCurve {
  const all = loaded(ctx.curves, 'Rate curves');
  const key = text.trim().toLowerCase();
  if (!key) {
    const live = liveCurve(all) || all[0];
    if (!live) throw new ToolError('There is no rate curve in the app.');
    return live;
  }
  const exact = all.find((c) => c.name.toLowerCase() === key || String(c.id) === key);
  if (exact) return exact;
  const some = all.filter((c) => c.name.toLowerCase().indexOf(key) >= 0);
  if (some.length === 1) return some[0];
  if (some.length === 0) throw new ToolError('No rate curve matches "' + text + '". Use get_rate_curves to see the names.');
  throw new ToolError('"' + text + '" matches several curves: ' + some.slice(0, 8).map((c) => c.name).join('; ') + '. Use the full name.');
}

const editableCurve = (c: RateCurve): boolean => curveKind(c) === 'yours' || curveKind(c) === 'scenario';

type BookView = { net: { [id: number]: number }; byTrade: { [id: number]: TradeValuation }; unit: { [instrumentId: number]: number } };

function bookOf(ctx: ToolCtx): BookView {
  const b: BookView = { net: {}, byTrade: {}, unit: {} };
  (ctx.valuation ? ctx.valuation.valuations : []).forEach((v) => { b.byTrade[v.tradeId] = v; });
  (ctx.trades || []).forEach((t) => {
    b.net[t.instrumentId] = (b.net[t.instrumentId] || 0) + t.quantity;
    const v = b.byTrade[t.id];
    if (v && v.status === 'valued' && b.unit[t.instrumentId] === undefined) b.unit[t.instrumentId] = v.unitPrice;
  });
  return b;
}

function underlyingSymbolOf(ctx: ToolCtx, instrumentId: number): string {
  const o = (ctx.options || []).find((x) => x.id === instrumentId);
  if (o) return o.underlying ? o.underlying.symbol : '';
  const u = ctx.stats.find((s) => s.id === instrumentId);
  return u ? u.symbol : '';
}

function expired(o: OptionEntity): boolean {
  return Date.parse(o.expirationDate) <= Date.now();
}

function volOf(prices: number[]): number | null {
  if (prices.length < 3) return null;
  const lr: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0 || prices[i] <= 0) return null;
    lr.push(Math.log(prices[i] / prices[i - 1]));
  }
  const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
  const variance = lr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (lr.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function historyOf(ctx: ToolCtx, id: number): Price[] {
  const u = (ctx.underlyings || []).find((x) => x.id === id);
  return u ? u.historicalPrices || [] : [];
}

const optionLine = (o: OptionEntity): string =>
  o.optionTypeName + (o.isCall ? ' call' : ' put') + ' on ' + (o.underlying ? o.underlying.symbol : 'its underlying') +
  (o.optionType === 6 ? '' : ', strike ' + money(o.strikePrice)) + ', expires ' + day(o.expirationDate);

// ---------------------------------------------------------------- read tools

const READ: { [name: string]: (a: Json, ctx: ToolCtx) => Promise<Done> | Done } = {
  get_underlyings: (a, ctx) => {
    loaded(ctx.underlyings, 'Prices');
    const wanted = Array.isArray(a.symbols) ? (a.symbols as unknown[]).map((x) => String(x).trim().toUpperCase()).filter((x) => x) : [];
    const q = str(a, 'query').toLowerCase();
    let rows = ctx.stats.slice();
    if (wanted.length) rows = rows.filter((s) => wanted.indexOf(s.symbol.toUpperCase()) >= 0);
    if (q) rows = rows.filter((s) => s.symbol.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0);
    const missing = wanted.filter((x) => !ctx.stats.some((s) => s.symbol.toUpperCase() === x));
    const result: Json = {
      count: rows.length,
      underlyings: rows.slice(0, 60).map((s) => ({
        symbol: s.symbol, name: s.name, last: round(s.last, 2), date: s.lastDate, change_pct: round(s.changePct, 2),
        vol_pct: pct(s.vol, 1), low_52w: round(s.lo52, 2), high_52w: round(s.hi52, 2), closes: s.n, predefined: s.predefined,
      })),
    };
    if (missing.length) result.not_found = missing;
    return { result: result, summary: rows.length === 1 ? rows[0].symbol : plural(rows.length, 'underlying', 'underlyings') };
  },

  get_price_history: (a, ctx) => {
    const u = underlyingBy(ctx, str(a, 'symbol'));
    const hp = historyOf(ctx, u.id);
    const to = isoDay(a, 'to', 'The end') || u.lastDate;
    const from = isoDay(a, 'from', 'The start') || new Date(Date.parse(to + 'T00:00:00Z') - YEAR_MS).toISOString().slice(0, 10);
    const rows = hp.filter((h) => day(h.date) >= from && day(h.date) <= to);
    if (rows.length === 0) throw new ToolError(u.symbol + ' has no closes between ' + from + ' and ' + to + '. Its history runs from ' + u.first + ' to ' + u.lastDate + '.');
    const first = rows[0];
    const last = rows[rows.length - 1];
    let hi = rows[0];
    let lo = rows[0];
    rows.forEach((h) => { if (h.price > hi.price) hi = h; if (h.price < lo.price) lo = h; });
    const step = Math.ceil(rows.length / 60);
    return {
      result: {
        symbol: u.symbol, name: u.name, from: day(first.date), to: day(last.date), closes: rows.length,
        first_close: round(first.price, 2), last_close: round(last.price, 2), return_pct: round((last.price / first.price - 1) * 100, 2),
        high: { date: day(hi.date), close: round(hi.price, 2) }, low: { date: day(lo.date), close: round(lo.price, 2) },
        realized_vol_pct: pct(volOf(rows.map((h) => h.price)), 1),
        sampled_every: step,
        points: rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((h) => [day(h.date), round(h.price, 2)]),
      },
      summary: u.symbol + ', ' + plural(rows.length, 'close', 'closes') + ', ' + day(first.date) + ' to ' + day(last.date),
    };
  },

  get_derivatives: (a, ctx) => {
    const all = loaded(ctx.options, 'Derivatives');
    const under = str(a, 'underlying').toUpperCase();
    const type = TYPE_KEYS.indexOf(str(a, 'type').toLowerCase());
    const q = str(a, 'query').toLowerCase();
    const b = bookOf(ctx);
    const spot: { [id: number]: number } = {};
    ctx.stats.forEach((s) => { spot[s.id] = s.last; });
    const rows = all.filter((o) =>
      (!under || (o.underlying ? o.underlying.symbol.toUpperCase() : '') === under) &&
      (type < 1 || o.optionType === type) &&
      (!q || o.symbol.toLowerCase().indexOf(q) >= 0 || (o.name || '').toLowerCase().indexOf(q) >= 0));
    return {
      result: {
        count: rows.length,
        derivatives: rows.slice(0, 60).map((o) => {
          const row: Json = {
            symbol: o.symbol, name: o.name, underlying: o.underlying ? o.underlying.symbol : '', type: TYPE_KEYS[o.optionType] || '', call: o.isCall,
            strike: o.optionType === 6 ? null : o.strikePrice, expiry: day(o.expirationDate),
            days_left: expired(o) ? 0 : Math.ceil((Date.parse(o.expirationDate) - Date.now()) / 86400000),
            spot: round(spot[o.underlyingId], 2), net_quantity: b.net[o.id] || 0, unit_value: expired(o) ? 0 : round(b.unit[o.id], 2),
          };
          if (o.optionType === 4) { row.barrier = o.barrier; row.barrier_type = o.barrierType ? BARRIER_KEYS[o.barrierType] : null; }
          if (o.optionType === 3) row.pays = o.rebate;
          return row;
        }),
      },
      summary: rows.length === 1 ? rows[0].symbol : plural(rows.length, 'contract', 'contracts'),
    };
  },

  get_trades: (a, ctx) => {
    const all = loaded(ctx.trades, 'Trades');
    const under = str(a, 'underlying').toUpperCase();
    const inst = str(a, 'instrument').toUpperCase();
    const from = isoDay(a, 'from', 'The earliest trade date');
    const to = isoDay(a, 'to', 'The latest trade date');
    const b = bookOf(ctx);
    const rows = all.filter((t) =>
      (!under || underlyingSymbolOf(ctx, t.instrumentId).toUpperCase() === under) &&
      (!inst || (t.instrument ? t.instrument.symbol.toUpperCase() : '') === inst) &&
      (!from || day(t.tradeDate) >= from) && (!to || day(t.tradeDate) <= to));
    return {
      result: {
        count: rows.length,
        valued_as_of: ctx.valuation ? ctx.valuation.valuationDate : null,
        trades: rows.slice(0, 80).map((t) => {
          const v = b.byTrade[t.id];
          const valued = Boolean(v && v.status === 'valued');
          const premium = t.quantity * t.price;
          return {
            id: t.id, date: day(t.tradeDate), instrument: t.instrument ? t.instrument.symbol : String(t.instrumentId),
            underlying: underlyingSymbolOf(ctx, t.instrumentId), quantity: t.quantity, price: round(t.price, 2), premium: round(premium, 2),
            unit_value: valued ? round(v.unitPrice, 2) : null, market_value: valued ? round(v.unitPrice * t.quantity, 2) : null,
            pnl: valued ? round(v.unitPrice * t.quantity - premium, 2) : null, status: v ? v.status : 'not valued yet',
          };
        }),
      },
      summary: plural(rows.length, 'trade', 'trades'),
    };
  },

  get_book: (_a, ctx) => {
    const all = loaded(ctx.trades, 'Trades');
    if (!ctx.valuation) throw new ToolError('The book is being valued right now. Try again in a few seconds.');
    const b = bookOf(ctx);
    type Line = { underlying: string; trades: number; premium: number; market_value: number; pnl: number };
    const by: { [k: string]: Line } = {};
    const total = { open_trades: 0, expired_trades: 0, not_valued: 0, net_premium_paid: 0, market_value: 0, pnl: 0 };
    all.forEach((t) => {
      const v = b.byTrade[t.id];
      if (!v) { total.not_valued += 1; return; }
      if (v.status !== 'valued') { total.expired_trades += 1; return; }
      const premium = t.quantity * t.price;
      const value = v.unitPrice * t.quantity;
      const key = underlyingSymbolOf(ctx, t.instrumentId) || 'other';
      if (!by[key]) by[key] = { underlying: key, trades: 0, premium: 0, market_value: 0, pnl: 0 };
      by[key].trades += 1; by[key].premium += premium; by[key].market_value += value; by[key].pnl += value - premium;
      total.open_trades += 1; total.net_premium_paid += premium; total.market_value += value; total.pnl += value - premium;
    });
    const lines = Object.keys(by).map((k) => by[k]).sort((x, y) => y.market_value - x.market_value)
      .map((l) => ({ underlying: l.underlying, trades: l.trades, premium: round(l.premium, 2), market_value: round(l.market_value, 2), pnl: round(l.pnl, 2) }));
    return {
      result: {
        valued_as_of: ctx.valuation.valuationDate,
        totals: {
          open_trades: total.open_trades, expired_trades: total.expired_trades, not_valued: total.not_valued,
          net_premium_paid: round(total.net_premium_paid, 2), market_value: round(total.market_value, 2), pnl: round(total.pnl, 2),
        },
        by_underlying: lines,
      },
      summary: plural(total.open_trades, 'open trade', 'open trades') + ', market value ' + money(total.market_value),
    };
  },

  get_rate_curves: (a, ctx) => {
    const all = loaded(ctx.curves, 'Rate curves');
    const q = str(a, 'name').toLowerCase();
    const live = liveCurve(all);
    const label = (c: RateCurve): string => (curveKind(c) === 'yours' ? 'user' : curveKind(c));
    if (!q) {
      return {
        result: {
          count: all.length,
          live_curve: live ? live.name : null,
          curves: all.map((c) => ({
            name: c.name, kind: label(c), points: curvePoints(c).length,
            overnight_pct: pct(rateAt(c, 1 / 365) === null ? (curvePoints(c)[0] || { rate: null }).rate : rateAt(c, 1 / 365)),
            y2_pct: pct(rateAt(c, 2)), y10_pct: pct(rateAt(c, 10)), y30_pct: pct(rateAt(c, 30)),
          })),
        },
        summary: plural(all.length, 'curve', 'curves'),
      };
    }
    const hits = all.filter((c) => c.name.toLowerCase().indexOf(q) >= 0);
    if (hits.length === 0) throw new ToolError('No rate curve matches "' + str(a, 'name') + '".');
    return {
      result: {
        count: hits.length,
        curves: hits.slice(0, 4).map((c) => ({ name: c.name, kind: label(c), points: curvePoints(c).map((p) => ({ tenor_years: round(p.tenor, 4), rate_pct: pct(p.rate, 3) })) })),
        more: hits.length > 4 ? hits.slice(4, 14).map((c) => c.name) : undefined,
      },
      summary: hits.length === 1 ? hits[0].name : plural(hits.length, 'curve', 'curves'),
    };
  },

  run_valuation: async (a, ctx) => {
    const all = loaded(ctx.trades, 'Trades');
    const curve = curveBy(ctx, str(a, 'curve'));
    const asOf = isoDay(a, 'as_of', 'The valuation date');
    if (asOf && asOf > today()) throw new ToolError('The valuation date cannot be in the future.');
    let picked = all;
    if (Array.isArray(a.trade_ids) && (a.trade_ids as unknown[]).length) {
      const ids = (a.trade_ids as unknown[]).map((x) => Number(x));
      picked = all.filter((t) => ids.indexOf(t.id) >= 0);
      const unknown = ids.filter((id) => !all.some((t) => t.id === id));
      if (picked.length === 0) throw new ToolError('None of those trade ids exist: ' + unknown.join(', ') + '.');
    }
    const under = str(a, 'underlying').toUpperCase();
    const inst = str(a, 'instrument').toUpperCase();
    if (under) picked = picked.filter((t) => underlyingSymbolOf(ctx, t.instrumentId).toUpperCase() === under);
    if (inst) picked = picked.filter((t) => (t.instrument ? t.instrument.symbol.toUpperCase() : '') === inst);
    if (picked.length === 0) throw new ToolError('No trades match that selection.');
    const req: ValuationRequest = {
      tradeIds: picked.map((t) => t.id), steps: clamp(Math.round(num(a, 'steps') || 64), 1, 252), simulations: clamp(Math.round(num(a, 'paths') || 5000), 1000, 20000),
      antithetic: flag(a, 'antithetic', true), controlVariate: flag(a, 'control_variate', false), multithreaded: true,
      useVDCSequence: false, base1: 2, base2: 5, rateCurveId: curve.id,
    };
    if (asOf) req.valuationDate = asOf + 'T23:00:00Z';
    const res = await api.valuate(req);
    const count = { valued: 0, expired: 0, not_traded_yet: 0 };
    res.valuations.forEach((v) => {
      if (v.status === 'valued') count.valued += 1; else if (v.status === 'expired') count.expired += 1; else count.not_traded_yet += 1;
    });
    return {
      result: {
        as_of: asOf || 'now', valuation_date: res.valuationDate, curve: curve.name, paths: req.simulations, steps: req.steps,
        portfolio_value: round(res.portfolioValue, 2), trades: res.valuations.length, valued: count.valued, expired: count.expired, not_traded_yet: count.not_traded_yet,
        note: 'value is unit_value times quantity; the Greeks are per unit',
        rows: res.valuations.slice(0, 60).map((v) => ({
          trade_id: v.tradeId, instrument: v.instrumentSymbol, quantity: v.quantity, status: v.status, unit_value: round(v.unitPrice, 2), value: round(v.price, 2),
          std_error: round(v.standardError, 3), delta: round(v.delta, 4), gamma: round(v.gamma, 5), vega: round(v.vega, 2), theta: round(v.theta, 2), rho: round(v.rho, 2),
          vol_pct: pct(v.volatility, 1), rate_pct: pct(v.riskFreeRate, 2), years_left: round(v.timeToMaturity, 3), spot: round(v.spot, 2),
        })),
        rows_cut: res.valuations.length > 60 ? res.valuations.length - 60 : undefined,
      },
      summary: plural(res.valuations.length, 'trade', 'trades') + ' as of ' + (asOf || 'now') + ': ' + money(res.portfolioValue),
    };
  },

  price_option: async (a, ctx) => {
    const type = TYPE_KEYS.indexOf(str(a, 'type').toLowerCase());
    if (type < 1) throw new ToolError('The option type must be one of: ' + TYPE_KEYS.slice(1).join(', ') + '.');
    if (typeof a.call !== 'boolean') throw new ToolError('Say whether it is a call (true) or a put (false).');
    const u = str(a, 'underlying') ? underlyingBy(ctx, str(a, 'underlying')) : null;
    const spot = num(a, 'spot') !== null ? (num(a, 'spot') as number) : u ? u.last : null;
    if (spot === null || !(spot > 0)) throw new ToolError('Give an underlying ticker or a spot price.');
    let years = num(a, 'years');
    const expiry = isoDay(a, 'expiry', 'The expiry');
    if (years === null && expiry) years = (Date.parse(expiry + 'T21:00:00Z') - Date.now()) / YEAR_MS;
    if (years === null || !(years > 0)) throw new ToolError('Give an expiry date in the future, or the years left.');
    const vol = num(a, 'volatility') !== null ? (num(a, 'volatility') as number) : u ? u.vol : null;
    if (vol === null || !(vol > 0)) throw new ToolError('No volatility to price with. Pass one as a decimal, for example 0.35.');
    if (vol > 5) throw new ToolError('Volatility is a decimal: 0.35 means 35%.');
    let rate = num(a, 'rate');
    let curveName = '';
    if (rate === null) {
      const curve = curveBy(ctx, str(a, 'curve'));
      rate = nearestRate(curve, years);
      curveName = curve.name;
      if (rate === null) throw new ToolError('The curve ' + curve.name + ' has no points. Pass a rate as a decimal.');
    }
    if (Math.abs(rate) > 1) throw new ToolError('The rate is a decimal: 0.045 means 4.5%.');
    const strike = num(a, 'strike');
    if (type !== 6 && !(strike !== null && strike > 0)) throw new ToolError('Give a strike above zero.');
    let barrier = 1;
    let barrierType = 1;
    if (type === 4) {
      barrier = num(a, 'barrier') || 0;
      barrierType = BARRIER_KEYS.indexOf(str(a, 'barrier_type').toLowerCase());
      if (!(barrier > 0) || barrierType < 1) throw new ToolError('A barrier option needs a barrier level and a barrier_type: ' + BARRIER_KEYS.slice(1).join(', ') + '.');
    }
    const rebate = num(a, 'rebate');
    if (type === 3 && !(rebate !== null && rebate >= 0)) throw new ToolError('A digital option needs rebate: the fixed amount it pays.');
    const paths = clamp(Math.round(num(a, 'paths') || 10000), 1000, 20000);
    const steps = clamp(Math.round(num(a, 'steps') || 64), 1, 252);
    const r = await api.priceOption({
      stockPrice: spot, strikePrice: strike !== null && strike > 0 ? strike : spot, riskFreeRate: rate, volatility: vol, timeToMaturity: years,
      steps: steps, simulations: paths, isCall: a.call as boolean, antithetic: true, controlVariate: false, multithreaded: true,
      optionType: type, useVDCSequence: false, base1: 2, base2: 5, rebate: rebate || 0, barrier: barrier, barrierType: barrierType,
    });
    const inputs: Json = {
      type: TYPE_KEYS[type], call: a.call, spot: round(spot, 2), strike: type === 6 ? null : strike, years: round(years, 4),
      volatility_pct: pct(vol, 1), rate_pct: pct(rate, 2), paths: paths, steps: steps,
    };
    if (u) inputs.underlying = u.symbol;
    if (curveName) inputs.rate_from = curveName;
    if (type === 4) { inputs.barrier = barrier; inputs.barrier_type = BARRIER_KEYS[barrierType]; }
    if (type === 3) inputs.pays = rebate;
    return {
      result: {
        price: round(r.price, 4), std_error: round(r.standardError, 4), delta: round(r.delta, 4), gamma: round(r.gamma, 5),
        vega: round(r.vega, 3), theta: round(r.theta, 3), rho: round(r.rho, 3), inputs: inputs, saved: false,
      },
      summary: OPTION_TYPES[type] + (a.call ? ' call' : ' put') + (u ? ' on ' + u.symbol : '') + ': ' + money(r.price),
    };
  },

  open_screen: (a, ctx) => {
    const screen = str(a, 'screen').toLowerCase();
    if (['underlyings', 'derivatives', 'trades', 'rates', 'valuation', 'overview'].indexOf(screen) < 0) throw new ToolError('There is no screen called ' + screen + '.');
    const symbol = str(a, 'symbol');
    let shown = '';
    if (symbol && screen === 'underlyings') { const u = underlyingBy(ctx, symbol); ctx.setSelUnderlying(u.id); shown = u.symbol; }
    if (symbol && screen === 'derivatives') { const o = optionBy(ctx, symbol); ctx.setSelOption(o.id); shown = o.symbol; }
    ctx.go(screen);
    return { result: { opened: screen, selected: shown || null }, summary: screen.charAt(0).toUpperCase() + screen.slice(1) + (shown ? ', ' + shown : '') };
  },
};

// ---------------------------------------------------------------- write tools

function cleanCloses(raw: unknown): Price[] {
  if (!Array.isArray(raw)) throw new ToolError('closes must be a list of {date, price}.');
  const seen: { [d: string]: boolean } = {};
  const out: Price[] = [];
  raw.forEach((r) => {
    const row = (r || {}) as Json;
    const d = str(row, 'date');
    const p = num(row, 'price');
    if (!ISO_DAY.test(d) || isNaN(Date.parse(d + 'T00:00:00Z')) || p === null || !(p > 0) || seen[d]) return;
    seen[d] = true;
    out.push({ date: d + 'T00:00:00.000Z', price: p });
  });
  if (out.length < 3) throw new ToolError('An underlying needs at least three valid closes: dates like 2026-11-13 and prices above zero.');
  return out.sort((x, y) => (x.date < y.date ? -1 : 1));
}

function optionBody(o: OptionEntity): OptionBody {
  const body: OptionBody = {
    id: o.id, symbol: o.symbol, name: o.name || o.symbol, strikePrice: o.strikePrice, expirationDate: o.expirationDate,
    optionStyle: o.optionType, optionType: o.optionType, isCall: o.isCall, underlyingId: o.underlyingId,
  };
  if (o.optionType === 3) body.rebate = o.rebate === null ? 0 : o.rebate;
  if (o.optionType === 4) { body.barrier = o.barrier === null ? 0 : o.barrier; body.barrierType = o.barrierType === null ? 2 : o.barrierType; }
  return body;
}

// The engine's own price for one unit as of a past trade date: close, volatility and time left as of that day.
async function modelPriceAt(ctx: ToolCtx, o: OptionEntity, tradeDay: string): Promise<number> {
  const hp = historyOf(ctx, o.underlyingId).filter((h) => day(h.date) <= tradeDay);
  const vol = volOf(hp.map((h) => h.price));
  const years = (Date.parse(o.expirationDate) - Date.parse(tradeDay + 'T23:00:00Z')) / YEAR_MS;
  const curve = curveBy(ctx, '');
  const rate = nearestRate(curve, years);
  if (hp.length === 0 || vol === null || !(years > 0) || rate === null) {
    throw new ToolError('The engine cannot price ' + o.symbol + ' as of ' + tradeDay + ': it needs closes up to that day, a rate curve and time left to expiry. Pass a price instead.');
  }
  const r = await api.priceOption({
    stockPrice: hp[hp.length - 1].price, strikePrice: o.strikePrice, riskFreeRate: rate, volatility: vol, timeToMaturity: years,
    steps: 64, simulations: 20000, isCall: o.isCall, antithetic: true, controlVariate: false, multithreaded: true, optionType: o.optionType,
    useVDCSequence: false, base1: 2, base2: 5, rebate: o.rebate || 0, barrier: o.barrier || 1, barrierType: o.barrierType || 1,
  });
  return Math.round(r.price * 100) / 100;
}

const sideWord = (q: number): string => (q > 0 ? 'Buy ' : 'Sell ') + Math.abs(q);

const WRITE: { [name: string]: (a: Json, ctx: ToolCtx) => Promise<Plan> | Plan } = {
  create_underlying: (a, ctx) => {
    loaded(ctx.underlyings, 'Prices');
    const symbol = str(a, 'symbol').toUpperCase();
    if (!/^[A-Z0-9._-]{1,20}$/.test(symbol)) throw new ToolError('The ticker may use letters, digits, dot, dash and underscore, up to 20 characters.');
    if (ctx.stats.some((s) => s.symbol.toUpperCase() === symbol) || (ctx.underlyings || []).some((u) => u.symbol.toUpperCase() === symbol)) {
      throw new ToolError('An underlying with the ticker ' + symbol + ' already exists.');
    }
    const name = str(a, 'name') || symbol;
    const closes = cleanCloses(a.closes);
    return {
      title: 'Add underlying ' + symbol, danger: false,
      lines: [name, plural(closes.length, 'close', 'closes') + ', ' + day(closes[0].date) + ' to ' + day(closes[closes.length - 1].date), 'Last close ' + money(closes[closes.length - 1].price)],
      apply: async () => {
        const made = await api.createUnderlying({ symbol: symbol, name: name, historicalPrices: closes });
        await ctx.reload('underlyings');
        return { result: { ok: true, symbol: symbol, id: made && made.id, closes: closes.length }, summary: 'Added ' + symbol };
      },
    };
  },

  rename_underlying: (a, ctx) => {
    const u = underlyingBy(ctx, str(a, 'symbol'));
    if (u.predefined) throw new ToolError(u.symbol + ' is a predefined stock and cannot be changed.');
    const name = str(a, 'name');
    if (!name) throw new ToolError('Give the new name.');
    return {
      title: 'Rename ' + u.symbol, danger: false, lines: ['From: ' + (u.name || '(no name)'), 'To: ' + name],
      apply: async () => {
        await api.renameUnderlying(u.id, u.symbol, name);
        await ctx.reload('underlyings');
        return { result: { ok: true, symbol: u.symbol, name: name }, summary: 'Renamed ' + u.symbol };
      },
    };
  },

  delete_underlying: (a, ctx) => {
    const u = underlyingBy(ctx, str(a, 'symbol'));
    if (u.predefined) throw new ToolError(u.symbol + ' is a predefined stock and cannot be deleted.');
    const contracts = loaded(ctx.options, 'Derivatives').filter((o) => o.underlyingId === u.id);
    if (contracts.length) {
      throw new ToolError(u.symbol + ' still has ' + plural(contracts.length, 'derivative', 'derivatives') + ' (' + contracts.slice(0, 5).map((o) => o.symbol).join(', ') + '). Delete those first.');
    }
    const direct = loaded(ctx.trades, 'Trades').filter((t) => t.instrumentId === u.id).length;
    return {
      title: 'Delete underlying ' + u.symbol, danger: true,
      lines: [u.name, plural(u.n, 'close', 'closes') + ' are deleted with it.'].concat(direct ? [plural(direct, 'trade', 'trades') + ' made directly in it ' + (direct === 1 ? 'is' : 'are') + ' deleted too.'] : []).concat(['This cannot be undone.']),
      apply: async () => {
        await api.deleteUnderlying(u.id);
        await ctx.reload('underlyings', 'options', 'trades');
        return { result: { ok: true, deleted: u.symbol, trades_deleted: direct }, summary: 'Deleted ' + u.symbol };
      },
    };
  },

  create_derivative: (a, ctx) => {
    const all = loaded(ctx.options, 'Derivatives');
    const symbol = str(a, 'symbol');
    if (!symbol || symbol.length > 60) throw new ToolError('Give the contract a symbol of up to 60 characters.');
    if (all.some((o) => o.symbol.toUpperCase() === symbol.toUpperCase())) throw new ToolError('A contract with the symbol ' + symbol + ' already exists.');
    const u = underlyingBy(ctx, str(a, 'underlying'));
    const type = TYPE_KEYS.indexOf(str(a, 'type').toLowerCase());
    if (type < 1) throw new ToolError('The option type must be one of: ' + TYPE_KEYS.slice(1).join(', ') + '.');
    if (typeof a.call !== 'boolean') throw new ToolError('Say whether it is a call (true) or a put (false).');
    const expiry = isoDay(a, 'expiry', 'The expiry');
    if (!expiry) throw new ToolError('Give the expiry date.');
    let strike = num(a, 'strike');
    if (type === 6 && !(strike !== null && strike > 0)) strike = Math.round(u.last);
    if (!(strike !== null && strike > 0)) throw new ToolError('Give a strike above zero.');
    const body: OptionBody = {
      id: 0, symbol: symbol, name: str(a, 'name') || symbol, strikePrice: strike, expirationDate: expiry + 'T21:00:00Z',
      optionStyle: type, optionType: type, isCall: a.call as boolean, underlyingId: u.id,
    };
    const lines = [OPTION_TYPES[type] + (a.call ? ' call' : ' put') + ' on ' + u.symbol, (type === 6 ? '' : 'Strike ' + money(strike) + ', ') + 'expires ' + expiry];
    if (type === 3) {
      const rebate = num(a, 'rebate');
      if (!(rebate !== null && rebate >= 0)) throw new ToolError('A digital option needs rebate: the fixed amount it pays.');
      body.rebate = rebate;
      lines.push('Pays ' + money(rebate) + ' if it ends in the money');
    }
    if (type === 4) {
      const barrier = num(a, 'barrier');
      const bt = BARRIER_KEYS.indexOf(str(a, 'barrier_type').toLowerCase());
      if (!(barrier !== null && barrier > 0) || bt < 1) throw new ToolError('A barrier option needs a barrier level and a barrier_type: ' + BARRIER_KEYS.slice(1).join(', ') + '.');
      body.barrier = barrier;
      body.barrierType = bt;
      lines.push(BARRIER_TYPES[bt] + ' barrier at ' + money(barrier));
    }
    if (expiry <= today()) lines.push('Note: this expiry is not in the future.');
    return {
      title: 'Add derivative ' + symbol, danger: false, lines: lines,
      apply: async () => {
        const made = await api.createOption(body);
        await ctx.reload('options');
        return { result: { ok: true, symbol: symbol, id: made && made.id }, summary: 'Added ' + symbol };
      },
    };
  },

  update_derivative: (a, ctx) => {
    const o = optionBy(ctx, str(a, 'symbol'));
    const body = optionBody(o);
    const lines: string[] = [];
    const newSymbol = str(a, 'new_symbol');
    if (newSymbol && newSymbol !== o.symbol) {
      if (loaded(ctx.options, 'Derivatives').some((x) => x.id !== o.id && x.symbol.toUpperCase() === newSymbol.toUpperCase())) throw new ToolError('A contract with the symbol ' + newSymbol + ' already exists.');
      body.symbol = newSymbol;
      lines.push('Symbol: ' + o.symbol + ' to ' + newSymbol);
    }
    const name = str(a, 'name');
    if (name && name !== o.name) { body.name = name; lines.push('Name: ' + name); }
    if (typeof a.call === 'boolean' && a.call !== o.isCall) { body.isCall = a.call as boolean; lines.push('Side: ' + (o.isCall ? 'call' : 'put') + ' to ' + (a.call ? 'call' : 'put')); }
    const strike = num(a, 'strike');
    if (strike !== null && strike !== o.strikePrice) {
      if (!(strike > 0)) throw new ToolError('The strike must be above zero.');
      body.strikePrice = strike;
      lines.push('Strike: ' + money(o.strikePrice) + ' to ' + money(strike));
    }
    const expiry = isoDay(a, 'expiry', 'The expiry');
    if (expiry && expiry !== day(o.expirationDate)) { body.expirationDate = expiry + 'T21:00:00Z'; lines.push('Expiry: ' + day(o.expirationDate) + ' to ' + expiry); }
    if (o.optionType === 4) {
      const barrier = num(a, 'barrier');
      if (barrier !== null && barrier !== o.barrier) {
        if (!(barrier > 0)) throw new ToolError('The barrier must be above zero.');
        body.barrier = barrier;
        lines.push('Barrier: ' + (o.barrier === null ? 'none' : money(o.barrier)) + ' to ' + money(barrier));
      }
      const bt = BARRIER_KEYS.indexOf(str(a, 'barrier_type').toLowerCase());
      if (bt >= 1 && bt !== o.barrierType) { body.barrierType = bt; lines.push('Barrier kind: ' + BARRIER_TYPES[bt]); }
    }
    if (o.optionType === 3) {
      const rebate = num(a, 'rebate');
      if (rebate !== null && rebate !== o.rebate) {
        if (!(rebate >= 0)) throw new ToolError('The payout cannot be negative.');
        body.rebate = rebate;
        lines.push('Pays: ' + (o.rebate === null ? 'none' : money(o.rebate)) + ' to ' + money(rebate));
      }
    }
    if (lines.length === 0) throw new ToolError('Nothing to change: the values given are the ones ' + o.symbol + ' already has, or they do not apply to its type.');
    return {
      title: 'Change ' + o.symbol, danger: false, lines: lines,
      apply: async () => {
        await api.updateOption(body);
        await ctx.reload('options', 'trades');
        return { result: { ok: true, symbol: body.symbol, changed: lines }, summary: 'Changed ' + body.symbol };
      },
    };
  },

  delete_derivative: (a, ctx) => {
    const o = optionBy(ctx, str(a, 'symbol'));
    const n = loaded(ctx.trades, 'Trades').filter((t) => t.instrumentId === o.id).length;
    return {
      title: 'Delete derivative ' + o.symbol, danger: true,
      lines: [optionLine(o), n ? plural(n, 'trade', 'trades') + ' in it ' + (n === 1 ? 'is' : 'are') + ' deleted with it.' : 'It has no trades.', 'This cannot be undone.'],
      apply: async () => {
        await api.deleteOption(o.id);
        await ctx.reload('options', 'trades');
        return { result: { ok: true, deleted: o.symbol, trades_deleted: n }, summary: 'Deleted ' + o.symbol };
      },
    };
  },

  create_trade: async (a, ctx) => {
    loaded(ctx.trades, 'Trades');
    const key = str(a, 'instrument').toUpperCase();
    if (!key) throw new ToolError('Say which instrument was traded, by its symbol.');
    const o = loaded(ctx.options, 'Derivatives').find((x) => x.symbol.toUpperCase() === key) || null;
    const u = o ? null : ctx.stats.find((s) => s.symbol.toUpperCase() === key) || null;
    if (!o && !u) throw new ToolError('There is no contract or stock with the symbol ' + str(a, 'instrument') + '.');
    const qty = num(a, 'quantity');
    if (qty === null || qty === 0 || Math.round(qty) !== qty) throw new ToolError('Quantity must be a whole number, positive to buy or negative to sell.');
    const date = isoDay(a, 'trade_date', 'The trade date');
    if (!date) throw new ToolError('Give the trade date.');
    let price = num(a, 'price');
    let priced = '';
    if (price === null) {
      if (!flag(a, 'use_model_price', false)) throw new ToolError('Give a price per unit, or set use_model_price to true.');
      if (o) {
        price = await modelPriceAt(ctx, o, date);
        priced = ' (engine price as of ' + date + ')';
      } else {
        const hp = historyOf(ctx, (u as UStats).id).filter((h) => day(h.date) <= date);
        if (hp.length === 0) throw new ToolError((u as UStats).symbol + ' has no close on or before ' + date + '. Pass a price instead.');
        price = Math.round(hp[hp.length - 1].price * 100) / 100;
        priced = ' (close of ' + day(hp[hp.length - 1].date) + ')';
      }
    }
    if (!(price >= 0)) throw new ToolError('The price cannot be negative.');
    const symbol = o ? o.symbol : (u as UStats).symbol;
    const id = o ? o.id : (u as UStats).id;
    const finalPrice = price;
    return {
      title: 'Add trade: ' + sideWord(qty) + ' ' + symbol, danger: false,
      lines: ['Trade date ' + date, 'Price ' + money(finalPrice) + ' per unit' + priced, 'Premium ' + money(Math.abs(qty) * finalPrice) + (qty > 0 ? ' paid' : ' received')],
      apply: async () => {
        const made = await api.createTrade({ instrumentId: id, quantity: qty, tradeDate: date + 'T23:00:00Z', price: finalPrice });
        await ctx.reload('trades');
        return { result: { ok: true, id: made && made.id, instrument: symbol, quantity: qty, price: finalPrice, trade_date: date }, summary: sideWord(qty) + ' ' + symbol + ' at ' + money(finalPrice) };
      },
    };
  },

  update_trade: (a, ctx) => {
    const id = num(a, 'id');
    const t: Trade | undefined = loaded(ctx.trades, 'Trades').find((x) => x.id === id);
    if (!t) throw new ToolError('There is no trade with the id ' + str(a, 'id') + '.');
    const symbol = t.instrument ? t.instrument.symbol : String(t.instrumentId);
    const body = { id: t.id, instrumentId: t.instrumentId, quantity: t.quantity, tradeDate: t.tradeDate, price: t.price };
    const lines: string[] = [];
    const qty = num(a, 'quantity');
    if (qty !== null && qty !== t.quantity) {
      if (qty === 0 || Math.round(qty) !== qty) throw new ToolError('Quantity must be a whole number, positive to buy or negative to sell.');
      body.quantity = qty;
      lines.push('Quantity: ' + t.quantity + ' to ' + qty);
    }
    const date = isoDay(a, 'trade_date', 'The trade date');
    if (date && date !== day(t.tradeDate)) { body.tradeDate = date + 'T23:00:00Z'; lines.push('Trade date: ' + day(t.tradeDate) + ' to ' + date); }
    const price = num(a, 'price');
    if (price !== null && price !== t.price) {
      if (!(price >= 0)) throw new ToolError('The price cannot be negative.');
      body.price = price;
      lines.push('Price: ' + money(t.price) + ' to ' + money(price));
    }
    if (lines.length === 0) throw new ToolError('Nothing to change: trade ' + t.id + ' already has those values.');
    return {
      title: 'Change trade ' + t.id + ' (' + symbol + ')', danger: false, lines: lines,
      apply: async () => {
        await api.updateTrade(body);
        await ctx.reload('trades');
        return { result: { ok: true, id: t.id, changed: lines }, summary: 'Changed trade ' + t.id };
      },
    };
  },

  delete_trade: (a, ctx) => {
    const id = num(a, 'id');
    const t = loaded(ctx.trades, 'Trades').find((x) => x.id === id);
    if (!t) throw new ToolError('There is no trade with the id ' + str(a, 'id') + '.');
    const symbol = t.instrument ? t.instrument.symbol : String(t.instrumentId);
    return {
      title: 'Delete trade ' + t.id, danger: true,
      lines: [sideWord(t.quantity) + ' ' + symbol + ' at ' + money(t.price) + ' on ' + day(t.tradeDate), 'This cannot be undone.'],
      apply: async () => {
        await api.deleteTrade(t.id);
        await ctx.reload('trades');
        return { result: { ok: true, deleted_trade: t.id }, summary: 'Deleted trade ' + t.id };
      },
    };
  },

  create_rate_curve: (a, ctx) => {
    const all = loaded(ctx.curves, 'Rate curves');
    const name = str(a, 'name');
    if (!name || name.length > 80) throw new ToolError('Give the curve a name of up to 80 characters.');
    if (all.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new ToolError('A curve named ' + name + ' already exists.');
    if (/^USD Treasury \+ SOFR/i.test(name)) throw new ToolError('That name is reserved for the Treasury curves. Pick another.');
    if (!Array.isArray(a.points)) throw new ToolError('points must be a list of {tenor, rate}.');
    let pts: RatePoint[] = (a.points as unknown[])
      .map((r) => ({ tenor: Number(((r || {}) as Json).tenor), rate: Number(((r || {}) as Json).rate) }))
      .filter((p) => isFinite(p.tenor) && p.tenor > 0 && isFinite(p.rate));
    if (pts.length === 0) throw new ToolError('The curve needs at least one point: a tenor in years above zero and a rate.');
    // Rates above 1 can only be percent: 4.5 means 4.5%.
    if (pts.some((p) => Math.abs(p.rate) > 1)) pts = pts.map((p) => ({ tenor: p.tenor, rate: p.rate / 100 }));
    pts.sort((x, y) => x.tenor - y.tenor);
    return {
      title: 'Add rate curve ' + name, danger: false,
      lines: [plural(pts.length, 'point', 'points') + ', ' + round(pts[0].tenor, 3) + ' to ' + round(pts[pts.length - 1].tenor, 3) + ' years', 'Rates ' + pct(pts[0].rate, 2) + '% to ' + pct(pts[pts.length - 1].rate, 2) + '%'],
      apply: async () => {
        const made = await api.createCurve(name, pts);
        await ctx.reload('curves');
        return { result: { ok: true, name: name, id: made && made.id, points: pts.length }, summary: 'Added ' + name };
      },
    };
  },

  rename_rate_curve: (a, ctx) => {
    const c = curveBy(ctx, str(a, 'name'));
    if (!str(a, 'name')) throw new ToolError('Say which curve, by its name.');
    if (!editableCurve(c)) throw new ToolError(c.name + ' is a Treasury curve and cannot be changed.');
    const name = str(a, 'new_name');
    if (!name || name.length > 80) throw new ToolError('Give the new name, up to 80 characters.');
    if (/^USD Treasury \+ SOFR/i.test(name)) throw new ToolError('That name is reserved for the Treasury curves. Pick another.');
    if (loaded(ctx.curves, 'Rate curves').some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) throw new ToolError('A curve named ' + name + ' already exists.');
    return {
      title: 'Rename rate curve', danger: false, lines: ['From: ' + c.name, 'To: ' + name],
      apply: async () => {
        await api.renameCurve(c.id, name);
        await ctx.reload('curves');
        return { result: { ok: true, name: name }, summary: 'Renamed to ' + name };
      },
    };
  },

  delete_rate_curve: (a, ctx) => {
    if (!str(a, 'name')) throw new ToolError('Say which curve, by its name.');
    const c = curveBy(ctx, str(a, 'name'));
    if (!editableCurve(c)) throw new ToolError(c.name + ' is a Treasury curve and cannot be deleted.');
    return {
      title: 'Delete rate curve', danger: true, lines: [c.name, plural(curvePoints(c).length, 'point', 'points'), 'This cannot be undone.'],
      apply: async () => {
        await api.deleteCurve(c.id);
        await ctx.reload('curves');
        return { result: { ok: true, deleted: c.name }, summary: 'Deleted ' + c.name };
      },
    };
  },
};

// ---------------------------------------------------------------- what the chat needs

export function isWriteTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(WRITE, name);
}

// A short line for the step shown while a tool runs.
export function stepLabel(name: string, a: Json): string {
  const on = (k: string): string => (str(a, k) ? ' on ' + str(a, k).toUpperCase() : '');
  switch (name) {
    case 'get_underlyings': return 'Looking up underlyings' + (Array.isArray(a.symbols) && (a.symbols as unknown[]).length ? ': ' + (a.symbols as unknown[]).slice(0, 6).join(', ') : str(a, 'query') ? ' matching "' + str(a, 'query') + '"' : '');
    case 'get_price_history': return 'Reading the price history of ' + str(a, 'symbol').toUpperCase();
    case 'get_derivatives': return 'Looking up derivatives' + on('underlying');
    case 'get_trades': return 'Looking up trades' + (on('underlying') || (str(a, 'instrument') ? ' in ' + str(a, 'instrument') : ''));
    case 'get_book': return 'Reading the book';
    case 'get_rate_curves': return 'Looking up rate curves' + (str(a, 'name') ? ': ' + str(a, 'name') : '');
    case 'run_valuation': return 'Running the valuation' + (on('underlying') || (str(a, 'instrument') ? ' of ' + str(a, 'instrument') : '')) + (str(a, 'as_of') ? ' as of ' + str(a, 'as_of') : '');
    case 'price_option': return 'Pricing a ' + (str(a, 'type') || 'what-if') + (a.call === true ? ' call' : a.call === false ? ' put' : '') + on('underlying');
    case 'open_screen': return 'Opening ' + (str(a, 'screen') || 'a screen');
    default: return name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
}

export function contextFor(ctx: ToolCtx): Json {
  let selection = '';
  if (ctx.section === 'underlyings' && ctx.selUnderlying !== null) {
    const u = ctx.stats.find((s) => s.id === ctx.selUnderlying);
    selection = u ? u.symbol : '';
  }
  if (ctx.section === 'derivatives' && ctx.selOption !== null) {
    const o = (ctx.options || []).find((x) => x.id === ctx.selOption);
    selection = o ? o.symbol : '';
  }
  const latest = ctx.stats.filter((s) => s.predefined).reduce((m, s) => (s.lastDate > m ? s.lastDate : m), '');
  return { screen: ctx.section === 'ai' ? 'DPP AI' : ctx.section, selection: selection, latestClose: latest };
}

const failed = (e: unknown): string =>
  e instanceof ToolError ? e.message : 'The app could not do this: ' + ((e as Error) && (e as Error).message ? (e as Error).message : 'unknown error');

// Read tools run at once. The result is the JSON the model reads.
export async function runRead(name: string, a: Json, ctx: ToolCtx): Promise<{ content: string; isError: boolean; summary: string }> {
  const fn = READ[name];
  if (!fn) return { content: 'This app has no tool called ' + name + '.', isError: true, summary: 'Unknown tool' };
  try {
    const out = await fn(a || {}, ctx);
    return { content: JSON.stringify(out.result), isError: false, summary: out.summary };
  } catch (e) {
    return { content: failed(e), isError: true, summary: failed(e) };
  }
}

// Write tools first say what they would do. An error here goes straight back to the model.
export async function planWrite(name: string, a: Json, ctx: ToolCtx): Promise<{ plan: Plan } | { error: string }> {
  const fn = WRITE[name];
  if (!fn) return { error: 'This app has no tool called ' + name + '.' };
  try {
    return { plan: await fn(a || {}, ctx) };
  } catch (e) {
    return { error: failed(e) };
  }
}

export async function applyPlan(plan: Plan): Promise<{ content: string; isError: boolean; summary: string }> {
  try {
    const out = await plan.apply();
    return { content: JSON.stringify(out.result), isError: false, summary: out.summary };
  } catch (e) {
    return { content: failed(e), isError: true, summary: failed(e) };
  }
}
