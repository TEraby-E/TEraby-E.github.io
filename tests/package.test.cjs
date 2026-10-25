'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const site = path.join(root, 'study');
const read = (name) => fs.readFileSync(path.join(site, name), 'utf8');

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(absolute) : [absolute];
  });
}

function checkRelativeAsset(reference, source = 'index.html') {
  if (!reference || reference.startsWith('#') || /^(?:https?:|data:|mailto:|tel:)/i.test(reference)) return;
  if (source === 'index.html' && reference === '../') {
    assert.ok(fs.existsSync(path.join(root, 'index.html')), 'study return link resolves to the preserved homepage');
    return;
  }
  assert.ok(!reference.startsWith('/'), `${source}: ${reference} must remain inside a GitHub project path`);
  const target = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  const absolute = path.resolve(path.dirname(path.join(site, source)), target || '.');
  assert.ok(absolute === site || absolute.startsWith(site + path.sep), `${source}: asset escapes site directory`);
  assert.ok(fs.existsSync(absolute), `${source}: missing asset ${reference}`);
}

test('website resources resolve under a GitHub Pages project subpath', () => {
  const html = read('index.html');
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) checkRelativeAsset(match[1]);
  const css = read('styles.css');
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) checkRelativeAsset(match[1], 'styles.css');
});

test('release payload contains the task library without personal runtime files', () => {
  const dataFiles = filesIn(path.join(site, 'data')).map((file) => path.relative(path.join(site, 'data'), file));
  assert.deepEqual(dataFiles, ['library.json']);
  for (const file of filesIn(site)) {
    const relative = path.relative(site, file);
    assert.doesNotMatch(relative, /(?:\.sqlite(?:3)?(?:-wal|-shm)?$|(?:^|[\\/])(?:current|runtime)\.json$|(?:^|[\\/])archives[\\/]|backup[^\\/]*\.json$|\.py[co]?$|\.vbs$|\.lnk$)/i);
  }
});

test('all website JavaScript files parse without requiring a build step', () => {
  for (const file of filesIn(site).filter((name) => name.endsWith('.js'))) {
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(site, file) });
  }
});

test('application uses browser storage instead of a remote or localhost API', () => {
  const app = read('app.js');
  const storage = read('storage.js');
  assert.match(app, /StudyStore\.request/);
  assert.doesNotMatch(app, /fetch\s*\(\s*["'`](?:https?:\/\/|\/api\/)/);
  assert.doesNotMatch(storage, /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/);
  assert.match(storage, /library\.json/);
  assert.ok(!JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies);
});

test('install manifest remains scoped to the deployed project', () => {
  const manifestFile = filesIn(site).find((name) => name.endsWith('.webmanifest'));
  assert.ok(manifestFile, 'install manifest is included');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const property of ['start_url', 'scope', 'id']) {
    if (manifest[property] != null) {
      const resolved = new URL(manifest[property], 'https://example.github.io/study/manifest.webmanifest');
      assert.equal(resolved.origin, 'https://example.github.io');
      assert.ok(resolved.pathname.startsWith('/study/'), `${property} must remain within /study/`);
    }
  }
  for (const icon of manifest.icons || []) checkRelativeAsset(icon.src, path.relative(site, manifestFile));
});

test('homepage retains original resources and the standalone study page remains available', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const links = [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const retainedLinks = [
    './style.css', 'https://github.com/', 'https://z-library.sk/', 'https://csdiy.wiki/',
    'https://fudan-nlp.feishu.cn/wiki/WFifwXxfQiI3PKkn9FEcy0wKnjh/',
    'https://space.bilibili.com/104490454', 'https://github.com/TEraby-E',
    'https://codeforces.com/profile/_Eraby_E', 'https://bgm.tv/user/terabyte'
  ];
  for (const reference of retainedLinks) assert.ok(links.includes(reference), `homepage retains ${reference}`);
  assert.match(html, /\.\/Assets\/Images\/Aegleseeker\.jpg/);
  assert.match(html, /\.\/Assets\/Icons\/terabyte-flow\.svg/);
  assert.ok(fs.existsSync(path.join(site, 'index.html')), 'standalone study page remains available');
  assert.match(read('index.html'), /href=["']\.\.\/["']/);
  assert.equal(fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim(), 'terabyte.top');
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (reference.startsWith('#') || /^(?:https?:|data:|mailto:|tel:)/i.test(reference)) continue;
    assert.ok(!reference.startsWith('/'), `homepage asset ${reference} uses a relative path`);
    assert.ok(fs.existsSync(path.resolve(root, reference.split(/[?#]/, 1)[0])), `homepage asset ${reference} exists`);
  }
});

test('deployment publishes an explicit homepage/study payload with the existing domain', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /branches:\s*\[main, master\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /name:\s*github-pages/);
  assert.match(workflow, /cp index\.html style\.css CNAME \.nojekyll _site\//);
  assert.match(workflow, /cp -R Assets study _site\//);
  assert.match(workflow, /path:\s*_site(?:\s|$)/);
  assert.match(workflow, /steps\.deployment\.outputs\.page_url/);
  assert.match(workflow, /run:\s*npm test/);
});
