#!/usr/bin/env node
/**
 * 开发/验收：对已有 channel_dispatches 灌入样例 post_analytics 指标。
 * 用法：node packages/engine/scripts/seed-analytics.mjs
 * 默认 DB：~/.solo-creator/solo_creator.db
 * 可选：SOLO_DB_PATH=/path/to.db node ...
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const dbPath =
  process.env.SOLO_DB_PATH ||
  path.join(process.env.HOME || os.homedir(), '.solo-creator', 'solo_creator.db');

if (!fs.existsSync(dbPath)) {
  console.error(`[seed-analytics] 数据库不存在: ${dbPath}`);
  console.error('请先通过 GUI/CLI 创建母稿并分发，或确认 SOLO_DB_PATH。');
  process.exit(1);
}

const db = new Database(dbPath);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_post_analytics_dispatch ON post_analytics(dispatch_id)`);

const dispatches = db
  .prepare('SELECT id, channel FROM channel_dispatches ORDER BY dispatched_at DESC')
  .all();

if (!dispatches.length) {
  console.log('[seed-analytics] 当前没有任何 channel_dispatches，无需灌数。请先发布草稿产生分发记录。');
  db.close();
  process.exit(0);
}

const samples = [
  { views: 1200, likes: 88, comments: 12, shares: 5, collected: 30 },
  { views: 860, likes: 64, comments: 9, shares: 3, collected: 21 },
  { views: 430, likes: 22, comments: 4, shares: 1, collected: 8 },
  { views: 2100, likes: 150, comments: 28, shares: 17, collected: 55 },
  { views: 95, likes: 7, comments: 1, shares: 0, collected: 2 }
];

const selectExisting = db.prepare(
  'SELECT id FROM post_analytics WHERE dispatch_id = ? ORDER BY fetched_at DESC LIMIT 1'
);
const updateStmt = db.prepare(
  `UPDATE post_analytics
   SET views = ?, likes = ?, comments = ?, shares = ?, collected = ?, fetched_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);
const insertStmt = db.prepare(
  `INSERT INTO post_analytics (id, dispatch_id, views, likes, comments, shares, collected, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
);

let upserted = 0;
for (let i = 0; i < dispatches.length; i++) {
  const d = dispatches[i];
  const metrics = samples[i % samples.length];
  const existing = selectExisting.get(d.id);
  if (existing) {
    updateStmt.run(metrics.views, metrics.likes, metrics.comments, metrics.shares, metrics.collected, existing.id);
  } else {
    insertStmt.run(
      `A-${Date.now()}-${i}`,
      d.id,
      metrics.views,
      metrics.likes,
      metrics.comments,
      metrics.shares,
      metrics.collected
    );
  }
  upserted += 1;
  console.log(`  ✓ ${d.id} (${d.channel}) → views=${metrics.views}`);
}

db.close();
console.log(`[seed-analytics] 完成：对 ${upserted} 条 dispatch 写入样例指标 → ${dbPath}`);
