// Checks a conversation sent by the browser and turns it into Bedrock's shape.
// Nothing here is trusted: sizes are bounded, tool names must be ones this
// service offers, and every tool call must have its answer.

import { READ_NAMES, WRITE_NAMES } from './tools.mjs';

export class Invalid extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ID = /^[A-Za-z0-9_-]{1,80}$/;

function sizeOf(msg) {
  let n = 0;
  for (const b of msg.content) {
    if (b.text) n += b.text.length;
    else if (b.toolUse) n += JSON.stringify(b.toolUse.input).length + b.toolUse.name.length;
    else if (b.toolResult) n += b.toolResult.content[0].text.length;
  }
  return n;
}

export function toConverse(input, cfg, owner) {
  if (!Array.isArray(input) || input.length === 0) throw new Invalid('invalid', 'There is no message to answer.');
  if (input.length > 400) throw new Invalid('too_long', 'This conversation has grown too long. Start a new one.');

  const out = [];
  let pending = new Set(); // tool calls of the previous assistant message still waiting for a result
  input.forEach((m, i) => {
    if (!isObj(m) || !Array.isArray(m.content)) throw new Invalid('invalid', 'The conversation could not be read.');
    const role = m.role;
    const want = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== want) throw new Invalid('invalid', 'The conversation could not be read.');
    const content = [];
    const calls = new Set();
    const answered = new Set();
    for (const b of m.content) {
      if (!isObj(b)) throw new Invalid('invalid', 'The conversation could not be read.');
      if (b.type === 'text') {
        const text = typeof b.text === 'string' ? b.text.trim() : '';
        if (!text) continue;
        if (role === 'user' && text.length > cfg.maxUserText) {
          throw new Invalid('too_long', 'That message is too long for DPP AI. Keep it under ' + cfg.maxUserText + ' characters.');
        }
        content.push({ text: role === 'user' ? text : text.slice(0, 20000) });
      } else if (b.type === 'tool_use' && role === 'assistant') {
        if (!ID.test(String(b.id || '')) || calls.has(b.id)) throw new Invalid('invalid', 'The conversation could not be read.');
        const name = String(b.name || '');
        if (WRITE_NAMES.has(name)) {
          if (!owner) throw new Invalid('owner_required', 'Changes are locked again. Enter the owner passcode to continue this conversation, or start a new one.');
        } else if (!READ_NAMES.has(name)) {
          throw new Invalid('invalid', 'The conversation could not be read.');
        }
        const args = isObj(b.input) ? b.input : {};
        if (JSON.stringify(args).length > 40000) throw new Invalid('too_long', 'This conversation has grown too long. Start a new one.');
        calls.add(b.id);
        content.push({ toolUse: { toolUseId: b.id, name, input: args } });
      } else if (b.type === 'tool_result' && role === 'user') {
        const id = String(b.tool_use_id || '');
        if (!pending.has(id) || answered.has(id)) throw new Invalid('invalid', 'The conversation could not be read.');
        answered.add(id);
        let text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content === undefined ? null : b.content);
        if (text.length > cfg.maxToolResult) text = text.slice(0, cfg.maxToolResult) + ' ...[cut: result too long]';
        content.push({ toolResult: { toolUseId: id, content: [{ text: text || '(empty)' }], status: b.is_error ? 'error' : 'success' } });
      } else {
        throw new Invalid('invalid', 'The conversation could not be read.');
      }
    }
    if (role === 'user' && answered.size !== pending.size) throw new Invalid('invalid', 'The conversation could not be read.');
    if (content.length === 0) throw new Invalid('invalid', 'There is no message to answer.');
    // Bedrock wants tool results before any other text in the same message.
    if (role === 'user') content.sort((a, b) => (a.toolResult ? 0 : 1) - (b.toolResult ? 0 : 1));
    pending = calls;
    out.push({ role, content });
  });
  if (out[out.length - 1].role !== 'user') throw new Invalid('invalid', 'There is no message to answer.');

  // Keep the newest whole exchanges that fit. An exchange starts at a user
  // message that is a question, not a batch of tool results.
  const sizes = out.map(sizeOf);
  let total = 0;
  let start = -1;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    total += sizes[i];
    if (total > cfg.maxChars || out.length - i > cfg.maxMessages) break;
    if (out[i].role === 'user' && !out[i].content.some((b) => b.toolResult)) start = i;
  }
  if (start < 0) throw new Invalid('too_long', 'This conversation has grown too long. Start a new one.');
  const kept = out.slice(start);
  return { messages: kept, chars: sizes.slice(start).reduce((a, b) => a + b, 0), dropped: start };
}

export function toToolSpecs(tools) {
  return tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.input_schema } } }));
}
