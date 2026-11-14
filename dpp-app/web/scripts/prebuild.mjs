// Copies what the new UI reuses from the current site into public/:
// the Overview text (as an HTML fragment) and the images it shows.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const legacy = join(here, '..', '..', 'MCSimulator', 'MonteCarloSimulatorWebApp');
const pub = join(here, '..', 'public');
mkdirSync(pub, { recursive: true });

const page = readFileSync(join(legacy, 'portfolioManager.html'), 'utf8');
const start = page.indexOf('<section id="overviewSection"');
if (start < 0) throw new Error('Overview section not found in portfolioManager.html');
const open = page.indexOf('>', start) + 1;
const end = page.indexOf('</section>', open);
if (end < 0) throw new Error('Overview section is not closed in portfolioManager.html');
const fragment = page.slice(open, end);
writeFileSync(join(pub, 'overview.html'), fragment);

const assets = new Set(['pm-logo.svg', 'og-logo-512.png']);
const re = /(?:src|href)="([^"#:]+\.(?:png|svg|jpg|jpeg|gif|webp))"/g;
let m;
while ((m = re.exec(fragment)) !== null) assets.add(m[1]);
let copied = 0;
for (const name of assets) {
  const from = join(legacy, name);
  if (!existsSync(from)) { console.warn('prebuild: missing asset ' + name); continue; }
  mkdirSync(dirname(join(pub, name)), { recursive: true });
  copyFileSync(from, join(pub, name));
  copied += 1;
}
console.log('prebuild: overview.html (' + fragment.length + ' chars) and ' + copied + ' assets');
