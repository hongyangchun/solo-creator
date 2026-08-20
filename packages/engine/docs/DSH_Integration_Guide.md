# DSH (DeepSeek Harness) 深度对接与集成规范

> 状态：已锁定  
> 适用：DeepSeek Harness (Cordis 微内核架构) / Standalone CLI / WorkBuddy 技能体系

---

## 1. 系统与 DSH 的关系定位：脑体解耦 (Hexagonal Architecture)

在 SoloCreator Content OS 中，**DSH (DeepSeek Harness) 是系统的“大脑中枢与调度容器”，而 SoloCreator 核心是“专业领域引擎与手脚执行器”**。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DSH (DeepSeek Harness) 宿主层                   │
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │   DSH 智能对话大脑    │  │  ctx.jobs 定时器 │  │ ctx.tools 工具总线│  │
│  │ (Prompt Loop / Agent)│  │ (每日雷达/复盘)  │  │ (向 LLM 暴露能力)│  │
│  └──────────┬───────────┘  └────────┬─────────┘  └────────┬─────────┘  │
└─────────────┼───────────────────────┼─────────────────────┼────────────┘
              │                       │                     │
              ▼                       ▼                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│               DSH 胶水层适配器 (dsh-plugin-solo-creator.ts)              │
│      • 实现 DSH 标准 Plugin 契约 (apply(ctx: Context, config))          │
│      • 声明 DSH 依赖注入服务 (declare module '@dsh/core' { ... })      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 调用独立业务域 API
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  SoloCreator Content OS 核心业务域 (零 DSH 依赖)         │
│                                                                        │
│   [MasterCriticEngine] ──► [TranspilerMatrix] ──► [LocalCardRenderer]   │
│            │                                              │            │
│            ▼                                              ▼            │
│    [LocalKeyVault 凭据]                             [CDP 草稿发布驱动]   │
└────────────────────────────────────────────────────────────────────────┘
```

### 为什么采用这种解耦设计？
1. **防止 DSH 快速迭代破坏业务逻辑**：DSH 处于高速演进期，若核心业务与 DSH 深度耦合，任何 DSH API 变更都会导致整个自媒体系统重构；
2. **支持双模自由切换**：
   * **DSH 模式**：作为 DSH 插件运行，支持在 DSH 对话框用自然语言驱动、支持 DSH 定时触发；
   * **独立模式 (Standalone)**：脱离 DSH 时，可直接作为独立 CLI 命令行工具或本地 Web 独立运行。

---

## 2. DSH 插件端对端对接实现 (`dsh-plugin-solo-creator.ts`)

以下为对接 DSH Cordis 微内核的标准插件实现代码（仅约 60 行胶水层）：

```typescript
import { Context, Service } from '@dsh/core';
import { SoloCreatorCore } from './core/SoloCreatorCore';
import { MasterPost, UnifiedPayload } from './types';

// 1. 扩展 DSH Context 服务类型定义
declare module '@dsh/core' {
  interface Context {
    soloCreator: SoloCreatorCore;
  }
}

export interface SoloCreatorPluginConfig {
  dbPath?: string;
  cdpEndpoint?: string;
  enableDailyRadar?: boolean;
  radarCron?: string; // 默认 '0 9 * * *' (每天上午 9 点)
}

export const name = 'dsh-plugin-solo-creator';

// 2. DSH 插件标准入口
export function apply(ctx: Context, config: SoloCreatorPluginConfig = {}) {
  // A. 实例化并向 DSH IoC 容器注册核心单例服务
  const core = new SoloCreatorCore({
    dbPath: config.dbPath,
    cdpEndpoint: config.cdpEndpoint
  });
  ctx.provide('soloCreator', core);

  // B. 向 DSH Agent 注册 Function Calling 工具 (Tools)
  ctx.tools.register({
    name: 'generate_social_master_post',
    description: '根据原始灵感或热点素材，生成包含 5 种黄金 Hook 并经过“去 AI 味”质检的高转化自媒体母稿',
    parameters: {
      type: 'object',
      properties: {
        rawIdea: { type: 'string', description: '原始灵感或观点' },
        targetAudience: { type: 'string', description: '目标读者群体' },
        topic: { type: 'string', description: '话题标签' }
      },
      required: ['rawIdea']
    },
    execute: async (args) => {
      const masterPost = await core.masterService.createMasterPost(args.rawIdea);
      return {
        masterId: masterPost.id,
        title: masterPost.title,
        hooks: masterPost.hookCandidates,
        contentPreview: masterPost.masterMarkdown.slice(0, 300) + '...'
      };
    }
  });

  ctx.tools.register({
    name: 'transpile_and_save_to_drafts',
    description: '将指定母稿转译为微信长图文/小红书卡片/X推文，并安全直塞官方后台草稿箱',
    parameters: {
      type: 'object',
      properties: {
        masterId: { type: 'string', description: '母稿 ID' },
        channels: {
          type: 'array',
          items: { type: 'string', enum: ['wechat', 'xiaohongshu', 'x', 'weibo'] },
          description: '目标渠道列表'
        },
        theme: { type: 'string', description: '视觉卡片主题，如 minimal_dark / notion_light' }
      },
      required: ['masterId', 'channels']
    },
    execute: async (args) => {
      const results = await core.publisherService.dispatchMasterPost(args.masterId, args.channels, {
        theme: args.theme
      });
      return {
        summary: `已成功转译并直塞 ${results.filter(r => r.success).length} 个渠道草稿箱`,
        details: results
      };
    }
  });

  // C. 注册 DSH 定时后台作业 (ctx.jobs)
  if (config.enableDailyRadar) {
    ctx.jobs.cron(config.radarCron || '0 9 * * *', async () => {
      ctx.logger.info('[SoloCreator] 正在触发每日 X 500+ 高赞爆款雷达扫描...');
      const items = await core.radarService.scanDailyViralPosts();
      ctx.logger.info(`[SoloCreator] 今日捕获 ${items.length} 篇高赞素材，已存入本地 SQLite。`);
    });
  }

  ctx.logger.info('🚀 SoloCreator Content OS 插件已成功载入 DSH 运行时！');
}
```

---

## 3. DSH 环境下的用户交互体验

在 DSH 对话界面中，创作者可以直接用自然语言驱动整个流水线：

* **交互示例 1（素材与母稿）**：
  > **用户**：“看看今天 X 上关于 Claude 3.7 的高赞帖子，选最火的一个帮我写一篇母稿。”  
  > **DSH Agent**：调用 `soloCreator.radar` 获取帖子 ──► 调用 `generate_social_master_post` 产出 5 组 Hook + 去 AI 味正文。

* **交互示例 2（多端转译与草稿直塞）**：
  > **用户**：“母稿选第 2 个 Hook，帮我转译成微信公众号和小红书卡片，直接存入草稿箱。”  
  > **DSH Agent**：调用 `transpile_and_save_to_drafts` ──► 本地无头浏览器秒级渲染 3:4 卡片 ──► CDP 直塞微信与小红书草稿箱 ──► 返回草稿箱预览链接与扫码状态。
