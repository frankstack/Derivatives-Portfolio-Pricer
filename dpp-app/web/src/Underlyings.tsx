// Underlyings: the price chart first, then the watchlist. The right panel shows what you hold on the selection.
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, parseCloses, daysLeft, day, shortDate, monthYear } from './api';
import type { UStats } from './api';
import { Shell, book } from './shell';
import type { Ctx } from './shell';
import { Panel, Kpi, Seg, Field, Area, Btn, DataGrid, Notice, fmt, signed, tone } from './ui';
import type { Col } from './ui';
import { LineChart, Legend, Sparkline, C } from './charts';
import type { HLine, Marker, XTick } from './charts';

const RANGES: { [k: string]: number } = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '5Y': 1260, All: 0 };
const cents = (x: number) => Math.round(x * 100) / 100;

export function Underlyings(p: { ctx: Ctx }) {
  const ctx = p.ctx;
  const [range, setRange] = useState('1Y');
  const [group, setGroup] = useState('Predefined');
  const [sym, setSym] = useState('');
  const [name, setName] = useState('');
  const [closes, setCloses] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<{ id: number; name: string } | null>(null);

  const stats = ctx.stats;
  const options = ctx.options || [];
  const trades = ctx.trades || [];
  const bk = useMemo(() => book(ctx), [ctx.trades, ctx.valuation]);

  // Until something is picked, show the underlying with the most trades on it.
  const busiest = useMemo(() => {
    const count: { [id: number]: number } = {};
    trades.forEach((t) => {
      const o = options.find((x) => x.id === t.instrumentId);
      const uid = o ? o.underlyingId : t.instrumentId;
      count[uid] = (count[uid] || 0) + 1;
    });
    let best: UStats | null = null;
    let bestN = -1;
    for (const s of stats) {
      const c = count[s.id] || 0;
      if (c > bestN) { best = s; bestN = c; }
    }
    return best;
  }, [stats, ctx.trades, ctx.options]);
  const selected: UStats | null = stats.find((s) => s.id === ctx.selUnderlying) || busiest;
  const full = selected && ctx.underlyings ? ctx.underlyings.find((u) => u.id === selected.id) : undefined;

  const chart = useMemo(() => {
    if (!full || full.historicalPrices.length < 2) return null;
    const k = RANGES[range];
    const hp = k ? full.historicalPrices.slice(-k) : full.historicalPrices;
    const values = hp.map((h) => h.price);
    const dates = hp.map((h) => day(h.date));
    const n = hp.length;
    const xTicks: XTick[] = [];
    for (let i = 0; i <= 5; i++) {
      const idx = Math.round((i * (n - 1)) / 5);
      xTicks.push({ pos: idx / (n - 1), label: k && k <= 126 ? shortDate(dates[idx]) : monthYear(dates[idx]) });
    }
    const lo = Math.min.apply(null, values);
    const hi = Math.max.apply(null, values);
    const span = hi - lo || 1;
    // Strikes of the open derivatives on this underlying, when they sit near the price range.
    const hlines: HLine[] = [];
    options.forEach((o) => {
      if (o.underlyingId !== full.id || o.optionType === 6 || daysLeft(o.expirationDate) === 0) return;
      if (o.strikePrice < lo - 0.3 * span || o.strikePrice > hi + 0.3 * span || hlines.length >= 5) return;
      const kind = (o.optionType === 1 ? '' : o.optionTypeName.toLowerCase() + ' ') + (o.isCall ? 'call' : 'put');
      hlines.push({ y: o.strikePrice, label: fmt(o.strikePrice, 0) + ' ' + kind + ', ' + monthYear(day(o.expirationDate)) });
    });
    // Trades on this underlying or on its derivatives, placed on the close of the trade date.
    const markers: Marker[] = [];
    trades.forEach((t) => {
      const o = options.find((x) => x.id === t.instrumentId);
      const uid = o ? o.underlyingId : t.instrumentId;
      const d = day(t.tradeDate);
      if (uid !== full.id || d < dates[0] || d > dates[n - 1]) return;
      let idx = dates.findIndex((x) => x >= d);
      if (idx < 0) idx = n - 1;
      const what = (t.quantity > 0 ? 'Bought ' : 'Sold ') + Math.abs(t.quantity) + ' ' + (t.instrument ? t.instrument.symbol : 'units');
      markers.push({ index: idx, y: values[idx], color: t.quantity > 0 ? C.teal : C.orange, label: what + ' on ' + d });
    });
    return { values: values, dates: dates, xTicks: xTicks, hlines: hlines, markers: markers };
  }, [full, range, ctx.options, ctx.trades]);

  const list = stats.filter((s) => (group === 'Predefined') === s.predefined);
  const cols: Col<UStats>[] = [
    { key: 'sym', head: 'Symbol', left: true, cls: 'sym', cell: (r) => r.symbol, sort: (r) => r.symbol },
    { key: 'name', head: 'Name', left: true, text: true, cls: 'soft', cell: (r) => r.name, sort: (r) => r.name },
    { key: 'last', head: 'Last', cell: (r) => fmt(r.last), sort: (r) => r.last },
    { key: 'chg', head: 'Change', cell: (r) => signed(r.change), sort: (r) => r.change, tone: (r) => tone(cents(r.change)) },
    { key: 'pct', head: 'Change %', cell: (r) => signed(r.changePct) + '%', sort: (r) => r.changePct, tone: (r) => tone(cents(r.changePct)) },
    { key: 'spark', head: '26 weeks', left: true, cell: (r) => <Sparkline values={r.spark} /> },
    { key: 'lo', head: '52-week low', cls: 'soft', cell: (r) => fmt(r.lo52), sort: (r) => r.lo52 },
    { key: 'hi', head: '52-week high', cls: 'soft', cell: (r) => fmt(r.hi52), sort: (r) => r.hi52 },
    { key: 'vol', head: 'Volatility', cell: (r) => (r.vol === null ? 'n/a' : fmt(r.vol * 100, 1) + '%'), sort: (r) => r.vol || 0 },
    { key: 'n', head: 'Closes', cls: 'soft', cell: (r) => fmt(r.n, 0), sort: (r) => r.n },
  ];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    const symbol = sym.trim().toUpperCase();
    if (!symbol) { setMsg('Give the underlying a symbol.'); return; }
    if (stats.some((s) => s.symbol.toUpperCase() === symbol)) { setMsg(symbol + ' already exists. Pick another symbol.'); return; }
    setBusy(true);
    try {
      const prices = parseCloses(closes);
      const made = await api.createUnderlying({ symbol: symbol, name: name.trim() || symbol, historicalPrices: prices });
      await ctx.reload('underlyings');
      setGroup('Yours');
      ctx.setSelUnderlying(made.id);
      setSym(''); setName(''); setCloses('');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editName = selected ? (edit && edit.id === selected.id ? edit.name : selected.name) : '';
  const rename = async () => {
    if (!selected) return;
    setMsg(''); setBusy(true);
    try {
      await api.renameUnderlying(selected.id, selected.symbol, editName.trim() || selected.symbol);
      await ctx.reload('underlyings');
      setEdit(null);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!selected) return;
    const used = options.filter((o) => o.underlyingId === selected.id).length;
    const warn = 'Delete ' + selected.symbol + ' and its ' + selected.n + ' closes?' + (used ? ' Its ' + used + ' derivatives and their trades go with it.' : '') + ' This cannot be undone.';
    if (!window.confirm(warn)) return;
    setMsg(''); setBusy(true);
    try {
      await api.deleteUnderlying(selected.id);
      ctx.setSelUnderlying(null);
      await Promise.all([ctx.reload('underlyings'), ctx.reload('options'), ctx.reload('trades')]);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mine = selected ? options.filter((o) => o.underlyingId === selected.id) : [];
  const rail = (
    <>
      <h3>{selected ? 'Derivatives on ' + selected.symbol : 'Derivatives'}</h3>
      {mine.length === 0 ? <p className="note">No derivatives on this underlying yet.</p> : null}
      {mine.map((o) => {
        const net = bk.net[o.id] || 0;
        const v = bk.byInstrument[o.id];
        return (
          <div key={o.id} className="card">
            <button type="button" onClick={() => { ctx.setSelOption(o.id); ctx.go('derivatives'); }}>{o.symbol}</button>
            <span className="soft">{o.optionTypeName + (o.isCall ? ' call' : ' put') + (o.optionType === 6 ? '' : ', strike ' + fmt(o.strikePrice, 0))}</span>
            <span className="split">
              <span className={tone(net)}>{'Net ' + signed(net, 0)}</span>
              <span className="soft">{daysLeft(o.expirationDate) === 0 ? 'expired' : v ? fmt(v.unitPrice) + ' per unit' : ''}</span>
            </span>
          </div>
        );
      })}
      {selected && !selected.predefined ? (
        <>
          <h3>{'Manage ' + selected.symbol}</h3>
          <Field label="Name" mono={false} value={editName} onChange={(v) => setEdit({ id: selected.id, name: v })} />
          <div className="btns">
            <Btn onClick={rename} disabled={busy}>Save name</Btn>
            <Btn kind="danger" onClick={remove} disabled={busy}>Delete</Btn>
          </div>
        </>
      ) : null}
      <h3>Add an underlying</h3>
      <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Symbol" value={sym} onChange={setSym} placeholder="MYSTOCK" />
        <Field label="Name" mono={false} value={name} onChange={setName} placeholder="My stock" />
        <Area label="Daily closes" value={closes} onChange={setCloses} placeholder={'2026-11-12, 101.50\n2026-11-13, 102.25'} />
        <Btn kind="primary" submit disabled={busy}>{busy ? 'Saving' : 'Save underlying'}</Btn>
      </form>
      {msg ? <Notice bad>{msg}</Notice> : null}
      <p className="note">One date and price per line, or a JSON list. Predefined underlyings update every night and are read-only.</p>
    </>
  );

  const where = selected && selected.hi52 > selected.lo52 ? ((selected.last - selected.lo52) / (selected.hi52 - selected.lo52)) * 100 : 0;
  return (
    <Shell ctx={ctx} title="Underlyings" sub="Prices that feed every valuation" railTitle={selected ? selected.symbol + ' in your book' : 'Your book'} rail={rail}>
      {ctx.underlyings === null ? <Notice>Loading the price history of every underlying. This is the largest download on the site.</Notice> : null}
      {selected ? (
        <div className="kpis">
          <Kpi label="Last close" value={fmt(selected.last)} sub={selected.lastDate} />
          <Kpi label="Day change" value={signed(selected.change)} sub={signed(selected.changePct) + '%'} cls={tone(cents(selected.change))} subCls={tone(cents(selected.change))} />
          <Kpi label="52-week low" value={fmt(selected.lo52)} sub={'High ' + fmt(selected.hi52) + '. Now ' + fmt(where, 0) + '% up the range'} />
          <Kpi label="Volatility used for pricing" value={selected.vol === null ? 'n/a' : fmt(selected.vol * 100, 1) + '%'} sub={'All ' + fmt(selected.n, 0) + ' closes since ' + monthYear(selected.first)} />
        </div>
      ) : null}
      {selected ? (
        <Panel
          title={<><span className="mono">{selected.symbol}</span> {selected.name}</>}
          right={<div style={{ flex: '0 1 300px' }}><Seg label="Chart range" options={Object.keys(RANGES)} value={range} onChange={setRange} /></div>}
        >
          {chart ? (
            <>
              <LineChart
                label={'Daily close of ' + selected.symbol + ' from ' + chart.dates[0] + ' to ' + chart.dates[chart.dates.length - 1] + ', last ' + fmt(selected.last)}
                series={[{ name: '', color: C.teal, values: chart.values, width: 2 }]}
                height={320}
                xTicks={chart.xTicks}
                yFormat={(v) => fmt(v)}
                yTick={(v) => fmt(v, v < 10 ? 2 : 0)}
                tip={(i) => chart.dates[i]}
                area
                tag
                hlines={chart.hlines}
                markers={chart.markers}
              />
              <Legend
                items={[{ color: C.teal, label: 'Daily close' }]
                  .concat(chart.hlines.length ? [{ color: C.amber, label: 'Strike of an open derivative', kind: 'dash' } as never] : [])
                  .concat(chart.markers.length ? [{ color: C.teal, label: 'Trade: bought', kind: 'round' } as never, { color: C.orange, label: 'Trade: sold', kind: 'round' } as never] : [])}
              />
            </>
          ) : (
            <div className="empty">This underlying needs at least two closes to draw a chart.</div>
          )}
        </Panel>
      ) : null}
      <Panel
        title="All underlyings"
        right={<div style={{ flex: '0 1 240px' }}><Seg label="Underlying group" options={['Predefined', 'Yours']} value={group} onChange={setGroup} /></div>}
      >
        <DataGrid
          cols={cols}
          rows={list}
          id={(r) => r.id}
          selected={selected ? selected.id : null}
          onPick={(r) => ctx.setSelUnderlying(r.id)}
          maxHeight={392}
          empty={group === 'Yours' ? 'You have not added an underlying yet. Use the form on the right.' : 'Loading.'}
        />
        <div className="panel-foot">{list.length + ' underlyings. Click a row to chart it, click a column to sort.'}</div>
      </Panel>
    </Shell>
  );
}
