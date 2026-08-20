import { Command } from 'commander';
import { SQLiteStorage } from '../storage/SQLiteStorage';
import { HumanizerZhCritic } from '../critic/HumanizerZhCritic';
import { HookGeneratorService } from '../critic/HookGeneratorService';
import { TranspilerMatrix, TranspileTarget } from '../transpiler/TranspilerMatrix';
import { CardRenderer } from '../renderer/CardRenderer';
import { PublisherRegistry } from '../publisher';
import { WeChatCdpDriver } from '../publisher/WeChatCdpDriver';
import { MasterPost, ChannelType } from '../types';

const program = new Command();

program
  .name('solo-creator')
  .description('SoloCreator Content OS - 本地优先的自媒体一人超级工作室')
  .version('0.1.0');

// ============ master 命令组 ============
const master = program.command('master').description('母稿生成与质检');

master
  .command('create')
  .description('从灵感生成母稿（含 5 类 Hook 与去 AI 味质检）')
  .requiredOption('--idea <idea>', '原始灵感文本')
  .option('--topic <topic>', '主题标签', '自媒体创作')
  .action(async (opts) => {
    const storage = new SQLiteStorage();

    const hooks = HookGeneratorService.generateHooks(opts.topic, opts.idea);
    const criticResult = HumanizerZhCritic.evaluate(opts.idea);

    const masterPost: MasterPost = {
      id: `M-${Date.now()}`,
      rawIdea: opts.idea,
      title: opts.idea.slice(0, 30),
      hookCandidates: hooks.map((h) => ({ type: h.type, hookText: h.hookText })),
      masterMarkdown: criticResult.purifiedContent,
      keyTakeaways: [opts.idea],
      suggestedTags: [opts.topic, '一人工作室'],
      createdAt: new Date().toISOString()
    };

    storage.saveMasterPost(masterPost);
    console.log(`\n✅ 母稿已生成并存入本地 SQLite: ${masterPost.id}`);
    console.log(`\n📋 5 类黄金 Hook 候选:`);
    hooks.forEach((h, i) => console.log(`  ${i + 1}. [${h.type}] ${h.hookText}`));
    console.log(`\n🛡️ 去 AI 味质检得分: ${criticResult.score}/100 ${criticResult.passed ? '(通过)' : '(未通过，已自动替换八股词)'}`);
    storage.close();
  });

// ============ transpile 命令 ============
program
  .command('transpile')
  .description('将母稿一鱼多吃转译为多端 Payload')
  .requiredOption('--master-id <masterId>', '母稿 ID')
  .requiredOption('--channels <channels>', '目标渠道，逗号分隔 (wechat,xiaohongshu,x,weibo)')
  .action(async (opts) => {
    const storage = new SQLiteStorage();
    const masterPost = storage.getMasterPost(opts.masterId);

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

      storage.saveDispatchRecord({
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
    storage.close();
  });

// ============ render 命令 ============
program
  .command('render')
  .description('渲染小红书 3:4 视网膜卡片流')
  .requiredOption('--master-id <masterId>', '母稿 ID')
  .option('--theme <theme>', '视觉主题 (minimal_dark / notion_light)', 'minimal_dark')
  .action(async (opts) => {
    const storage = new SQLiteStorage();
    const masterPost = storage.getMasterPost(opts.masterId);

    if (!masterPost) {
      console.error(`❌ 未找到母稿: ${opts.masterId}`);
      process.exit(1);
    }

    const payload = TranspilerMatrix.transpile(masterPost, { channel: 'xiaohongshu', format: 'card_flow' });
    const paths = await CardRenderer.renderCardFlow(payload as any, { theme: opts.theme as any });
    console.log(`\n✅ 已渲染 ${paths.length} 张 1080×1440 @2x 视网膜卡片:`);
    paths.forEach((p) => console.log(`  📸 ${p}`));
    storage.close();
  });

// ============ publish 命令 ============
program
  .command('publish')
  .description('多渠道直塞草稿箱')
  .requiredOption('--master-id <masterId>', '母稿 ID')
  .requiredOption('--channels <channels>', '目标渠道')
  .action(async (opts) => {
    const storage = new SQLiteStorage();
    const masterPost = storage.getMasterPost(opts.masterId);

    if (!masterPost) {
      console.error(`❌ 未找到母稿: ${opts.masterId}`);
      process.exit(1);
    }

    const registry = new PublisherRegistry();
    registry.register(new WeChatCdpDriver());

    const channels = opts.channels.split(',') as ChannelType[];
    for (const channel of channels) {
      // 幂等锁：已成功的渠道跳过
      const existing = storage.getDispatchRecord(masterPost.id, channel);
      if (existing && existing.dispatch_status === 'success') {
        console.log(`⏭️ [${channel}] 已成功分发过 (draft: ${existing.draft_id})，幂等跳过`);
        continue;
      }

      const payload = TranspilerMatrix.transpile(masterPost, { channel, format: 'article' } as TranspileTarget);
      const result = await registry.dispatch(channel, payload, { draftOnly: true });
      console.log(`\n${result.success ? '✅' : '❌'} [${channel}] ${result.success ? `草稿已存入 (${result.previewUrl})` : `失败: ${result.errorMessage}`}`);

      storage.saveDispatchRecord({
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
    storage.close();
  });

program.parse(process.argv);
