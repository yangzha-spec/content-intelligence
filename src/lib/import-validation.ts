import { Temporal } from '@js-temporal/polyfill';
import { FIELDS, KINDS, isBlank, type DatasetKind, type ImportTable, type Issue, type NormalizedRow, type ValidationReport } from './import-model.ts';

export function normalizeCount(value: unknown): string | null {
  if (isBlank(value)) return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('数值已失去整数精度，请把原始大整数以文本格式提供。');
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('计数必须是非负整数，不能使用布尔值。');
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new Error('计数必须是非负整数；负数、百分比、小数和科学计数字符串都需先核实。');
  const count = BigInt(text);
  if (count > 9223372036854775807n) throw new Error('数值超过数据库整数范围，请检查单位或原始数据。');
  return count.toString();
}

export function normalizeDate(value: unknown, timezone: string): string | null {
  if (isBlank(value)) return null;
  if (typeof value !== 'string') throw new Error('请提供明确的日期时间；不自动猜测数字是秒、毫秒还是 Excel 日期。');
  const text = value.trim().replace(' ', 'T');
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) throw new Error('format');
    if (/(Z|[+-]\d{2}:\d{2})$/i.test(text)) return Temporal.Instant.from(text).toString();
    const local = Temporal.PlainDateTime.from(text, { overflow: 'reject' });
    return local.toZonedDateTime(timezone, { disambiguation: 'reject' }).toInstant().toString();
  } catch { throw new Error('日期时间或时区无法解析，请使用 YYYY-MM-DD HH:mm:ss；夏令时重复/缺失时刻请显式提供 UTC 偏移。'); }
}

function normalizeId(value: unknown) {
  if (isBlank(value)) return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('编号精度已丢失，请在原文件中将长编号设置为文本。');
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('编号必须是文本或可精确表示的整数。');
  return String(value).trim();
}

const platforms: Record<string, string> = { youtube: 'youtube', weibo: 'weibo', 微博: 'weibo', xiaohongshu: 'xiaohongshu', 小红书: 'xiaohongshu', douyin: 'douyin', 抖音: 'douyin', wechat: 'wechat', 微信公众号: 'wechat', 微信: 'wechat', bilibili: 'bilibili', instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', linkedin: 'linkedin', x: 'x', other: 'other', 其他: 'other' };
const types: Record<string, string> = { video: 'video', 视频: 'video', text: 'text', 文字: 'text', article: 'article', 文章: 'article', image: 'image', 图片: 'image', mixed: 'mixed', 图文: 'mixed', audio: 'audio', 音频: 'audio', live: 'live', 直播: 'live', other: 'other', 其他: 'other' };
const sampleTypes = new Set(['all', 'latest', 'top', 'random', 'manual', 'unknown']);

export type ExistingPost = { content_key: string; publish_time: string; platform?: string; external_content_id?: string | null };
export function validateImport(tables: ImportTable[], timezone = 'Asia/Shanghai', existing: ExistingPost[] = []): ValidationReport {
  const issues: Issue[] = []; const selected = tables.filter(t => t.kind !== 'ignore');
  const results: ValidationReport['tables'] = []; const refs = new Map<string, NormalizedRow[]>();
  const existingKeys = new Set(existing.map(post => post.content_key));
  const existingExternalIds = new Set(existing.filter(post => post.external_content_id).map(post => `${post.platform}\0${post.external_content_id}`));
  for (const post of existing) refs.set(post.content_key, [{ sourceRow: 0, values: { ...post, timezone }, issues: [] }]);
  function issue(table: ImportTable, row: NormalizedRow | null, field: string, code: string, message: string, suggestion: string, severity: 'error' | 'warning' = 'error') {
    const item: Issue = { severity, tableId: table.id, source: table.source, kind: table.kind, row: row?.sourceRow || 0, field, code, message, suggestion };
    issues.push(item); row?.issues.push(item);
  }
  const batch: ImportTable = { id: 'batch', source: '本批文件', kind: 'Posts', headers: [], rows: [], mapping: {} };
  if (!selected.some(t => t.kind === 'Posts') && !existing.length) issue(batch, null, 'Posts', 'MISSING_POSTS', '缺少内容表 Posts，无法核对内容关联。', '补充内容表；登录真实项目后也可关联项目内已有内容。');
  for (const kind of KINDS) {
    const found = selected.filter(t => t.kind === kind);
    if (found.length > 1) issue(batch, null, kind, 'MULTIPLE_TABLES', `本批有多张 ${kind} 表，无法确定唯一来源。`, '每类保留一张表，其余设为忽略，或合并后重新选择。');
    if (!found.length && kind !== 'Posts') issue(batch, null, kind, 'MISSING_OPTIONAL_TABLE', `未提供 ${kind}；本次只预览现有数据。`, '需要完整内容—指标—评论流程时，再补齐对应数据。', 'warning');
  }
  // Normalize Posts first so child dates can use the corresponding post's zone.
  for (const kind of KINDS) for (const table of selected.filter(t => t.kind === kind)) {
    const output = { tableId: table.id, source: table.source, kind, rows: [] as NormalizedRow[] }; results.push(output);
    const fields = FIELDS[kind]; const used = new Map<number, string>();
    for (const field of fields) {
      const col = table.mapping[field.key];
      if (col === undefined) {
        if (field.required) issue(table, null, field.key, 'REQUIRED_MAPPING', `必填字段「${field.label}」尚未映射。`, '在字段映射中选择对应源列。');
      } else if (!Number.isInteger(col) || col < 0 || col >= table.headers.length) {
        issue(table, null, field.key, 'INVALID_MAPPING', `「${field.label}」映射的列已不存在。`, '重新选择源列。');
      } else if (used.has(col)) issue(table, null, field.key, 'REUSED_COLUMN', `源列「${table.headers[col]}」被重复映射。`, '每个标准字段使用独立的源列，或取消多余映射。');
      else used.set(col, field.key);
    }
    if (!table.rows.length) issue(table, null, '', 'EMPTY_TABLE', `${kind} 只有表头，没有数据记录。`, '空表可以保留表头，当前不会产生业务记录。', kind === 'Posts' ? 'error' : 'warning');
    for (const raw of table.rows) {
      const row: NormalizedRow = { sourceRow: raw.sourceRow, values: {}, issues: [] }; output.rows.push(row);
      const rawValue = (key: string) => { const col = table.mapping[key]; return col === undefined ? null : raw.cells[col] ?? null; };
      const contentKey = (() => { try { return normalizeId(rawValue('content_key')); } catch { return null; } })();
      const matching = contentKey ? refs.get(contentKey) : undefined;
      const rawZone = rawValue('timezone');
      const zone = kind === 'Posts' ? (isBlank(rawZone) ? timezone : String(rawZone).trim()) : String(matching?.[0]?.values.timezone || timezone);
      for (const field of fields) {
        const value = rawValue(field.key); const col = table.mapping[field.key];
        row.values[field.key] = null;
        if (field.required && isBlank(value)) { issue(table, row, field.key, 'REQUIRED_VALUE', `「${field.label}」不能为空。`, '补充原始数据后重新选择文件。'); continue; }
        if (isBlank(value)) continue;
        if (col !== undefined && raw.formulas?.includes(col)) { issue(table, row, field.key, 'FORMULA_CELL', `「${field.label}」是公式或 Excel 错误单元格。`, '复制并粘贴为已核实的值后再导入；本工具不计算公式或使用缓存结果。'); continue; }
        try {
          if (field.type === 'count') row.values[field.key] = normalizeCount(value);
          else if (field.type === 'date') row.values[field.key] = normalizeDate(value, zone);
          else if (field.type === 'id') row.values[field.key] = normalizeId(value);
          else if (field.type === 'tags') {
            const text = String(value).trim(); const tags: unknown = text.startsWith('[') ? JSON.parse(text) : text.split(/[,，;；|]/);
            if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) throw new Error('标签需为文本数组，或用逗号、分号、竖线分隔的文本。');
            row.values.tags = [...new Set(tags.map(tag => (tag as string).trim()).filter(Boolean))];
          } else if (field.type === 'json') {
            const data: unknown = JSON.parse(String(value));
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('原始指标需为 JSON 对象，不能是数组或单个数值。');
            row.values[field.key] = data;
          } else if (field.type === 'url') {
            const url = new URL(String(value).trim());
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('链接必须以 http:// 或 https:// 开头。');
            row.values[field.key] = url.href;
          } else row.values[field.key] = String(value).trim();
        } catch (error) { issue(table, row, field.key, 'INVALID_VALUE', error instanceof Error ? error.message : `「${field.label}」无法解析。`, '核对原值、格式与字段映射，修正原文件后重试。'); }
      }
      if (kind === 'Posts') {
        if (contentKey && existingKeys.has(contentKey)) issue(table, row, 'content_key', 'EXISTING_CONTENT', '内容编号已存在于项目，不能重复新增或自动覆盖。', '补充指标或评论时，移除或忽略已导入的 Posts，使用原内容编号关联。');
        if (row.values.external_content_id && existingExternalIds.has(`${row.values.platform}\0${row.values.external_content_id}`)) issue(table, row, 'external_content_id', 'EXISTING_EXTERNAL_CONTENT', '该平台内容 ID 已在项目中存在。', '请使用已有内容编号，避免重复新增内容。');
        row.values.timezone = zone;
        try { Temporal.Now.instant().toZonedDateTimeISO(zone); }
        catch { issue(table, row, 'timezone', 'INVALID_TIMEZONE', '时区名称无法识别。', '填写 IANA 时区，例如 Asia/Shanghai。'); }
        const platform = String(row.values.platform || '').toLowerCase();
        if (platform && !Object.hasOwn(platforms, platform)) issue(table, row, 'platform', 'UNKNOWN_PLATFORM', `尚未支持平台标识「${platform}」。`, '核对平台名称；确实属于其他平台时，在原文件填 other。');
        else if (platform) row.values.platform = platforms[platform];
        const type = String(row.values.content_type || '').toLowerCase();
        if (type) {
          row.values.raw_content_type = row.values.content_type;
          row.values.content_type = Object.hasOwn(types, type) ? types[type] : 'other';
          if (!Object.hasOwn(types, type)) issue(table, row, 'content_type', 'OTHER_CONTENT_TYPE', `「${type}」暂归为 other，并保留原始类型。`, '后续可补充平台专属类型映射。', 'warning');
        }
        if (contentKey) { const list = refs.get(contentKey) || []; list.push(row); refs.set(contentKey, list); }
      } else {
        if (contentKey && !matching?.length) issue(table, row, 'content_key', 'ORPHAN_CONTENT', '内容编号在本批 Posts 或已核对的项目历史中不存在。', '补充对应内容，或核对项目和内容编号。');
        else if (matching && (matching.length > 1 || matching[0].issues.some(i => i.severity === 'error'))) issue(table, row, 'content_key', 'INVALID_PARENT', '关联内容存在错误或内容编号不唯一。', '先修正 Posts 的对应记录。');
        const timeField = kind === 'Metrics' ? 'snapshot_time' : 'comment_time';
        const time = row.values[timeField]; const publish = matching?.[0]?.values.publish_time;
        if (typeof time === 'string' && typeof publish === 'string' && Temporal.Instant.compare(time, publish) < 0) issue(table, row, timeField, 'BEFORE_PUBLICATION', '时间早于内容发布时间。', '核对采集时间、评论时间与时区；不直接删除该记录。', 'warning');
        if (kind === 'Metrics') {
          const type = String(row.values.snapshot_type || 'cumulative').toLowerCase(); row.values.snapshot_type = type;
          if (type !== 'cumulative') issue(table, row, 'snapshot_type', 'UNSUPPORTED_PERIOD', '当前阶段只支持 cumulative 累计快照。', '周期数据需要起止边界，不能直接改名为累计值。');
          row.values.metric_profile ||= 'pending_review';
        } else {
          const sample = String(row.values.sample_type || 'unknown').toLowerCase(); row.values.sample_type = sample;
          if (!sampleTypes.has(sample)) issue(table, row, 'sample_type', 'INVALID_SAMPLE_TYPE', '评论采样方式无法识别。', '可用 all/latest/top/random/manual/unknown。');
          if (sample === 'unknown') issue(table, row, 'sample_type', 'UNKNOWN_SAMPLE', '评论覆盖范围未知，不能代表全体用户。', '尽量补充全量或具体抽样方式。', 'warning');
          if (!row.values.comment_key && !row.values.external_comment_id) issue(table, row, 'comment_key', 'INFERRED_ID', '缺少稳定评论编号，后续只能推断去重。', '优先补充平台评论 ID；相同文本不会被直接删除。', 'warning');
        }
      }
    }
    if (kind === 'Metrics' && output.rows.length) issue(table, null, 'metric_profile', 'METRIC_DEFINITION_REVIEW', '字段映射不等于指标定义相同，本阶段尚未核实平台指标口径。', '正式统计前确认指标含义、单位、分母及口径版本。', 'warning');
  }
  function duplicates(kind: DatasetKind, key: (row: NormalizedRow) => string | null, field: string, code: string, message: string, severity: 'error' | 'warning' = 'error') {
    const groups = new Map<string, { table: ImportTable; row: NormalizedRow }[]>();
    for (const result of results.filter(t => t.kind === kind)) {
      const table = tables.find(t => t.id === result.tableId)!;
      for (const row of result.rows) { const value = key(row); if (!value) continue; const group = groups.get(value) || []; group.push({ table, row }); groups.set(value, group); }
    }
    for (const group of groups.values()) if (group.length > 1) for (const item of group) issue(item.table, item.row, field, code, message, severity === 'error' ? '核对重复记录；本工具不会自动覆盖、合并或删除。' : '人工复核来源与评论时间，不凭相同文本自动删除。', severity);
  }
  duplicates('Posts', r => r.values.content_key as string | null, 'content_key', 'DUPLICATE_CONTENT', '内容编号重复，无法唯一关联指标与评论。');
  duplicates('Posts', r => r.values.external_content_id ? `${r.values.platform}\0${r.values.external_content_id}` : null, 'external_content_id', 'DUPLICATE_EXTERNAL_CONTENT', '同平台的内容 ID 重复。');
  duplicates('Metrics', r => r.values.content_key && r.values.snapshot_time ? `${r.values.content_key}\0${r.values.snapshot_time}\0${r.values.snapshot_type}\0${r.values.metric_profile}` : null, 'snapshot_time', 'DUPLICATE_SNAPSHOT', '同一内容、时间、类型与口径的快照重复。');
  duplicates('Comments', r => r.values.external_comment_id && r.values.content_key ? `${r.values.content_key}\0${r.values.external_comment_id}` : null, 'external_comment_id', 'DUPLICATE_COMMENT_ID', '同一内容的稳定平台评论 ID 重复。');
  duplicates('Comments', r => r.values.comment_key as string | null, 'comment_key', 'DUPLICATE_FILE_COMMENT', '同一批文件中的评论编号重复。');
  duplicates('Comments', r => !r.values.external_comment_id && !r.values.comment_key && r.values.content_key && r.values.comment_text ? `${r.values.content_key}\0${String(r.values.comment_text).normalize('NFKC')}\0${r.values.comment_time || ''}` : null, 'comment_text', 'POSSIBLE_DUPLICATE_COMMENT', '评论文本与时间相同，标为疑似重复并保留。', 'warning');
  const rows = results.flatMap(t => t.rows);
  const coverage = results.flatMap(table => FIELDS[table.kind].map(field => ({ kind: table.kind, field: field.key, label: field.label, total: table.rows.length, present: table.rows.filter(r => !isBlank(r.values[field.key])).length })));
  return { tables: results, issues, coverage, summary: {
    total: rows.length, valid: rows.filter(r => !r.issues.some(i => i.severity === 'error')).length,
    errors: rows.filter(r => r.issues.some(i => i.severity === 'error')).length,
    warningRows: rows.filter(r => r.issues.some(i => i.severity === 'warning')).length,
    duplicateRows: rows.filter(r => r.issues.some(i => i.code.includes('DUPLICATE'))).length,
  } };
}

export function csvText(rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
export function issueReportCsv(report: ValidationReport) {
  return csvText([['级别', '数据类型', '来源表', '记录号（0为整表）', '字段', '问题代码', '说明', '处理建议'], ...report.issues.map(i => [i.severity === 'error' ? '错误' : '提示', i.kind, i.source, i.row, i.field, i.code, i.message, i.suggestion])]);
}
