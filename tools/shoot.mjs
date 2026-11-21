// Capture the three dossier screenshots from a built output dir with headless Chrome.
//   node tools/shoot.mjs --out out [--chrome <path>]
// Writes screenshots/1-board.png, 2-detail.png, 3-filtered.png in this repository.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = resolve(opt('out', join(root, 'out')));
const chrome = opt('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const page = pathToFileURL(join(out, 'dashboard', 'index.html')).href;
const profile = join(root, 'out-chrome-profile');

export const VIEWS = [
  ['1-board.png', ''],
  ['2-detail.png', opt('detail', 'p=steakhouse-financial')],
  ['3-filtered.png', opt('filter', 'lane=early&min=25000000&hide=1&sort=c7&dir=-1')],
];
mkdirSync(join(root, 'screenshots'), { recursive: true });
for (const [file, hash] of VIEWS) {
  const target = join(root, 'screenshots', file);
  rmSync(target, { force: true });
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--virtual-time-budget=3000', `--screenshot=${target}`, `${page}#${hash}`,
  ], { stdio: 'ignore' });
  process.stdout.write(`${file}  #${hash}  ${statSync(target).size} bytes\n`);
}
rmSync(profile, { recursive: true, force: true });
