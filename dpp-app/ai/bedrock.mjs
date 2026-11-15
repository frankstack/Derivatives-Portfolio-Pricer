// One streaming call to Claude on Amazon Bedrock (Converse API).
// Credentials come from the default AWS chain: on the server, the instance role.

import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

export function makeModel(cfg) {
  const client = new BedrockRuntimeClient({ region: cfg.region, maxAttempts: 2 });
  let useCache = cfg.promptCache;

  const request = (p, cached) => ({
    modelId: cfg.modelId,
    // The fixed prompt and the tool list are identical between calls, so they sit
    // before a cache point; the per-request context line comes after it.
    system: cached ? [{ text: p.system }, { cachePoint: { type: 'default' } }, { text: p.context }] : [{ text: p.system + '\n\n' + p.context }],
    messages: p.messages,
    toolConfig: { tools: cached ? p.tools.concat([{ cachePoint: { type: 'default' } }]) : p.tools },
    inferenceConfig: { maxTokens: cfg.maxTokens },
  });

  // Yields {t:'text',d}, {t:'tool',id,name,input} and finally {t:'done',stop,usage}.
  return async function* converse(p, signal) {
    let res;
    try {
      res = await client.send(new ConverseStreamCommand(request(p, useCache)), { abortSignal: signal });
    } catch (e) {
      // A model that does not take cache points says so before answering: go on without them.
      if (useCache && e && e.name === 'ValidationException' && /cache/i.test(String(e.message))) {
        useCache = false;
        res = await client.send(new ConverseStreamCommand(request(p, false)), { abortSignal: signal });
      } else {
        throw e;
      }
    }
    let tool = null;
    let stop = '';
    let usage = null;
    for await (const ev of res.stream) {
      if (ev.contentBlockStart) {
        const t = ev.contentBlockStart.start && ev.contentBlockStart.start.toolUse;
        if (t) tool = { id: t.toolUseId, name: t.name, json: '' };
      } else if (ev.contentBlockDelta) {
        const d = ev.contentBlockDelta.delta || {};
        if (typeof d.text === 'string' && d.text) yield { t: 'text', d: d.text };
        else if (d.toolUse && tool) tool.json += d.toolUse.input || '';
      } else if (ev.contentBlockStop) {
        if (tool) {
          let input;
          try {
            input = tool.json ? JSON.parse(tool.json) : {};
          } catch (e) {
            const err = new Error('The model sent a tool call that could not be read.');
            err.name = 'MalformedToolUse';
            throw err;
          }
          yield { t: 'tool', id: tool.id, name: tool.name, input };
          tool = null;
        }
      } else if (ev.messageStop) {
        stop = ev.messageStop.stopReason || '';
      } else if (ev.metadata) {
        usage = ev.metadata.usage || null;
      } else {
        const bad = ev.internalServerException || ev.modelStreamErrorException || ev.validationException || ev.throttlingException || ev.serviceUnavailableException;
        if (bad) {
          const err = new Error(bad.message || 'The model stream failed.');
          err.name = ev.throttlingException ? 'ThrottlingException' : ev.validationException ? 'ValidationException' : 'ModelStreamError';
          throw err;
        }
      }
    }
    yield { t: 'done', stop, usage };
  };
}
