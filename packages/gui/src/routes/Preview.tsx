import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Monitor, RefreshCw, LoaderCircle, CircleX, Download, FolderOpen } from 'lucide-react';
import { useMaster, useTranspile, useCardPreview } from '../lib/queries';
import { engine, ChannelPayload, subscribeJob } from '../lib/engineClient';

const CHANNEL_TABS = [
  { key: 'wechat', label: '微信长图文' },
  { key: 'xiaohongshu', label: '小红书卡片' },
  { key: 'x', label: 'X 连推' },
  { key: 'weibo', label: '微博短文' }
] as const;

function WechatPane({ html }: { html: string }) {
  return <iframe title="微信长图文预览" sandbox="" srcDoc={html} className="h-full w-full rounded-[var(--radius-sm)] border border-border bg-white" />;
}

function CardPane({ cards }: { cards: string[] }) {
  const [idx, setIdx] = useState(0);
  if (cards.length === 0) return null;
  return (
    <div className="flex h-full flex-col">
      <iframe title={`小红书卡片 ${idx + 1}`} sandbox="" srcDoc={cards[idx]} className="min-h-0 w-full flex-1 rounded-[var(--radius-sm)] border border-border" />
      <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted">
        <button className="rounded-[var(--radius-sm)] border border-border px-2 py-1 hover:border-accent" onClick={() => setIdx(Math.max(0, idx - 1))}>上一张</button>
        <span className="font-mono">{idx + 1} / {cards.length}</span>
        <button className="rounded-[var(--radius-sm)] border border-border px-2 py-1 hover:border-accent" onClick={() => setIdx(Math.min(cards.length - 1, idx + 1))}>下一张</button>
      </div>
    </div>
  );
}

function ThreadPane({ tweets }: { tweets: string[] }) {
  return (
    <ol className="space-y-2 overflow-auto">
      {tweets.map((t, i) => (
        <li key={i} className="rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-sm leading-relaxed">
          <span className="mr-2 font-mono text-xs text-muted">{i + 1}/{tweets.length}</span>
          {t.replace(/\\n/g, ' ')}
        </li>
      ))}
    </ol>
  );
}

export default function Preview() {
  const { masterId = '' } = useParams();
  const { data: post } = useMaster(masterId);
  const transpile = useTranspile();
  const cardPreview = useCardPreview();
  const [channel, setChannel] = useState<string>('wechat');
  const [rendering, setRendering] = useState(false);
  const [renderMsg, setRenderMsg] = useState('');

  const runTranspile = async () => {
    if (!post) return;
    const result = await transpile.mutateAsync({ id: masterId, channels: ['wechat', 'x', 'weibo'] });
    await cardPreview.mutateAsync({ id: masterId, theme: 'minimal_dark' });
    return result;
  };

  const payload = transpile.data as Record<string, ChannelPayload> | undefined;
  const cards = cardPreview.data?.cards || [];

  const doRender = async () => {
    setRendering(true);
    setRenderMsg('提交渲染任务…');
    try {
      const { jobId } = await engine.render(masterId, 'minimal_dark');
      subscribeJob(jobId, (job) => {
        setRenderMsg(job.message);
        if (job.status !== 'running') {
          setRendering(false);
          if (job.status === 'done' && job.result?.imagePaths?.length) {
            setRenderMsg(`已生成 ${job.result.imagePaths.length} 张 PNG：${job.result.imagePaths[0]}`);
          }
        }
      });
    } catch (e: any) {
      setRendering(false);
      setRenderMsg(`渲染失败：${e.message}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-5 py-3">
        <Monitor size={18} className="text-accent" />
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{post?.title || masterId}</h1>
        <button
          className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-xs transition-colors duration-120ms hover:border-accent hover:text-accent"
          onClick={runTranspile}
          disabled={transpile.isPending || cardPreview.isPending}
        >
          {transpile.isPending || cardPreview.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          生成预览
        </button>
        <button
          className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-hover disabled:opacity-50"
          onClick={doRender}
          disabled={rendering}
        >
          <Download size={14} /> 导出卡片 PNG
        </button>
        {renderMsg && (
          <span className="flex items-center gap-2 text-xs text-muted">
            {rendering && <LoaderCircle size={12} className="animate-spin" />}
            {renderMsg}
            {!rendering && renderMsg.includes('.png') && <FolderOpen size={12} className="text-accent" />}
          </span>
        )}
      </header>

      <nav className="flex gap-1 border-b border-border bg-surface px-5 py-2">
        {CHANNEL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setChannel(t.key)}
            className={`rounded-[var(--radius-pill)] px-3 py-1 text-xs transition-colors duration-120ms ${
              channel === t.key ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:bg-surface-warm'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!payload && !cardPreview.data && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            点击「生成预览」，为母稿生成四端交付物（≤3s）。
          </div>
        )}
        {payload && channel === 'wechat' && <WechatPane html={(payload.wechat as { htmlContent?: string })?.htmlContent || ''} />}
        {channel === 'xiaohongshu' && (cards.length ? <CardPane cards={cards} /> : <EmptyPane text="点「生成预览」后在此查看卡片流（webview 实时渲染，不经 Playwright）。" />)}
        {payload && channel === 'x' && payload.x && <ThreadPane tweets={(payload.x as { tweets: string[] }).tweets} />}
        {payload && channel === 'weibo' && payload.weibo && (
          <div className="rounded-[var(--radius-sm)] border border-border bg-surface p-4 text-sm leading-relaxed">
            {(payload.weibo as { text: string }).text}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-border bg-surface px-5 py-2 text-xs text-muted">
        <span>预览即真实排版 · 图片已换链无裂图风险</span>
        <Link to="/dashboard" className="text-accent hover:underline underline-offset-2">前往发布 →</Link>
      </footer>
    </div>
  );
}

function EmptyPane({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
      <CircleX size={14} /> {text}
    </div>
  );
}
