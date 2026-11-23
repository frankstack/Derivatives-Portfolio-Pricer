// Typed access to the DPP API, plus the small calculations the screens share.

export type Price = { date: string; price: number };
export type Underlying = { id: number; symbol: string; name: string; historicalPrices: Price[] };
export type OptionEntity = {
  id: number; symbol: string; name: string; strikePrice: number; expirationDate: string;
  optionStyle: number; optionType: number; optionTypeName: string; isCall: boolean;
  underlyingId: number; underlying: { id: number; symbol: string; name: string } | null;
  rebate: number | null; barrier: number | null; barrierType: number | null; barrierTypeName: string | null;
};
export type Trade = {
  id: number; instrumentId: number; instrument: { id: number; symbol: string; name: string } | null;
  quantity: number; tradeDate: string; price: number;
};
export type RatePoint = { tenor: number; rate: number };
export type RateCurve = { id: number; name: string; ratePoints: RatePoint[] };
export type TradeValuation = {
  tradeId: number; instrumentSymbol: string; instrumentName: string; price: number; standardError: number;
  delta: number; gamma: number; vega: number; theta: number; rho: number; volatility: number; riskFreeRate: number;
  quantity: number; unitPrice: number; spot: number; spotDate: string | null; timeToMaturity: number; status: string;
};
export type ValuationResult = { valuations: TradeValuation[]; portfolioValue: number; valuationDate: string };
export type ValuationRequest = {
  tradeIds: number[]; steps: number; simulations: number; antithetic: boolean; controlVariate: boolean;
  multithreaded: boolean; useVDCSequence: boolean; base1: number; base2: number; rateCurveId: number; valuationDate?: string;
};
export type OptionBody = {
  id: number; symbol: string; name: string; strikePrice: number; expirationDate: string; optionStyle: number;
  optionType: number; isCall: boolean; underlyingId: number; rebate?: number; barrier?: number; barrierType?: number;
};
export type TradeBody = { id?: number; instrumentId: number; quantity: number; tradeDate: string; price: number };
export type PriceRequest = {
  stockPrice: number; strikePrice: number; riskFreeRate: number; volatility: number; timeToMaturity: number;
  steps: number; simulations: number; isCall: boolean; antithetic: boolean; controlVariate: boolean; multithreaded: boolean;
  optionType: number; useVDCSequence: boolean; base1: number; base2: number; rebate: number; barrier: number; barrierType: number;
};
export type PriceResult = { price: number; standardError: number; delta: number; gamma: number; vega: number; theta: number; rho: number };

export const OPTION_TYPES = ['', 'European', 'Asian', 'Digital', 'Barrier', 'Lookback', 'Range'];
export const BARRIER_TYPES = ['', 'Up-and-In', 'Up-and-Out', 'Down-and-In', 'Down-and-Out'];

const BASE = '/api';

function describe(status: number, body: string): string {
  // nginx answers a timeout or a stopped service with an HTML page: say what happened instead of showing it.
  if (/^\s*</.test(body || '')) {
    if (status === 504) return 'The pricing server took too long to answer (504). Try again in a minute, or value fewer trades or paths.';
    if (status === 502 || status === 503) return 'The pricing server is not answering right now (' + status + '). Try again in a minute.';
    return 'The server answered ' + status + '.';
  }
  let msg = body || '';
  try {
    const j = JSON.parse(body);
    if (j && j.errors) msg = Object.keys(j.errors).map((k) => String(j.errors[k])).join(' ');
    else if (j && j.title) msg = String(j.title);
    else if (j && typeof j.message === 'string') msg = j.message;
    else if (typeof j === 'string') msg = j;
  } catch (e) {
    // plain text answer: keep it as it is
  }
  msg = msg.trim().slice(0, 300);
  return msg || 'The server answered ' + status + '.';
}

// Changing data needs the owner's token (see AiChat: the passcode buys one). The server checks it;
// this only attaches it. onRejected tells the interface that the token is no longer good.
export const ownerAuth = { token: '', onRejected: () => {} };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const changes = Boolean(init && init.method && init.method !== 'GET');
  const withOwner = changes && ownerAuth.token
    ? Object.assign({}, init, { headers: Object.assign({}, init && init.headers, { 'X-DPP-Owner': ownerAuth.token }) })
    : init;
  try {
    res = await fetch(BASE + path, withOwner);
  } catch (e) {
    throw new Error('The pricing server could not be reached. Check the connection and try again.');
  }
  const text = await res.text();
  if (res.status === 401 && changes) {
    ownerAuth.onRejected();
    throw new Error('Changes are locked. Unlock them with the owner passcode.');
  }
  if (!res.ok) throw new Error(describe(res.status, text));
  return (text ? JSON.parse(text) : undefined) as T;
}

function send(method: string, body: unknown): RequestInit {
  return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const api = {
  underlyings: () => call<Underlying[]>('/Underlyings'),
  createUnderlying: (b: { symbol: string; name: string; historicalPrices: Price[] }) => call<Underlying>('/Underlyings', send('POST', b)),
  renameUnderlying: (id: number, symbol: string, name: string) => call<void>('/Underlyings/' + id, send('PUT', { id: id, symbol: symbol, name: name })),
  deleteUnderlying: (id: number) => call<void>('/Underlyings/' + id, { method: 'DELETE' }),
  options: () => call<OptionEntity[]>('/OptionEntities'),
  createOption: (b: OptionBody) => call<OptionEntity>('/OptionEntities', send('POST', b)),
  updateOption: (b: OptionBody) => call<void>('/OptionEntities/' + b.id, send('PUT', b)),
  deleteOption: (id: number) => call<void>('/OptionEntities/' + id, { method: 'DELETE' }),
  trades: () => call<Trade[]>('/Trades'),
  createTrade: (b: TradeBody) => call<Trade>('/Trades', send('POST', b)),
  updateTrade: (b: TradeBody) => call<void>('/Trades/' + b.id, send('PUT', b)),
  deleteTrade: (id: number) => call<void>('/Trades/' + id, { method: 'DELETE' }),
  curves: () => call<RateCurve[]>('/RateCurves'),
  createCurve: (name: string, pts: RatePoint[]) => call<RateCurve>('/RateCurves', send('POST', { id: 0, name: name, ratePoints: pts })),
  renameCurve: (id: number, name: string) => call<void>('/RateCurves/' + id, send('PUT', { id: id, name: name })),
  deleteCurve: (id: number) => call<void>('/RateCurves/' + id, { method: 'DELETE' }),
  valuate: (req: ValuationRequest) => call<ValuationResult>('/valuation', send('POST', req)),
  priceOption: (req: PriceRequest) => call<PriceResult>('/Simulation/price-option', send('POST', req)),
};

// ---------------------------------------------------------------- dates

export function day(iso: string): string {
  return (iso || '').slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysLeft(expiryIso: string): number {
  const ms = Date.parse(expiryIso) - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthName(isoDay: string): string {
  return MONTHS[Number(isoDay.slice(5, 7)) - 1] || '';
}

export function shortDate(isoDay: string): string {
  return monthName(isoDay) + ' ' + Number(isoDay.slice(8, 10));
}

export function monthYear(isoDay: string): string {
  return monthName(isoDay) + ' ' + isoDay.slice(0, 4);
}

// ---------------------------------------------------------------- underlyings

export type UStats = {
  id: number; symbol: string; name: string; n: number; first: string; lastDate: string; last: number; prev: number;
  change: number; changePct: number; hi52: number; lo52: number; vol: number | null; spark: number[]; predefined: boolean;
};

// The same volatility the pricing engine uses: daily log returns over every close, annualized.
export function computeStats(u: Underlying): UStats | null {
  const hp = u.historicalPrices || [];
  const n = hp.length;
  if (n === 0) return null;
  const p = hp.map((h) => h.price);
  const last = p[n - 1];
  const prev = n > 1 ? p[n - 2] : last;
  const year = p.slice(-252);
  let vol: number | null = null;
  if (n >= 3) {
    const lr: number[] = [];
    let ok = true;
    for (let i = 1; i < n; i++) {
      if (p[i - 1] <= 0 || p[i] <= 0) { ok = false; break; }
      lr.push(Math.log(p[i] / p[i - 1]));
    }
    if (ok) {
      const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
      const variance = lr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (lr.length - 1);
      vol = Math.sqrt(variance) * Math.sqrt(252);
    }
  }
  const spark: number[] = [];
  for (let i = n - 1; i >= 0 && spark.length < 26; i -= 5) spark.unshift(p[i]);
  return {
    id: u.id, symbol: u.symbol, name: u.name || '', n: n, first: day(hp[0].date), lastDate: day(hp[n - 1].date),
    last: last, prev: prev, change: last - prev, changePct: prev ? ((last - prev) / prev) * 100 : 0,
    hi52: Math.max.apply(null, year), lo52: Math.min.apply(null, year), vol: vol, spark: spark, predefined: u.id <= 50,
  };
}

// Accepts a JSON array of {date, price} or one "date, price" pair per line.
export function parseCloses(text: string): Price[] {
  const t = text.trim();
  if (!t) return [];
  let rows: { date: string; price: number }[] = [];
  if (t.charAt(0) === '[') {
    const arr = JSON.parse(t);
    if (!Array.isArray(arr)) throw new Error('Closes must be a list of dates and prices.');
    rows = arr.map((r: { date: string; price: number }) => ({ date: String(r.date), price: Number(r.price) }));
  } else {
    t.split(/\r?\n/).forEach((line) => {
      const parts = line.split(/[,;\t ]+/).filter((x) => x !== '');
      if (parts.length < 2) return;
      const price = Number(parts[parts.length - 1]);
      if (!isFinite(price) || isNaN(Date.parse(parts[0]))) return;
      rows.push({ date: parts[0], price: price });
    });
  }
  const out = rows
    .filter((r) => isFinite(r.price) && r.price > 0 && !isNaN(Date.parse(r.date)))
    .map((r) => ({ date: new Date(r.date).toISOString(), price: r.price }));
  if (out.length === 0) throw new Error('No valid closes found. Use one "2026-11-13, 162.90" pair per line.');
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

// ---------------------------------------------------------------- rate curves

export type CurveKind = 'live' | 'snapshot' | 'scenario' | 'yours';

export function curveKind(c: RateCurve): CurveKind {
  if (/^USD Treasury \+ SOFR \d{4}-\d{2}-\d{2}$/.test(c.name)) return 'snapshot';
  if (/^USD Treasury \+ SOFR/.test(c.name)) return 'live';
  if (/^Scenario/i.test(c.name)) return 'scenario';
  return 'yours';
}

export function snapshotDay(c: RateCurve): string {
  const m = /(\d{4}-\d{2}-\d{2})$/.exec(c.name);
  return m ? m[1] : '';
}

export function liveCurve(curves: RateCurve[]): RateCurve | null {
  return curves.find((c) => curveKind(c) === 'live') || null;
}

// Points sorted by tenor, one per tenor.
export function curvePoints(c: RateCurve): RatePoint[] {
  const seen: { [k: string]: boolean } = {};
  const out: RatePoint[] = [];
  (c.ratePoints || []).slice().sort((a, b) => a.tenor - b.tenor).forEach((p) => {
    const k = p.tenor.toFixed(4);
    if (seen[k]) return;
    seen[k] = true;
    out.push({ tenor: p.tenor, rate: p.rate });
  });
  return out;
}

export function rateAt(c: RateCurve, tenor: number): number | null {
  const p = curvePoints(c).find((x) => Math.abs(x.tenor - tenor) < 0.01);
  return p ? p.rate : null;
}

// The engine discounts with the point whose tenor is nearest to the time left.
export function nearestRate(c: RateCurve, years: number): number | null {
  const pts = curvePoints(c);
  if (pts.length === 0) return null;
  let best = pts[0];
  pts.forEach((p) => { if (Math.abs(p.tenor - years) < Math.abs(best.tenor - years)) best = p; });
  return best.rate;
}

export function tenorLabel(t: number): string {
  if (t < 0.02) return 'O/N';
  if (t < 0.95) return Math.round(t * 12) + 'M';
  return (Math.abs(t - Math.round(t)) < 0.01 ? String(Math.round(t)) : t.toFixed(1)) + 'Y';
}

// Accepts a JSON array of {tenor, rate} or one "tenor in years, rate" pair per line.
// Rates above 1 are read as percent (4.32 means 4.32%).
export function parsePoints(text: string): RatePoint[] {
  const t = text.trim();
  if (!t) throw new Error('Add at least one point: tenor in years, then the rate.');
  let rows: RatePoint[] = [];
  if (t.charAt(0) === '[') {
    const arr = JSON.parse(t);
    if (!Array.isArray(arr)) throw new Error('Points must be a list of tenors and rates.');
    rows = arr.map((r: RatePoint) => ({ tenor: Number(r.tenor), rate: Number(r.rate) }));
  } else {
    t.split(/\r?\n/).forEach((line) => {
      const parts = line.split(/[,;\t ]+/).filter((x) => x !== '');
      if (parts.length < 2) return;
      rows.push({ tenor: Number(parts[0]), rate: Number(parts[1].replace('%', '')) });
    });
  }
  rows = rows.filter((r) => isFinite(r.tenor) && r.tenor > 0 && isFinite(r.rate));
  if (rows.length === 0) throw new Error('No valid points found. Use one "0.25, 4.32" pair per line.');
  const percent = rows.some((r) => Math.abs(r.rate) > 1);
  return rows.map((r) => ({ tenor: r.tenor, rate: percent ? r.rate / 100 : r.rate })).sort((a, b) => a.tenor - b.tenor);
}
