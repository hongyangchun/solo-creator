import { TrendingUp } from 'lucide-react';

// v2 占位：post_analytics 数据回采留待 v2（Spec §0.4 S3 / out-of-scope）
export default function Retro() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-[420px] rounded-[var(--radius-md)] border border-border bg-surface p-10 text-center">
        <TrendingUp size={28} className="mx-auto text-accent" />
        <h1 className="mt-4 text-lg font-semibold">数据复盘（v2 规划中）</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          v2 将接入 post_analytics 表，做阅读/点赞/转发的表现复盘闭环，反哺选题与 Hook 策略。
        </p>
      </div>
    </div>
  );
}
