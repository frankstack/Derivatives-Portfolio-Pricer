// Small building blocks shared by every screen.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const formats: { [digits: number]: Intl.NumberFormat } = {};

export function fmt(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !isFinite(x)) return '';
  if (!formats[digits]) {
    formats[digits] = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  return formats[digits].format(x);
}

export function signed(x: number, digits = 2): string {
  return (x > 0 ? '+' : '') + fmt(x, digits);
}

export function tone(x: number): string {
  return x > 0 ? 'pos' : x < 0 ? 'neg' : 'soft';
}

// Chart height follows the window, so the grid under a chart keeps some room on short screens.
export function useChartHeight(max: number, min: number): number {
  const calc = () => Math.round(Math.min(max, Math.max(min, window.innerHeight * 0.3)));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const on = () => setH(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [max, min]);
  return h;
}

export function Panel(p: { title: ReactNode; right?: ReactNode; fill?: boolean; children: ReactNode }) {
  return (
    <section className={p.fill ? 'panel fill' : 'panel'}>
      <div className="panel-head">
        <h2>{p.title}</h2>
        {p.right}
      </div>
      {p.children}
    </section>
  );
}

export function Kpi(p: { label: string; value: string; sub?: string; cls?: string; subCls?: string }) {
  return (
    <div className="kpi">
      <span className="label">{p.label}</span>
      <span className={'value ' + (p.cls || '')}>{p.value}</span>
      {p.sub ? <span className={'sub ' + (p.subCls || '')}>{p.sub}</span> : null}
    </div>
  );
}

export function Btn(p: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'danger' | 'tall'; disabled?: boolean; submit?: boolean }) {
  return (
    <button type={p.submit ? 'submit' : 'button'} className={'btn ' + (p.kind || '')} onClick={p.onClick} disabled={p.disabled}>
      {p.children}
    </button>
  );
}

// Deleting takes two clicks, both in place: the first one says what will be lost.
export function ConfirmDelete(p: { warn: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <Btn kind="danger" onClick={() => setArmed(true)} disabled={p.disabled}>Delete</Btn>;
  }
  return (
    <div className="confirm" role="group" aria-label="Confirm delete">
      <span>{p.warn}</span>
      <div className="btns">
        <Btn kind="danger" onClick={() => { setArmed(false); p.onConfirm(); }} disabled={p.disabled}>Yes, delete</Btn>
        <Btn onClick={() => setArmed(false)}>Keep</Btn>
      </div>
    </div>
  );
}

export function Seg(p: { label: string; options: string[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="seg" role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button key={o} type="button" className={o === p.value ? 'on' : ''} aria-pressed={o === p.value} disabled={p.disabled} onClick={() => p.onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function Field(p: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; type?: string; disabled?: boolean }) {
  return (
    <label className="field">
      {p.label}
      <input
        type={p.type || 'text'}
        className={p.mono === false ? '' : 'mono'}
        value={p.value}
        placeholder={p.placeholder}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </label>
  );
}

export function Area(p: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="field">
      {p.label}
      <textarea rows={p.rows || 4} value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />
    </label>
  );
}

export type Choice = { value: string; label: string; group?: string };

export function Select(p: { label: string; value: string; onChange: (v: string) => void; options: Choice[]; disabled?: boolean }) {
  const groups: string[] = [];
  p.options.forEach((o) => { if (o.group && groups.indexOf(o.group) < 0) groups.push(o.group); });
  return (
    <label className="field">
      {p.label}
      <select value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)}>
        {groups.length === 0
          ? p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          : groups.map((g) => (
              <optgroup key={g} label={g}>
                {p.options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
      </select>
    </label>
  );
}

export function Check(p: { label: string; checked: boolean; onChange: (v: boolean) => void; swatch?: string }) {
  return (
    <label className={'check ' + (p.checked ? 'on' : '')}>
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      {p.swatch ? <span className="swatch" aria-hidden="true" style={{ background: p.swatch }} /> : null}
      <span className="name">{p.label}</span>
    </label>
  );
}

export function Notice(p: { children: ReactNode; bad?: boolean }) {
  return <div className={'notice ' + (p.bad ? 'bad' : '')} role={p.bad ? 'alert' : undefined}>{p.children}</div>;
}

export function Kv(p: { k: string; v: ReactNode; ruled?: boolean; cls?: string }) {
  return (
    <div className={'kv ' + (p.ruled === false ? '' : 'ruled')}>
      <span>{p.k}</span>
      <span className={p.cls || ''}>{p.v}</span>
    </div>
  );
}

export type Col<T> = {
  key: string;
  head: string;
  left?: boolean;
  text?: boolean;
  cls?: string;
  cell: (r: T) => ReactNode;
  sort?: (r: T) => number | string;
  tone?: (r: T) => string;
};

type GridProps<T> = {
  cols: Col<T>[];
  rows: T[];
  id: (r: T) => string | number;
  selected?: string | number | null;
  onPick?: (r: T) => void;
  dim?: (r: T) => boolean;
  empty?: string;
};

// A dense table. Click a column head to sort by it, click again to reverse.
export function DataGrid<T>(p: GridProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: number } | null>(null);
  let rows = p.rows;
  if (sort) {
    const col = p.cols.find((c) => c.key === sort.key);
    if (col && col.sort) {
      const f = col.sort;
      rows = rows.slice().sort((a, b) => {
        const x = f(a);
        const y = f(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    }
  }
  const flip = (key: string) => setSort(sort && sort.key === key ? (sort.dir === 1 ? { key: key, dir: -1 } : null) : { key: key, dir: 1 });
  const pick = p.onPick;
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            {p.cols.map((c) => {
              const on = sort !== null && sort.key === c.key;
              return (
                <th key={c.key} scope="col" className={(c.left ? 'l ' : '') + (on ? 'sorted' : '')} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {c.sort ? <button type="button" onClick={() => flip(c.key)}>{c.head}{on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button> : c.head}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = p.id(r);
            const cls = (pick ? 'pick ' : '') + (p.selected === key ? 'sel ' : '') + (p.dim && p.dim(r) ? 'dim' : '');
            return (
              <tr
                key={key}
                className={cls}
                tabIndex={pick ? 0 : undefined}
                onClick={pick ? () => pick(r) : undefined}
                onKeyDown={pick ? (e) => { if (e.key === 'Enter') pick(r); } : undefined}
              >
                {p.cols.map((c) => (
                  <td key={c.key} className={(c.left ? 'l ' : '') + (c.text ? 't ' : '') + (c.cls || '') + ' ' + (c.tone ? c.tone(r) : '')}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? <div className="empty">{p.empty || 'Nothing to show yet.'}</div> : null}
    </div>
  );
}
