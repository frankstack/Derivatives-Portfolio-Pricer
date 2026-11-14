// Trades: the blotter, with every position aged to today. The right panel is the trade ticket.
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, day, daysLeft, today, liveCurve, nearestRate } from './api';
import type { OptionEntity, TradeBody } from './api';
import { Shell, book, underlyingOf } from './shell';
import type { Ctx } from './shell';
import { Panel, Kpi, Seg, Field, Select, Btn, ConfirmDelete, DataGrid, Notice, Kv, fmt, signed, tone } from './ui';
import type { Col } from './ui';

type Row = {
  key: string; id: number; instrumentId: number; date: string; symbol: string; under: string; net: number; price: number;
  premium: number; unit: number | null; value: number | null; pl: number | null; days: number | null; open: boolean; count: number;
};
type Form = { id: number; instrumentId: string; side: string; qty: string; date: string; price: string };

const cents = (x: number) => Math.round(x * 100) / 100;

export function Trades(p: { ctx: Ctx }) {
  const ctx = p.ctx;
  const trades = ctx.trades || [];
  const options = ctx.options || [];
  const stats = ctx.stats;
  const [mode, setMode] = useState('By trade');
  const [form, setForm] = useState<Form>({ id: 0, instrumentId: '', side: 'Buy', qty: '', date: today(), price: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const bk = useMemo(() => book(ctx), [ctx.trades, ctx.valuation]);

  const optById: { [id: number]: OptionEntity } = {};
  options.forEach((o) => { optById[o.id] = o; });

  const tradeRows: Row[] = trades.map((t) => {
    const v = bk.byTrade[t.id];
    const o = optById[t.instrumentId];
    const days = o ? daysLeft(o.expirationDate) : null;
    const expired = days === 0;
    const valued = !!v && v.status === 'valued';
    const premium = t.quantity * t.price;
    const u = underlyingOf(ctx, t.instrumentId);
    return {
      key: 't' + t.id, id: t.id, instrumentId: t.instrumentId, date: day(t.tradeDate),
      symbol: t.instrument ? t.instrument.symbol : String(t.instrumentId), under: u ? u.symbol : '', net: t.quantity, price: t.price,
      premium: premium, unit: valued ? v.unitPrice : null, value: valued ? v.price : expired ? 0 : null,
      pl: valued ? v.price - premium : null, days: days, open: !expired, count: 1,
    };
  });

  // Roll trades up by instrument or by underlying. Expired trades stay out of the roll-ups.
  const roll = (keyOf: (r: Row) => string, label: (r: Row) => string): Row[] => {
    const map: { [k: string]: Row } = {};
    const order: string[] = [];
    tradeRows.filter((r) => r.open).forEach((r) => {
      const k = keyOf(r);
      if (!map[k]) {
        map[k] = Object.assign({}, r, { key: k, symbol: label(r), net: 0, premium: 0, value: 0, pl: 0, count: 0 });
        order.push(k);
      }
      const g = map[k];
      g.net += r.net;
      g.premium += r.premium;
      g.count += 1;
      g.value = g.value === null || r.value === null ? null : g.value + r.value;
      g.pl = g.pl === null || r.pl === null ? null : g.pl + r.pl;
    });
    return order.map((k) => map[k]).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
  };
  const rows = mode === 'By trade' ? tradeRows : mode === 'By instrument' ? roll((r) => 'i' + r.instrumentId, (r) => r.symbol) : roll((r) => 'u' + r.under, (r) => r.under || 'Unknown');

  const money = (x: number | null) => (x === null ? '' : fmt(x));
  const plCol: Col<Row> = { key: 'pl', head: 'P&L', cell: (r) => (r.pl === null ? (r.open ? '' : 'n/a') : signed(r.pl)), sort: (r) => r.pl || 0, tone: (r) => (r.pl === null ? '' : tone(cents(r.pl))) };
  const premCol: Col<Row> = { key: 'prem', head: 'Premium', cls: 'soft', cell: (r) => fmt(r.premium), sort: (r) => r.premium };
  const valueCol: Col<Row> = { key: 'value', head: 'Market value', cell: (r) => money(r.value), sort: (r) => r.value || 0 };
  const unitCol: Col<Row> = { key: 'unit', head: 'Unit value', cell: (r) => (r.open ? money(r.unit) : 'expired'), sort: (r) => r.unit || 0 };
  const daysCol: Col<Row> = { key: 'days', head: 'Days', cls: 'soft', cell: (r) => (r.days === null ? '' : r.days), sort: (r) => (r.days === null ? 99999 : r.days) };
  const countCol: Col<Row> = { key: 'count', head: 'Trades', cls: 'soft', cell: (r) => r.count, sort: (r) => r.count };
  const netCol: Col<Row> = { key: 'net', head: 'Net qty', cell: (r) => signed(r.net, 0), sort: (r) => r.net, tone: (r) => tone(r.net) };
  let cols: Col<Row>[];
  if (mode === 'By trade') {
    cols = [
      { key: 'id', head: 'ID', cls: 'muted', cell: (r) => r.id, sort: (r) => r.id },
      { key: 'date', head: 'Trade date', cls: 'soft', cell: (r) => r.date, sort: (r) => r.date },
      { key: 'sym', head: 'Instrument', left: true, cls: 'sym', cell: (r) => r.symbol, sort: (r) => r.symbol },
      { key: 'side', head: 'Side', left: true, text: true, cell: (r) => <b>{r.net >= 0 ? 'Buy' : 'Sell'}</b>, sort: (r) => (r.net >= 0 ? 0 : 1), tone: (r) => (r.open ? (r.net >= 0 ? 'pos' : 'neg') : '') },
      { key: 'qty', head: 'Qty', cell: (r) => fmt(Math.abs(r.net), 0), sort: (r) => Math.abs(r.net) },
      { key: 'price', head: 'Price', cell: (r) => fmt(r.price), sort: (r) => r.price },
      premCol, unitCol, valueCol, plCol, daysCol,
    ];
  } else if (mode === 'By instrument') {
    cols = [{ key: 'sym', head: 'Instrument', left: true, cls: 'sym', cell: (r) => r.symbol, sort: (r) => r.symbol }, countCol, netCol, premCol, unitCol, valueCol, plCol, daysCol];
  } else {
    cols = [{ key: 'sym', head: 'Underlying', left: true, cls: 'sym', cell: (r) => r.symbol, sort: (r) => r.symbol }, countCol, premCol, valueCol, plCol];
  }

  const open = tradeRows.filter((r) => r.open);
  const priced = open.filter((r) => r.pl !== null);
  const premium = open.reduce((a, r) => a + r.premium, 0);
  const value = priced.reduce((a, r) => a + (r.value || 0), 0);
  const pl = priced.reduce((a, r) => a + (r.pl || 0), 0);
  const waiting = ctx.valBusy || (open.length > 0 && priced.length === 0 && !ctx.valError);

  const editing = form.id !== 0;
  const set = (k: keyof Form, v: string) => setForm(Object.assign({}, form, { [k]: v }));
  const instrumentId = Number(form.instrumentId) || 0;
  const pickedOption = optById[instrumentId];
  const pickedUnder = stats.find((s) => s.id === instrumentId);
  const qty = Number(form.qty);
  const price = Number(form.price);
  const signedQty = form.side === 'Buy' ? qty : -qty;
  const before = (bk.net[instrumentId] || 0) - (editing ? (trades.find((t) => t.id === form.id) || { quantity: 0 }).quantity : 0);

  const modelPrice = async () => {
    setMsg('');
    if (pickedUnder) { set('price', String(cents(pickedUnder.last))); return; }
    if (!pickedOption) { setMsg('Choose an instrument first.'); return; }
    const v = bk.byInstrument[pickedOption.id];
    if (v) { set('price', String(cents(v.unitPrice))); return; }
    const s = stats.find((x) => x.id === pickedOption.underlyingId);
    const live = ctx.curves ? liveCurve(ctx.curves) : null;
    const years = (Date.parse(pickedOption.expirationDate) - Date.now()) / (365 * 86400000);
    if (!s || s.vol === null || !live || years <= 0) { setMsg('This contract cannot be priced now.'); return; }
    setBusy(true);
    try {
      const r = await api.priceOption({
        stockPrice: s.last, strikePrice: pickedOption.strikePrice, riskFreeRate: nearestRate(live, years) || 0, volatility: s.vol,
        timeToMaturity: years, steps: 64, simulations: 20000, isCall: pickedOption.isCall, antithetic: true, controlVariate: false,
        multithreaded: true, optionType: pickedOption.optionType, useVDCSequence: false, base1: 2, base2: 5,
        rebate: pickedOption.rebate || 0, barrier: pickedOption.barrier || 1, barrierType: pickedOption.barrierType || 1,
      });
      set('price', String(cents(r.price)));
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setForm({ id: 0, instrumentId: form.instrumentId, side: 'Buy', qty: '', date: today(), price: '' });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (!instrumentId) { setMsg('Choose the instrument you traded.'); return; }
    if (!(qty > 0) || Math.round(qty) !== qty) { setMsg('Quantity must be a whole number above zero. Use Sell for a short trade.'); return; }
    if (!form.date) { setMsg('Choose the trade date.'); return; }
    if (!(price >= 0) || form.price === '') { setMsg('Enter the price paid or received per unit.'); return; }
    const body: TradeBody = { instrumentId: instrumentId, quantity: signedQty, tradeDate: form.date + 'T23:00:00Z', price: price };
    setBusy(true);
    try {
      if (editing) {
        body.id = form.id;
        await api.updateTrade(body);
      } else {
        await api.createTrade(body);
      }
      await ctx.reload('trades');
      reset();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setMsg(''); setBusy(true);
    try {
      await api.deleteTrade(form.id);
      await ctx.reload('trades');
      reset();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choices = [{ value: '', label: 'Choose an instrument', group: 'Pick one' }]
    .concat(options.slice().sort((a, b) => (a.symbol < b.symbol ? -1 : 1)).map((o) => ({ value: String(o.id), label: o.symbol, group: 'Derivatives' })))
    .concat(stats.map((s) => ({ value: String(s.id), label: s.symbol + '  ' + s.name, group: 'Underlyings' })));
  const about = pickedOption
    ? pickedOption.optionTypeName + (pickedOption.isCall ? ' call' : ' put') + ' on ' + (pickedOption.underlying ? pickedOption.underlying.symbol : 'its underlying') + ', ' + (daysLeft(pickedOption.expirationDate) === 0 ? 'expired' : daysLeft(pickedOption.expirationDate) + ' days left') + '.'
    : pickedUnder ? 'A position in the underlying itself, valued at its last close.' : '';

  const rail = (
    <>
      {editing ? <p className="mono pos" style={{ fontSize: 12, fontWeight: 500 }}>{'Editing trade ' + form.id}</p> : null}
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Select label="Instrument" value={form.instrumentId} onChange={(v) => set('instrumentId', v)} options={choices} />
        {about ? <p className="note">{about}</p> : null}
        <Seg label="Side" options={['Buy', 'Sell']} value={form.side} onChange={(v) => set('side', v)} />
        <Field label="Quantity" value={form.qty} onChange={(v) => set('qty', v)} />
        <Field label="Trade date" type="date" value={form.date} onChange={(v) => set('date', v)} />
        <Field label="Price per unit" value={form.price} onChange={(v) => set('price', v)} />
        <Btn onClick={modelPrice} disabled={busy}>Use the model price</Btn>
        <div>
          <Kv k="Premium" v={qty > 0 && form.price !== '' && price >= 0 ? fmt(qty * price) : ''} />
          <Kv k="Position after" v={instrumentId && qty > 0 ? signed(before + signedQty, 0) : ''} />
        </div>
        <div className="btns">
          <Btn kind="primary" submit disabled={busy}>{busy ? 'Working' : editing ? 'Save changes' : 'Add trade'}</Btn>
          {editing ? <Btn kind="tall" onClick={reset} disabled={busy}>Cancel</Btn> : null}
          {editing ? <ConfirmDelete key={form.id} warn={'Delete trade ' + form.id + '? This cannot be undone.'} onConfirm={remove} disabled={busy} /> : null}
        </div>
      </form>
      {msg ? <Notice bad>{msg}</Notice> : null}
      <p className="note">Quantity is always positive. Side decides whether the trade is long or short. Click a row in the blotter to edit that trade.</p>
    </>
  );

  return (
    <Shell ctx={ctx} title="Trades" sub="Every position, aged to today" railTitle={editing ? 'Edit trade' : 'New trade'} rail={rail}>
      {ctx.trades === null ? <Notice>Loading trades.</Notice> : null}
      {ctx.valError ? <Notice bad>{'The book could not be valued: ' + ctx.valError}</Notice> : null}
      <div className="kpis">
        <Kpi label="Open trades" value={String(open.length)} sub={tradeRows.length - open.length + ' expired'} />
        <Kpi label="Net premium paid" value={fmt(premium)} sub="Buys minus sells" />
        <Kpi label="Market value" value={waiting ? 'valuing' : fmt(value)} sub={ctx.valuation ? 'As of ' + ctx.valuation.valuationDate.slice(0, 16).replace('T', ' ') + ' UTC' : ''} />
        <Kpi label="Unrealized P&L" value={waiting ? 'valuing' : signed(pl)} sub={waiting || !premium ? '' : signed((pl / Math.abs(premium)) * 100, 1) + '% of premium'} cls={waiting ? '' : tone(cents(pl))} subCls={waiting ? '' : tone(cents(pl))} />
      </div>
      <Panel fill title="Blotter" right={<div style={{ flex: '0 1 330px' }}><Seg label="Group trades" options={['By trade', 'By instrument', 'By underlying']} value={mode} onChange={setMode} /></div>}>
        <DataGrid
          cols={cols}
          rows={rows}
          id={(r) => r.key}
          selected={editing ? 't' + form.id : null}
          onPick={mode === 'By trade' ? (r) => { setMsg(''); setForm({ id: r.id, instrumentId: String(r.instrumentId), side: r.net >= 0 ? 'Buy' : 'Sell', qty: String(Math.abs(r.net)), date: r.date, price: String(r.price) }); } : undefined}
          dim={(r) => !r.open}
          empty="No trades yet. Add the first one with the ticket on the right."
        />
        <div className="totals">
          <span>Open trades <b>{open.length}</b></span>
          <span>Premium <b>{fmt(premium)}</b></span>
          <span>Market value <b>{waiting ? 'valuing' : fmt(value)}</b></span>
          <span>P&L <b className={waiting ? '' : tone(cents(pl))}>{waiting ? 'valuing' : signed(pl)}</b></span>
        </div>
      </Panel>
    </Shell>
  );
}
