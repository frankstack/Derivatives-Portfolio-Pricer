// Sets the owner passcode: asks for it twice without showing it and stores only
// its salted hash as DPP_AI_OWNER_HASH in the env file given as the argument.
//
//   docker run --rm -it -v /etc/dpp-ai:/cfg dpp-ai:local node set-owner-passcode.mjs /cfg/env
//
// Then restart the service. Tokens issued under the old passcode stop working.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashPasscode } from './owner.mjs';

function ask(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('This needs a terminal: run it with "docker run -it".'));
      return;
    }
    process.stdout.write(label);
    let typed = '';
    const finish = (value) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(value);
    };
    function onData(chunk) {
      for (const c of String(chunk)) {
        const code = c.charCodeAt(0);
        if (code === 13 || code === 10) return finish(typed);
        if (code === 3) return finish(null); // Ctrl+C
        if (code === 127 || code === 8) typed = typed.slice(0, -1);
        else if (code >= 32) typed += c;
      }
      return undefined;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

const file = process.argv[2];
const first = await ask('New owner passcode (hidden, at least 10 characters): ');
if (first === null) process.exit(1);
if (first.length < 10) {
  console.error('Too short. Nothing was changed.');
  process.exit(1);
}
const second = await ask('Once more: ');
if (second !== first) {
  console.error('The two entries differ. Nothing was changed.');
  process.exit(1);
}
const line = 'DPP_AI_OWNER_HASH=' + hashPasscode(first);
if (!file) {
  console.log(line);
} else {
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const kept = old.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('DPP_AI_OWNER_HASH='));
  kept.push(line);
  writeFileSync(file, kept.join('\n') + '\n', { mode: 0o600 });
  console.log('Saved the passcode hash to ' + file + '. Restart the service to use it.');
}
