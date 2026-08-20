import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Save, Anchor, ShieldCheck, Inbox, FileText, TriangleAlert, LoaderCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMasters, useCreateMaster, useSaveMaster, useSecrets, useMaster } from '../lib/queries';
import { MasterPostDetail } from '../lib/engineClient';

const HOOK_TYPE_LABELS: Record<string, string> = {
  curiosity_gap: '好奇缺口',
  counter_intuitive: '反直觉',
  pain_point: '痛点直击',
  authority: '权威背书',
  storytelling: '故事切入'
};

function EditorPane({ post }: { post: MasterPostDetail }) {
  const [markdown, setMarkdown] = useState(post.masterMarkdown);
  const [title, setTitle] = useState(post.title);
  const save = useSaveMaster();
  const dirty = markdown !== post.masterMarkdown || title !== post.title;

  const doSave = () => save.mutate({ id: post.id, patch: { title, masterMarkdown: markdown } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section className="flex min-w-0 flex-1 flex-col border-x border-border bg-surface">
      <header className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
          placeholder="母稿标题"
        />
        {dirty && (
          <button
            className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-xs font-medium text-accent-on transition-colors duration-[120ms] hover:bg-accent-hover"
            onClick={doSave}
            disabled={save.isPending}
          >
            {save.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}
            保存 ⌘S
          </button>
        )}
      </header>
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        className="min-h-0 flex-1 resize-none bg-transparent p-5 font-mono text-sm leading-relaxed outline-none"
        placeholder="母稿 Markdown 正文…"
      />
    </section>
  );
}

function QualityPane({ post }: { post: MasterPostDetail }) {
  const score = post.critic?.score ?? 0;
  const [selectedHook, setSelectedHook] = useState(0);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-auto bg-surface-warm/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck size={16} className="text-accent" /> 去 AI 味质检
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{score}</span>
        <span className="text-xs text-muted">/ 100 · {score >= 75 ? '通过' : '需人工复核'}</span>
        {post.generatedBy === 'offline' && (
          <span className="ml-auto rounded-[var(--radius-pill)] bg-info-soft px-2 py-0.5 text-xs text-info">离线生成</span>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2 text-sm font-medium">
        <Anchor size={16} className="text-accent" /> 黄金 Hook（选 1 为主）
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {post.hookCandidates.map((h, i) => (
          <li key={i}>
            <button
              onClick={() => setSelectedHook(i)}
              className={`w-full rounded-[var(--radius-md)] border p-3 text-left text-sm transition-colors duration-[120ms] ${
                i === selectedHook
                  ? 'border-accent bg-accent-soft/60'
                  : 'border-border bg-surface hover:border-accent'
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="rounded-[var(--radius-pill)] bg-surface-warm px-2 py-0.5">{HOOK_TYPE_LABELS[h.type] || h.type}</span>
              </div>
              <p className="mt-1.5 leading-snug">{h.hookText}</p>
            </button>
          </li>
        ))}
      </ul>

      {post.keyTakeaways.length > 0 && (
        <>
          <div className="mt-6 text-sm font-medium">核心要点</div>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-fg-2">
            {post.keyTakeaways.slice(0, 8).map((t, i) => (
              <li key={i} className="leading-relaxed">{t}</li>
            ))}
          </ol>
        </>
      )}

      <Link
        to={`/preview/${post.id}`}
        className="mt-6 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-center text-sm text-fg-2 transition-colors duration-[120ms] hover:border-accent hover:text-accent"
      >
        多端预览 →
      </Link>
    </aside>
  );
}

export default function Studio() {
  const { data: list, isLoading } = useMasters();
  const create = useCreateMaster();
  const { data: secrets } = useSecrets();
  const queryClient = useQueryClient();
  const [idea, setIdea] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const posts = list?.items || [];
  const noDeepSeek = !(secrets || []).some((s) => s.key === 'DEEPSEEK_API_KEY' && s.exists);

  // 列表最新一篇作默认展示（未显式选中时回退到第一篇）
  const resolvedId = activeId || posts[0]?.id || null;
  const { data: activePost, isLoading: detailLoading } = useMaster(resolvedId);

  const expand = async () => {
    if (!idea.trim()) return;
    const post = await create.mutateAsync({ idea: idea.trim() });
    // create 返回完整 MasterPostDetail，直接写入缓存避免 useMaster 闪空
    queryClient.setQueryData(['master', post.id], post);
    setActiveId(post.id);
    setIdea('');
  };

  return (
    <div className="flex h-full min-h-0">
      {/* 左栏：灵感输入 + 母稿库 */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border-soft p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Inbox size={16} className="text-accent" /> 灵感输入
          </div>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') expand();
            }}
            placeholder="粘贴原始闪念，⌘Enter 展开…"
            className="mt-2 h-24 w-full resize-none rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-sm outline-none transition-colors duration-[120ms] focus:border-accent"
          />
          <button
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-accent px-3 py-2 text-sm font-medium text-accent-on transition-colors duration-[120ms] hover:bg-accent-hover disabled:opacity-50"
            disabled={!idea.trim() || create.isPending}
            onClick={expand}
          >
            {create.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
            展开母稿 ⌘↵
          </button>
          {noDeepSeek && (
            <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-sm)] bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                未检测到 DeepSeek Key，将启用离线模板展开（质量降级）。
                <Link to="/settings/secrets" className="ml-1 underline underline-offset-2">立即前往配置中心 →</Link>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 pt-4 pb-2 text-sm font-medium">
          <FileText size={16} className="text-accent" /> 母稿库（{posts.length}）
        </div>
        <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {isLoading && <li className="p-4 text-center text-xs text-muted">加载中…</li>}
          {!isLoading && posts.length === 0 && (
            <li className="p-6 text-center text-xs leading-relaxed text-muted">
              灵感还空着。从一条闪念开始，左侧输入后点「展开母稿」。
            </li>
          )}
          {posts.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setActiveId(p.id)}
                className={`w-full rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm transition-colors duration-[120ms] ${
                  (resolvedId || '') === p.id ? 'bg-accent-soft/70 text-accent' : 'text-fg-2 hover:bg-surface-warm'
                }`}
              >
                <div className="truncate font-medium">{p.title}</div>
                <div className="mt-0.5 font-mono text-xs text-muted">{p.id}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* 中栏 + 右栏 */}
      {resolvedId && !activePost ? (
        detailLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
            <LoaderCircle size={16} className="animate-spin" /> 正在加载母稿详情…
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-[360px] rounded-[var(--radius-md)] border border-border bg-surface p-8 text-center">
              <TriangleAlert size={24} className="mx-auto text-warn" />
              <p className="mt-3 text-sm font-medium">母稿详情加载失败</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">请确认本地引擎已就绪后重试。</p>
            </div>
          </div>
        )
      ) : activePost ? (
        <>
          <EditorPane key={activePost.id} post={activePost} />
          <QualityPane post={activePost} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-[360px] rounded-[var(--radius-md)] border border-border bg-surface p-8 text-center">
            <Sparkles size={24} className="mx-auto text-accent" />
            <p className="mt-3 text-sm font-medium">从一条灵感开始</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              在左栏输入原始闪念，展开为多端母稿；生成后自动跑去 AI 味质检与 5 类 Hook。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
