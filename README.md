# SoloCreator Content OS

> 专为自媒体与个人创作者打造的本地优先、极度模块化、直塞官方草稿箱的内容生产与多端分发系统。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg)](https://nodejs.org/)

---

## 核心设计理念

1. **六边形解耦架构**：业务核心（母稿生成、去 AI 味质检、多端排版转译、本地视网膜卡片渲染）与 DSH / 命令行 / Web 宿主环境 100% 正交解耦。
2. **草稿箱优先安全界**：坚守“AI 负责前 95% 脏活，人类保留最后 5% 扳机确认”，自动直塞官方后台草稿箱，彻底规避封号与合规风险。
3. **统一内容契约 (Unified Payloads)**：定义 `ArticlePayload`、`CardFlowPayload`、`ThreadPayload`、`ShortTextPayload`，实现内容转译与平台发布的正交扩展。
4. **多驱动插拔发布矩阵**：针对各平台统一封装 API / CDP / CLI 多种驱动，支持环境智能探测与自动降级。
5. **本地数据主权与凭据加密**：单文件 SQLite 存储，敏感密钥通过系统原生钥匙串或 AES-256-GCM 本地加密隔离。

---

## 模块分层与文档索引

| 模块文档 | 职责与技术特性 |
|---|---|
| [`SPEC.md`](./docs/SPEC.md) | **Phase 1.5 规格契约**：MVP 范围锁定、EARS 验收标准与 E2E 验证流程 |
| [`PRD & 架构设计总纲`](./docs/SoloCreator_Modular_Architecture_PRD_and_Design.md) | 系统总架构、业务流程、数据库表结构与六大设计原则 |
| [`LLD-01 灵感输入与雷达`](./docs/LLD_01_Ingestor_System.md) | X 500+ 高赞爆款雷达采集与语义痛点打分模型 |
| [`LLD-02 母稿质检引擎`](./docs/LLD_02_Master_Critic_Engine.md) | 黄金 3 秒 Hook 矩阵与正则+启发式去 AI 味质检过滤器 |
| [`LLD-03 多端转译矩阵`](./docs/LLD_03_Transpiler_Matrix.md) | 一鱼多吃转译、微信图片 CDN 换链防裂图与 LLM 429 限流队列 |
| [`LLD-04 卡片渲染引擎`](./docs/LLD_04_Card_Renderer.md) | Playwright 3:4 视网膜卡片渲染、跨平台内嵌 WOFF2 字体与 7 天垃圾回收 |
| [`LLD-05 发布调度中枢`](./docs/LLD_05_Pluggable_Publisher.md) | CDP 浏览器免密直塞、登录失效二维码扫码接管与单渠道幂等锁 |
| [`LLD-06 协同通知系统`](./docs/LLD_06_Notifier_System.md) | 人机协同终审通知、飞书交互式卡片与草稿就绪跳转 |
| [`LLD-07 数据复盘与存储`](./docs/LLD_07_Analytics_Storage.md) | 24-48h 数据回抓归因、Persona 风格自进化与 LocalKeyVault 加密 |
| [`DSH 对接规范`](./docs/DSH_Integration_Guide.md) | 基于 Cordis 微内核的标准 DSH Plugin 协议适配与工具挂载 |

---

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 并填入必要配置：

```bash
cp .env.example .env
```

### 3. 运行 CLI 流程

```bash
# 生成母稿并质检
pnpm solo-creator master create --idea="自媒体超级工作室的架构实践"

# 多端转译并存入草稿箱
pnpm solo-creator transpile --master-id="M-001" --channels=wechat,xiaohongshu,x
```

---

## 开源协议

本项目基于 [MIT 协议](./LICENSE) 开源。
