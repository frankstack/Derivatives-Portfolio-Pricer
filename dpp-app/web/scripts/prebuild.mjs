// Puts the Overview page into public/: its text (the HTML fragment in overview/overview.html)
// and the images it shows. The diagrams drawn for this page live in overview/; the screenshots
// and the two reference diagrams are read from MonteCarloSimulatorWebApp, where they also live.
// public/ holds nothing else, so it is rebuilt from scratch on every build.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const own = join(here, '..', 'overview');
const shared = join(here, '..', '..', 'MCSimulator', 'MonteCarloSimulatorWebApp');
const pub = join(here, '..', 'public');
rmSync(pub, { recursive: true, force: true });
mkdirSync(pub, { recursive: true });

const fragment = readFileSync(join(own, 'overview.html'), 'utf8');
writeFileSync(join(pub, 'overview.html'), fragment);

const assets = new Set(['pm-logo.svg', 'og-logo-512.png']);
const re = /(?:src|href)="([^"#:]+\.(?:png|svg|jpg|jpeg|gif|webp))"/g;
let m;
while ((m = re.exec(fragment)) !== null) assets.add(m[1]);
for (const name of assets) {
  const from = [join(own, name), join(shared, name)].find((f) => existsSync(f));
  // A figure that cannot be found stops the build: better than a page with a hole in it.
  if (!from) throw new Error('prebuild: the Overview refers to ' + name + ', which is in neither overview/ nor MonteCarloSimulatorWebApp/');
  copyFileSync(from, join(pub, name));
}
console.log('prebuild: overview.html (' + fragment.length + ' chars) and ' + assets.size + ' images');
