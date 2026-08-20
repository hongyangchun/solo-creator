export interface CriticResult {
  score: number; // 0 ~ 100, 越低表示 AI 味越重，>85 为合格
  passed: boolean;
  detectedIssues: {
    type: 'ai_cliche' | 'inflated_adjective' | 'formulaic_structure' | 'passive_voice';
    matchedWord: string;
    suggestion: string;
  }[];
  purifiedContent: string;
}

export class HumanizerZhCritic {
  // 常见 AI 八股词汇及替换建议
  private static readonly AI_CLICHES: Record<string, string> = {
    '值得注意的是': '注意',
    '不可否认的是': '确实',
    '总而言之': '最后',
    '综上所述': '总结来说',
    '如同一把双刃剑': '有优有劣',
    '是一把双刃剑': '有利有弊',
    '不仅如此': '而且',
    '深入探讨': '看看',
    '显而易见': '很明显',
    '毋庸置疑': '确实',
    '赋能': '帮助',
    '打法': '方法',
    '抓手': '着力点',
    '闭环': '完整流程',
    '方法论': '经验总结',
    '底层逻辑': '核心原因',
    '颠覆性': '巨大',
    '史诗级': '重要'
  };

  private static readonly INFLATED_WORDS = [
    '令人惊叹', '惊人的', '无与伦比', '前所未有', '颠覆你的认知', '彻底改变世界'
  ];

  static evaluate(markdown: string): CriticResult {
    const issues: CriticResult['detectedIssues'] = [];
    let purified = markdown;

    // 1. 检测并替换八股词
    for (const [cliche, replacement] of Object.entries(this.AI_CLICHES)) {
      const regex = new RegExp(cliche, 'g');
      const matches = markdown.match(regex);
      if (matches && matches.length > 0) {
        issues.push({
          type: 'ai_cliche',
          matchedWord: cliche,
          suggestion: `建议替换为「${replacement}」或直接删除`
        });
        purified = purified.replace(regex, replacement);
      }
    }

    // 2. 检测夸大词汇
    for (const word of this.INFLATED_WORDS) {
      if (markdown.includes(word)) {
        issues.push({
          type: 'inflated_adjective',
          matchedWord: word,
          suggestion: 'AI 生成痕迹重，建议用事实和具体数据替代夸大形容词'
        });
      }
    }

    // 3. 计算得分
    const penalty = issues.length * 8;
    const score = Math.max(0, 100 - penalty);

    return {
      score,
      passed: score >= 80,
      detectedIssues: issues,
      purifiedContent: purified
    };
  }
}
