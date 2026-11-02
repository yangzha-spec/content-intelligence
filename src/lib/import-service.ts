import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/database.ts';
import { readImportFiles } from './import-parser.ts';
import { validateImport, type ExistingPost } from './import-validation.ts';
import { applyImportConfig, commitPayload, requestHash, validateManifest, type ImportConfig, type ImportSource, type ServerResult } from './import-contract.ts';
import { KINDS, type ImportTable } from './import-model.ts';

export async function findExistingPosts(client: SupabaseClient<Database>, projectId: string, tables: ImportTable[]): Promise<ExistingPost[]> {
  const keys = [...new Set(tables.filter(t => t.kind !== 'ignore').flatMap(t => {
    const col = t.mapping.content_key;
    return col === undefined ? [] : t.rows.map(r => String(r.cells[col] ?? '').trim()).filter(Boolean);
  }))];
  const found: ExistingPost[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await client.from('content_posts').select('content_key,publish_time,platform,external_content_id').eq('project_id', projectId).in('content_key', keys.slice(i, i + 100));
    if (error) throw new Error('无法核对项目内已有内容，请确认登录状态后重试。');
    found.push(...data);
  }
  return found;
}

export async function processImport(client: SupabaseClient<Database>, batchId: string, action: 'validate' | 'commit', actorId: string): Promise<ServerResult> {
  const { data: batch, error } = await client.from('import_batches').select('*').eq('id', batchId).single();
  if (error || !batch) throw new Error('找不到批次，或当前账号无权访问。');
  const { data: project } = await client.from('projects').select('id,workspace_id,default_timezone').eq('id', batch.project_id).single();
  if (!project) throw new Error('无法访问该项目。');
  const { data: member } = await client.from('workspace_members').select('role').eq('workspace_id', project.workspace_id).eq('user_id', actorId).single();
  if (!member || !['owner', 'editor'].includes(member.role)) throw new Error('只有空间所有者和编辑者可以导入数据。');
  if (batch.status === 'success') return { batch_id: batch.id, result: { batch_id: batch.id, already_applied: true, counts: batch.row_counts as Record<string, number> } };
  const manifest = validateManifest(batch.file_manifest, batch.project_id, batch.id);
  const config = batch.import_config as unknown as ImportConfig;
  if (config.timezone !== project.default_timezone) throw new Error('项目时区已改变，请用当前时区重新建立导入批次。');
  if (!['utf-8', 'gb18030'].includes(config.encoding)) throw new Error('批次编码无效。');
  const originalFiles: File[] = [];
  for (const file of manifest) {
    const { data, error: downloadError } = await client.storage.from('raw-imports').download(file.path);
    if (downloadError || !data) throw new Error('部分原文件尚未上传完成，请重新上传本批文件。');
    if (data.size !== file.size) throw new Error('原文件大小与清单不一致，已停止处理。');
    originalFiles.push(new File([data], file.name, { type: file.mime }));
  }
  // Reparse bytes downloaded with the caller's JWT. Never accept browser rows.
  const parsed = await readImportFiles(originalFiles, config.encoding);
  if (parsed.files.some((file, i) => file.sha256 !== manifest[i].sha256)) throw new Error('原文件哈希不一致，已停止处理。');
  const source: ImportSource = { source_name: batch.source_name, data_owner_or_provider: batch.data_owner_or_provider || '', license_name: batch.license_name, notes: batch.notes || '', contains_personal_data: batch.contains_personal_data };
  if (await requestHash(batch.project_id, parsed.files, config, source, batch.source_type === 'synthetic') !== batch.request_hash) throw new Error('批次来源或映射与指纹不一致，请重新建立批次。');
  const tables = applyImportConfig(parsed.tables, config);
  const existing = await findExistingPosts(client, batch.project_id, tables);
  const report = validateImport(tables, config.timezone, existing);
  const ready = !report.issues.some(issue => issue.severity === 'error') && report.summary.total > 0;
  const counts = Object.fromEntries(KINDS.map(kind => [kind, report.tables.filter(t => t.kind === kind).reduce((n, t) => n + t.rows.length, 0)]));
  const { error: updateError } = await client.from('import_batches').update({ status: ready ? 'ready' : 'failed', error_message: ready ? null : '服务器复核发现错误，请修正文件或映射后建立新批次。', quality_summary: { ...report.summary, issue_count: report.issues.length, checked_by: 'import_v2' }, row_counts: counts }).eq('id', batch.id).neq('status', 'success');
  if (updateError) throw new Error('无法保存服务器复核结果，请稍后重试。');
  if (!ready || action === 'validate') return { batch_id: batch.id, ready, report };
  const payload = await commitPayload(report);
  const { data: result, error: commitError } = await client.rpc('commit_import_batch', { target_batch: batch.id, expected_config: batch.import_config, expected_manifest: batch.file_manifest, payload: payload as Json });
  if (commitError) {
    const conflict = commitError.code === '23505';
    const message = conflict ? '发现与项目已有内容、快照或平台评论 ID 重复的记录。本批业务数据未写入，请修正后重试。'
      : commitError.message.includes('IMPORT_LIMIT_EXCEEDED') ? '标准化后的批次过大，请拆分为更小的文件再导入。本批业务数据未写入。'
      : commitError.code === '42501' ? '项目写入权限已改变，本批业务数据未写入。请确认权限后重试。'
      : '整批入库未完成，业务数据已回滚。请核对关联、来源记录和字段后重试。';
    await client.from('import_batches').update({ status: 'failed', error_message: message }).eq('id', batch.id).neq('status', 'success');
    throw new Error(message);
  }
  return { batch_id: batch.id, result: result as unknown as ServerResult['result'] };
}
