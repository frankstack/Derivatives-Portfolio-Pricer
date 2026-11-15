# DPP AI service

The chat in the site ("DPP AI") talks to Claude on Amazon Bedrock through this small
Node service. It is the only way from the site to the model, and it never touches the
pricing data.

## How the pieces fit

    browser (dpp-app/web)  --/api/ai/-->  nginx  -->  dpp-ai (this folder)  -->  Amazon Bedrock
          |
          +--/api/-->  nginx  -->  dpp-api (pricing engine and database)

- The service holds the instructions and the list of tools the model may ask for,
  checks every request, enforces the limits and the spend caps, and relays the answer
  as a stream.
- The tools themselves run in the visitor's browser, with the same calls the screens
  use. The service has no database access and no route to the pricing API.
- Visitors get read tools only (look up, value, price a what-if, open a screen).
  Tools that add, edit or delete are offered only after the owner passcode has been
  entered, and the site shows each change for confirmation before it is applied.
- No AWS keys are stored: calls are signed with the EC2 instance role, which is
  allowed to invoke Anthropic models on Bedrock and nothing else in Bedrock.
- The log has sizes, token counts and cost per call. It never has conversation text.

## Files

    server.mjs               routes, checks, the stream
    bedrock.mjs              the call to Bedrock (ConverseStream)
    prompt.mjs               what the model is told
    tools.mjs                the tools it may ask for (read for everyone, write for the owner)
    validate.mjs             checks and trims the conversation sent by the browser
    limits.mjs               per-visitor limits and the daily and monthly spend caps
    owner.mjs                passcode hash and the owner token
    config.mjs               every setting, with its default
    set-owner-passcode.mjs   sets or changes the owner passcode
    deploy.sh                build and (re)start on the server
    env.example              the settings file, copied to /etc/dpp-ai/env on first deploy
    test/                    npm test

## On the server

Build and start (also after pulling new code):

    cd ~/Derivatives-Portfolio-Pricer/dpp-app/ai && bash deploy.sh

Set or change the owner passcode. It is typed twice, never shown, and only its salted
hash is stored. Then restart:

    docker run --rm -it -v /etc/dpp-ai:/cfg dpp-ai:local node set-owner-passcode.mjs /cfg/env
    bash deploy.sh restart

Change the model or a cap: edit /etc/dpp-ai/env (model id, display name and the four
prices go together), then

    bash deploy.sh restart

Switch the chat off without touching the site: add DPP_AI_ENABLED=0 to the env file
and restart. The site then says the chat is unavailable.

Look at it:

    curl -s http://127.0.0.1:5024/api/ai/status
    docker logs --tail 50 dpp-ai
    cat /var/lib/dpp-ai/budget.json

nginx needs the /api/ai/ block from dpp-app/infra/nginx/dpp.conf, placed before the
/api/ block of the live config.

## Limits (defaults)

- 1 USD per day and 10 USD per month in model cost. At a cap the chat rests until the
  next day or month (UTC). The estimate is on the high side when a call breaks off.
- Per visitor: 12 model calls per minute and 150 per day. One question usually takes
  two to four calls.
- Whole site: 40 model calls per minute, 3 at the same time.
- Passcode attempts: 5 per visitor in 15 minutes, 30 per hour for the whole site.

## Tests

    npm install
    npm test

The tests run the whole service against a stand-in model, so they need no AWS access.
