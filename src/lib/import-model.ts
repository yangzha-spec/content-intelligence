export type DatasetKind = 'Posts' | 'Metrics' | 'Comments';
export type RawCell = string | number | boolean | null;
export type Mapping = Record<string, number | undefined>;
export type Field = { key: string; label: string; required?: boolean; type?: 'count' | 'date' | 'id' | 'tags' | 'json' | 'url'; aliases?: string[] };
export type ImportTable = {
  id: string; source: string; kind: DatasetKind | 'ignore'; headers: string[];
  rows: { sourceRow: number; cells: RawCell[]; formulas?: number[] }[];
  mapping: Mapping;
};
export type ImportFileInfo = { name: string; size: number; sha256: string };
export type Issue = { severity: 'error' | 'warning'; tableId: string; source: string; kind: string; row: number; field: string; code: string; message: string; suggestion: string };
export type NormalizedRow = { sourceRow: number; values: Record<string, unknown>; issues: Issue[] };
export type ValidatedTable = { tableId: string; source: string; kind: DatasetKind; rows: NormalizedRow[] };
export type ValidationReport = {
  tables: ValidatedTable[]; issues: Issue[];
  summary: { total: number; valid: number; errors: number; warningRows: number; duplicateRows: number };
  coverage: { kind: DatasetKind; field: string; label: string; present: number; total: number }[];
};
export const KINDS: DatasetKind[] = ['Posts', 'Metrics', 'Comments'];
export const KIND_LABELS: Record<DatasetKind, string> = { Posts: '内容', Metrics: '指标快照', Comments: '评论' };
export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const MAX_COLUMNS = 64;
export const FIELDS: Record<DatasetKind, Field[]> = {
  Posts: [
    { key: 'content_key', label: '内容编号', required: true, type: 'id', aliases: ['内容键', '作品编号', '帖子编号'] },
    { key: 'platform', label: '平台', required: true },
    { key: 'title', label: '内容标题', required: true, aliases: ['标题'] },
    { key: 'content_type', label: '内容形式', required: true, aliases: ['内容类型', '类型'] },
    { key: 'publish_time', label: '发布时间', required: true, type: 'date', aliases: ['发布日期'] },
    { key: 'timezone', label: '时区' },
    { key: 'account_key', label: '账号编号', type: 'id', aliases: ['账号键'] },
    { key: 'external_content_id', label: '平台内容ID', type: 'id', aliases: ['视频ID', 'video_id'] },
    { key: 'content_text', label: '正文', aliases: ['内容正文', '描述'] },
    { key: 'topic', label: '主题' },
    { key: 'tags', label: '标签', type: 'tags' },
    { key: 'content_url', label: '内容链接', type: 'url' },
    { key: 'language', label: '语言' },
  ],
  Metrics: [
    { key: 'content_key', label: '内容编号', required: true, type: 'id', aliases: ['内容键', '作品编号', '帖子编号'] },
    { key: 'snapshot_time', label: '采集时间', required: true, type: 'date', aliases: ['快照时间', '统计时间'] },
    { key: 'snapshot_type', label: '快照类型' },
    { key: 'metric_profile', label: '指标口径版本' },
    { key: 'views', label: '阅读或播放量', type: 'count', aliases: ['阅读量', '播放量', 'view_count'] },
    { key: 'impressions', label: '曝光量', type: 'count' },
    { key: 'reach', label: '触达人数', type: 'count' },
    { key: 'likes', label: '点赞量', type: 'count', aliases: ['点赞数', 'like_count'] },
    { key: 'comments_count', label: '评论总量', type: 'count', aliases: ['评论数', 'comment_count'] },
    { key: 'shares', label: '分享量', type: 'count', aliases: ['分享数'] },
    { key: 'saves', label: '收藏量', type: 'count', aliases: ['收藏数'] },
    { key: 'raw_metrics', label: '原始指标补充', type: 'json' },
  ],
  Comments: [
    { key: 'content_key', label: '内容编号', required: true, type: 'id', aliases: ['内容键', '作品编号', '帖子编号'] },
    { key: 'comment_text', label: '评论正文', required: true, aliases: ['评论内容', '评论文本'] },
    { key: 'comment_key', label: '文件评论编号', type: 'id', aliases: ['评论键'] },
    { key: 'external_comment_id', label: '平台评论ID', type: 'id' },
    { key: 'comment_time', label: '评论时间', type: 'date' },
    { key: 'comment_likes', label: '评论获赞数', type: 'count', aliases: ['评论点赞数', '获赞数'] },
    { key: 'reply_count', label: '回复数', type: 'count' },
    { key: 'parent_comment_id', label: '父评论ID', type: 'id', aliases: ['parent_comment_external_id'] },
    { key: 'language', label: '语言' },
    { key: 'sample_type', label: '评论采样方式' },
  ],
};
const headerKey = (value: string) => value.trim().toLowerCase().replace(/[\s_\-]/g, '');
export function inferKind(name: string, headers: string[]): DatasetKind | 'ignore' {
  const text = name.replace(/\.csv$/i, '').trim().toLowerCase();
  if (['posts', '内容', '内容信息'].includes(text)) return 'Posts';
  if (['metrics', '指标', '指标快照'].includes(text)) return 'Metrics';
  if (['comments', '评论', '评论信息'].includes(text)) return 'Comments';
  const keys = headers.map(headerKey);
  if (keys.some(k => ['commenttext', '评论正文', '评论内容', '评论文本'].includes(k))) return 'Comments';
  if (keys.some(k => ['snapshottime', '采集时间', '快照时间'].includes(k))) return 'Metrics';
  if (keys.some(k => ['title', '标题', '内容标题'].includes(k))) return 'Posts';
  return 'ignore';
}
export function suggestMapping(kind: DatasetKind, headers: string[]): Mapping {
  return Object.fromEntries(FIELDS[kind].map(field => {
    const candidates = [field.key, field.label, ...(field.aliases || [])].map(headerKey);
    const index = headers.findIndex(h => candidates.includes(headerKey(h)));
    return [field.key, index < 0 ? undefined : index];
  }));
}
export function isBlank(value: unknown) { return value === null || value === undefined || (typeof value === 'string' && value.trim() === ''); }
export function displayCell(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
