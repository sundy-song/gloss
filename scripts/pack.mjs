#!/usr/bin/env node
// 打成可发布的扩展包：dist/gloss-<version>.zip
// 只放运行时需要的文件；测试、文档、截图一律不进包。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const name = `gloss-${version}`;
const distDir = path.join(root, 'dist');
const stage = path.join(distDir, name);

const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'annotate.js',
  'offscreen.html',
  'offscreen.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'export.html',
  'export.css',
  'export.js',
  'LICENSE'
];
const DIRS = ['lib', 'icons'];

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const file of FILES) {
  fs.copyFileSync(path.join(root, file), path.join(stage, file));
}
for (const dir of DIRS) {
  fs.cpSync(path.join(root, dir), path.join(stage, dir), { recursive: true });
}

// 安全兜底：包里绝不能出现密钥/签名文件
const banned = /\.(crx|pem|key|p12|pfx)$|(^|\/)\.(git|env)/i;
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
const staged = walk(stage);
const bad = staged.filter((file) => banned.test(path.relative(stage, file)));
if (bad.length) {
  console.error('包里出现不该有的文件：', bad.map((f) => path.relative(stage, f)).join(', '));
  process.exit(1);
}

// 清单里引用的文件必须都在
const referenced = new Set();
const collect = (value) => {
  if (typeof value === 'string' && /\.(js|css|html|png)$/.test(value)) referenced.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
};
collect(manifest);
const missing = [...referenced].filter((file) => !staged.includes(path.join(stage, file)));
if (missing.length) {
  console.error('清单引用了不存在的文件：', missing.join(', '));
  process.exit(1);
}

const zip = path.join(distDir, `${name}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', `${name}.zip`, name], { cwd: distDir });

const size = fs.statSync(zip).size;
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`已打包 ${path.relative(root, zip)}`);
console.log(`  v${version} · ${staged.length} 个文件 · ${kb(size)}`);
console.log(`  清单引用 ${referenced.size} 个文件，全部存在`);
