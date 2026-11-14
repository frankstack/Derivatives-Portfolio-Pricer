// Charts drawn as plain SVG: a line chart with hover, a sparkline and a diverging bar list.
import { useState } from 'react';
import type { MouseEvent } from 'react';

export const C = {
  teal: '#2DD4AC', orange: '#F2784B', sky: '#7CB7FF', amber: '#F0C36D', grey: '#7E8B99',
  violet: '#B79CFF', pink: '#FF9FCF', lime: '#A6DE8C', rowline: '#26313D',
};
export const OVERLAY_COLORS = [C.sky, C.amber, C.grey, C.violet, C.pink, C.lime];

export function Sparkline(p: { values: number[] }) {
  const v = p.values;
  if (v.length < 2) return null;
  const lo = Math.min.apply(null, v);
  const hi = Math.max.apply(null, v);
  const span = hi - lo || 1;
  const pts = v.map((y, i) => ((i * 100) / (v.length - 1)).toFixed(1) + ',' + (20 - ((y - lo) / span) * 18).toFixed(1)).join(' ');
  return (
    <svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block', width: 84, height: 22 }}>
      <polyline points={pts} fill="none" stroke={v[v.length - 1] >= v[0] ? C.teal : C.orange} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Round tick values that cover [lo, hi].
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let t = start; t < hi + step * 0.999; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

export type Series = { name: string; color: string; values: (number | null)[]; width?: number };
export type XTick = { pos: number; label: string };
export type HLine = { y: number; label: string };
export type Marker = { index: number; y: number; color: string; label: string };

type LineProps = {
  label: string;
  series: Series[];
  height: number;
  xTicks: XTick[];
  yFormat: (v: number) => string;
  yTick?: (v: number) => string;
  tip: (i: number) => string;
  categorical?: boolean;
  area?: boolean;
  tag?: boolean;
  hlines?: HLine[];
  markers?: Marker[];
};

export function LineChart(p: LineProps) {
  const [hover, setHover] = useState<number | null>(null);
  const n = p.series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const all: number[] = [];
  p.series.forEach((s) => s.values.forEach((v) => { if (v !== null && isFinite(v)) all.push(v); }));
  (p.hlines || []).forEach((h) => all.push(h.y));
  if (all.length === 0 || (n < 2 && !p.categorical)) return <div className="empty">Not enough data to draw this chart.</div>;

  let lo = Math.min.apply(null, all);
  let hi = Math.max.apply(null, all);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.06;
  const ticks = niceTicks(lo - pad, hi + pad);
  lo = ticks[0];
  hi = ticks[ticks.length - 1];
  const W = 1000;
  const H = p.height;
  const fx = (i: number) => (p.categorical ? (i + 0.5) / n : n > 1 ? i / (n - 1) : 0.5);
  const fy = (v: number) => (hi - v) / (hi - lo);
  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v === null || !isFinite(v)) return;
      d += (d ? ' L' : 'M') + (fx(i) * W).toFixed(1) + ',' + (fy(v) * H).toFixed(1);
    });
    return d;
  };

  const first = p.series[0];
  let lastIdx = -1;
  let firstIdx = -1;
  first.values.forEach((v, i) => { if (v !== null && isFinite(v)) { if (firstIdx < 0) firstIdx = i; lastIdx = i; } });
  const area = p.area && lastIdx > firstIdx
    ? path(first.values) + ' L' + (fx(lastIdx) * W).toFixed(1) + ',' + H + ' L' + (fx(firstIdx) * W).toFixed(1) + ',' + H + ' Z'
    : '';

  const move = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(p.categorical ? Math.min(n - 1, Math.floor(f * n)) : Math.round(f * (n - 1)));
  };

  // Labels of nearby reference lines alternate above and below so they do not collide.
  const lines = (p.hlines || []).slice().sort((a, b) => b.y - a.y);
  let prevTop = -1;
  let prevAbove = false;
  const lineLabels = lines.map((h) => {
    const top = fy(h.y);
    const above = !(prevTop >= 0 && top - prevTop < 0.08 && prevAbove);
    prevTop = top;
    prevAbove = above;
    return { top: top, above: above, label: h.label };
  });

  return (
    <div className="chart">
      <div className="chart-row">
        <div className="plot" style={{ height: H }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
          <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" role="img" aria-label={p.label}>
            {ticks.slice(1, -1).map((t) => (
              <line key={t} x1="0" x2={W} y1={fy(t) * H} y2={fy(t) * H} stroke={C.rowline} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {area ? <path d={area} fill={first.color} fillOpacity="0.09" /> : null}
            {lines.map((h) => (
              <line key={h.label} x1="0" x2={W} y1={fy(h.y) * H} y2={fy(h.y) * H} stroke={C.amber} strokeWidth="1" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
            ))}
            {p.series.slice().reverse().map((s) => (
              <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {lineLabels.map((h) => (
            <span key={h.label} className="hl-label" style={{ top: h.top * 100 + '%', transform: h.above ? 'translateY(-115%)' : 'translateY(15%)' }}>{h.label}</span>
          ))}
          {(p.markers || []).map((m, i) => (
            <span key={i} className="marker" title={m.label} style={{ left: fx(m.index) * 100 + '%', top: fy(m.y) * 100 + '%', background: m.color }} />
          ))}
          {hover !== null ? (
            <>
              <span className="cursor" style={{ left: fx(hover) * 100 + '%' }} />
              <div className="tip" style={{ left: fx(hover) * 100 + '%', transform: fx(hover) > 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
                <div className="when">{p.tip(hover)}</div>
                {p.series.map((s) => {
                  const v = s.values[hover];
                  if (v === null || v === undefined || !isFinite(v)) return null;
                  return (
                    <div key={s.name} className="val">
                      <span className="dot" style={{ background: s.color }} />
                      {s.name ? s.name + ' ' : ''}{p.yFormat(v)}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
        <div className="yaxis" aria-hidden="true" style={{ height: H }}>
          {ticks.map((t) => <span key={t} style={{ top: fy(t) * 100 + '%' }}>{(p.yTick || p.yFormat)(t)}</span>)}
          {p.tag && lastIdx >= 0 ? (
            <span className="tag" style={{ top: fy(first.values[lastIdx] as number) * 100 + '%' }}>{p.yFormat(first.values[lastIdx] as number)}</span>
          ) : null}
        </div>
      </div>
      <div className="xaxis" aria-hidden="true">
        {p.xTicks.map((t, i) => (
          <span key={i} className={t.pos <= 0 ? 'first' : t.pos >= 1 ? 'last' : ''} style={{ left: t.pos * 100 + '%' }}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}

export function Legend(p: { items: { color: string; label: string; kind?: 'line' | 'dash' | 'round' }[] }) {
  return (
    <div className="legend">
      {p.items.map((it) => (
        <span key={it.label}>
          <i className={it.kind === 'dash' ? 'dash' : it.kind === 'round' ? 'round' : ''} style={it.kind === 'dash' ? undefined : { background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Horizontal bars around a zero line: positive values to the right, negative to the left.
export function BarList(p: { items: { name: string; value: number }[]; format: (v: number) => string }) {
  if (p.items.length === 0) return <div className="empty">Run a valuation to see this.</div>;
  const mx = Math.max(0, Math.max.apply(null, p.items.map((x) => x.value)));
  const mn = Math.min(0, Math.min.apply(null, p.items.map((x) => x.value)));
  const span = mx - mn || 1;
  const zero = (-mn / span) * 100;
  return (
    <div className={p.items.length > 6 ? 'bars two' : 'bars'} style={{ gridTemplateRows: 'repeat(' + Math.ceil(p.items.length / 2) + ', auto)' }}>
      {p.items.map((it) => {
        const w = (Math.abs(it.value) / span) * 100;
        return (
          <div key={it.name} className="bar">
            <span className="name">{it.name}</span>
            <span className="track" aria-hidden="true">
              <span className="fill" style={{ left: (it.value >= 0 ? zero : zero - w) + '%', width: w + '%', background: it.value >= 0 ? C.teal : C.orange }} />
              <span className="zero" style={{ left: zero + '%' }} />
            </span>
            <span className={'amount ' + (it.value > 0 ? 'pos' : it.value < 0 ? 'neg' : 'soft')}>{p.format(it.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
