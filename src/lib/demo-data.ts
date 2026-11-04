import type { AnalysisSource, Metric } from './analytics.ts';
import { csvText } from './import-validation.ts';

export const DEMO_DESCRIPTION = '合成演示 · 360 篇内容 / 1,080 次累计快照 / 2,400 条评论 · 固定种子，不来自真实账号';
const platforms = ['youtube', 'xiaohongshu', 'weibo'];
const topics = ['实用教程', '行业观察', '品牌故事', '产品体验', '用户问答', '趋势解读'];
const messages = ['教程很实用，步骤清晰，希望增加更多案例。', '这个功能体验不错，期待下期更新。', '价格太贵，预算有限，希望解释成本。', '看不懂具体操作，演示不清楚。', '感谢分享，细节有用，推荐这个系列。', '一般。', '收到。', '这期主题很有意思，可以讨论一下吗？', '工具速度让我失望，需要改进功能。', 'not helpful for beginners, more examples please.', 'Great guide, helpful examples and useful steps.', '喜欢这个系列，但是价格太贵。'];
const uuid = (group: number, n: number) => `${group.toString().padStart(8, '0')}-0000-4000-8000-${n.toString().padStart(12, '0')}`;
export function demoData(): AnalysisSource {
  const source: AnalysisSource = { posts: [], metrics: [], comments: [], revision: 'synthetic-fixed-v1', captured_at: '2026-11-03T00:00:00Z', timezone: 'Asia/Shanghai' };
  for (let i = 0; i < 360; i += 1) {
    const platform = platforms[i % 3]; const day = Math.floor(i / 12) + 1;
    const date = `2026-10-${String(day).padStart(2, '0')}`; const id = uuid(11, i + 1); const batch = uuid(10, Math.floor(i / 120) + 1);
    source.posts.push({ id, content_key: `${platform}_${String(i + 1).padStart(4, '0')}`, platform, title: `${topics[Math.floor(i / 3) % topics.length]}：${['把复杂步骤讲清楚', '从数据发现新问题', '让复盘更有效', '一次产品使用记录'][i % 4]} #${String(i + 1).padStart(3, '0')}`, content_type: i % 4 === 0 ? 'article' : 'video', topic: topics[Math.floor(i / 3) % topics.length], publish_time: `${date}T${String(1 + i % 12).padStart(2, '0')}:00:00Z`, source_batch_id: batch });
    for (let j = 0; j < 3; j += 1) {
      const value = (2600 + (i * 7919 % 68000)) * (j + 1) + (i % 17 === 0 ? 85000 : 0);
      const time = new Date(Date.parse(`${date}T13:00:00Z`) + j * 86400000).toISOString();
      source.metrics.push({ id: uuid(12, i * 3 + j + 1), content_post_id: id, snapshot_time: time, snapshot_type: 'cumulative', metric_profile: `synthetic_${platform}_v1`, source_batch_id: batch,
        views: i % 13 === 0 ? null : String(value), impressions: String(value * 2), reach: i % 7 ? String(Math.floor(value * .73)) : null, likes: i % 19 === 0 ? '0' : String(Math.floor(value * (.025 + i % 6 / 1000))), comments_count: String(30 + i % 380), shares: i % 9 ? String(5 + i % 93) : null, saves: platform === 'weibo' ? null : String(20 + i % 295) });
    }
  }
  for (let i = 0; i < 2400; i += 1) {
    const p = source.posts[i % 360]; source.comments.push({ id: uuid(13, i + 1), content_post_id: p.id, comment_text: messages[i % messages.length], comment_time: i % 41 ? new Date(Date.parse(p.publish_time) + 3600000 * (1 + i % 30)).toISOString() : null, sample_type: ['top', 'latest', 'random', 'all'][Math.floor(i / 12) % 4], source_batch_id: p.source_batch_id });
  }
  return source;
}
export function complexCsvFiles() {
  const data = demoData(); const keys = new Map(data.posts.map(p => [p.id, p.content_key]));
  return {
    Posts: csvText([['content_key', 'platform', 'title', 'content_type', 'publish_time', 'topic'], ...data.posts.map(p => [p.content_key, p.platform, p.title, p.content_type, p.publish_time, p.topic])]),
    Metrics: csvText([['content_key', 'snapshot_time', 'snapshot_type', 'metric_profile', ...(['views', 'impressions', 'reach', 'likes', 'comments_count', 'shares', 'saves'] as Metric[])], ...data.metrics.map(m => [keys.get(m.content_post_id), m.snapshot_time, m.snapshot_type, m.metric_profile, m.views, m.impressions, m.reach, m.likes, m.comments_count, m.shares, m.saves])]),
    Comments: csvText([['content_key', 'external_comment_id', 'comment_text', 'comment_time', 'sample_type'], ...data.comments.map(c => [keys.get(c.content_post_id), c.id, c.comment_text, c.comment_time, c.sample_type])]),
  };
}
