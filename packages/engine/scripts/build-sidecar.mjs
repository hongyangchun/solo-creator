/**
 * Sidecar 构建脚本：
 * 1) esbuild 打包 engineServer.ts → 单文件 engine-server.js（external: better-sqlite3 / playwright）
 * 2) 复制 Node 运行时二进制 → node-<triple>（供 tauri externalBin sidecar 声明）
 * 3) 复制原生模块与运行时 node_modules → binaries/resources/
 * 用法：node scripts/build-sidecar.mjs
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(here, '..');
const guiDir = path.resolve(engineDir, '../gui/src-tauri');
const binariesDir = path.join(guiDir, 'binaries');
const resourcesDir = path.join(binariesDir, 'resources');

fs.mkdirSync(resourcesDir, { recursive: true });

// 1) bundle engine-server.js
await build({
  entryPoints: [path.join(engineDir, 'src/server/engineServer.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(resourcesDir, 'engine-server.cjs'),
  external: ['better-sqlite3', 'playwright', 'playwright-core'],
  minify: false,
  sourcemap: false
});
console.log('[sidecar] engine-server.js built');

// 2) Node 运行时（dev 态用软链指向当前 node；打包态由 CI 替换为独立 Node 20 分发二进制）
const triple = execSync('rustc -vV | grep host | awk \'{print $2}\'').toString().trim();
const nodeBin = process.execPath;
const nodeTarget = path.join(binariesDir, `node-${triple}`);
try {
  fs.symlinkSync(nodeBin, nodeTarget, 'file');
  console.log(`[sidecar] node-${triple} -> ${nodeBin} (symlink, dev)`);
} catch {
  console.log(`[sidecar] node-${triple} 已存在`);
}

// 3) 运行时 node_modules（better-sqlite3 原生绑定 + playwright）
const runtimeDeps = ['better-sqlite3', 'playwright', 'playwright-core'];
const destModules = path.join(resourcesDir, 'node_modules');
fs.mkdirSync(destModules, { recursive: true });
for (const dep of runtimeDeps) {
  const src = path.join(engineDir, 'node_modules', dep);
  const dst = path.join(destModules, dep);
  if (!fs.existsSync(src)) {
    console.warn(`[sidecar] 警告: ${dep} 不在 engine node_modules，跳过`);
    continue;
  }
  if (fs.existsSync(dst)) {
    console.log(`[sidecar] ${dep} 已存在，跳过复制`);
    continue;
  }
  fs.cpSync(src, dst, { recursive: true });
  console.log(`[sidecar] copied ${dep}`);
}

console.log('[sidecar] done ->', binariesDir);
