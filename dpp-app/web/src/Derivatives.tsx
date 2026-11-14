// Derivatives: a dense grid of contracts, with the ticket for the selected one on the right.
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, OPTION_TYPES, BARRIER_TYPES, day, daysLeft, liveCurve, nearestRate } from './api';
import type { OptionEntity, OptionBody, PriceResult } from './api';
import { Shell, book } from './shell';
import type { Ctx } from './shell';
import { Panel, Seg, Field, Select, Btn, DataGrid, Notice, Kv, fmt, signed, tone } from './ui';
import type { Col } from './ui';

type Draft = {
  id: number; symbol: string; name: string; underlyingId: string; type: string; side: string;
  strike: string; expiry: string; rebate: string; barrier: string; barrierType: string;
};

function blank(underlyingId: string): Draft {
  const expiry = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  return { id: 0, symbol: '', name: '', underlyingId: underlyingId, type: '1', side: 'Call', strike: '', expiry: expiry, rebate: '', barrier: '', barrierType: '2' };
}

function fromOption(o: OptionEntity): Draft {
  return {
    id: o.id, symbol: o.symbol, name: o.name || '', underlyingId: String(o.underlyingId), type: String(o.optionType),
    side: o.isCall ? 'Call' : 'Put', strike: String(o.strikePrice), expiry: day(o.expirationDate),
    rebate: o.rebate === null ? '' : String(o.rebate), barrier: o.barrier === null ? '' : String(o.barrier),
    barrierType: o.barrierType === null ? '2' : String(o.barrierType),
  };
}

type Row = { o: OptionEntity; under: string; days: number; spot: number | null; money: number | null; net: number; unit: number | null; terms: string };

export function Derivatives(p: { ctx: Ctx }) {
  const ctx = p.ctx;
  const options = ctx.options || [];
  const stats = ctx.stats;
  const [filter, setFilter] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [quick, setQuick] = useState<{ id: number; r: PriceResult } | null>(null);
  const bk = useMemo(() => book(ctx), [ctx.trades, ctx.valuation]);
  const selected = options.find((o) => o.id === ctx.selOption) || null;

  // The ticket follows the selected row.
  useEffect(() => {
    if (selected) { setDraft(fromOption(selected)); setMsg(''); }
  }, [ctx.selOption, ctx.options]);

  const spotBy: { [id: number]: number } = {};
  stats.forEach((s) => { spotBy[s.id] = s.last; });
  const rows: Row[] = options
    .filter((o) => filter === 0 || o.optionType === filter)
    .map((o) => {
      const spot = spotBy[o.underlyingId] === undefined ? null : spotBy[o.underlyingId];
      const days = daysLeft(o.expirationDate);
      const v = bk.byInstrument[o.id];
      return {
        o: o,
        under: o.underlying ? o.underlying.symbol : '',
        days: days,
        spot: spot,
        money: spot === null || o.optionType === 6 || !o.strikePrice ? null : ((spot - o.strikePrice) / o.strikePrice) * 100,
        net: bk.net[o.id] || 0,
        unit: days > 0 && v ? v.unitPrice : null,
        terms: o.optionType === 4 ? (o.barrierTypeName || 'Barrier') + ' ' + fmt(o.barrier, 0) : o.optionType === 3 ? 'Pays ' + fmt(o.rebate, 2) : '',
      };
    })
    .sort((a, b) => (a.under < b.under ? -1 : a.under > b.under ? 1 : a.o.expirationDate < b.o.expirationDate ? -1 : a.o.expirationDate > b.o.expirationDate ? 1 : a.o.id - b.o.id));

  const cols: Col<Row>[] = [
    { key: 'sym', head: 'Instrument', left: true, cls: 'sym', cell: (r) => r.o.symbol, sort: (r) => r.o.symbol },
    { key: 'type', head: 'Type', left: true, text: true, cls: 'soft', cell: (r) => r.o.optionTypeName + (r.o.isCall ? ' call' : ' put'), sort: (r) => r.o.optionType * 2 + (r.o.isCall ? 0 : 1) },
    { key: 'k', head: 'Strike', cell: (r) => (r.o.optionType === 6 ? 'n/a' : fmt(r.o.strikePrice, 0)), sort: (r) => r.o.strikePrice },
    { key: 'exp', head: 'Expiry', cls: 'soft', cell: (r) => day(r.o.expirationDate), sort: (r) => r.o.expirationDate },
    { key: 'days', head: 'Days', cls: 'soft', cell: (r) => r.days, sort: (r) => r.days },
    { key: 'spot', head: 'Spot', cls: 'soft', cell: (r) => fmt(r.spot), sort: (r) => r.spot || 0 },
    { key: 'money', head: 'Moneyness', cls: 'soft', cell: (r) => (r.money === null ? 'n/a' : signed(r.money, 1) + '%'), sort: (r) => r.money || 0 },
    { key: 'terms', head: 'Terms', left: true, text: true, cls: 'soft', cell: (r) => r.terms, sort: (r) => r.terms },
    { key: 'net', head: 'Net qty', cell: (r) => signed(r.net, 0), sort: (r) => r.net, tone: (r) => (r.days === 0 ? '' : tone(r.net)) },
    { key: 'unit', head: 'Unit value', cell: (r) => (r.days === 0 ? 'expired' : r.unit === null ? '' : fmt(r.unit)), sort: (r) => r.unit || 0 },
  ];

  const set = (k: keyof Draft, v: string) => { if (draft) setDraft(Object.assign({}, draft, { [k]: v })); };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setMsg('');
    const type = Number(draft.type);
    const strike = Number(draft.strike);
    const symbol = draft.symbol.trim();
    if (!symbol) { setMsg('Give the derivative a symbol.'); return; }
    if (!draft.underlyingId) { setMsg('Choose the underlying.'); return; }
    if (!(strike > 0)) { setMsg('Strike must be a positive number.'); return; }
    if (!draft.expiry) { setMsg('Choose the expiry date.'); return; }
    const keepTime = selected !== null && draft.id === selected.id && day(selected.expirationDate) === draft.expiry;
    const body: OptionBody = {
      id: draft.id, symbol: symbol, name: draft.name.trim() || symbol, strikePrice: strike,
      expirationDate: keepTime ? (selected as OptionEntity).expirationDate : draft.expiry + 'T21:00:00Z',
      optionStyle: type, optionType: type, isCall: draft.side === 'Call', underlyingId: Number(draft.underlyingId),
    };
    if (type === 3) {
      const rebate = Number(draft.rebate);
      if (draft.rebate === '' || !(rebate >= 0)) { setMsg('A digital option needs the amount it pays.'); return; }
      body.rebate = rebate;
    }
    if (type === 4) {
      const barrier = Number(draft.barrier);
      if (!(barrier > 0)) { setMsg('A barrier option needs its barrier level.'); return; }
      body.barrier = barrier;
      body.barrierType = Number(draft.barrierType);
    }
    setBusy(true);
    try {
      if (draft.id) {
        await api.updateOption(body);
        await ctx.reload('options');
      } else {
        const made = await api.createOption(body);
        await ctx.reload('options');
        ctx.setSelOption(made.id);
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const n = (ctx.trades || []).filter((t) => t.instrumentId === selected.id).length;
    const warn = 'Delete ' + selected.symbol + '?' + (n ? ' Its ' + n + (n === 1 ? ' trade goes' : ' trades go') + ' with it.' : '') + ' This cannot be undone.';
    if (!window.confirm(warn)) return;
    setMsg(''); setBusy(true);
    try {
      await api.deleteOption(selected.id);
      ctx.setSelOption(null);
      setDraft(null);
      await Promise.all([ctx.reload('options'), ctx.reload('trades')]);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Price the selected contract on its own, with today's spot, the engine's volatility and the live curve.
  const priceNow = async () => {
    if (!selected) return;
    const s = stats.find((x) => x.id === selected.underlyingId);
    const live = ctx.curves ? liveCurve(ctx.curves) : null;
    const years = (Date.parse(selected.expirationDate) - Date.now()) / (365 * 86400000);
    if (!s || s.vol === null || !live || years <= 0) {
      setMsg('This contract cannot be priced now: it needs a price history, a rate curve and time left to expiry.');
      return;
    }
    setMsg(''); setBusy(true);
    try {
      const r = await api.priceOption({
        stockPrice: s.last, strikePrice: selected.strikePrice, riskFreeRate: nearestRate(live, years) || 0, volatility: s.vol,
        timeToMaturity: years, steps: 64, simulations: 20000, isCall: selected.isCall, antithetic: true, controlVariate: false,
        multithreaded: true, optionType: selected.optionType, useVDCSequence: false, base1: 2, base2: 5,
        rebate: selected.rebate || 0, barrier: selected.barrier || 1, barrierType: selected.barrierType || 1,
      });
      setQuick({ id: selected.id, r: r });
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const type = draft ? Number(draft.type) : 1;
  const lastRun = selected ? bk.byInstrument[selected.id] : undefined;
  const fresh = selected && quick && quick.id === selected.id ? quick.r : null;
  const model = fresh
    ? { unit: fresh.price, delta: fresh.delta, gamma: fresh.gamma, vega: fresh.vega, theta: fresh.theta, rho: fresh.rho }
    : lastRun
      ? { unit: lastRun.unitPrice, delta: lastRun.delta, gamma: lastRun.gamma, vega: lastRun.vega, theta: lastRun.theta, rho: lastRun.rho }
      : null;

  const rail = draft ? (
    <>
      {draft.id ? <p className="mono pos" style={{ fontSize: 12, fontWeight: 500, overflowWrap: 'anywhere' }}>{draft.symbol}</p> : <p className="note">A new contract. Fill it in and save.</p>}
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Symbol" value={draft.symbol} onChange={(v) => set('symbol', v)} placeholder="AAPL-19MAR27-340-C" />
        <Field label="Name" mono={false} value={draft.name} onChange={(v) => set('name', v)} placeholder="AAPL European call 340 Mar 2027" />
        <Select
          label="Underlying"
          value={draft.underlyingId}
          onChange={(v) => set('underlyingId', v)}
          options={stats.map((s) => ({ value: String(s.id), label: s.symbol + '  ' + s.name, group: s.predefined ? 'Predefined' : 'Yours' }))}
        />
        <Select
          label={draft.id ? 'Option type (fixed once created)' : 'Option type'}
          value={draft.type}
          disabled={draft.id !== 0}
          onChange={(v) => set('type', v)}
          options={OPTION_TYPES.slice(1).map((t, i) => ({ value: String(i + 1), label: t }))}
        />
        <Seg label="Call or put" options={['Call', 'Put']} value={draft.side} onChange={(v) => set('side', v)} />
        <div className="two">
          <Field label={type === 6 ? 'Strike (not used)' : 'Strike'} value={draft.strike} onChange={(v) => set('strike', v)} />
          <Field label="Expiry" type="date" value={draft.expiry} onChange={(v) => set('expiry', v)} />
        </div>
        {type === 3 ? <Field label="Pays, if it ends in the money" value={draft.rebate} onChange={(v) => set('rebate', v)} /> : null}
        {type === 4 ? (
          <>
            <Select label="Barrier type" value={draft.barrierType} onChange={(v) => set('barrierType', v)} options={BARRIER_TYPES.slice(1).map((t, i) => ({ value: String(i + 1), label: t }))} />
            <Field label="Barrier level" value={draft.barrier} onChange={(v) => set('barrier', v)} />
          </>
        ) : null}
        <div className="btns">
          <Btn kind="primary" submit disabled={busy}>{busy ? 'Working' : draft.id ? 'Save changes' : 'Create derivative'}</Btn>
          {draft.id ? <Btn kind="danger" onClick={remove} disabled={busy}>Delete</Btn> : null}
        </div>
      </form>
      {msg ? <Notice bad>{msg}</Notice> : null}
      {selected && draft.id ? (
        <>
          <h3>{fresh ? 'Model value, priced just now' : 'Model value, last run'}</h3>
          {model ? (
            <div>
              <Kv k="Per unit" v={fmt(model.unit)} />
              <Kv k="Delta" v={signed(model.delta, 3)} />
              <Kv k="Gamma" v={fmt(model.gamma, 4)} />
              <Kv k="Vega" v={fmt(model.vega, 1)} />
              <Kv k="Theta" v={fmt(model.theta, 1)} />
              <Kv k="Rho" v={fmt(model.rho, 1)} />
              <Kv k="Days left" v={daysLeft(selected.expirationDate)} />
            </div>
          ) : (
            <p className="note">{daysLeft(selected.expirationDate) === 0 ? 'This contract has expired.' : 'No trade on this contract has been valued yet.'}</p>
          )}
          {daysLeft(selected.expirationDate) > 0 ? <Btn onClick={priceNow} disabled={busy}>Price it now</Btn> : null}
        </>
      ) : null}
    </>
  ) : (
    <p className="note">Pick a row to see and edit its ticket, or start a new derivative.</p>
  );

  const count = (t: number) => options.filter((o) => t === 0 || o.optionType === t).length;
  return (
    <Shell ctx={ctx} title="Derivatives" sub="Option contracts you can trade and value" railTitle="Derivative ticket" rail={rail}>
      {ctx.options === null ? <Notice>Loading derivatives.</Notice> : null}
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter by option type">
          {['All'].concat(OPTION_TYPES.slice(1)).map((label, t) => (
            <button key={label} type="button" className={'chip ' + (filter === t ? 'on' : '')} aria-pressed={filter === t} onClick={() => setFilter(t)}>
              {label}<span className="count">{count(t)}</span>
            </button>
          ))}
        </div>
        <Btn kind="primary" onClick={() => { ctx.setSelOption(null); setQuick(null); setMsg(''); setDraft(blank(stats.length ? String(stats[0].id) : '')); }}>New derivative</Btn>
      </div>
      <Panel title="Instruments" right={<span className="hint">Values come from the latest valuation of your trades. Click a column to sort.</span>}>
        <DataGrid
          cols={cols}
          rows={rows}
          id={(r) => r.o.id}
          selected={ctx.selOption}
          onPick={(r) => ctx.setSelOption(r.o.id)}
          dim={(r) => r.days === 0}
          empty="No derivatives of this type yet."
        />
      </Panel>
    </Shell>
  );
}
