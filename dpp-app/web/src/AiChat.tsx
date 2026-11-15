// The assistant in the interface: the conversation, the dock in the right rail and the
// panel that slides over it. The conversation itself lives in App, so it carries
// across screens.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MutableRefObject, ReactNode } from 'react';
import { aiChat, aiStatus, aiUnlock, AiError, AI_NAME, AI_TITLE, applyPlan, contextFor, isWriteTool, planWrite, runRead, stepLabel } from './ai';
import type { AiStatus, Block, Json, ToolCtx, WireMessage } from './ai';
import { ownerAuth } from './api';
import { Btn } from './ui';

export type Step = {
  id: string; label: string; state: 'running' | 'ask' | 'done' | 'failed' | 'declined'; summary: string;
  plan: { title: string; lines: string[]; danger: boolean } | null;
};
export type Entry =
  | { kind: 'user'; key: number; text: string }
  | { kind: 'assistant'; key: number; text: string; steps: Step[]; streaming: boolean }
  | { kind: 'note'; key: number; text: string; bad: boolean };

export type Ai = {
  status: AiStatus | null;
  statusLoaded: boolean;
  entries: Entry[];
  busy: boolean;
  unlockedUntil: number; // 0 while changes are locked
  panel: boolean;
  setPanel: (open: boolean) => void;
  send: (text: string) => void;
  ask: (text: string) => void; // from the dock: opens the panel and sends
  stop: () => void;
  reset: () => void;
  decide: (stepId: string, yes: boolean) => void;
  unlock: (passcode: string) => Promise<string>; // '' when it worked, otherwise why not
  lock: () => void;
};

const MAX_ROUNDS = 8; // model calls one question may take
const OWNER_KEY = 'dpp-ai-owner';
type Owner = { token: string; until: number };
const LOCKED: Owner = { token: '', until: 0 };

function readOwner(): Owner {
  try {
    const j = JSON.parse(window.sessionStorage.getItem(OWNER_KEY) || 'null');
    if (j && typeof j.token === 'string' && Number(j.until) > Date.now()) return { token: j.token, until: Number(j.until) };
  } catch (e) {
    // no storage here: the unlock simply lasts until the page is closed
  }
  return LOCKED;
}

function writeOwner(o: Owner) {
  try {
    if (o.token) window.sessionStorage.setItem(OWNER_KEY, JSON.stringify(o));
    else window.sessionStorage.removeItem(OWNER_KEY);
  } catch (e) {
    // see readOwner
  }
}

// Lets React finish drawing reloaded data before the next tool reads it.
const settle = () => new Promise((resolve) => window.setTimeout(resolve, 80));

export function useAi(ctxRef: MutableRefObject<ToolCtx>): Ai {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState<Owner>(readOwner);
  const [panel, setPanel] = useState(false);
  const wire = useRef<WireMessage[]>([]);
  const seq = useRef(0);
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const waiting = useRef<{ [id: string]: (yes: boolean) => void }>({});
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  const refreshStatus = useCallback(() => {
    aiStatus().then((s) => { setStatus(s); setStatusLoaded(true); });
  }, []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const lock = useCallback(() => { setOwner(LOCKED); ownerRef.current = LOCKED; writeOwner(LOCKED); }, []);
  // The screens' own tickets send the same token (api.ts) and lock again when the server refuses it.
  ownerAuth.token = owner.token && owner.until > Date.now() ? owner.token : '';
  ownerAuth.onRejected = lock;

  const unlock = useCallback(async (passcode: string): Promise<string> => {
    try {
      const got = await aiUnlock(passcode);
      const next = { token: got.token, until: got.expiresAt };
      setOwner(next);
      ownerRef.current = next;
      writeOwner(next);
      return '';
    } catch (e) {
      return e instanceof AiError ? e.message : AI_NAME + ' could not be reached. Try again.';
    }
  }, []);

  const push = (e: Entry) => setEntries((all) => all.concat([e]));
  const nextKey = () => { seq.current += 1; return seq.current; };
  const note = (text: string, bad: boolean) => push({ kind: 'note', key: nextKey(), text: text, bad: bad });
  const patch = (key: number, change: Partial<{ text: string; streaming: boolean }>) =>
    setEntries((all) => all.map((e) => (e.key === key && e.kind === 'assistant' ? Object.assign({}, e, change) : e)));
  const addStep = (key: number, s: Step) =>
    setEntries((all) => all.map((e) => (e.key === key && e.kind === 'assistant' ? Object.assign({}, e, { steps: e.steps.concat([s]) }) : e)));
  const patchStep = (key: number, id: string, change: Partial<Step>) =>
    setEntries((all) => all.map((e) => (e.key === key && e.kind === 'assistant'
      ? Object.assign({}, e, { steps: e.steps.map((s) => (s.id === id ? Object.assign({}, s, change) : s)) }) : e)));
  const drop = (key: number) => setEntries((all) => all.filter((e) => e.key !== key));

  // Carry out one tool call and return what the model is told about it.
  const execute = async (call: { id: string; name: string; input: Json }, key: number): Promise<{ content: string; isError: boolean }> => {
    const ctx = ctxRef.current;
    if (isWriteTool(call.name)) {
      const planned = await planWrite(call.name, call.input, ctx);
      if ('error' in planned) {
        patchStep(key, call.id, { state: 'failed', summary: planned.error });
        return { content: planned.error, isError: true };
      }
      const plan = planned.plan;
      patchStep(key, call.id, { state: 'ask', label: plan.title, plan: { title: plan.title, lines: plan.lines, danger: plan.danger } });
      const yes = await new Promise<boolean>((resolve) => { waiting.current[call.id] = resolve; });
      delete waiting.current[call.id];
      if (!yes) {
        patchStep(key, call.id, { state: 'declined', summary: 'Not applied' });
        return { content: 'The person declined this change. Do not retry it; ask what they would like instead.', isError: true };
      }
      patchStep(key, call.id, { state: 'running', summary: '' });
      const applied = await applyPlan(plan);
      patchStep(key, call.id, { state: applied.isError ? 'failed' : 'done', summary: applied.summary });
      await settle();
      return applied;
    }
    const fromFullView = ctx.section === 'ai';
    const out = await runRead(call.name, call.input, ctx);
    patchStep(key, call.id, { state: out.isError ? 'failed' : 'done', summary: out.summary });
    // The full view is about to be replaced by the screen it opened: keep the conversation in sight.
    if (call.name === 'open_screen' && !out.isError && fromFullView) setPanel(true);
    return out;
  };

  const run = async (question: string) => {
    const q = question.trim();
    if (!q || running.current) return;
    running.current = true;
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    if (ownerRef.current.token && ownerRef.current.until <= Date.now()) lock();
    const w = wire.current;
    const tail = w[w.length - 1];
    // After a stopped or failed run the conversation can end on our side: the new question joins that message.
    const merged = Boolean(tail && tail.role === 'user');
    if (merged) tail.content.push({ type: 'text', text: q });
    else w.push({ role: 'user', content: [{ type: 'text', text: q }] });
    push({ kind: 'user', key: nextKey(), text: q });
    const takeBack = () => {
      const last = w[w.length - 1];
      if (!last || last.role !== 'user') return;
      if (merged) last.content.pop();
      else w.pop();
    };
    try {
      for (let round = 1; ; round += 1) {
        const key = nextKey();
        push({ kind: 'assistant', key: key, text: '', steps: [], streaming: true });
        const got = { text: '', calls: [] as { id: string; name: string; input: Json }[], failure: null as null | { code: string; message: string } };
        try {
          await aiChat({ messages: w, context: contextFor(ctxRef.current), ownerToken: ownerRef.current.token || undefined }, (ev) => {
            if (ev.t === 'text') {
              got.text += ev.d;
              patch(key, { text: got.text });
            } else if (ev.t === 'tool') {
              got.calls.push({ id: ev.id, name: ev.name, input: ev.input || {} });
              addStep(key, { id: ev.id, label: stepLabel(ev.name, ev.input || {}), state: 'running', summary: '', plan: null });
            } else if (ev.t === 'error') {
              got.failure = { code: ev.code, message: ev.message };
            }
          }, ctl.signal);
        } catch (e) {
          if (got.text.trim()) patch(key, { streaming: false });
          else drop(key);
          if (round === 1) takeBack(); // the question never got an answer: it can be asked again as it is
          throw e;
        }
        patch(key, { streaming: false });
        if (got.failure) {
          // Keep what was said. Tool calls that will not run are left out, or the conversation could not go on.
          if (got.text.trim()) w.push({ role: 'assistant', content: [{ type: 'text', text: got.text }] });
          else drop(key);
          got.calls.forEach((c) => patchStep(key, c.id, { state: 'failed', summary: 'Not run' }));
          note(got.failure.message, true);
          break;
        }
        const blocks: Block[] = [];
        if (got.text.trim()) blocks.push({ type: 'text', text: got.text });
        got.calls.forEach((c) => blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input }));
        if (blocks.length === 0) {
          drop(key);
          note(AI_NAME + ' had nothing to add.', false);
          break;
        }
        w.push({ role: 'assistant', content: blocks });
        if (got.calls.length === 0) break;
        const results: Block[] = [];
        for (const call of got.calls) {
          if (ctl.signal.aborted) {
            patchStep(key, call.id, { state: 'declined', summary: 'Stopped' });
            results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Stopped by the person before this ran.', is_error: true });
          } else {
            const out = await execute(call, key);
            results.push({ type: 'tool_result', tool_use_id: call.id, content: out.content, is_error: out.isError });
          }
        }
        w.push({ role: 'user', content: results });
        if (ctl.signal.aborted) {
          note('Stopped.', false);
          break;
        }
        if (round >= MAX_ROUNDS) {
          note(AI_NAME + ' paused after ' + MAX_ROUNDS + ' steps. Say "continue" to let it go on.', false);
          break;
        }
        await settle();
      }
    } catch (e) {
      if (ctl.signal.aborted) {
        note('Stopped.', false);
      } else if (e instanceof AiError) {
        note(e.message, true);
        if (e.code === 'owner_expired' || e.code === 'owner_required') lock();
        if (e.code === 'off' || e.code.indexOf('budget_') === 0) refreshStatus();
      } else {
        note(AI_NAME + ' ran into a problem. Try again.', true);
      }
    } finally {
      running.current = false;
      abort.current = null;
      waiting.current = {};
      setBusy(false);
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  const send = useCallback((text: string) => { void runRef.current(text); }, []);
  const ask = useCallback((text: string) => { setPanel(true); void runRef.current(text); }, []);
  const stop = useCallback(() => {
    if (abort.current) abort.current.abort();
    Object.keys(waiting.current).forEach((id) => waiting.current[id](false));
  }, []);
  const decide = useCallback((id: string, yes: boolean) => {
    const answer = waiting.current[id];
    if (answer) answer(yes);
  }, []);
  const reset = useCallback(() => {
    if (running.current) return;
    wire.current = [];
    setEntries([]);
  }, []);

  return {
    status: status, statusLoaded: statusLoaded, entries: entries, busy: busy, unlockedUntil: owner.token && owner.until > Date.now() ? owner.until : 0,
    panel: panel, setPanel: setPanel, send: send, ask: ask, stop: stop, reset: reset, decide: decide, unlock: unlock, lock: lock,
  };
}

// ---------------------------------------------------------------- answers as text

const TICK = String.fromCharCode(96);
const INLINE = new RegExp('(\\*\\*[^*\\n]+\\*\\*|\\*[^*\\s](?:[^*\\n]*[^*\\s])?\\*|' + TICK + '[^' + TICK + '\\n]+' + TICK + ')', 'g');
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.charAt(0) === '*' && part.charAt(part.length - 1) === '*') return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.charAt(0) === TICK && part.charAt(part.length - 1) === TICK) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

type RichBlock =
  | { t: 'p'; lines: string[] }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] };

// The small part of Markdown the assistant is asked to use: paragraphs, lists, tables, bold and code.
function parseRich(text: string): RichBlock[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const tableAt = (i: number) => ROW.test(lines[i]) && i + 1 < lines.length && RULE.test(lines[i + 1]);
  const out: RichBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (tableAt(i)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && ROW.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      out.push({ t: 'table', head: head, rows: rows });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const re = BULLET.test(line) ? BULLET : NUMBERED;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) { items.push((re.exec(lines[i]) as RegExpExecArray)[1]); i += 1; }
      out.push({ t: re === BULLET ? 'ul' : 'ol', items: items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !tableAt(i)) {
      para.push(lines[i].replace(/^\s*#{1,6}\s+/, ''));
      i += 1;
    }
    out.push({ t: 'p', lines: para });
  }
  return out;
}

function Rich(p: { text: string }) {
  return (
    <div className="ai-rich">
      {parseRich(p.text).map((b, i) => {
        if (b.t === 'p') return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j ? <br /> : null}{inline(l)}</span>)}</p>;
        if (b.t === 'table') {
          return (
            <div className="ai-table" key={i}>
              <table>
                <thead><tr>{b.head.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
        return b.t === 'ol' ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------- the conversation

export const EXAMPLES = [
  'Where is most of the value in the book, and how is it doing?',
  'Value the NVDA trades on the 2026-10-30 curve and compare with today.',
  'What would a 3-month AAPL call 5% out of the money cost?',
  'How much does the book move if rates rise 100 bp?',
];

const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function StepLine(p: { s: Step; ai: Ai }) {
  const s = p.s;
  if (s.state === 'ask' && s.plan) {
    return (
      <div className={'ai-ask' + (s.plan.danger ? ' danger' : '')} role="group" aria-label="Change to confirm">
        <strong>{s.plan.title}</strong>
        <ul>{s.plan.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="btns">
          <Btn kind={s.plan.danger ? 'danger' : 'primary'} onClick={() => p.ai.decide(s.id, true)}>{s.plan.danger ? 'Yes, delete' : 'Apply'}</Btn>
          <Btn onClick={() => p.ai.decide(s.id, false)}>{s.plan.danger ? 'Keep' : 'Skip'}</Btn>
        </div>
      </div>
    );
  }
  return (
    <div className={'ai-step ' + s.state}>
      <span className="mark" aria-hidden="true" />
      <span className="what">{s.label}</span>
      {s.summary ? <span className="sum">{s.summary}</span> : null}
    </div>
  );
}

function OwnerLock(p: { ai: Ai }) {
  const ai = p.ai;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [checking, setChecking] = useState(false);
  if (!ai.status || !ai.status.ownerSetUp) return null;
  if (ai.unlockedUntil) {
    return <span>Changes unlocked until {clock(ai.unlockedUntil)}. <button type="button" className="link" onClick={ai.lock}>Lock</button></span>;
  }
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>Owner: unlock changes</button>;
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!code || checking) return;
    setChecking(true);
    setMsg('');
    const why = await ai.unlock(code);
    setChecking(false);
    if (why) { setMsg(why); return; }
    setCode('');
    setOpen(false);
  };
  return (
    <form className="ai-unlock" onSubmit={go}>
      <label>
        Owner passcode
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus />
      </label>
      <Btn submit disabled={checking || !code}>{checking ? 'Checking' : 'Unlock'}</Btn>
      <button type="button" className="link" onClick={() => { setOpen(false); setCode(''); setMsg(''); }}>Cancel</button>
      {msg ? <span className="neg" role="alert">{msg}</span> : null}
    </form>
  );
}

// At the top of every ticket: says whether changes are open, and lets the owner unlock them.
export function OwnerGate(p: { ai: Ai }) {
  const ai = p.ai;
  if (ai.unlockedUntil) return <div className="gate open"><OwnerLock ai={ai} /></div>;
  const setUp = Boolean(ai.status && ai.status.ownerSetUp);
  return (
    <div className="gate">
      <span>{setUp ? 'Read only. Adding, editing and deleting is reserved for the site owner.' : 'Read only. Changing data is not available right now.'}</span>
      <OwnerLock ai={ai} />
    </div>
  );
}

export function AiConversation(p: { ai: Ai; focus?: boolean }) {
  const ai = p.ai;
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const follow = useRef(true);

  useEffect(() => {
    const el = log.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [ai.entries]);
  useEffect(() => {
    if (p.focus && box.current) box.current.focus();
  }, [p.focus]);

  const s = ai.status;
  const off = !ai.statusLoaded ? ''
    : !s ? AI_NAME + ' is not available right now.'
      : !s.enabled ? AI_NAME + ' is switched off at the moment.'
        : s.resting === 'month' ? AI_NAME + ' has used up its budget for this month. It is back on the first of next month.'
          : s.resting === 'day' ? AI_NAME + ' has used up its budget for today. It is back tomorrow (UTC).'
            : '';

  const submit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const q = draft.trim();
    if (!q || ai.busy || off) return;
    setDraft('');
    follow.current = true;
    ai.send(q);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="ai">
      <div
        className="ai-log"
        ref={log}
        aria-live="polite"
        onScroll={() => {
          const el = log.current;
          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {ai.entries.length === 0 ? (
          <div className="ai-empty">
            <p>Ask about the book, price a what-if or run a valuation. {AI_NAME} works on the same data and the same engine as these screens.</p>
            <div className="ai-examples">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="ai-example" disabled={ai.busy || Boolean(off)} onClick={() => { follow.current = true; ai.send(x); }}>{x}</button>
              ))}
            </div>
          </div>
        ) : null}
        {ai.entries.map((e, i) => {
          if (e.kind === 'user') return <div key={e.key} className="ai-msg user"><span className="who">You</span><p>{e.text}</p></div>;
          if (e.kind === 'note') return <div key={e.key} className={'notice' + (e.bad ? ' bad' : '')} role={e.bad ? 'alert' : undefined}>{e.text}</div>;
          const prev = i > 0 ? ai.entries[i - 1] : null;
          return (
            <div key={e.key} className="ai-msg bot">
              {!prev || prev.kind !== 'assistant' ? <span className="who">{AI_NAME}</span> : null}
              {e.text ? <Rich text={e.text} /> : null}
              {e.streaming && !e.text && e.steps.length === 0 ? <span className="ai-wait">Thinking</span> : null}
              {e.steps.map((st) => <StepLine key={st.id} s={st} ai={ai} />)}
            </div>
          );
        })}
      </div>
      {off ? <div className="notice">{off}</div> : null}
      <form className="ai-compose" onSubmit={submit}>
        <textarea
          ref={box}
          rows={2}
          maxLength={4000}
          value={draft}
          disabled={Boolean(off)}
          placeholder="Ask about the book, a price or a what-if"
          aria-label={'Message to ' + AI_NAME}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        {ai.busy ? <Btn onClick={ai.stop}>Stop</Btn> : <Btn kind="primary" submit disabled={!draft.trim() || Boolean(off)}>Send</Btn>}
      </form>
      <div className="ai-foot">
        <span>{(s && s.model ? s.model + ' on Amazon Bedrock. ' : '') + 'It can be wrong: check figures on the screens.'}</span>
        <OwnerLock ai={ai} />
        {ai.entries.length ? <button type="button" className="link" disabled={ai.busy} onClick={ai.reset}>New conversation</button> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dock and panel

export function AiDock(p: { ai: Ai }) {
  const ai = p.ai;
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    setQ('');
    if (text) ai.ask(text);
    else ai.setPanel(true);
  };
  return (
    <form className="dock" id="dpp-ai" onSubmit={submit}>
      <label>
        Ask {AI_NAME}
        <input type="text" value={q} maxLength={4000} placeholder="Value my NVDA trades on the Oct 30 curve" onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="btns">
        <Btn submit>{q.trim() ? 'Ask' : ai.entries.length ? 'Open the conversation' : 'Open'}</Btn>
      </div>
      <p className="note">Reads the book, prices what-ifs and runs valuations, in every section.</p>
    </form>
  );
}

export function AiPanel(p: { ai: Ai; go: (section: string) => void }) {
  const ai = p.ai;
  if (!ai.panel) return null;
  return (
    <aside
      className="ai-panel"
      aria-label={AI_TITLE}
      onKeyDown={(e) => { if (e.key === 'Escape') ai.setPanel(false); }}
    >
      <div className="rail-head">
        <h2>{AI_TITLE}</h2>
        <button type="button" className="link" onClick={() => { ai.setPanel(false); p.go('ai'); }}>Full view</button>
        <button type="button" className="link" onClick={() => ai.setPanel(false)}>Close</button>
      </div>
      <AiConversation ai={ai} focus />
    </aside>
  );
}
