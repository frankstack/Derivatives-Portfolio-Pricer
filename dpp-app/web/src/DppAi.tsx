// The assistant as a full screen: the conversation in the workspace, what it can do on the right.
import { Shell } from './shell';
import type { Ctx } from './shell';
import { AiConversation } from './AiChat';
import { AI_NAME, AI_TITLE } from './ai';

export function DppAi(p: { ctx: Ctx }) {
  const ai = p.ctx.ai;
  const owner = Boolean(ai.status && ai.status.ownerSetUp);
  const rail = (
    <>
      <h3>What it does</h3>
      <p className="note">
        {AI_NAME} is the AI assistant built into this pricer. The name comes from Monte Carlo, the simulation method behind every price here.
      </p>
      <p className="note">
        It reads the underlyings, derivatives, trades and rate curves in this app, prices what-if contracts with the Monte Carlo engine, and runs
        valuations as of today or a past date, on any curve. It can also bring up the screen it is talking about.
      </p>
      <h3>Changing data</h3>
      <p className="note">
        {ai.unlockedUntil
          ? 'Changes are unlocked. ' + AI_NAME + ' can add, edit and delete records, and shows you each change to confirm before it is applied.'
          : owner
            ? 'Visitors get answers, prices and valuations. Adding, editing and deleting through ' + AI_NAME + ' is reserved for the site owner, who unlocks it with a passcode below the message box.'
            : AI_NAME + ' answers, prices and values. It does not change the data on this site.'}
      </p>
      <h3>Good to know</h3>
      <p className="note">
        Engine figures are Monte Carlo estimates, so two runs differ slightly. {AI_NAME} explains and computes; it does not give investment advice.
        To keep it free to use, it answers a limited number of questions per minute and per day.
      </p>
    </>
  );
  return (
    <Shell ctx={p.ctx} title={AI_TITLE} sub="Ask about the book, price a what-if, run a valuation" railTitle={'About ' + AI_NAME} rail={rail} noDock>
      <section className="panel fill ai-screen" aria-label={'Conversation with ' + AI_NAME}>
        <AiConversation ai={ai} focus />
      </section>
    </Shell>
  );
}
