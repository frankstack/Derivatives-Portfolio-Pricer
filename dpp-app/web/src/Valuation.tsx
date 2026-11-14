// Valuation: run the Monte Carlo engine over the book. Run settings sit on the right.
import { useMemo, useState } from 'react';
import { curveKind, liveCurve, shortDate, snapshotDay, today } from './api';
import type { TradeValuation } from './api';
import { Shell, underlyingOf } from './shell';
import type { Ctx, ValSettings } from './shell';
import { Panel, Kpi, Seg, Field, Select, Check, Btn, DataGrid, Notice, Kv, fmt, signed, tone } from './ui';
import type { Col } from './ui';
import { BarList } from './charts';

type Row = { id: number; symbol: string; qty: number; v: TradeValuation | undefined; on: boolean };

const STATUS: { [k: string]: string } = { valued: 'Valued', expired: 'Expired', not_traded_yet: 'Not traded yet' };

export function Valuation(p: { ctx: Ctx }) {
  const ctx = p.ctx;
  const trades = ctx.trades || [];
  const curves = ctx.curves || [];
  const s = ctx.valSettings;
  const [off, setOff] = useState<{ [id: number]: boolean }>({});
  const [msg, setMsg] = useState('');
  const set = (patch: Partial<ValSettings>) => ctx.setValSettings(Object.assign({}, s, patch));

  const byTrade = useMemo(() => {
    const m: { [id: number]: TradeValuation } = {};
    (ctx.valuation ? ctx.valuation.valuations : []).forEach((v) => { m[v.tradeId] = v; });
    return m;
  }, [ctx.valuation]);

  const rows: Row[] = trades.map((t) => ({ id: t.id, symbol: t.instrument ? t.instrument.symbol : String(t.instrumentId), qty: t.quantity, v: byTrade[t.id], on: !off[t.id] }));
  const chosen = rows.filter((r) => r.on).map((r) => r.id);
  const num = (x: number | undefined, d: number) => (x === undefined ? '' : fmt(x, d));
  const live = (r: Row) => r.v !== undefined && r.v.status === 'valued';

  const cols: Col<Row>[] = [
    {
      key: 'on', head: 'Run', left: true,
      cell: (r) => <input type="checkbox" checked={r.on} aria-label={'Include trade ' + r.id + ' in the next run'} onClick={(e) => e.stopPropagation()} onChange={(e) => setOff(Object.assign({}, off, { [r.id]: !e.target.checked }))} />,
    },
    { key: 'id', head: 'ID', cls: 'muted', cell: (r) => r.id, sort: (r) => r.id },
    { key: 'sym', head: 'Instrument', left: true, cls: 'sym', cell: (r) => r.symbol, sort: (r) => r.symbol },
    { key: 'qty', head: 'Qty', cell: (r) => signed(r.qty, 0), sort: (r) => r.qty, tone: (r) => (live(r) ? tone(r.qty) : '') },
    { key: 'unit', head: 'Unit value', cell: (r) => (live(r) ? num(r.v && r.v.unitPrice, 2) : ''), sort: (r) => (r.v ? r.v.unitPrice : 0) },
    { key: 'value', head: 'Value', cell: (r) => (r.v ? fmt(r.v.price) : ''), sort: (r) => (r.v ? r.v.price : 0) },
    { key: 'delta', head: 'Delta', cls: 'soft', cell: (r) => (live(r) && r.v ? signed(r.v.delta, 3) : ''), sort: (r) => (r.v ? r.v.delta : 0) },
    { key: 'gamma', head: 'Gamma', cls: 'soft', cell: (r) => (live(r) ? num(r.v && r.v.gamma, 4) : ''), sort: (r) => (r.v ? r.v.gamma : 0) },
    { key: 'vega', head: 'Vega', cls: 'soft', cell: (r) => (live(r) ? num(r.v && r.v.vega, 1) : ''), sort: (r) => (r.v ? r.v.vega : 0) },
    { key: 'theta', head: 'Theta', cls: 'soft', cell: (r) => (live(r) ? num(r.v && r.v.theta, 1) : ''), sort: (r) => (r.v ? r.v.theta : 0) },
    { key: 'rho', head: 'Rho', cls: 'soft', cell: (r) => (live(r) ? num(r.v && r.v.rho, 1) : ''), sort: (r) => (r.v ? r.v.rho : 0) },
    { key: 'vol', head: 'Vol', cls: 'soft', cell: (r) => (live(r) && r.v ? fmt(r.v.volatility * 100, 1) + '%' : ''), sort: (r) => (r.v ? r.v.volatility : 0) },
    { key: 'rate', head: 'Rate', cls: 'soft', cell: (r) => (live(r) && r.v ? fmt(r.v.riskFreeRate * 100, 2) + '%' : ''), sort: (r) => (r.v ? r.v.riskFreeRate : 0) },
    { key: 'days', head: 'Days', cls: 'soft', cell: (r) => (r.v ? Math.round(r.v.timeToMaturity * 365) : ''), sort: (r) => (r.v ? r.v.timeToMaturity : 0) },
    {
      key: 'status', head: 'Status', left: true, text: true,
      cell: (r) => (r.v ? STATUS[r.v.status] || r.v.status : 'Not in the last run'),
      sort: (r) => (r.v ? r.v.status : 'z'),
      tone: (r) => (!r.v ? 'muted' : r.v.status === 'valued' ? 'pos' : 'warn'),
    },
  ];
  // Status sits right after the instrument so it stays in view when the grid scrolls sideways.
  cols.splice(3, 0, cols.pop() as Col<Row>);

  const vals = ctx.valuation ? ctx.valuation.valuations : [];
  const valued = vals.filter((v) => v.status === 'valued');
  const expired = vals.filter((v) => v.status === 'expired').length;
  const later = vals.filter((v) => v.status === 'not_traded_yet').length;

  const bars = useMemo(() => {
    const sum: { [name: string]: number } = {};
    valued.forEach((v) => {
      const t = trades.find((x) => x.id === v.tradeId);
      const u = t ? underlyingOf(ctx, t.instrumentId) : null;
      const name = u ? u.symbol : 'Other';
      sum[name] = (sum[name] || 0) + v.price;
    });
    return Object.keys(sum).map((k) => ({ name: k, value: sum[k] })).sort((a, b) => b.value - a.value);
  }, [ctx.valuation, ctx.trades, ctx.options, ctx.stats]);

  const run = () => {
    setMsg('');
    if (chosen.length === 0) { setMsg('Tick at least one trade to value.'); return; }
    if (!(s.paths >= 100 && s.paths <= 500000)) { setMsg('Paths must be between 100 and 500,000.'); return; }
    if (!(s.steps >= 1 && s.steps <= 500)) { setMsg('Steps must be between 1 and 500.'); return; }
    if (s.vdc && !(s.base1 >= 2 && s.base2 >= 2)) { setMsg('Both sequence bases must be 2 or more.'); return; }
    if (s.asOf && s.asOf > today()) { setMsg('The valuation date cannot be in the future.'); return; }
    ctx.runValuation(chosen, s);
  };

  const liveId = liveCurve(curves);
  const group = (k: string) => (k === 'live' ? 'Live' : k === 'snapshot' ? 'Month-end snapshots' : k === 'scenario' ? 'Scenarios' : 'Yours');
  const order = ['live', 'snapshot', 'scenario', 'yours'];
  const curveChoices = curves
    .slice()
    .sort((a, b) => order.indexOf(curveKind(a)) - order.indexOf(curveKind(b)) || (snapshotDay(a) < snapshotDay(b) ? 1 : -1))
    .map((c) => ({ value: String(c.id), label: c.name, group: group(curveKind(c)) }));
  const when = ctx.valuation ? shortDate(ctx.valuation.valuationDate.slice(0, 10)) + ', ' + ctx.valuation.valuationDate.slice(11, 16) : '';

  const rail = (
    <>
      <Select label="Rate curve" value={String(s.curveId || (liveId ? liveId.id : ''))} onChange={(v) => set({ curveId: Number(v) })} options={curveChoices} />
      <div className="field">
        <span>Value as of</span>
        <Seg label="Valuation date" options={['Now', 'A past date']} value={s.asOf ? 'A past date' : 'Now'} onChange={(v) => set({ asOf: v === 'Now' ? '' : s.asOf || today() })} />
      </div>
      {s.asOf ? <Field label="Date" type="date" value={s.asOf} onChange={(v) => set({ asOf: v || today() })} /> : null}
      <div className="two">
        <Field label="Paths" value={String(s.paths)} onChange={(v) => set({ paths: Math.round(Number(v)) || 0 })} />
        <Field label="Steps" value={String(s.steps)} onChange={(v) => set({ steps: Math.round(Number(v)) || 0 })} />
      </div>
      <h3>Variance reduction</h3>
      <div>
        <Check label="Antithetic paths" checked={s.antithetic} onChange={(v) => set({ antithetic: v })} />
        <Check label="Control variate" checked={s.controlVariate} onChange={(v) => set({ controlVariate: v })} />
        <Check label="Van der Corput sequence" checked={s.vdc} onChange={(v) => set({ vdc: v })} />
        <Check label="Run on all cores" checked={s.multithreaded} onChange={(v) => set({ multithreaded: v })} />
      </div>
      {s.vdc ? (
        <div className="two">
          <Field label="Base 1" value={String(s.base1)} onChange={(v) => set({ base1: Math.round(Number(v)) || 0 })} />
          <Field label="Base 2" value={String(s.base2)} onChange={(v) => set({ base2: Math.round(Number(v)) || 0 })} />
        </div>
      ) : null}
      <Btn kind="primary" onClick={run} disabled={ctx.valBusy}>{ctx.valBusy ? 'Valuing' : 'Run valuation on ' + chosen.length + (chosen.length === 1 ? ' trade' : ' trades')}</Btn>
      {msg ? <Notice bad>{msg}</Notice> : null}
      {ctx.valuation ? (
        <div>
          <Kv k="Last run took" v={fmt(ctx.valMs / 1000, 1) + ' s'} />
          <Kv k="Trades in it" v={vals.length} />
        </div>
      ) : null}
      <p className="note">A past date uses closes up to that day and leaves out trades made after it. The other screens always show the book as of now.</p>
    </>
  );

  return (
    <Shell ctx={ctx} title="Valuation" sub="Monte Carlo value and Greeks for the book" railTitle="Run settings" rail={rail}>
      {ctx.valError ? <Notice bad>{'The valuation did not run: ' + ctx.valError}</Notice> : null}
      <div className="kpis">
        <Kpi label="Portfolio value" value={ctx.valuation ? fmt(ctx.valuation.portfolioValue) : ctx.valBusy ? 'valuing' : 'not run yet'} sub={ctx.valBusy && ctx.valuation ? 'Running again' : ''} />
        <Kpi label="Trades valued" value={String(valued.length)} sub={'of ' + vals.length + ' in the last run'} />
        <Kpi label="Left at zero" value={String(expired + later)} sub={expired + ' expired, ' + later + ' not traded yet'} cls={expired + later > 0 ? 'warn' : ''} />
        <Kpi label="Valued as of" value={when || 'n/a'} sub={when ? 'UTC' + (valued.length && valued[0].spotDate ? ', spot from the ' + valued[0].spotDate.slice(0, 10) + ' close' : '') : ''} />
      </div>
      <Panel title="Market value by underlying" right={<span className="hint">Long positions right of the line, short positions left</span>}>
        <BarList items={bars} format={(v) => signed(v)} />
      </Panel>
      <Panel
        title="Results by trade"
        right={
          <div className="btns">
            <span className="hint" style={{ alignSelf: 'center' }}>Value is unit value times quantity. Greeks are per unit.</span>
            <Btn onClick={() => setOff({})}>Tick all</Btn>
            <Btn onClick={() => { const m: { [id: number]: boolean } = {}; trades.forEach((t) => { m[t.id] = true; }); setOff(m); }}>Clear</Btn>
          </div>
        }
      >
        <DataGrid cols={cols} rows={rows} id={(r) => r.id} dim={(r) => !r.v || r.v.status !== 'valued'} maxHeight={512} empty="No trades to value yet. Add one in Trades." />
      </Panel>
    </Shell>
  );
}
