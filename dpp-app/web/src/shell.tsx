// The frame every screen sits in: left navigation, top bar and the right panel.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Underlying, OptionEntity, Trade, RateCurve, ValuationResult, TradeValuation, UStats } from './api';
import { liveCurve, rateAt } from './api';
import { fmt } from './ui';

export type ValSettings = {
  curveId: number; asOf: string; paths: number; steps: number; antithetic: boolean; controlVariate: boolean;
  vdc: boolean; base1: number; base2: number; multithreaded: boolean;
};

export type Reloadable = 'underlyings' | 'options' | 'trades' | 'curves';

export type Ctx = {
  underlyings: Underlying[] | null;
  stats: UStats[];
  options: OptionEntity[] | null;
  trades: Trade[] | null;
  curves: RateCurve[] | null;
  error: string;
  reload: (...what: Reloadable[]) => Promise<void>;
  valuation: ValuationResult | null;
  valBusy: boolean;
  valError: string;
  valMs: number;
  valSettings: ValSettings;
  setValSettings: (s: ValSettings) => void;
  runValuation: (ids?: number[], s?: ValSettings) => Promise<void>;
  section: string;
  go: (section: string) => void;
  selUnderlying: number | null;
  setSelUnderlying: (id: number | null) => void;
  selOption: number | null;
  setSelOption: (id: number | null) => void;
};

export const SECTIONS = [
  { key: 'underlyings', label: 'Underlyings' },
  { key: 'derivatives', label: 'Derivatives' },
  { key: 'trades', label: 'Trades' },
  { key: 'rates', label: 'Rates' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'overview', label: 'Overview' },
];

export type Book = {
  net: { [instrumentId: number]: number };
  byTrade: { [tradeId: number]: TradeValuation };
  byInstrument: { [instrumentId: number]: TradeValuation };
};

// Net position per instrument and the latest valuation per trade and per instrument.
export function book(ctx: Ctx): Book {
  const out: Book = { net: {}, byTrade: {}, byInstrument: {} };
  (ctx.valuation ? ctx.valuation.valuations : []).forEach((v) => { out.byTrade[v.tradeId] = v; });
  (ctx.trades || []).forEach((t) => {
    out.net[t.instrumentId] = (out.net[t.instrumentId] || 0) + t.quantity;
    const v = out.byTrade[t.id];
    if (v && v.status === 'valued' && !out.byInstrument[t.instrumentId]) out.byInstrument[t.instrumentId] = v;
  });
  return out;
}

// The underlying behind an instrument: the option's underlying, or the instrument itself.
export function underlyingOf(ctx: Ctx, instrumentId: number): { id: number; symbol: string } | null {
  const o = (ctx.options || []).find((x) => x.id === instrumentId);
  if (o) return { id: o.underlyingId, symbol: o.underlying ? o.underlying.symbol : String(o.underlyingId) };
  const u = ctx.stats.find((s) => s.id === instrumentId);
  return u ? { id: u.id, symbol: u.symbol } : null;
}

function Logo() {
  return (
    <svg className="brand-logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="none" stroke="#1ABC9C" strokeWidth="3" />
      <rect x="18" y="31" width="6" height="15" rx="2" fill="#ECF0F1" />
      <rect x="29" y="23" width="6" height="23" rx="2" fill="#ECF0F1" />
      <rect x="40" y="35" width="6" height="11" rx="2" fill="#ECF0F1" />
      <path d="M17 37 L24 30 L32 33 L43 27 L50 23" fill="none" stroke="#2DD4AC" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="23" r="3.2" fill="#2DD4AC" />
    </svg>
  );
}

export function LeftRail(p: { ctx: Ctx }) {
  const ctx = p.ctx;
  const counts: { [k: string]: number | null } = {
    underlyings: ctx.underlyings ? ctx.underlyings.length : null,
    derivatives: ctx.options ? ctx.options.length : null,
    trades: ctx.trades ? ctx.trades.length : null,
    rates: ctx.curves ? ctx.curves.length : null,
  };
  const latest = ctx.stats.filter((s) => s.predefined).reduce((m, s) => (s.lastDate > m ? s.lastDate : m), '');
  const lag = latest ? Math.floor((Date.now() - Date.parse(latest + 'T21:00:00Z')) / 86400000) : -1;
  const live = ctx.curves ? liveCurve(ctx.curves) : null;
  const ten = live ? rateAt(live, 10) : null;
  const item = (key: string, label: string) => {
    const c = counts[key];
    return (
      <a key={key} href={'#/' + key} className={ctx.section === key ? 'active' : ''} aria-current={ctx.section === key ? 'page' : undefined}>
        <span>{label}</span>
        {c !== null && c !== undefined ? <span className="count">{c}</span> : null}
      </a>
    );
  };
  return (
    <nav className="rail left" aria-label="Sections">
      <div className="rail-head">
        <Logo />
        <span className="brand">Derivatives Portfolio Pricer</span>
      </div>
      <div className="nav">{SECTIONS.slice(0, 5).map((s) => item(s.key, s.label))}</div>
      <div className="nav second">
        <a
          href="#/ai"
          onClick={(e) => {
            e.preventDefault();
            const dock = document.getElementById('dpp-ai');
            if (dock) dock.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
        >
          <span>DPP AI</span>
          <span className="count">next</span>
        </a>
        {item('overview', 'Overview')}
      </div>
      <div className="grow" />
      <div className="status">
        <h2>Market data</h2>
        <div className="kv"><span>Prices</span><span>{latest ? latest + ' close' : 'loading'}</span></div>
        <div className="kv"><span>10-year rate</span><span>{ten !== null ? fmt(ten * 100, 2) + '%' : 'loading'}</span></div>
        <div className="kv">
          <span>Nightly update</span>
          <span className={lag < 0 ? '' : lag <= 4 ? 'pos' : 'warn'}>{lag < 0 ? 'loading' : lag <= 4 ? 'on schedule' : 'behind'}</span>
        </div>
      </div>
      <p className="credit">
        Designed and developed by Frank Ygnacio Rosas<br />
        <a href="https://linktr.ee/fsyrosas" target="_blank" rel="noreferrer">linktr.ee/fsyrosas</a><br />
        © 2026
      </p>
    </nav>
  );
}

function Find(p: { ctx: Ctx }) {
  const ctx = p.ctx;
  const [q, setQ] = useState('');
  const open = (text: string): boolean => {
    const key = text.trim().toUpperCase();
    if (!key) return false;
    const u = ctx.stats.find((s) => s.symbol.toUpperCase() === key);
    if (u) { ctx.setSelUnderlying(u.id); ctx.go('underlyings'); return true; }
    const o = (ctx.options || []).find((x) => x.symbol.toUpperCase() === key);
    if (o) { ctx.setSelOption(o.id); ctx.go('derivatives'); return true; }
    return false;
  };
  return (
    <form className="find" role="search" onSubmit={(e) => { e.preventDefault(); if (open(q)) setQ(''); }}>
      <label htmlFor="find-box">Find</label>
      <input
        id="find-box"
        type="search"
        list="find-list"
        placeholder="Symbol or instrument"
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          const kind = (e.nativeEvent as InputEvent).inputType;
          // Picking a suggestion arrives as a replacement, not as typing: open it right away.
          if ((!kind || kind === 'insertReplacementText') && open(v)) setQ('');
          else setQ(v);
        }}
      />
      <datalist id="find-list">
        {ctx.stats.map((s) => <option key={'u' + s.id} value={s.symbol}>{s.name}</option>)}
        {(ctx.options || []).map((o) => <option key={'o' + o.id} value={o.symbol}>{o.name}</option>)}
      </datalist>
    </form>
  );
}

function AiDock() {
  return (
    <div className="dock" id="dpp-ai">
      <label>
        Ask DPP AI
        <input type="text" disabled placeholder="Value my NVDA trades on the Oct 30 curve" />
      </label>
      <p className="note">Coming next. It will add data and run valuations from this panel, in every section.</p>
    </div>
  );
}

export function Shell(p: { ctx: Ctx; title: string; sub: string; railTitle: string; rail: ReactNode; children: ReactNode }) {
  return (
    <>
      <main className="main" id="workspace">
        <header className="topbar">
          <h1>{p.title}</h1>
          <p>{p.sub}</p>
          <Find ctx={p.ctx} />
        </header>
        <div className="work">
          {p.ctx.error ? <div className="notice bad" role="alert">{p.ctx.error}</div> : null}
          {p.children}
        </div>
      </main>
      <aside className="rail right" aria-label={p.railTitle}>
        <div className="rail-head"><h2>{p.railTitle}</h2></div>
        <div className="rail-body">{p.rail}</div>
        <div className="grow" />
        <AiDock />
      </aside>
    </>
  );
}
