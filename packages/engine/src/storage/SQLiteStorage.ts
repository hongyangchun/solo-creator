import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { MasterPost, ChannelType, UnifiedPayload, RawIdeaPayload } from '../types';

export class SQLiteStorage {
  private db: Database.Database;

  constructor(dbPath: string = path.join(process.env.HOME || '.', '.solo-creator', 'solo_creator.db')) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS radar_items (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        author TEXT,
        raw_content TEXT,
        viral_score REAL DEFAULT 0,
        status TEXT DEFAULT 'unread',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS master_posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        raw_idea TEXT,
        master_markdown TEXT NOT NULL,
        hook_candidates JSON,
        status TEXT DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS channel_dispatches (
        id TEXT PRIMARY KEY,
        master_id TEXT NOT NULL REFERENCES master_posts(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        payload_type TEXT NOT NULL,
        payload_json JSON NOT NULL,
        driver_used TEXT,
        dispatch_status TEXT DEFAULT 'pending',
        draft_id TEXT,
        preview_url TEXT,
        error_log TEXT,
        dispatched_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS post_analytics (
        id TEXT PRIMARY KEY,
        dispatch_id TEXT NOT NULL REFERENCES channel_dispatches(id) ON DELETE CASCADE,
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        collected INTEGER DEFAULT 0,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS persona_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_post_analytics_dispatch ON post_analytics(dispatch_id);
    `);
  }

  saveMasterPost(master: MasterPost): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO master_posts (id, title, raw_idea, master_markdown, hook_candidates, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(
      master.id,
      master.title,
      master.rawIdea,
      master.masterMarkdown,
      JSON.stringify(master.hookCandidates),
      'draft'
    );
  }

  getMasterPost(id: string): MasterPost | null {
    const row = this.db.prepare('SELECT * FROM master_posts WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      rawIdea: row.raw_idea,
      masterMarkdown: row.master_markdown,
      hookCandidates: JSON.parse(row.hook_candidates || '[]'),
      keyTakeaways: [],
      suggestedTags: [],
      createdAt: row.created_at
    };
  }

  saveDispatchRecord(record: {
    id: string;
    masterId: string;
    channel: ChannelType;
    payloadType: string;
    payloadJson: string;
    driverUsed?: string;
    status: string;
    draftId?: string;
    previewUrl?: string;
    errorLog?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO channel_dispatches (id, master_id, channel, payload_type, payload_json, driver_used, dispatch_status, draft_id, preview_url, error_log, dispatched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(
      record.id,
      record.masterId,
      record.channel,
      record.payloadType,
      record.payloadJson,
      record.driverUsed || 'cdp',
      record.status,
      record.draftId || null,
      record.previewUrl || null,
      record.errorLog || null
    );
  }

  getDispatchRecord(masterId: string, channel: ChannelType): any | null {
    return this.db.prepare('SELECT * FROM channel_dispatches WHERE master_id = ? AND channel = ?').get(masterId, channel);
  }

  getPersonaMemory(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM persona_memory WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setPersonaMemory(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO persona_memory (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
  }

  // ===== GUI engineServer 增量查询（Spec §2.3，只读/追加，不改既有逻辑）=====

  listMasterPosts(page = 1, pageSize = 20): { total: number; items: any[] } {
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM master_posts').get() as any).c;
    const rows = this.db
      .prepare('SELECT id, title, raw_idea, status, created_at, updated_at FROM master_posts ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize);
    return { total, items: rows as any[] };
  }

  updateMasterPost(id: string, patch: { title?: string; masterMarkdown?: string }): boolean {
    const current = this.getMasterPost(id);
    if (!current) return false;
    const stmt = this.db.prepare(
      'UPDATE master_posts SET title = ?, master_markdown = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    stmt.run(patch.title ?? current.title, patch.masterMarkdown ?? current.masterMarkdown, id);
    return true;
  }

  deleteMasterPost(id: string): boolean {
    const res = this.db.prepare('DELETE FROM master_posts WHERE id = ?').run(id);
    return res.changes > 0;
  }

  getDispatchesByMaster(masterId: string): any[] {
    return this.db.prepare('SELECT * FROM channel_dispatches WHERE master_id = ? ORDER BY dispatched_at DESC').all(masterId) as any[];
  }

  getDispatchById(dispatchId: string): any | null {
    return this.db.prepare('SELECT * FROM channel_dispatches WHERE id = ?').get(dispatchId) ?? null;
  }

  listAllDispatches(limit = 200): any[] {
    return this.db.prepare('SELECT * FROM channel_dispatches ORDER BY dispatched_at DESC LIMIT ?').all(limit) as any[];
  }

  // ===== Analytics Retro MVP（dispatch 驱动 LEFT JOIN，禁止触发 publish）=====

  upsertPostAnalytics(
    dispatchId: string,
    metrics: { views: number; likes: number; comments: number; shares: number; collected: number },
    analyticsId?: string
  ): {
    dispatchId: string;
    masterId: string;
    channel: string;
    title: string;
    publishedAt: string | null;
    metrics: { views: number; likes: number; comments: number; shares: number; collected: number };
    fetchedAt: string | null;
    analyticsId: string | null;
  } | null {
    const dispatch = this.getDispatchById(dispatchId);
    if (!dispatch) return null;

    const existing = this.db
      .prepare('SELECT id FROM post_analytics WHERE dispatch_id = ? ORDER BY fetched_at DESC LIMIT 1')
      .get(dispatchId) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE post_analytics
           SET views = ?, likes = ?, comments = ?, shares = ?, collected = ?, fetched_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(metrics.views, metrics.likes, metrics.comments, metrics.shares, metrics.collected, existing.id);
    } else {
      const id = analyticsId || `A-${Date.now()}`;
      this.db
        .prepare(
          `INSERT INTO post_analytics (id, dispatch_id, views, likes, comments, shares, collected, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        )
        .run(id, dispatchId, metrics.views, metrics.likes, metrics.comments, metrics.shares, metrics.collected);
    }

    const item = this.getAnalyticsByDispatch(dispatchId);
    if (!item || !item.metrics) return null;
    return { ...item, metrics: item.metrics };
  }

  getAnalyticsByDispatch(dispatchId: string): {
    dispatchId: string;
    masterId: string;
    channel: string;
    title: string;
    publishedAt: string | null;
    metrics: { views: number; likes: number; comments: number; shares: number; collected: number } | null;
    fetchedAt: string | null;
    analyticsId: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT
           cd.id AS dispatch_id,
           cd.master_id AS master_id,
           cd.channel AS channel,
           cd.dispatched_at AS published_at,
           mp.title AS title,
           pa.id AS analytics_id,
           pa.views AS views,
           pa.likes AS likes,
           pa.comments AS comments,
           pa.shares AS shares,
           pa.collected AS collected,
           pa.fetched_at AS fetched_at
         FROM channel_dispatches cd
         LEFT JOIN master_posts mp ON mp.id = cd.master_id
         LEFT JOIN post_analytics pa ON pa.id = (
           SELECT id FROM post_analytics WHERE dispatch_id = cd.id ORDER BY fetched_at DESC LIMIT 1
         )
         WHERE cd.id = ?`
      )
      .get(dispatchId) as any;

    if (!row) return null;
    return this.mapAnalyticsRow(row);
  }

  listAnalyticsJoined(limit = 200): {
    total: number;
    items: Array<{
      dispatchId: string;
      masterId: string;
      channel: string;
      title: string;
      publishedAt: string | null;
      metrics: { views: number; likes: number; comments: number; shares: number; collected: number } | null;
      fetchedAt: string | null;
      analyticsId: string | null;
    }>;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM channel_dispatches').get() as any).c as number;
    const rows = this.db
      .prepare(
        `SELECT
           cd.id AS dispatch_id,
           cd.master_id AS master_id,
           cd.channel AS channel,
           cd.dispatched_at AS published_at,
           mp.title AS title,
           pa.id AS analytics_id,
           pa.views AS views,
           pa.likes AS likes,
           pa.comments AS comments,
           pa.shares AS shares,
           pa.collected AS collected,
           pa.fetched_at AS fetched_at
         FROM channel_dispatches cd
         LEFT JOIN master_posts mp ON mp.id = cd.master_id
         LEFT JOIN post_analytics pa ON pa.id = (
           SELECT id FROM post_analytics WHERE dispatch_id = cd.id ORDER BY fetched_at DESC LIMIT 1
         )
         ORDER BY COALESCE(cd.dispatched_at, '') DESC
         LIMIT ?`
      )
      .all(limit) as any[];

    return { total, items: rows.map((row) => this.mapAnalyticsRow(row)) };
  }

  refreshAnalyticsPlaceholder(dispatchId: string): {
    dispatchId: string;
    masterId: string;
    channel: string;
    title: string;
    publishedAt: string | null;
    metrics: { views: number; likes: number; comments: number; shares: number; collected: number } | null;
    fetchedAt: string | null;
    analyticsId: string | null;
    mode: 'placeholder';
    created: boolean;
  } | null {
    const dispatch = this.getDispatchById(dispatchId);
    if (!dispatch) return null;

    const existing = this.db
      .prepare('SELECT id FROM post_analytics WHERE dispatch_id = ? ORDER BY fetched_at DESC LIMIT 1')
      .get(dispatchId) as { id: string } | undefined;

    let created = false;
    if (!existing) {
      const id = `A-${Date.now()}`;
      this.db
        .prepare(
          `INSERT INTO post_analytics (id, dispatch_id, views, likes, comments, shares, collected, fetched_at)
           VALUES (?, ?, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP)`
        )
        .run(id, dispatchId);
      created = true;
    } else {
      this.db
        .prepare('UPDATE post_analytics SET fetched_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(existing.id);
    }

    const item = this.getAnalyticsByDispatch(dispatchId);
    if (!item) return null;
    return { ...item, mode: 'placeholder', created };
  }

  private mapAnalyticsRow(row: any): {
    dispatchId: string;
    masterId: string;
    channel: string;
    title: string;
    publishedAt: string | null;
    metrics: { views: number; likes: number; comments: number; shares: number; collected: number } | null;
    fetchedAt: string | null;
    analyticsId: string | null;
  } {
    const hasAnalytics = row.analytics_id != null;
    return {
      dispatchId: row.dispatch_id,
      masterId: row.master_id,
      channel: row.channel,
      title: row.title || '',
      publishedAt: row.published_at ?? null,
      metrics: hasAnalytics
        ? {
            views: Number(row.views) || 0,
            likes: Number(row.likes) || 0,
            comments: Number(row.comments) || 0,
            shares: Number(row.shares) || 0,
            collected: Number(row.collected) || 0
          }
        : null,
      fetchedAt: hasAnalytics ? row.fetched_at ?? null : null,
      analyticsId: hasAnalytics ? row.analytics_id : null
    };
  }

  close(): void {
    this.db.close();
  }
}
