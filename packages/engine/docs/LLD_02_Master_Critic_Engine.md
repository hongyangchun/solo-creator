# LLD-02: 母稿展开与去 AI 味质检引擎详细设计 (Master & Critic Engine)

---

## 1. 模块定位与职责边界

### 1.1 模块定位
母稿展开与去 AI 味质检引擎是整个内容流水线的**“大脑与质检总监”**。它负责：
1. **结构化母稿展开**：将简短的闪念、语音速记或原始素材，依据严谨的自媒体叙事框架（痛点-机制-解法-案例-金句）展开为高质量的 Master Markdown；
2. **多道 Critic 质检流水线**：插拔式执行去 AI 味重写、广告法与敏感词合规审查、事实核验；
3. **黄金 3 秒 Hook 矩阵生成**：为同一篇母稿生成 5 个不同心理切入点的标题与开篇第一句。

---

## 2. 核心架构与质检流水线时序

```
[原始闪念 / 语音速记 RawIdea]
            │
            ▼
┌────────────────────────────────────────┐
│   MasterContentService.expandMaster()  │ ──► 结合创作者 Persona 提示词
└───────────────────┬────────────────────┘
                    │ 生成初版 MasterMarkdown
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       CriticPipeline (质检审查流水线)                   │
├────────────────────────────────────────────────────────────────────────┤
│ 1. critic-humanizer-zh ──► 扫描并替换 8 大类典型中文 AI 八股套话       │
│ 2. critic-ad-compliance ──► 扫描广告法极限词与平台限流敏感词           │
│ 3. critic-fact-checker ──► 核验引用数据与外链真实有效性               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   HookGeneratorService.generateHooks()                 │
│                   · 颠覆型 · 焦虑唤醒型 · 极简解法型 · 好奇揭秘型       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       [交付标准 MasterPost 对象，存入 SQLite (master_posts)]
```

---

## 3. TypeScript 接口契约与数据模型

### 3.1 核心数据结构 (`MasterPost`)

```typescript
export interface HookCandidate {
  id: string;
  type: 'counter_intuitive' | 'curiosity' | 'pain_direct' | 'story_intro' | 'contrarian';
  title: string;                 // 标题 Hook
  firstSentence: string;         // 第一句话 Hook
  estimatedEngagementScore: number; // 预估吸引力评分 (0 ~ 100)
}

export interface MasterPost {
  id: string;                    // UUID
  title: string;                 // 默认选定的主标题
  rawIdea: string;               // 输入的原始闪念
  masterMarkdown: string;        // 经过质检与去AI味修复后的母稿 Markdown
  hookCandidates: HookCandidate[]; // 5 个黄金 Hook 备选项
  selectedHookId: string;
  criticScore: number;           // 综合质量评分 (0 ~ 100)
  criticReport: CriticReport;    // 详细质检报告
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.2 质检插件规范 (`CriticRulePlugin`)

```typescript
export interface CriticIssue {
  ruleId: string;
  type: 'ai_flavor' | 'compliance_violation' | 'weak_hook' | 'fact_error';
  severity: 'warning' | 'error';
  message: string;
  matchedText?: string;
  suggestedFix?: string;
}

export interface CriticReport {
  passed: boolean;
  overallScore: number;
  issues: CriticIssue[];
}

export interface CriticRulePlugin {
  readonly id: string;           // 例如 'critic-humanizer-zh'
  readonly name: string;
  readonly priority: number;

  /**
   * 检查并可选提供自动修复后的文本
   */
  inspectAndRepair(content: string, context?: any): Promise<{
    issues: CriticIssue[];
    repairedContent: string;
  }>;
}
```

---

## 4. 核心实现与算法细节

### 4.1 中文去 AI 味引擎 (`HumanizerZhCritic`)

针对大语言模型常见的八股化语言特征进行多重规则与语义重写：

```typescript
export class HumanizerZhCritic implements CriticRulePlugin {
  readonly id = 'critic-humanizer-zh';
  readonly name = '中文去 AI 八股腔质检器';
  readonly priority = 1;

  // 严禁出现的典型 AI 词汇与套话模式
  private static FORBIDDEN_PATTERNS = [
    /总而言之[，,]?/g,
    /综上所述[，,]?/g,
    /宛如一把双刃剑/g,
    /值得注意的是[，,]?/g,
    /不可否认的是[，,]?/g,
    /显而易见[，,]?/g,
    /在这个数字化\/AI时代[，,]?/g,
    /不仅如此[，,]还/g,
    /犹如一座灯塔/g
  ];

  async inspectAndRepair(content: string): Promise<{ issues: CriticIssue[]; repairedContent: string }> {
    const issues: CriticIssue[] = [];
    let repaired = content;

    // 1. 正则快速初筛与硬替换
    for (const pattern of HumanizerZhCritic.FORBIDDEN_PATTERNS) {
      if (pattern.test(repaired)) {
        issues.push({
          ruleId: this.id,
          type: 'ai_flavor',
          severity: 'warning',
          message: `命中典型 AI 八股短语: ${pattern.source}`
        });
        repaired = repaired.replace(pattern, '');
      }
    }

    // 2. 启发式标点与句式修正 (修复过度破折号与空洞排比)
    repaired = repaired.replace(/——/g, '，');

    return { issues, repairedContent: repaired };
  }
}
```

---

### 4.2 黄金 3 秒 Hook 矩阵生成器 (`HookGeneratorService`)

```typescript
export class HookGeneratorService {
  constructor(private llm: LlmAdapter) {}

  async generate5Hooks(markdown: string): Promise<HookCandidate[]> {
    const prompt = `
请阅读以下文章母稿，为其生成 5 个不同心理学切入点的黄金 3 秒标题和开篇第一句：

文章正文摘要:
${markdown.slice(0, 1000)}

切入点类型规范：
1. counter_intuitive (反直觉/颠覆常规认知)
2. curiosity (极度好奇/信息缺口)
3. pain_direct (直击核心痛点/制造紧迫感)
4. story_intro (生活化第一人称场景切入)
5. contrarian (逆向思维/反对大众共识)

请严格输出 JSON 数组，格式如下：
[
  {
    "id": "hook-1",
    "type": "counter_intuitive",
    "title": "标题文本",
    "firstSentence": "第一句话文本",
    "estimatedEngagementScore": 92
  }
]`;

    const res = await this.llm.chat([
      { role: 'system', content: 'You are an elite viral headline copywriter. Respond in JSON array only.' },
      { role: 'user', content: prompt }
    ], { responseFormat: 'json' });

    return JSON.parse(res);
  }
}
```

---

## 5. 异常处理与质量门禁

1. **质检未达标阻断 (Quality Gate)**：
   * 如果 `CriticReport.overallScore < 75` 或存在严重合规违禁词，系统标记为 `status = 'need_manual_review'`，阻止自动向多端转译；
2. **自动修复重试机制**：
   * 支持调用 LLM 将带有 `CriticIssue` 批注的草稿重新精修一次（最多 2 轮反思循环），若依然不达标再通知创作者。
