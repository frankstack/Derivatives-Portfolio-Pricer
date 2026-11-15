// Who may call the model, how often, and how much it may cost.
// Rate windows live in memory; the money spent is written to disk so a restart
// does not hand out a fresh budget.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NAME } from './config.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

class Window {
  constructor(span) {
    this.span = span;
    this.hits = new Map();
  }
  list(key, now) {
    const all = this.hits.get(key);
    if (!all) return [];
    const from = now - this.span;
    let i = 0;
    while (i < all.length && all[i] <= from) i += 1;
    if (i > 0) all.splice(0, i);
    if (all.length === 0) this.hits.delete(key);
    return all;
  }
  count(key, now) {
    return this.list(key, now).length;
  }
  // Seconds until the oldest hit in the window expires.
  wait(key, now) {
    const all = this.list(key, now);
    return all.length ? Math.max(1, Math.ceil((all[0] + this.span - now) / 1000)) : 1;
  }
  add(key, now) {
    const all = this.hits.get(key);
    if (all) all.push(now);
    else this.hits.set(key, [now]);
  }
  sweep(now) {
    for (const key of Array.from(this.hits.keys())) this.list(key, now);
  }
}

const refusal = (code, message, retryAfter) => ({ status: 429, code, message, retryAfter: retryAfter || 0 });

export class Limits {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.now = opts.now || Date.now;
    this.file = join(cfg.stateDir, 'budget.json');
    this.ipMinute = new Window(MINUTE);
    this.ipDay = new Window(DAY);
    this.allMinute = new Window(MINUTE);
    this.unlockIp = new Window(15 * MINUTE);
    this.unlockAll = new Window(HOUR);
    this.active = 0;
    this.reserved = 0;
    this.saveFailed = false;
    this.budget = this.load();
  }

  load() {
    const empty = { day: '', daySpend: 0, month: '', monthSpend: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8'));
      const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
      return {
        day: String(j.day || ''), daySpend: n(j.daySpend), month: String(j.month || ''), monthSpend: n(j.monthSpend),
        calls: n(j.calls), inputTokens: n(j.inputTokens), outputTokens: n(j.outputTokens),
      };
    } catch (e) {
      return empty;
    }
  }

  save() {
    try {
      mkdirSync(this.cfg.stateDir, { recursive: true });
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.budget));
      renameSync(tmp, this.file);
      this.saveFailed = false;
    } catch (e) {
      // Keep serving from memory; the caller logs this once.
      this.saveFailed = true;
    }
  }

  roll(now) {
    const iso = new Date(now).toISOString();
    const day = iso.slice(0, 10);
    const month = iso.slice(0, 7);
    if (this.budget.day !== day) {
      this.budget.day = day;
      this.budget.daySpend = 0;
    }
    if (this.budget.month !== month) {
      this.budget.month = month;
      this.budget.monthSpend = 0;
    }
  }

  costOf(usage) {
    const u = usage || {};
    const p = this.cfg.price;
    const t = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    return (t(u.inputTokens) * p.input + t(u.outputTokens) * p.output + t(u.cacheReadInputTokens) * p.cacheRead + t(u.cacheWriteInputTokens) * p.cacheWrite) / 1e6;
  }

  // What a call could cost at most: its whole input uncached plus a full-length answer.
  estimate(inputChars) {
    const p = this.cfg.price;
    return ((inputChars / 3) * p.input + this.cfg.maxTokens * p.output) / 1e6;
  }

  budgetLeft() {
    this.roll(this.now());
    return {
      day: Math.max(0, this.cfg.capDayUsd - this.budget.daySpend - this.reserved),
      month: Math.max(0, this.cfg.capMonthUsd - this.budget.monthSpend - this.reserved),
    };
  }

  // null when a model call may start, otherwise the refusal to send back.
  admit(ip, estimateUsd) {
    const now = this.now();
    this.roll(now);
    const b = this.budget;
    if (b.monthSpend + this.reserved + estimateUsd > this.cfg.capMonthUsd) {
      return refusal('budget_month', NAME + ' has used up its budget for this month. It is back on the first of next month.');
    }
    if (b.daySpend + this.reserved + estimateUsd > this.cfg.capDayUsd) {
      return refusal('budget_day', NAME + ' has used up its budget for today. It is back tomorrow (UTC).');
    }
    if (this.active >= this.cfg.maxConcurrent || this.allMinute.count('all', now) >= this.cfg.globalPerMinute) {
      return refusal('busy', NAME + ' is busy with other questions right now. Try again in a few seconds.', 5);
    }
    if (this.ipMinute.count(ip, now) >= this.cfg.perIpPerMinute) {
      return refusal('rate_limited', 'That was a lot in one minute. Give ' + NAME + ' a moment and ask again.', this.ipMinute.wait(ip, now));
    }
    if (this.ipDay.count(ip, now) >= this.cfg.perIpPerDay) {
      return refusal('rate_limited_day', 'You have reached the daily limit for ' + NAME + '. It opens again within 24 hours.', this.ipDay.wait(ip, now));
    }
    return null;
  }

  begin(ip, estimateUsd) {
    const now = this.now();
    this.ipMinute.add(ip, now);
    this.ipDay.add(ip, now);
    this.allMinute.add('all', now);
    this.active += 1;
    this.reserved += estimateUsd;
    return { estimate: estimateUsd, open: true };
  }

  // Close a call: release the reservation and book what it really cost.
  end(ticket, usage) {
    if (!ticket || !ticket.open) return 0;
    ticket.open = false;
    this.active = Math.max(0, this.active - 1);
    this.reserved = Math.max(0, this.reserved - ticket.estimate);
    const cost = this.costOf(usage);
    this.roll(this.now());
    this.budget.daySpend += cost;
    this.budget.monthSpend += cost;
    if (usage) {
      this.budget.calls += 1;
      this.budget.inputTokens += (usage.inputTokens || 0) + (usage.cacheReadInputTokens || 0) + (usage.cacheWriteInputTokens || 0);
      this.budget.outputTokens += usage.outputTokens || 0;
    }
    this.save();
    return cost;
  }

  admitUnlock(ip) {
    const now = this.now();
    if (this.unlockIp.count(ip, now) >= this.cfg.unlockPerIpPer15Min) {
      return refusal('unlock_limited', 'Too many passcode attempts. Wait a few minutes.', this.unlockIp.wait(ip, now));
    }
    if (this.unlockAll.count('all', now) >= this.cfg.unlockGlobalPerHour) {
      return refusal('unlock_limited', 'Too many passcode attempts. Try again later.', this.unlockAll.wait('all', now));
    }
    return null;
  }

  noteUnlock(ip) {
    const now = this.now();
    this.unlockIp.add(ip, now);
    this.unlockAll.add('all', now);
  }

  sweep() {
    const now = this.now();
    [this.ipMinute, this.ipDay, this.allMinute, this.unlockIp, this.unlockAll].forEach((w) => w.sweep(now));
  }
}
