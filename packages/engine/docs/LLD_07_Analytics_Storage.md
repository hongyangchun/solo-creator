# LLD-07: 数据复盘流与本地存储后端详细设计 (Analytics & Storage Backend)

---

## 1. 模块定位与职责边界

### 1.1 模块定位
数据复盘流与本地存储后端是整个系统的**“记忆中枢与进化引擎”**。它负责：
1. **本地数据绝对主权**：基于 SQLite 单文件数据库，持久化存储素材雷达、母稿、多端草稿状态与历史指标；
2. **多端数据自动回访抓取**：定时回访微信公众号、小红书、X 后台，抓取发布 24~48 小时后的真实完播率、阅读量、点赞与收藏数据；
3. **Persona 风格自进化闭环**：通过归因分析高转化内容与平庸内容的差异，反向自动更新本地 `persona_memory` 表和提示词模板。

---

## 2. 核心架构与复盘自进化数据流

```
┌────────────────────────────────────────────────────────┐
│     ctx.jobs 定时任务 / AnalyticsScheduler (每日 23:00)  │
└───────────────────────────┬────────────────────────────┘
                            │ 扫描已发布的草稿列表 (channel_dispatches)
                            ▼
┌────────────────────────────────────────────────────────┐
│   [XhsAnalyticsFetcher]  [WeChatMetrics] [XInsights]   │
└───────────────────────────┬────────────────────────────┘
                            │ 抓取阅读量、完播率、互动比
                            ▼
┌────────────────────────────────────────────────────────┐
│      SQLite 持久化 (post_analytics 性能表现表)          │
└───────────────────────────┬────────────────────────────┘
                            │ 触发归因分析引擎 (AttributionEngine)
                            ▼
┌────────────────────────────────────────────────────────┐
│ 提炼爆款 Hook 模式 ──► 自动更新 persona_memory 风格知识库 │
└────────────────────────────────────────────────────────┘
```

---

## 3. TypeScript 接口契约与数据模型

### 3.1 核心数据结构与接口

```typescript
export interface PostPerformanceMetrics {
  views: number;                 // 阅读量 / 展现量
  likes: number;                 // 点赞数
  comments: number;              // 评论数
  shares: number;                // 分享数
  collected?: number;            // 收藏数
  completionRate?: number;       // 完播率 / 读完率 (0 ~ 1.0)
  ctr?: number;                  // 点击率
}

export interface AnalyticsFetcherPlugin {
  readonly channel: ChannelType;
  readonly id: string;

  isAvailable(): Promise<boolean>;
  fetchMetrics(postOrDraftId: string): Promise<PostPerformanceMetrics>;
}
```

---

## 4. 存储层与 SQLite 数据访问实现 (`SQLiteStorage`)

```typescript
import Database from 'better-sqlite3';
import * as path from 'path';

export class SQLiteStorage {
  private db: Database.Database;

  constructor(dbPath: string = path.join(process.env.HOME || '.', '.solo-creator', 'solo_creator.db')) {
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

  // 存储母稿
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

  // 获取风格记忆
  getPersonaMemory(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM persona_memory WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  // 更新风格记忆
  setPersonaMemory(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO persona_memory (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
  }
}
```

---

## 5. 创作者风格归因与自进化算法 (`PersonaEvolutionEngine`)

```typescript
export class PersonaEvolutionEngine {
  constructor(private storage: SQLiteStorage, private llm: LlmAdapter) {}

  async runWeeklyEvolutionAnalysis(): Promise<void> {
    // 1. 读取最近 14 天发布的所有内容及其数据表现
    const recentPosts = this.getRecentPerformanceData();
    if (recentPosts.length < 5) return; // 样本不足则暂不更新

    // 2. 调用 LLM 进行表现归因分析
    const prompt = `
你是一位顶级新媒体增长科学家。请分析以下创作者近期发布的内容及其实际互动数据，找出最高转化模式与避坑点：

发布数据摘要:
${JSON.stringify(recentPosts, null, 2)}

请输出总结与反思：
1. 哪些标题 Hook / 开篇模式互动率最高？
2. 哪些内容结构完播率最好？
3. 哪些句式或风格容易让用户流失？

请输出纯 JSON:
{
  "bestHookPatterns": ["模式1", "模式2"],
  "highRetentionStructures": ["结构1"],
  "avoidRules": ["避坑规则1", "避坑规则2"]
}`;

    const res = await this.llm.chat([
      { role: 'system', content: 'You are a growth scientist. Respond in JSON only.' },
      { role: 'user', content: prompt }
    ], { responseFormat: 'json' });

    const insight = JSON.parse(res);

    // 3. 将提炼的高光模式沉淀入 SQLite persona_memory 表，供后续母稿生成时自动注入 System Prompt
    this.storage.setPersonaMemory('high_converting_hooks', JSON.stringify(insight.bestHookPatterns));
    this.storage.setPersonaMemory('negative_avoid_rules', JSON.stringify(insight.avoidRules));
  }

  private getRecentPerformanceData(): any[] {
    // 从数据库查询最近 14 天的母稿与关联指标
    return [];
  }
}
```

---

## 6. 本地凭据保险箱与敏感配置加密 (`LocalKeyVault`)

系统涉及大量平台密钥（微信 AppSecret、X API Token、各大 LLM Key）。**严禁将明文密钥存放在 SQLite 数据库或普通配置文件中**。系统优先利用操作系统底层钥匙串（macOS Keychain / Windows Credential Manager / Linux Secret Service），在无 GUI 环境下降级为 AES-256-GCM 派生加密。

### 6.1 凭据安全架构

```
┌────────────────────────────────────────────────────────┐
│               LocalKeyVault 统一凭据管理器              │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼ (平台支持 Keychain)        ▼ (无桌面密钥环 / 服务器环境)
     [OS 原生钥匙串 keytar]        [AES-256-GCM 本地加密保险箱]
     • macOS Keychain              • 基于用户机器指纹派生 Master Key
     • Windows Credential Manager  • PBKDF2 100,000 次哈希迭代
```

### 6.2 凭据保险箱核心实现

```typescript
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class LocalKeyVault {
  private vaultPath: string;
  private masterKey: Buffer;

  constructor(baseDir: string = path.join(process.env.HOME || '.', '.solo-creator')) {
    this.vaultPath = path.join(baseDir, 'vault.enc');
    // 基于机器唯一特征派生本地保护主密钥
    const machineFingerprint = `${process.env.USER || 'user'}:${process.arch}:${process.platform}`;
    this.masterKey = crypto.pbkdf2Sync(machineFingerprint, 'solo-creator-salt-2026', 100000, 32, 'sha256');
  }

  // 加密并存储凭据
  setSecret(key: string, secretValue: string): void {
    const secrets = this.loadAllSecrets();
    secrets[key] = secretValue;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    
    let encrypted = cipher.update(JSON.stringify(secrets), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const payload = JSON.stringify({
      iv: iv.toString('hex'),
      authTag,
      data: encrypted
    });

    fs.mkdirSync(path.dirname(this.vaultPath), { recursive: true });
    fs.writeFileSync(this.vaultPath, payload, 'utf8');
  }

  // 解密并读取凭据
  getSecret(key: string): string | null {
    const secrets = this.loadAllSecrets();
    return secrets[key] || null;
  }

  private loadAllSecrets(): Record<string, string> {
    if (!fs.existsSync(this.vaultPath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf8');
      const { iv, authTag, data } = JSON.parse(raw);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (err) {
      console.error('[LocalKeyVault] 凭据解密失败或损坏，将重置为空保险箱');
      return {};
    }
  }
}
```

---

## 7. 存储备份与迁移考量

1. **单文件零依赖备份**：
   * SQLite 数据库单一文件存储于 `~/.solo-creator/solo_creator.db`，直接复制即可完成整库迁移备份；
2. **纯 Markdown 镜像输出**：
   * 所有生成的母稿与各端 Payload 均在本地 `~/.solo-creator/posts/YYYY-MM-DD/` 生成纯 Markdown 副本，与 Git / Obsidian 无缝互通；
3. **敏感凭据与数据隔离**：
   * 数据库仅存放发布记录与公开指标，所有 Token/Secret 全程隔离于 `vault.enc` 或系统 Keychain 中，避免备份数据库造成敏感信息泄露。
