import { getSupabase } from './supabase.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/database.ts';
import { importConfig, requestHash, validateManifest, type ImportSource, type ImportManifest, type ServerResult } from './import-contract.ts';
import type { ImportFileInfo, ImportTable } from './import-model.ts';

export async function prepareImport(projectId: string, originals: File[], files: ImportFileInfo[], tables: ImportTable[], encoding: string, timezone: string, source: ImportSource, synthetic: boolean, progress: (text: string) => void, client: SupabaseClient<Database> = getSupabase()) {
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new Error('登录已过期，请重新登录。');
  if (!source.source_name.trim() || source.source_name.length > 200 || source.notes.length > 2000 || source.license_name.length > 200 || source.data_owner_or_provider.length > 200) throw new Error('请填写来源名称，并检查来源信息长度。');
  if (originals.length !== files.length || !files.length) throw new Error('原文件已清除，请重新选择。');
  const config = importConfig(tables, encoding, timezone);
  const fingerprint = await requestHash(projectId, files, config, source, synthetic);
  const proposedId = crypto.randomUUID();
  const manifest: ImportManifest = files.map((file, i) => ({ ...file, path: `${projectId}/${proposedId}/${i}.${/\.xlsx$/i.test(file.name) ? 'xlsx' : 'csv'}`, mime: /\.xlsx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' }));
  validateManifest(manifest, projectId, proposedId);
  progress('正在建立导入批次…');
  const { data: inserted, error: insertError } = await client.from('import_batches').insert({
    id: proposedId, project_id: projectId, created_by: auth.user.id, file_name: files.map(f => f.name).join(' + '), file_hash: files[0].sha256,
    storage_path: manifest[0].path, file_size_bytes: files.reduce((n, f) => n + f.size, 0), mime_type: manifest[0].mime,
    source_type: synthetic ? 'synthetic' : 'user_upload', ...source, license_verified: false, public_demo_allowed: false,
    file_manifest: manifest as unknown as Json, import_config: config as unknown as Json, field_mapping: config as unknown as Json,
    request_hash: fingerprint, processing_version: 'import_v2', status: 'pending',
  }).select('*').single();
  let batch = inserted;
  if (insertError?.code === '23505') {
    const existing = await client.from('import_batches').select('*').eq('project_id', projectId).eq('request_hash', fingerprint).single();
    if (existing.error) throw new Error('无法恢复相同文件的批次，请刷新导入历史。');
    batch = existing.data;
  } else if (insertError) throw new Error('无法建立批次，请确认当前项目的编辑权限。');
  if (!batch) throw new Error('批次创建未完成。');
  if (batch.status === 'success') return { batchId: batch.id, complete: true };
  if (batch.status === 'ready') return { batchId: batch.id, complete: false };
  const stored = batch.file_manifest as unknown as ImportManifest;
  for (let i = 0; i < stored.length; i += 1) {
    progress(`正在私有保存原文件 ${i + 1} / ${stored.length}…`);
    const { error } = await client.storage.from('raw-imports').upload(stored[i].path, originals[i], { upsert: false, contentType: stored[i].mime, cacheControl: '0' });
    // Existing objects are immutable; server rechecks their actual size and SHA-256.
    if (error && !['409', '400'].includes(String(error.statusCode))) throw new Error(`「${stored[i].name}」上传未完成，请重试。`);
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`「${stored[i].name}」上传未完成：${error.message}`);
  }
  const { error } = await client.from('import_batches').update({ status: 'uploaded', error_message: null }).eq('id', batch.id).neq('status', 'success');
  if (error) throw new Error('原文件已保存，但批次状态更新未完成。可在导入历史中重试复核。');
  return { batchId: batch.id, complete: false };
}

export async function invokeImport(batchId: string, action: 'validate' | 'commit'): Promise<ServerResult> {
  const { data, error } = await getSupabase().functions.invoke<ServerResult>('import-batch', { body: { batch_id: batchId, action } });
  if (error) {
    let message = '服务器复核未完成。原文件若已上传会保留，可在导入历史中重试。';
    if (error.context instanceof Response) {
      try { const detail = await error.context.json(); if (typeof detail.error === 'string') message = detail.error; } catch {}
    }
    throw new Error(message);
  }
  if (!data || data.error) throw new Error(data?.error || '服务器未返回处理结果，请在导入历史确认状态后重试。');
  return data;
}
