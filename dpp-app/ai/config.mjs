// Settings, all from the environment, with defaults that are safe for a public site.

// The assistant's name as people read it. The screens carry the same name in web/src/ai.ts.
export const NAME = 'Carlo';

const num = (v, d) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

export function loadConfig(env = process.env) {
  return {
    enabled: env.DPP_AI_ENABLED !== '0',
    host: env.DPP_AI_HOST || '127.0.0.1',
    port: num(env.DPP_AI_PORT, 5024),
    region: env.DPP_AI_REGION || env.AWS_REGION || 'us-east-2',
    // A Bedrock inference profile this account can invoke. "global." has no regional price premium.
    modelId: env.DPP_AI_MODEL_ID || 'global.anthropic.claude-sonnet-4-6',
    modelLabel: env.DPP_AI_MODEL_LABEL || 'Claude Sonnet 4.6',
    maxTokens: num(env.DPP_AI_MAX_TOKENS, 4000),
    promptCache: env.DPP_AI_PROMPT_CACHE !== '0',
    // USD per million tokens, for the spend cap. Keep in line with the model above.
    price: {
      input: num(env.DPP_AI_PRICE_INPUT, 3),
      output: num(env.DPP_AI_PRICE_OUTPUT, 15),
      cacheRead: num(env.DPP_AI_PRICE_CACHE_READ, 0.3),
      cacheWrite: num(env.DPP_AI_PRICE_CACHE_WRITE, 3.75),
    },
    capDayUsd: num(env.DPP_AI_CAP_DAY_USD, 1),
    capMonthUsd: num(env.DPP_AI_CAP_MONTH_USD, 10),
    // Model calls. One question usually takes two to four of them.
    perIpPerMinute: num(env.DPP_AI_PER_IP_MINUTE, 12),
    perIpPerDay: num(env.DPP_AI_PER_IP_DAY, 150),
    globalPerMinute: num(env.DPP_AI_GLOBAL_MINUTE, 40),
    maxConcurrent: num(env.DPP_AI_MAX_CONCURRENT, 3),
    unlockPerIpPer15Min: num(env.DPP_AI_UNLOCK_PER_IP, 5),
    unlockGlobalPerHour: num(env.DPP_AI_UNLOCK_GLOBAL, 30),
    // Conversation size the service accepts.
    maxMessages: num(env.DPP_AI_MAX_MESSAGES, 80),
    maxChars: num(env.DPP_AI_MAX_CHARS, 120000),
    maxUserText: num(env.DPP_AI_MAX_USER_TEXT, 4000),
    maxToolResult: num(env.DPP_AI_MAX_TOOL_RESULT, 24000),
    maxBodyBytes: num(env.DPP_AI_MAX_BODY, 400000),
    ownerHash: env.DPP_AI_OWNER_HASH || '',
    tokenTtlMs: num(env.DPP_AI_TOKEN_HOURS, 8) * 3600 * 1000,
    stateDir: env.DPP_AI_STATE_DIR || './state',
    origins: (env.DPP_AI_ORIGINS || 'https://derivativespricer.com,https://www.derivativespricer.com')
      .split(',').map((s) => s.trim()).filter(Boolean),
  };
}
