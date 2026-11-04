import { Temporal } from '@js-temporal/polyfill';

export const METRICS = ['views', 'impressions', 'reach', 'likes', 'comments_count', 'shares', 'saves'] as const;
export type Metric = typeof METRICS[number];
export const METRIC_NAMES: Record<Metric, string> = { views: '阅读 / 播放量', impressions: '曝光量', reach: '触达人数', likes: '点赞量', comments_count: '评论总量', shares: '分享量', saves: '收藏量' };
export type Post = { id: string; content_key: string; platform: string; title: string; content_type: string; topic: string | null; publish_time: string; source_batch_id: string };
export type Snapshot = { id: string; content_post_id: string; snapshot_time: string; snapshot_type: string; metric_profile: string; source_batch_id: string } & Record<Metric, string | null>;
export type Comment = { id: string; content_post_id: string; comment_text: string; comment_time: string | null; sample_type: string; source_batch_id: string };
export type AnalysisSource = { posts: Post[]; metrics: Snapshot[]; comments: Comment[]; revision: string; captured_at: string; timezone: string };
export type Filters = { platform: string; profile: string; start: string; end: string; metric: Metric; topic: string; timezone: string };
export type Aggregate = { sum: string | null; mean: string | null; median: string | null; valid: number; missing: number; missingRate: number | null };
export type CommentResult = { id: string; content_post_id: string; text: string; sample_type: string; status: 'success' | 'unknown'; label: 'positive' | 'negative' | 'neutral' | 'unknown'; evidence: string[]; topics: string[]; method: string };
export type Insight = { id: string; title: string; observation: string; action: string; evidence: string[]; limitation: string };
export type Analysis = {
  version: string; filters: Filters; cutoff: string; sourceRevision: string; capturedAt: string; sourceBatchIds: string[];
  postCount: number; snapshotCount: number; selectedSnapshotCount: number; missingSnapshots: number | null;
  metrics: Record<Metric, Aggregate>; ranking: (Post & { value: string | null; snapshot_time: string | null; commentSample: number })[];
  daily: { day: string; posts: number; value: string | null; valid: number }[];
  groups: { topic: string; posts: number; aggregate: Aggregate }[];
  comments: { total: number; analyzed: number; unknown: number; positive: number; negative: number; neutral: number; negativeShare: number | null; sampleTypes: Record<string, number>; topics: { topic: string; count: number; share: number | null }[]; rows: CommentResult[] };
  warnings: string[]; insights: Insight[];
};
const VERSION = 'analytics_v1.0';
export function divide(numerator: bigint, denominator: bigint, digits = 2): string | null {
  if (!denominator) return null;
  const factor = 10n ** BigInt(digits); const n = (numerator * factor + denominator / 2n) / denominator;
  return digits ? `${n / factor}.${(n % factor).toString().padStart(digits, '0')}` : n.toString();
}
export function aggregate(values: (string | null)[]): Aggregate {
  const numbers = values.filter((v): v is string => v !== null).map(v => {
    if (!/^\d+$/.test(v)) throw new Error('分析数据包含无效计数，请核对导入记录。');
    return BigInt(v);
  }).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const n = numbers.length; const sum = numbers.reduce((s, v) => s + v, 0n);
  return { sum: n ? sum.toString() : null, mean: n ? divide(sum, BigInt(n)) : null,
    median: n ? n % 2 ? numbers[(n - 1) / 2].toString() : divide(numbers[n / 2 - 1] + numbers[n / 2], 2n) : null,
    valid: n, missing: values.length - n, missingRate: values.length ? (values.length - n) / values.length : null };
}
export function validateFilters(input: unknown, projectTimezone: string): Filters {
  const f = input as Filters;
  if (!f || !METRICS.includes(f.metric) || typeof f.platform !== 'string' || f.platform.length > 60 || typeof f.profile !== 'string' || f.profile.length > 200 || typeof f.topic !== 'string' || f.topic.length > 200) throw new Error('分析筛选条件无效。');
  if (f.timezone !== projectTimezone) throw new Error('项目时区已改变，请刷新后重新分析。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start) || !/^\d{4}-\d{2}-\d{2}$/.test(f.end)) throw new Error('请选择完整的起止日期。');
  try {
    const start = Temporal.PlainDate.from(f.start); const end = Temporal.PlainDate.from(f.end);
    start.toZonedDateTime(projectTimezone);
    if (Temporal.PlainDate.compare(start, end) > 0 || start.until(end).days > 366) throw new Error('range');
  } catch { throw new Error('日期范围或时区无效，一次最多分析 367 天。'); }
  return { platform: f.platform, profile: f.profile, start: f.start, end: f.end, metric: f.metric, topic: f.topic, timezone: projectTimezone };
}
const positiveWords = ['喜欢', '有用', '清晰', '实用', '感谢', '推荐', '赞', '满意', '精彩', 'helpful', 'great', 'love', 'excellent', 'useful'];
const negativeWords = ['失望', '看不懂', '太贵', '不清楚', '糟糕', '错误', '无聊', '差评', '不好', '没用', '不喜欢', 'bad', 'confusing', 'expensive', 'disappointed'];
const topicRules: Record<string, string[]> = { '内容质量': ['清晰', '有用', '实用', '细节', '看不懂', '不清楚', 'helpful', 'confusing'], '教程需求': ['教程', '步骤', '案例', '演示', '实操', 'guide', 'example'], '产品体验': ['功能', '体验', '速度', '工具', '卡顿', 'feature', 'bug'], '价格与成本': ['价格', '太贵', '预算', '成本', 'expensive', 'price'], '发布与互动': ['更新', '回复', '系列', '直播', '下期', 'update'] };
export function classifyComment(comment: Comment): CommentResult {
  const text = comment.comment_text.normalize('NFKC').toLowerCase();
  const hits = (terms: string[]) => terms.filter(word => /[a-z]/.test(word) ? new RegExp(`\\b${word}\\b`, 'i').test(text) : text.includes(word));
  const positive = hits(positiveWords); const negative = hits(negativeWords);
  // Both poles, negation or sarcasm are deliberately left unknown for review.
  const uncertain = /(?:不|没|并非|not\s|never\s).{0,3}(?:喜欢|有用|满意|推荐|great|helpful|useful|love)|[反讽]/.test(text);
  const label = uncertain || (positive.length > 0 && negative.length > 0) ? 'unknown' : negative.length ? 'negative' : positive.length ? 'positive' : /^(一般|中立|已阅|收到|neutral|ok)[。.!！\s]*$/i.test(text) ? 'neutral' : 'unknown';
  return { id: comment.id, content_post_id: comment.content_post_id, text: comment.comment_text, sample_type: comment.sample_type,
    status: label === 'unknown' ? 'unknown' : 'success', label, evidence: [...positive, ...negative], topics: Object.entries(topicRules).filter(([, words]) => hits(words).length > 0).map(([topic]) => topic), method: 'lexicon_zh_en_v1' };
}
export function analyze(source: AnalysisSource, input: Filters): Analysis {
  const filters = validateFilters(input, source.timezone);
  const begin = Temporal.PlainDate.from(filters.start).toZonedDateTime(filters.timezone).toInstant();
  const until = Temporal.PlainDate.from(filters.end).add({ days: 1 }).toZonedDateTime(filters.timezone).toInstant();
  const cutoff = until.subtract({ nanoseconds: 1 }).toString();
  const before = (a: string, b: string) => Temporal.Instant.compare(a, b) <= 0;
  const posts = source.posts.filter(p => (!filters.platform || p.platform === filters.platform) && (!filters.topic || p.topic === filters.topic) && Temporal.Instant.compare(p.publish_time, begin) >= 0 && Temporal.Instant.compare(p.publish_time, until) < 0);
  const postMap = new Map(posts.map(p => [p.id, p]));
  const comparable = !!filters.platform && !!filters.profile;
  const eligible = source.metrics.filter(m => postMap.has(m.content_post_id) && m.snapshot_type === 'cumulative' && m.metric_profile === filters.profile && before(m.snapshot_time, cutoff) && before(postMap.get(m.content_post_id)!.publish_time, m.snapshot_time));
  const latest = new Map<string, Snapshot>();
  if (comparable) for (const snapshot of eligible) {
    const old = latest.get(snapshot.content_post_id);
    if (!old || Temporal.Instant.compare(old.snapshot_time, snapshot.snapshot_time) < 0 || (old.snapshot_time === snapshot.snapshot_time && old.id < snapshot.id)) latest.set(snapshot.content_post_id, snapshot);
  }
  const metrics = Object.fromEntries(METRICS.map(metric => [metric, aggregate(comparable ? posts.map(p => latest.get(p.id)?.[metric] ?? null) : [])])) as Record<Metric, Aggregate>;
  const selectedComments = source.comments.filter(c => postMap.has(c.content_post_id) && (!c.comment_time || (Temporal.Instant.compare(c.comment_time, begin) >= 0 && Temporal.Instant.compare(c.comment_time, until) < 0)));
  const commentCounts = new Map<string, number>(); for (const c of selectedComments) commentCounts.set(c.content_post_id, (commentCounts.get(c.content_post_id) || 0) + 1);
  const ranking = posts.map(p => ({ ...p, value: latest.get(p.id)?.[filters.metric] ?? null, snapshot_time: latest.get(p.id)?.snapshot_time ?? null, commentSample: commentCounts.get(p.id) || 0 })).sort((a, b) => a.value === null ? b.value === null ? a.content_key.localeCompare(b.content_key) : 1 : b.value === null ? -1 : BigInt(a.value) > BigInt(b.value) ? -1 : BigInt(a.value) < BigInt(b.value) ? 1 : a.content_key.localeCompare(b.content_key));
  const daily: Analysis['daily'] = [];
  const publicationDays = new Map<string, number>();
  for (const post of posts) { const day = Temporal.Instant.from(post.publish_time).toZonedDateTimeISO(filters.timezone).toPlainDate().toString(); publicationDays.set(day, (publicationDays.get(day) || 0) + 1); }
  const dailyLatest = new Map<string, Snapshot>(); const timeline = comparable ? [...eligible].sort((a, b) => Temporal.Instant.compare(a.snapshot_time, b.snapshot_time)) : []; let cursor = 0; let dailySum = 0n; let dailyValid = 0;
  for (let date = Temporal.PlainDate.from(filters.start); Temporal.PlainDate.compare(date, filters.end) <= 0; date = date.add({ days: 1 })) {
    const day = date.toString(); const end = date.add({ days: 1 }).toZonedDateTime(filters.timezone).toInstant();
    while (cursor < timeline.length && Temporal.Instant.compare(timeline[cursor].snapshot_time, end) < 0) {
      const s = timeline[cursor++]; const old = dailyLatest.get(s.content_post_id)?.[filters.metric] ?? null;
      if (old !== null) { dailySum -= BigInt(old); dailyValid -= 1; }
      const value = s[filters.metric]; if (value !== null) { dailySum += BigInt(value); dailyValid += 1; }
      dailyLatest.set(s.content_post_id, s);
    }
    daily.push({ day, posts: publicationDays.get(day) || 0, value: dailyValid ? dailySum.toString() : null, valid: dailyValid });
  }
  const groups = [...new Set(posts.map(p => p.topic || '未分类'))].map(topic => { const rows = posts.filter(p => (p.topic || '未分类') === topic); return { topic, posts: rows.length, aggregate: aggregate(comparable ? rows.map(p => latest.get(p.id)?.[filters.metric] ?? null) : []) }; }).sort((a, b) => b.posts - a.posts);
  const rows = selectedComments.map(classifyComment); const count = (label: CommentResult['label']) => rows.filter(c => c.label === label).length;
  const analyzed = rows.filter(c => c.status === 'success').length; const classified = rows.filter(c => c.topics.length).length;
  const sampleTypes: Record<string, number> = {}; for (const c of rows) sampleTypes[c.sample_type] = (sampleTypes[c.sample_type] || 0) + 1;
  const comments = { total: rows.length, analyzed, unknown: count('unknown'), positive: count('positive'), negative: count('negative'), neutral: count('neutral'), negativeShare: analyzed ? count('negative') / analyzed : null, sampleTypes,
    topics: Object.keys(topicRules).map(topic => ({ topic, count: rows.filter(c => c.topics.includes(topic)).length, share: classified ? rows.filter(c => c.topics.includes(topic)).length / classified : null })).sort((a, b) => b.count - a.count), rows };
  const warnings = ['累计快照按内容、时间与口径选取最新一条，历史累计值不相加。', '口径名称用于分组，不代表已核实平台定义；正式比较前需确认含义、单位与适用范围。', '评论使用透明词典规则做初筛，未经标注样本评估；未知、否定和混合表达保留待复核。', '评论时间缺失的记录保留并单独提示；本页评论量是导入样本量，不等于平台评论总量。'];
  if (!comparable) warnings.unshift('跨平台总览只统计内容和评论样本；请选择单一平台及指标口径后查看指标汇总与排名。');
  if (filters.profile === 'pending_review') warnings.push('当前指标口径尚未核实，结果仅供数据核对，不能直接用于正式结论。');
  if (Object.keys(sampleTypes).some(t => t !== 'all')) warnings.push('包含热门、最新、人工或未知采样的评论，结果只描述导入样本，不能代表全部受众。');
  const unknownDates = selectedComments.filter(c => !c.comment_time).length;
  if (unknownDates) warnings.push(`${unknownDates} 条评论缺少时间，无法判断其是否发生在所选日期内。`);
  const missingSnapshots = comparable ? posts.length - latest.size : null;
  if (missingSnapshots && comparable) warnings.push(`${missingSnapshots} 篇内容在截止时刻前没有可用的当前口径快照；不补零。`);
  const evidence = [`筛选内容 ${posts.length} 篇`, `指标有效样本 ${metrics[filters.metric].valid}/${posts.length}`, `评论样本 ${comments.total} 条；有效初筛 ${analyzed} 条`];
  const insights: Insight[] = [];
  if (ranking[0]?.value !== null && ranking[0] && comparable) insights.push({ id: 'top-content', title: '先拆解表现靠前的内容', observation: `「${ranking[0].title}」的${METRIC_NAMES[filters.metric]}为 ${ranking[0].value}，在当前筛选中排名第一。`, action: '对照标题、内容形式和主题，整理可复用的表达，并用后续内容验证。', evidence: [ranking[0].content_key, ...evidence.slice(0, 2)], limitation: '排名受内容发布时间、推广和观察时长影响，不能据此推断因果。' });
  if (comments.topics[0]?.count) insights.push({ id: 'comment-topic', title: '从评论中补充下一轮内容', observation: `「${comments.topics[0].topic}」出现在 ${comments.topics[0].count} 条评论中。`, action: '人工复核相关原文，再把反复出现的需求整理为选题或 FAQ。', evidence: [evidence[2], `有主题标签的样本 ${classified} 条`], limitation: '多标签主题之和可超过 100%；词典命中不是经过模型验证的主题识别。' });
  if (metrics[filters.metric].missing && comparable) insights.push({ id: 'missing-data', title: '补齐数据后再比较内容', observation: `${posts.length} 篇内容中，有 ${metrics[filters.metric].missing} 篇缺少可用的${METRIC_NAMES[filters.metric]}。`, action: '回查来源导出与指标定义，不把缺失值填成零。', evidence: evidence.slice(0, 2), limitation: '缺失不代表没有表现，均值只使用有效观测。' });
  return { version: VERSION, filters, cutoff, sourceRevision: source.revision, capturedAt: source.captured_at, sourceBatchIds: [...new Set([...posts, ...[...latest.values()], ...selectedComments].map(r => r.source_batch_id))].sort(), postCount: posts.length, snapshotCount: eligible.length, selectedSnapshotCount: latest.size, missingSnapshots, metrics, ranking, daily, groups, comments, warnings, insights };
}
