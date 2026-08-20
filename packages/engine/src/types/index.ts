// 核心统一类型定义

export type PayloadType = 'article' | 'card_flow' | 'thread' | 'short_text';
export type ChannelType = 'wechat' | 'xiaohongshu' | 'x' | 'weibo' | 'zhihu' | 'medium';
export type DriverType = 'api' | 'cdp' | 'cli';

export interface RawIdeaPayload {
  id: string;
  source: 'x_radar' | 'rss' | 'manual' | 'flomo';
  rawContent: string;
  author?: string;
  url?: string;
  viralScore?: number;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface MasterPost {
  id: string;
  rawIdea: string;
  title: string;
  hookCandidates: {
    type: 'curiosity_gap' | 'counter_intuitive' | 'pain_point' | 'authority' | 'storytelling';
    hookText: string;
  }[];
  masterMarkdown: string;
  keyTakeaways: string[];
  suggestedTags: string[];
  createdAt: string;
}

export interface ArticlePayload {
  type: 'article';
  title: string;
  author?: string;
  digest?: string;
  htmlContent: string;
  coverImageLocalPath?: string;
  images: { localPath: string; originalUrl?: string; cdnUrl?: string }[];
}

export interface CardFlowPayload {
  type: 'card_flow';
  title: string;
  caption: string;
  cardImagePaths: string[];
  tags: string[];
}

export interface ThreadPayload {
  type: 'thread';
  tweets: string[];
  mediaAttachments?: { tweetIndex: number; localPath: string }[];
}

export interface ShortTextPayload {
  type: 'short_text';
  text: string;
  images?: string[];
  tags?: string[];
}

export type UnifiedPayload = ArticlePayload | CardFlowPayload | ThreadPayload | ShortTextPayload;

export interface PublishResult {
  success: boolean;
  channel: ChannelType;
  driverId: string;
  driverType: DriverType;
  mode: 'draft' | 'published';
  draftId?: string;
  previewUrl?: string;
  errorMessage?: string;
  timestamp: string;
}
