export interface HookCandidate {
  type: 'curiosity_gap' | 'counter_intuitive' | 'pain_point' | 'authority' | 'storytelling';
  hookText: string;
  explanation: string;
}

export class HookGeneratorService {
  /**
   * 基于主题和核心论点生成 5 类黄金 3 秒 Hook 矩阵
   */
  static generateHooks(topic: string, coreInsight: string): HookCandidate[] {
    return [
      {
        type: 'curiosity_gap',
        hookText: `为什么 90% 的自媒体人在${topic}上都在做无用功？`,
        explanation: '制造认知缺口，激发读者“我是否也做错了”的好奇心'
      },
      {
        type: 'counter_intuitive',
        hookText: `不要再迷信传统发布流程了：${coreInsight || '一人工作室的核心不是堆时间，而是重构手脚'}。`,
        explanation: '打破常规共识，通过冲突感吸引专业人群'
      },
      {
        type: 'pain_point',
        hookText: `每天花 4 小时排版切图发布，你是不是也快被自媒体繁杂流程逼疯了？`,
        explanation: '直击创作者日常最高频痛点，引发强烈共鸣'
      },
      {
        type: 'authority',
        hookText: `复盘了 100+ 头部博主的生产流：真正拉开差距的，只有这套自动化系统。`,
        explanation: '用样本量和案例背书提升专业说服力'
      },
      {
        type: 'storytelling',
        hookText: `上个月我决定把繁琐的多端分发彻底自动化，结果效率提升了 5 倍...`,
        explanation: '以第一人称真实经历切入，拉近与读者的距离'
      }
    ];
  }
}
