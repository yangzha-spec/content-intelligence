import { FIELDS, KINDS, MAX_BYTES, type ImportFileInfo, type ImportTable, type ValidationReport } from './import-model.ts';

export type ImportConfig = { encoding: 'utf-8' | 'gb18030'; timezone: string; tables: { id: string; kind: ImportTable['kind']; mapping: Record<string, number> }[] };
export type ImportManifest = (ImportFileInfo & { path: string; mime: string })[];
export type ImportSource = { source_name: string; data_owner_or_provider: string; license_name: string; notes: string; contains_personal_data: boolean };
export type CommitResult = { batch_id: string; already_applied: boolean; counts: Record<string, number> };
export type ServerResult = { batch_id: string; ready?: boolean; report?: ValidationReport; result?: CommitResult; error?: string };

export async function sha256(value: string | ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const stableJson = (value: unknown) => JSON.stringify(canonical(value));
export function importConfig(tables: ImportTable[], encoding: string, timezone: string): ImportConfig {
  if (!['utf-8', 'gb18030'].includes(encoding)) throw new Error('不支持的 CSV 编码。');
  return { encoding: encoding as ImportConfig['encoding'], timezone, tables: tables.map(t => ({ id: t.id, kind: t.kind, mapping: Object.fromEntries(Object.entries(t.mapping).filter((entry): entry is [string, number] => entry[1] !== undefined)) })) };
}
// Apply only a bounded mapping to freshly parsed original files. Browser rows,
// normalized values and browser validation results are never accepted here.
export function applyImportConfig(tables: ImportTable[], input: unknown): ImportTable[] {
  const config = input as ImportConfig;
  if (!config || !['utf-8', 'gb18030'].includes(config.encoding) || typeof config.timezone !== 'string' || !Array.isArray(config.tables) || config.tables.length !== tables.length) throw new Error('批次映射配置无效，请重新选择文件。');
  const seen = new Set<string>();
  return tables.map(table => {
    const entry = config.tables.find(t => t.id === table.id);
    if (!entry || seen.has(entry.id) || ![...KINDS, 'ignore'].includes(entry.kind) || !entry.mapping || typeof entry.mapping !== 'object' || Array.isArray(entry.mapping)) throw new Error('来源表与保存的字段映射不一致。');
    seen.add(entry.id);
    const allowed = entry.kind === 'ignore' ? [] : FIELDS[entry.kind].map(f => f.key);
    for (const [key, col] of Object.entries(entry.mapping)) if (!allowed.includes(key) || !Number.isInteger(col) || col < 0 || col >= table.headers.length) throw new Error('字段映射包含无效源列。');
    return { ...table, kind: entry.kind, mapping: entry.mapping };
  });
}
export function validateManifest(value: unknown, projectId: string, batchId: string): ImportManifest {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('原文件清单无效。');
  const names = new Set<string>();
  const entries = value as ImportManifest;
  entries.forEach((file, i) => {
    const excel = /\.xlsx$/i.test(file.name);
    const extension = excel ? 'xlsx' : 'csv';
    const mime = excel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 240 || !/\.(csv|xlsx)$/i.test(file.name) || names.has(file.name) || (excel && entries.length !== 1) || !Number.isSafeInteger(file.size) || file.size <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || file.path !== `${projectId}/${batchId}/${i}.${extension}` || file.mime !== mime) throw new Error('原文件名称、哈希、大小或存储位置无效。');
    names.add(file.name);
  });
  if (entries.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error('文件合计超过 20 MiB。');
  return entries;
}
export async function requestHash(projectId: string, files: ImportFileInfo[], config: ImportConfig, source: ImportSource, synthetic: boolean) {
  return sha256(stableJson({ projectId, files, config, source, synthetic, version: 'import_v2' }));
}
export async function commitPayload(report: ValidationReport) {
  if (report.issues.some(issue => issue.severity === 'error') || !report.summary.total) throw new Error('仍有校验错误，不能入库。');
  const output: Record<string, Record<string, unknown>[]> = { Posts: [], Metrics: [], Comments: [] };
  for (const table of report.tables) for (const row of table.rows) {
    const values: Record<string, unknown> = { ...row.values, source_row_number: row.sourceRow, source_table: table.source };
    if (table.kind === 'Comments') Object.assign(values, { dedupe_hash: await sha256(stableJson([values.content_key, String(values.comment_text).normalize('NFKC'), values.comment_time || null])), dedupe_method: values.external_comment_id ? 'external_id' : values.comment_key ? 'file_key' : 'inferred', dedupe_confidence: values.external_comment_id ? 'high' : values.comment_key ? 'medium' : 'low' });
    output[table.kind].push(values);
  }
  return output;
}
