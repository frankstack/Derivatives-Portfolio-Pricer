// Application state: what is loaded, what is selected, and the latest valuation run.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, computeStats, liveCurve } from './api';
import type { Underlying, OptionEntity, Trade, RateCurve, ValuationResult, ValuationRequest, UStats } from './api';
import { LeftRail, SECTIONS } from './shell';
import type { Ctx, ValSettings, Reloadable } from './shell';
import { Underlyings } from './Underlyings';
import { Derivatives } from './Derivatives';
import { Trades } from './Trades';
import { Rates } from './Rates';
import { Valuation } from './Valuation';
import { Overview } from './Overview';
import { DppAi } from './DppAi';
import { useAi } from './AiChat';
import type { ToolCtx } from './ai';

const DEFAULTS: ValSettings = {
  curveId: 0, asOf: '', paths: 5000, steps: 64, antithetic: true, controlVariate: false, vdc: false, base1: 2, base2: 5, multithreaded: true,
};

function readSection(): string {
  const key = window.location.hash.replace(/^#\/?/, '');
  return key === 'ai' || SECTIONS.some((s) => s.key === key) ? key : 'underlyings';
}

export default function App() {
  const [section, setSection] = useState(readSection());
  const [underlyings, setUnderlyings] = useState<Underlying[] | null>(null);
  const [options, setOptions] = useState<OptionEntity[] | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [curves, setCurves] = useState<RateCurve[] | null>(null);
  const [error, setError] = useState('');
  const [selUnderlying, setSelUnderlying] = useState<number | null>(null);
  const [selOption, setSelOption] = useState<number | null>(null);
  const [valSettings, setValSettings] = useState<ValSettings>(DEFAULTS);
  const [valuation, setValuation] = useState<ValuationResult | null>(null);
  const [valBusy, setValBusy] = useState(false);
  const [valError, setValError] = useState('');
  const [valMs, setValMs] = useState(0);

  useEffect(() => {
    const onHash = () => setSection(readSection());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((key: string) => {
    window.location.hash = '#/' + key;
  }, []);

  const reload = useCallback(async (...what: Reloadable[]) => {
    try {
      const has = (k: Reloadable) => what.indexOf(k) >= 0;
      const [u, o, t, c] = await Promise.all([
        has('underlyings') ? api.underlyings() : null,
        has('options') ? api.options() : null,
        has('trades') ? api.trades() : null,
        has('curves') ? api.curves() : null,
      ]);
      // Everything that was asked for lands in one render, so the book is never half updated.
      if (u) setUnderlyings(u);
      if (o) setOptions(o.sort((a, b) => a.id - b.id));
      if (t) setTrades(t.sort((a, b) => a.id - b.id));
      if (c) setCurves(c.sort((a, b) => a.id - b.id));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload('options');
    reload('trades');
    reload('curves');
    reload('underlyings');
  }, [reload]);

  const stats = useMemo(() => {
    const out: UStats[] = [];
    (underlyings || []).forEach((u) => {
      const s = computeStats(u);
      if (s) out.push(s);
    });
    return out;
  }, [underlyings]);

  // Only the latest run may write its result: an older, slower answer must not replace a newer one.
  const runSeq = useRef(0);
  const runValuation = useCallback(
    async (ids?: number[], s?: ValSettings) => {
      const st = s || valSettings;
      const tradeIds = ids || (trades || []).map((t) => t.id);
      if (tradeIds.length === 0 || !curves || curves.length === 0) return;
      const live = liveCurve(curves);
      const curveId = st.curveId && curves.some((c) => c.id === st.curveId) ? st.curveId : (live || curves[0]).id;
      const req: ValuationRequest = {
        tradeIds: tradeIds, steps: st.steps, simulations: st.paths, antithetic: st.antithetic, controlVariate: st.controlVariate,
        multithreaded: st.multithreaded, useVDCSequence: st.vdc, base1: st.base1, base2: st.base2, rateCurveId: curveId,
      };
      if (st.asOf) req.valuationDate = st.asOf + 'T23:00:00Z';
      runSeq.current += 1;
      const seq = runSeq.current;
      setValBusy(true);
      setValError('');
      const t0 = Date.now();
      try {
        const res = await api.valuate(req);
        if (seq === runSeq.current) {
          setValuation(res);
          setValMs(Date.now() - t0);
        }
      } catch (e) {
        if (seq === runSeq.current) setValError((e as Error).message);
      } finally {
        if (seq === runSeq.current) setValBusy(false);
      }
    },
    [trades, curves, valSettings],
  );

  // Revalue the whole book as of now whenever trades, instruments or curves change,
  // so the blotter and the instrument grid always show current values.
  const runRef = useRef(runValuation);
  runRef.current = runValuation;
  const settingsRef = useRef(valSettings);
  settingsRef.current = valSettings;
  const autoKey =
    trades && curves && options
      ? JSON.stringify([
          trades.map((t) => [t.id, t.instrumentId, t.quantity, t.price, t.tradeDate]),
          options.map((o) => [o.id, o.strikePrice, o.expirationDate, o.isCall, o.barrier, o.barrierType, o.rebate]),
          curves.length,
        ])
      : '';
  const lastAuto = useRef('');
  useEffect(() => {
    if (!autoKey || autoKey === lastAuto.current) return;
    lastAuto.current = autoKey;
    runRef.current(undefined, Object.assign({}, settingsRef.current, { asOf: '' }));
  }, [autoKey]);

  // DPP AI works on whatever the screens hold right now: its tools read this on every call.
  const tools: ToolCtx = {
    underlyings: underlyings, stats: stats, options: options, trades: trades, curves: curves, valuation: valuation, reload: reload, go: go,
    setSelUnderlying: setSelUnderlying, setSelOption: setSelOption, section: section, selUnderlying: selUnderlying, selOption: selOption,
  };
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const ai = useAi(toolsRef);
  const closePanel = ai.setPanel;
  useEffect(() => {
    if (section === 'ai') closePanel(false);
  }, [section, closePanel]);

  const ctx: Ctx = {
    underlyings: underlyings, stats: stats, options: options, trades: trades, curves: curves, error: error, reload: reload,
    valuation: valuation, valBusy: valBusy, valError: valError, valMs: valMs, valSettings: valSettings, setValSettings: setValSettings,
    runValuation: runValuation, section: section, go: go, selUnderlying: selUnderlying, setSelUnderlying: setSelUnderlying,
    selOption: selOption, setSelOption: setSelOption, ai: ai,
  };

  return (
    <div className="app">
      <LeftRail ctx={ctx} />
      {section === 'underlyings' ? <Underlyings ctx={ctx} /> : null}
      {section === 'derivatives' ? <Derivatives ctx={ctx} /> : null}
      {section === 'trades' ? <Trades ctx={ctx} /> : null}
      {section === 'rates' ? <Rates ctx={ctx} /> : null}
      {section === 'valuation' ? <Valuation ctx={ctx} /> : null}
      {section === 'overview' ? <Overview ctx={ctx} /> : null}
      {section === 'ai' ? <DppAi ctx={ctx} /> : null}
    </div>
  );
}
