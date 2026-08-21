import { Command } from 'commander';
import { HumanizerZhCritic } from '../critic/HumanizerZhCritic';
import { HookGeneratorService } from '../critic/HookGeneratorService';
import { TranspilerMatrix, TranspileTarget } from '../transpiler/TranspilerMatrix';
import { CardRenderer } from '../renderer/CardRenderer';
import { FeishuCardNotifier, ConsoleNotifier } from '../notifier/NotifierPlugin';
import { ChannelType } from '../types';
import { createEngineContext, type EngineContext, ENGINE_VERSION } from '../core/createEngineContext';

const program = new Command();

/** 进程级懒单例：避免每条命令开关库；退出时 close */
let sharedCtx: EngineContext | null = null;

function getEngineContext(): EngineContext {
  if (!sharedCtx) {
    sharedCtx = createEngineContext();
  }
  return sharedCtx;
}

function closeSharedContext(): void {
  if (sharedCtx) {
    sharedCtx.close();
    sharedCtx = null;
  }
}

process.on('exit', () => {
  closeSharedContext();
});

program
  .name('solo-creator')
  .description('SoloCreator Content OS - 本地优先的自媒体一人超级工作室')
  .version(ENGINE_VERSION);

// ============ master 命令组 ============
const master = program.command('master').description('母稿生成与质检');

master
  .command('create')
  .description('从灵感生成母稿（LLM 展开长文 + 5 类 Hook + 去 AI 味质检）')
  .requiredOption('--idea <idea>', '原始灵感文本')
  .option('--topic <topic>', '主题标签', '自媒体创作')
  .option('--offline', '跳过 LLM，使用离线规则模式', false)
  .action(async (opts) => {
    const ctx = getEngineContext();

    const masterPost = await ctx.masterService.createMasterPost(opts.idea, opts.topic);
    const criticResult = HumanizerZhCritic.evaluate(masterPost.masterMarkdown);
    const hooks = HookGeneratorService.generateHooks(opts.topic, opts.idea);

    ctx.storage.saveMasterPost(masterPost);
    const llmStatus = await ctx.llm.isAvailable();
    console.log(`\n✅ 母稿已生成并存入本地 SQLite: ${masterPost.id}`);
    console.log(`   生成模式: ${llmStatus ? 'LLM 深度展开 (DeepSeek)' : '离线规则模式 (未配置 DEEPSEEK_API_KEY)'}`);
    console.log(`\n📝 标题: ${masterPost.title}`);
    console.log(`\n📋 5 类黄金 Hook 候选:`);
    hooks.forEach((h, i) => console.log(`  ${i + 1}. [${h.type}] ${h.hookText}`));
    console.log(`\n🛡️ 去 AI 味质检得分: ${criticResult.score}/100 ${criticResult.passed ? '(通过)' : '(未通过，已自动替换八股词)'}`);
    console.log(`\n💡 核心要点:`);
    masterPost.keyTakeaways.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  });

// ============ master show ============
master
  .command('show')
  .description('查看母稿全文')
  .requiredOption('--master-id <masterId>', '母稿 ID')
  .action((opts) => {
    const ctx = getEngineContext();
    const post = ctx.storage.getMasterPost(opts.masterId);
    if (!post) {
      console.error(`❌ 未找到母稿: ${opts.masterId}`);
      process.exit(1);
    }
    console.log(`\n# ${post.title}\n`);
    console.log(post.masterMarkdown);
  });

// ============ transpile 命令 ============
program
  .command('transpile')
  .description('将母稿一鱼多吃转译为多端 Payload')
  .requiredOption('--master-id <masterId>', '母稿 ID')
  .requiredOption('--channels <channels>', '目标渠道，逗号分隔 (wechat,xiaohongshu,x,weibo)')
  .action(async (opts) => {
    const ctx = getEngineContext();
    const masterPost = ctx.storage.getMasterPost(opts.masterId);

    if (!masterPost) {
      console.error(`❌ 未找到母稿: ${opts.masterId}`);
      process.exit(1);
    }

    const channels = opts.channels.split(',') as ChannelType[];
    const formatMap: Record<string, TranspileTarget['format']> = {
      wechat: 'article',
      xiaohongshu: 'card_flow',
      x: 'thread',
      weibo: 'short_text'
    };

    for (const channel of channels) {
      const payload = TranspilerMatrix.transpile(masterPost, {
        channel,
        format: formatMap[channel]
      } as TranspileTarget);
      const payloadJson = JSON.stringify(payload, null, 2);

      ctx.storage.saveDispatchRecord({
        id: `D-${Date.now()}-${channel}`,
        masterId: masterPost.id,
        channel,
        payloadType: payload.type,
        payloadJson,
        status: 'pending'
      });

      console.log(`\n✅ [${channel}] 转译完成 (${payload.type})`);
      console.log(payloadJson.slice(0, 500) + '...');
    }
  });

// ============ render 命令 ============
program
  .command('render')
  .description('渲染小红书 3:4 视网膜卡片流')
  .requiredOption('--master-id <masterId>', '母稿 ID')
  .option('--theme <theme>', '视觉主题 (minimal_dark / notion_light)', 'minimal_dark')
  .action(async (opts) => {
    const ctx = getEngineContext();
    const masterPost = ctx.storage.getMasterPost(opts.masterId);

    if (!masterPost) {
      console.error(`❌ 未找到母稿: ${opts.masterId}`);
      process.exit(1);
    }

    const payload = TranspilerMatrix.transpile(masterPost, { channel: 'xiaohongshu', format: 'card_flow' });
    const paths = await CardRenderer.renderCardFlow(payload as any, { theme: opts.theme as any });
    console.log(`\n✅ 已渲染 ${paths.length} 张 1080×1440 @2x 视网膜卡片:`);
    paths.forEach((p) => console.log(`  📸 ${p}`));
  });

// ============ publish 命令 ============
program
  .command('publish')
  .description('多渠道直塞草稿箱')
  .requiredOption('--master-id <masterId>', '母稿 ID')
  .requiredOption('--channels <channels>', '目标渠道')
  .action(async (opts) => {
    const ctx = getEngineContext();
    const masterPost = ctx.storage.getMasterPost(opts.masterId);

    if (!masterPost) {
      console.error(`❌ 未找到母稿: ${opts.masterId}`);
      process.exit(1);
    }

    // 通知器：飞书卡片优先，未配置 webhook 时静默降级为控制台
    const notifier = process.env.FEISHU_WEBHOOK_URL ? new FeishuCardNotifier() : new ConsoleNotifier();

    const formatMap: Record<string, string> = {
      wechat: 'article',
      xiaohongshu: 'card_flow',
      x: 'thread',
      weibo: 'short_text'
    };

    const channels = opts.channels.split(',') as ChannelType[];
    for (const channel of channels) {
      // 幂等锁：已成功的渠道跳过
      const existing = ctx.storage.getDispatchRecord(masterPost.id, channel);
      if (existing && existing.dispatch_status === 'success') {
        console.log(`⏭️ [${channel}] 已成功分发过 (draft: ${existing.draft_id})，幂等跳过`);
        continue;
      }

      const payload = TranspilerMatrix.transpile(masterPost, { channel, format: formatMap[channel] } as TranspileTarget);
      const result = await ctx.registry.dispatch(channel, payload, { draftOnly: true });
      console.log(`\n${result.success ? '✅' : '❌'} [${channel}] ${result.success ? `草稿已存入 (${result.previewUrl})` : `失败: ${result.errorMessage}`}`);

      // 通知：成功推飞书卡片，失败推控制台告警
      await notifier.notify({
        event: result.success
          ? { kind: 'draft_ready', channel, previewUrl: result.previewUrl, title: masterPost.title }
          : { kind: 'dispatch_failed', channel, error: result.errorMessage || '未知错误' },
        timestamp: new Date().toISOString()
      });

      ctx.storage.saveDispatchRecord({
        id: `D-${Date.now()}-${channel}`,
        masterId: masterPost.id,
        channel,
        payloadType: payload.type,
        payloadJson: JSON.stringify(payload),
        driverUsed: result.driverId,
        status: result.success ? 'success' : 'failed',
        draftId: result.draftId,
        previewUrl: result.previewUrl
      });
    }
    await notifier.notify({
      event: { kind: 'pipeline_done', masterId: masterPost.id, summary: `母稿《${masterPost.title}》全渠道分发流程结束` },
      timestamp: new Date().toISOString()
    });
  });

// ============ config 命令 ============
const config = program.command('config').description('本地加密凭据管理');

config
  .command('set-secret')
  .description('将敏感密钥安全写入本地加密保险箱 (AES-256-GCM，不进 git)')
  .requiredOption('--key <key>', '密钥名，如 WECHAT_APP_ID / WECHAT_APP_SECRET / DEEPSEEK_API_KEY')
  .requiredOption('--value <value>', '密钥值')
  .action((opts) => {
    const ctx = getEngineContext();
    ctx.vault.setSecret(opts.key, opts.value);
    console.log(`\n🔐 已加密写入: ${opts.key}（存储于 ~/.solo-creator/vault.enc，明文永不落盘）`);
  });

config
  .command('get-secret')
  .description('读取已存储的密钥（仅显示末 4 位，用于确认）')
  .requiredOption('--key <key>', '密钥名')
  .action((opts) => {
    const ctx = getEngineContext();
    const val = ctx.vault.getSecret(opts.key);
    if (!val) {
      console.log(`❌ 未找到密钥: ${opts.key}`);
      return;
    }
    const masked = val.length > 4 ? `${'*'.repeat(val.length - 4)}${val.slice(-4)}` : '****';
    console.log(`🔑 ${opts.key} = ${masked}`);
  });

program.parse(process.argv);
