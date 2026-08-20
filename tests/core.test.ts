import { describe, it, expect } from 'vitest';
import { HumanizerZhCritic } from '../src/critic/HumanizerZhCritic';
import { HookGeneratorService } from '../src/critic/HookGeneratorService';
import { TranspilerMatrix } from '../src/transpiler/TranspilerMatrix';
import { MasterPost } from '../src/types';
import { LocalKeyVault } from '../src/storage/LocalKeyVault';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('HumanizerZhCritic 去 AI 味质检', () => {
  it('应检测出 AI 八股词并自动替换', () => {
    const input = '值得注意的是，这套方法论具有颠覆性。总而言之，它能赋能创作者。';
    const result = HumanizerZhCritic.evaluate(input);

    expect(result.detectedIssues.length).toBeGreaterThan(0);
    expect(result.purifiedContent).not.toContain('值得注意的是');
    expect(result.purifiedContent).not.toContain('总而言之');
  });

  it('干净文本应得高分通过', () => {
    const input = '我昨天试了 3 个工具，只留下了一个。它帮我省了 2 小时。';
    const result = HumanizerZhCritic.evaluate(input);

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.passed).toBe(true);
  });
});

describe('HookGeneratorService 黄金 Hook 矩阵', () => {
  it('应生成 5 类不同风格的 Hook', () => {
    const hooks = HookGeneratorService.generateHooks('自动化分发', '重构生产流');
    expect(hooks.length).toBe(5);
    expect(hooks.map((h) => h.type)).toEqual(
      expect.arrayContaining(['curiosity_gap', 'counter_intuitive', 'pain_point', 'authority', 'storytelling'])
    );
  });
});

describe('TranspilerMatrix 一鱼多吃转译', () => {
  const mockMaster: MasterPost = {
    id: 'M-TEST-001',
    rawIdea: '一人工作室自动化',
    title: '一人工作室的自动化实战',
    hookCandidates: [
      { type: 'pain_point', hookText: '每天花 4 小时排版，你疯了吗？' }
    ],
    masterMarkdown: '# 一人工作室\n\n核心是重构手脚，不是堆时间。\n\n- 自动化转译\n- 草稿箱直塞',
    keyTakeaways: ['要点一：自动化转译', '要点二：草稿箱直塞'],
    suggestedTags: ['自媒体', '自动化'],
    createdAt: new Date().toISOString()
  };

  it('微信渠道应产出 ArticlePayload HTML', () => {
    const payload = TranspilerMatrix.transpile(mockMaster, { channel: 'wechat', format: 'article' });
    expect(payload.type).toBe('article');
    expect((payload as any).htmlContent).toContain('<h1>');
  });

  it('X 渠道应产出 ThreadPayload 且每条不超 280 字符', () => {
    const payload = TranspilerMatrix.transpile(mockMaster, { channel: 'x', format: 'thread' });
    expect(payload.type).toBe('thread');
    (payload as any).tweets.forEach((t: string) => {
      expect(t.length).toBeLessThanOrEqual(280);
    });
  });

  it('小红书渠道应产出 CardFlowPayload', () => {
    const payload = TranspilerMatrix.transpile(mockMaster, { channel: 'xiaohongshu', format: 'card_flow' });
    expect(payload.type).toBe('card_flow');
    expect((payload as any).cardImagePaths.length).toBeGreaterThan(0);
  });

  it('微博渠道应产出 ShortTextPayload 并带话题标签', () => {
    const payload = TranspilerMatrix.transpile(mockMaster, { channel: 'weibo', format: 'short_text' });
    expect(payload.type).toBe('short_text');
    expect((payload as any).text).toContain('#');
  });
});

describe('LocalKeyVault 凭据保险箱', () => {
  it('应加密存储并解密读取凭据', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-vault-test-'));
    const vault = new LocalKeyVault(tmpDir);

    vault.setSecret('WECHAT_APP_SECRET', 'my-super-secret-123');
    expect(vault.getSecret('WECHAT_APP_SECRET')).toBe('my-super-secret-123');
    expect(vault.getSecret('NOT_EXIST')).toBeNull();

    // 验证落盘文件确为密文
    const raw = fs.readFileSync(path.join(tmpDir, 'vault.enc'), 'utf8');
    expect(raw).not.toContain('my-super-secret-123');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
