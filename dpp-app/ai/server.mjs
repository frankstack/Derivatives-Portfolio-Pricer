// The assistant's service (dpp-ai): the only way from the site to the model.
// It decides what the model is told (prompt and tools), who may call it and how
// much it may cost. It never touches the pricing data: the tools the model asks
// for are carried out by the site in the visitor's browser.
//
//   GET  /api/ai/status   is it on, which model, is an owner passcode set
//   POST /api/ai/unlock   {passcode} -> {token, expiresAt}
//   POST /api/ai/chat     {messages, context, ownerToken?} -> NDJSON stream
//   GET  /api/ai/owner-check   204 when the X-DPP-Owner header carries a valid owner token, else 401.
//                              nginx asks this before it lets a change through to the pricing API.
//
// Stream lines: {"t":"text","d":"..."}  {"t":"tool","id","name","input"}
//               {"t":"done","stop":"end_turn|tool_use|..."}  {"t":"error","code","message"}

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, NAME } from './config.mjs';
import { Limits } from './limits.mjs';
import { loadSigningKey, issueToken, verifyToken, verifyPasscode } from './owner.mjs';
import { toConverse, toToolSpecs, Invalid } from './validate.mjs';
import { toolsFor } from './tools.mjs';
import { systemPrompt, contextLine } from './prompt.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function sendJson(res, status, body, extra) {
  res.writeHead(status, Object.assign({}, JSON_HEADERS, extra || {}));
  res.end(JSON.stringify(body));
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (code, message) => {
      if (done) return;
      done = true;
      reject(new Invalid(code, message));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        fail('too_long', 'This conversation has grown too long. Start a new one.');
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('error', () => fail('invalid', 'The request could not be read.'));
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const j = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object');
        resolve(j);
      } catch (e) {
        reject(new Invalid('invalid', 'The request could not be read.'));
      }
    });
  });
}

// What to tell the person when the model call itself fails. Details go to the log only.
export function describeUpstream(e) {
  const name = String((e && e.name) || '');
  if (/Throttling|TooManyRequests|ServiceUnavailable|ModelNotReady|ModelTimeout/.test(name)) {
    return { code: 'busy', message: 'The model is busy right now. Try again in a moment.' };
  }
  if (/AccessDenied|UnrecognizedClient|Credentials|ResourceNotFound|ExpiredToken/.test(name)) {
    return { code: 'unavailable', message: NAME + ' is not available right now.' };
  }
  if (/MalformedToolUse/.test(name)) {
    return { code: 'cut', message: 'The answer was cut short. Ask again, or ask for less at once.' };
  }
  if (/Validation/.test(name)) {
    return { code: 'invalid_upstream', message: NAME + ' could not follow this conversation. Start a new one.' };
  }
  return { code: 'error', message: NAME + ' ran into a problem. Try again.' };
}

export function createHandler(deps) {
  const { cfg, limits, model, key } = deps;
  const now = deps.now || Date.now;
  const log = deps.log || ((o) => process.stdout.write(JSON.stringify(o) + '\n'));

  const ipOf = (req) => String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown').slice(0, 64);
  // Logs carry a short daily hash of the address, enough to see one visitor's burst, not who it was.
  const tag = (ip) => createHash('sha256').update(new Date(now()).toISOString().slice(0, 10) + '|' + ip).digest('hex').slice(0, 10);

  const allowedPost = (req, res) => {
    const origin = req.headers.origin;
    if (origin && cfg.origins.indexOf(origin) < 0) {
      sendJson(res, 403, { code: 'forbidden', message: NAME + ' only answers its own site.' });
      return false;
    }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
      sendJson(res, 415, { code: 'invalid', message: 'The request could not be read.' });
      return false;
    }
    return true;
  };

  const status = (req, res) => {
    const left = limits.budgetLeft();
    const floor = limits.estimate(8000);
    sendJson(res, 200, {
      enabled: cfg.enabled,
      model: cfg.modelLabel,
      ownerSetUp: Boolean(cfg.ownerHash),
      resting: left.day < floor || left.month < floor ? (left.month < floor ? 'month' : 'day') : '',
    });
  };

  const unlock = async (req, res) => {
    if (!allowedPost(req, res)) return;
    const ip = ipOf(req);
    if (!cfg.ownerHash) return sendJson(res, 404, { code: 'no_owner', message: 'Owner changes are not set up on this site.' });
    const no = limits.admitUnlock(ip);
    if (no) return sendJson(res, no.status, { code: no.code, message: no.message }, { 'Retry-After': String(no.retryAfter || 60) });
    limits.noteUnlock(ip);
    let body;
    try {
      body = await readJson(req, 4000);
    } catch (e) {
      return sendJson(res, 400, { code: 'invalid', message: 'The request could not be read.' });
    }
    const pass = body.passcode;
    const ok = typeof pass === 'string' && pass.length > 0 && pass.length <= 200 && verifyPasscode(pass, cfg.ownerHash);
    log({ ts: new Date(now()).toISOString(), ev: 'unlock', who: tag(ip), ok });
    if (!ok) return sendJson(res, 401, { code: 'wrong_passcode', message: 'That passcode is not right.' });
    return sendJson(res, 200, issueToken(key, cfg.tokenTtlMs, now()));
  };

  const ownerCheck = (req, res) => {
    const token = req.headers['x-dpp-owner'];
    if (cfg.ownerHash && typeof token === 'string' && verifyToken(key, token, now())) {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    sendJson(res, 401, { code: 'owner_required', message: 'Changes are locked. Unlock them with the owner passcode.' });
  };

  const chat = async (req, res) => {
    if (!allowedPost(req, res)) return;
    if (!cfg.enabled) return sendJson(res, 503, { code: 'off', message: NAME + ' is switched off at the moment.' });
    const ip = ipOf(req);
    let body;
    let conv;
    let owner = false;
    try {
      body = await readJson(req, cfg.maxBodyBytes);
      if (body.ownerToken !== undefined && body.ownerToken !== null && body.ownerToken !== '') {
        owner = Boolean(cfg.ownerHash) && verifyToken(key, body.ownerToken, now());
        if (!owner) return sendJson(res, 401, { code: 'owner_expired', message: 'The owner unlock has expired. Enter the passcode again.' });
      }
      conv = toConverse(body.messages, cfg, owner);
    } catch (e) {
      if (e instanceof Invalid) return sendJson(res, e.code === 'owner_required' ? 401 : 400, { code: e.code, message: e.message });
      throw e;
    }
    const tools = toToolSpecs(toolsFor(owner));
    const system = systemPrompt(owner);
    const context = contextLine(body.context, owner, new Date(now()));
    const promptChars = system.length + JSON.stringify(tools).length + context.length + conv.chars;
    const estimate = limits.estimate(promptChars);
    const no = limits.admit(ip, estimate);
    if (no) {
      log({ ts: new Date(now()).toISOString(), ev: 'refused', who: tag(ip), code: no.code });
      return sendJson(res, no.status, { code: no.code, message: no.message }, no.retryAfter ? { 'Retry-After': String(no.retryAfter) } : undefined);
    }

    const ticket = limits.begin(ip, estimate);
    const started = now();
    const abort = new AbortController();
    let finished = false;
    res.on('close', () => {
      if (!finished) abort.abort();
    });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const write = (o) => {
      if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(o) + '\n');
    };
    let usage = null;
    let stop = '';
    let outChars = 0;
    let toolCalls = 0;
    let failure = '';
    try {
      for await (const ev of model({ system, context, tools, messages: conv.messages }, abort.signal)) {
        if (ev.t === 'done') {
          usage = ev.usage;
          stop = ev.stop;
        } else {
          if (ev.t === 'text') outChars += ev.d.length;
          if (ev.t === 'tool') {
            toolCalls += 1;
            outChars += JSON.stringify(ev.input).length;
          }
          write(ev);
        }
      }
      if (stop === 'max_tokens') write({ t: 'error', code: 'cut', message: 'The answer was cut short. Ask again, or ask for less at once.' });
      else write({ t: 'done', stop, dropped: conv.dropped });
    } catch (e) {
      failure = String((e && e.name) || 'Error');
      if (!abort.signal.aborted) {
        const d = describeUpstream(e);
        write({ t: 'error', code: d.code, message: d.message });
        log({ ts: new Date(now()).toISOString(), ev: 'upstream_error', name: failure, message: String((e && e.message) || '').slice(0, 300) });
      }
    } finally {
      finished = true;
      // A call that broke off after it started still cost something: book a rough figure rather than nothing.
      // A call the model service turned away before answering cost nothing.
      const turnedAway = Boolean(failure) && !abort.signal.aborted && outChars === 0;
      const booked = usage || (turnedAway ? { inputTokens: 0, outputTokens: 0 } : { inputTokens: Math.round(promptChars / 3.5), outputTokens: Math.round(outChars / 3) });
      const cost = limits.end(ticket, booked);
      log({
        ts: new Date(now()).toISOString(), ev: 'chat', who: tag(ip), owner, messages: conv.messages.length, promptChars,
        inputTokens: usage ? usage.inputTokens : null, outputTokens: usage ? usage.outputTokens : null,
        cacheRead: usage ? usage.cacheReadInputTokens || 0 : null, cacheWrite: usage ? usage.cacheWriteInputTokens || 0 : null,
        toolCalls, stop: stop || (abort.signal.aborted ? 'aborted' : failure), usd: Number(cost.toFixed(5)), ms: now() - started,
        budgetSaved: !limits.saveFailed,
      });
      res.end();
    }
  };

  return (req, res) => {
    const path = String(req.url || '').split('?')[0];
    const route =
      req.method === 'GET' && path === '/api/ai/status' ? status
        : req.method === 'POST' && path === '/api/ai/unlock' ? unlock
          : req.method === 'POST' && path === '/api/ai/chat' ? chat
            : req.method === 'GET' && path === '/api/ai/owner-check' ? ownerCheck
              : req.method === 'GET' && path === '/healthz' ? (rq, rs) => sendJson(rs, 200, { ok: true })
                : null;
    if (!route) return sendJson(res, 404, { code: 'not_found', message: 'Nothing here.' });
    Promise.resolve(route(req, res)).catch((e) => {
      log({ ts: new Date(now()).toISOString(), ev: 'crash', message: String((e && e.stack) || e).slice(0, 600) });
      if (!res.headersSent) sendJson(res, 500, { code: 'error', message: NAME + ' ran into a problem. Try again.' });
      else res.end();
    });
    return undefined;
  };
}

async function main() {
  const cfg = loadConfig();
  const { makeModel } = await import('./bedrock.mjs');
  const limits = new Limits(cfg);
  const key = loadSigningKey(cfg.stateDir, cfg.ownerHash);
  const server = createServer(createHandler({ cfg, limits, model: makeModel(cfg), key }));
  server.requestTimeout = 150000;
  server.headersTimeout = 20000;
  setInterval(() => limits.sweep(), 5 * 60 * 1000).unref();
  server.listen(cfg.port, cfg.host, () => {
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(), ev: 'start', host: cfg.host, port: cfg.port, model: cfg.modelId, region: cfg.region,
      capDayUsd: cfg.capDayUsd, capMonthUsd: cfg.capMonthUsd, ownerSetUp: Boolean(cfg.ownerHash), enabled: cfg.enabled,
    }) + '\n');
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(String((e && e.stack) || e) + '\n');
    process.exit(1);
  });
}
