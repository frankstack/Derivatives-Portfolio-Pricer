// Rates: the curve chart first. The right panel chooses which curves are drawn.
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, curveKind, curvePoints, liveCurve, rateAt, snapshotDay, tenorLabel, parsePoints, shortDate, monthYear } from './api';
import type { RateCurve } from './api';
import { Shell } from './shell';
import type { Ctx } from './shell';
import { Panel, Kpi, Field, Area, Btn, Check, Select, DataGrid, Notice, fmt, signed, tone } from './ui';
import type { Col } from './ui';
import { LineChart, Legend, C, OVERLAY_COLORS } from './charts';
import type { Series } from './charts';

function shortName(c: RateCurve): string {
  const k = curveKind(c);
  if (k === 'live') return 'Live';
  if (k === 'snapshot') return shortDate(snapshotDay(c)) + ' ' + snapshotDay(c).slice(0, 4);
  return c.name.length > 20 ? c.name.slice(0, 20) : c.name;
}

const bp = (a: number, b: number) => Math.round((a - b) * 10000);

export function Rates(p: { ctx: Ctx }) {
  const ctx = p.ctx;
  const curves = ctx.curves || [];
  const [shown, setShown] = useState<number[] | null>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [manage, setManage] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const live = liveCurve(curves);
  // Month-end snapshots, newest first.
  const snaps = useMemo(
    () => curves.filter((c) => curveKind(c) === 'snapshot').sort((a, b) => (snapshotDay(a) < snapshotDay(b) ? 1 : -1)),
    [ctx.curves],
  );
  const scenarios = curves.filter((c) => curveKind(c) === 'scenario');
  const yours = curves.filter((c) => curveKind(c) === 'yours');

  // Until the user chooses, draw the live curve against the latest, a mid-year and the oldest month end.
  let visible: number[] = [];
  if (shown !== null) {
    visible = shown.filter((id) => curves.some((c) => c.id === id));
  } else {
    const picks = [live, snaps[0], snaps[4], snaps[snaps.length - 1]];
    picks.forEach((c) => { if (c && visible.indexOf(c.id) < 0) visible.push(c.id); });
    if (visible.length === 0 && curves.length > 0) visible.push(curves[0].id);
  }
  const toggle = (id: number, on: boolean) => setShown(on ? visible.concat([id]) : visible.filter((x) => x !== id));
  const drawn = visible.map((id) => curves.find((c) => c.id === id) as RateCurve).filter((c) => !!c);
  drawn.sort((a, b) => (live && a.id === live.id ? -1 : live && b.id === live.id ? 1 : 0));
  const others = drawn.filter((c) => !live || c.id !== live.id);
  const colorOf = (c: RateCurve) => (live && c.id === live.id ? C.teal : OVERLAY_COLORS[Math.max(0, others.indexOf(c)) % OVERLAY_COLORS.length]);

  const tenors = useMemo(() => {
    const seen: { [k: string]: number } = {};
    drawn.forEach((c) => curvePoints(c).forEach((pt) => { seen[pt.tenor.toFixed(4)] = pt.tenor; }));
    return Object.keys(seen).map((k) => seen[k]).sort((a, b) => a - b);
  }, [ctx.curves, visible.join(',')]);

  const series: Series[] = drawn.map((c) => ({
    name: shortName(c),
    color: colorOf(c),
    width: live && c.id === live.id ? 2.5 : 1.5,
    values: tenors.map((t) => { const r = rateAt(c, t); return r === null ? null : r * 100; }),
  }));

  // Key tenors at each month end, oldest first, ending with the live curve.
  const timeline = snaps.slice().reverse().concat(live ? [live] : []);
  const keyTenors = [10, 30, 2, 0.25].filter((t) => live !== null && rateAt(live, t) !== null);
  const keyColors = [C.teal, C.sky, C.amber, C.grey];
  const history: Series[] = keyTenors.map((t, i) => ({
    name: tenorLabel(t), color: keyColors[i], width: i === 0 ? 2.5 : 1.5,
    values: timeline.map((c) => { const r = rateAt(c, t); return r === null ? null : r * 100; }),
  }));
  const step = Math.max(1, Math.round(timeline.length / 4));
  const historyTicks = timeline
    .map((c, i) => ({ i: i, label: live && c.id === live.id ? 'Live' : shortDate(snapshotDay(c)) }))
    .filter((x) => x.i === timeline.length - 1 || (x.i % step === 0 && x.i < timeline.length - 1 - step / 2))
    .map((x) => ({ pos: timeline.length > 1 ? x.i / (timeline.length - 1) : 0.5, label: x.label }));

  const ref = snaps[0];
  const ten = live ? rateAt(live, 10) : null;
  const two = live ? rateAt(live, 2) : null;
  const first = live ? curvePoints(live)[0] : null;
  const since = ref ? ' since ' + shortDate(snapshotDay(ref)) : '';
  const delta = (t: number): number | null => {
    if (!live || !ref) return null;
    const a = rateAt(live, t);
    const b = rateAt(ref, t);
    return a === null || b === null ? null : bp(a, b);
  };
  const dTen = delta(10);
  const dTwo = delta(2);
  const dFirst = first ? delta(first.tenor) : null;
  const refSpread = ref && rateAt(ref, 10) !== null && rateAt(ref, 2) !== null ? bp(rateAt(ref, 10) as number, rateAt(ref, 2) as number) : null;

  type Row = { tenor: number };
  const base = others[0];
  const cols: Col<Row>[] = [{ key: 'tenor', head: 'Tenor', left: true, cls: 'soft', cell: (r) => tenorLabel(r.tenor), sort: (r) => r.tenor }];
  drawn.slice(0, 5).forEach((c) => {
    cols.push({
      key: 'c' + c.id, head: shortName(c), cls: live && c.id === live.id ? '' : 'soft',
      cell: (r) => { const v = rateAt(c, r.tenor); return v === null ? '' : fmt(v * 100, 2); },
      sort: (r) => rateAt(c, r.tenor) || 0,
    });
  });
  if (live && base && visible.indexOf(live.id) >= 0) {
    const diff = (r: Row) => { const a = rateAt(live, r.tenor); const b = rateAt(base, r.tenor); return a === null || b === null ? null : bp(a, b); };
    cols.splice(2, 0, {
      key: 'chg', head: 'Change, bp', cell: (r) => { const d = diff(r); return d === null ? '' : signed(d, 0); },
      sort: (r) => diff(r) || 0, tone: (r) => tone(diff(r) || 0),
    });
  }

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    const n = name.trim();
    if (!n) { setMsg('Give the curve a name.'); return; }
    if (curves.some((c) => c.name.toLowerCase() === n.toLowerCase())) { setMsg('A curve called ' + n + ' already exists.'); return; }
    setBusy(true);
    try {
      const made = await api.createCurve(n, parsePoints(text));
      await ctx.reload('curves');
      setShown(visible.concat([made.id]));
      setName(''); setText('');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const manageable = scenarios.concat(yours);
  const target = manageable.find((c) => String(c.id) === manage) || null;
  const rename = async () => {
    if (!target || !newName.trim()) { setMsg('Pick a curve and type its new name.'); return; }
    setMsg(''); setBusy(true);
    try {
      await api.renameCurve(target.id, newName.trim());
      await ctx.reload('curves');
      setNewName('');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!target) { setMsg('Pick the curve to delete.'); return; }
    if (!window.confirm('Delete the curve ' + target.name + '? This cannot be undone.')) return;
    setMsg(''); setBusy(true);
    try {
      await api.deleteCurve(target.id);
      setManage('');
      await ctx.reload('curves');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tick = (c: RateCurve, label: string) => (
    <Check key={c.id} label={label} checked={visible.indexOf(c.id) >= 0} onChange={(on) => toggle(c.id, on)} swatch={visible.indexOf(c.id) >= 0 ? colorOf(c) : undefined} />
  );
  const rail = (
    <>
      <h3>Live</h3>
      <div>{live ? tick(live, live.name) : <p className="note">No live curve found.</p>}</div>
      <h3>Month-end snapshots</h3>
      <div>{snaps.length ? snaps.map((c) => tick(c, snapshotDay(c))) : <p className="note">None yet.</p>}</div>
      <h3>Scenarios</h3>
      <div>{scenarios.length ? scenarios.map((c) => tick(c, c.name.replace(/^Scenario\s*/i, ''))) : <p className="note">None yet.</p>}</div>
      <h3>Yours</h3>
      <div>{yours.length ? yours.map((c) => tick(c, c.name)) : <p className="note">None yet.</p>}</div>
      <h3>New curve</h3>
      <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Name" mono={false} value={name} onChange={setName} placeholder="My curve" />
        <Area label="Points: tenor in years, rate" value={text} onChange={setText} placeholder={'0.25, 4.32\n1, 4.65\n10, 5.10'} />
        <Btn kind="primary" submit disabled={busy}>{busy ? 'Saving' : 'Save curve'}</Btn>
      </form>
      {manageable.length ? (
        <>
          <h3>Rename or delete</h3>
          <Select label="Curve" value={manage} onChange={setManage} options={[{ value: '', label: 'Choose a curve' }].concat(manageable.map((c) => ({ value: String(c.id), label: c.name })))} />
          <Field label="New name" mono={false} value={newName} onChange={setNewName} />
          <div className="btns">
            <Btn onClick={rename} disabled={busy}>Rename</Btn>
            <Btn kind="danger" onClick={remove} disabled={busy}>Delete</Btn>
          </div>
        </>
      ) : null}
      {msg ? <Notice bad>{msg}</Notice> : null}
      <p className="note">Rates above 1 are read as percent, so 4.32 means 4.32%. The live curve and the month-end snapshots are read-only.</p>
    </>
  );

  return (
    <Shell ctx={ctx} title="Rates" sub="Curves used to discount each trade, by nearest tenor" railTitle="Curves on the chart" rail={rail}>
      {ctx.curves === null ? <Notice>Loading rate curves.</Notice> : null}
      {live && ten !== null ? (
        <div className="kpis">
          <Kpi label="10-year" value={fmt(ten * 100) + '%'} sub={dTen === null ? live.name : signed(dTen, 0) + ' bp' + since} subCls={dTen === null ? '' : tone(dTen)} />
          {two !== null ? <Kpi label="2-year" value={fmt(two * 100) + '%'} sub={dTwo === null ? '' : signed(dTwo, 0) + ' bp' + since} subCls={dTwo === null ? '' : tone(dTwo)} /> : null}
          {two !== null ? <Kpi label="10-year minus 2-year" value={bp(ten, two) + ' bp'} sub={refSpread === null || !ref ? '' : refSpread + ' bp on ' + shortDate(snapshotDay(ref))} /> : null}
          {first ? <Kpi label={first.tenor < 0.02 ? 'Overnight (SOFR)' : tenorLabel(first.tenor)} value={fmt(first.rate * 100) + '%'} sub={dFirst === null ? '' : signed(dFirst, 0) + ' bp' + since} subCls={dFirst === null ? '' : tone(dFirst)} /> : null}
        </div>
      ) : null}
      <Panel title="Yield curve" right={<span className="hint">US Treasury par yields and SOFR, from FRED. Tick curves on the right to compare.</span>}>
        {series.length ? (
          <>
            <LineChart
              label={'Yield curves by tenor for ' + drawn.map((c) => c.name).join(', ')}
              series={series}
              height={300}
              categorical
              xTicks={tenors.map((t, i) => ({ pos: (i + 0.5) / tenors.length, label: tenorLabel(t) }))}
              yFormat={(v) => fmt(v, 2) + '%'}
              yTick={(v) => fmt(v, 1) + '%'}
              tip={(i) => tenorLabel(tenors[i])}
            />
            <Legend items={drawn.map((c) => ({ color: colorOf(c), label: curveKind(c) === 'live' ? 'Live' : curveKind(c) === 'snapshot' ? snapshotDay(c) : c.name }))} />
          </>
        ) : (
          <div className="empty">Tick a curve on the right to draw it.</div>
        )}
      </Panel>
      <div className="row">
        {timeline.length >= 2 && history.length ? (
          <Panel title="Key tenors, month by month">
            <LineChart
              label="Key tenor yields at each month end, ending with the live curve"
              series={history}
              height={220}
              xTicks={historyTicks}
              yFormat={(v) => fmt(v, 2) + '%'}
              yTick={(v) => fmt(v, 1) + '%'}
              tip={(i) => (live && timeline[i].id === live.id ? 'Live curve' : snapshotDay(timeline[i]))}
            />
            <Legend items={history.map((s) => ({ color: s.color, label: s.name }))} />
          </Panel>
        ) : null}
        <Panel title="Points, in percent">
          <DataGrid cols={cols} rows={tenors.map((t) => ({ tenor: t }))} id={(r) => r.tenor} empty="No curve selected." />
        </Panel>
      </div>
    </Shell>
  );
}
