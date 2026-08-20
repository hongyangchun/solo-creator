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
  }): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO channel_dispatches (id, master_id, channel, payload_type, payload_json, driver_used, dispatch_status, draft_id, preview_url, dispatched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      record.previewUrl || null
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

  close(): void {
    this.db.close();
  }
}
