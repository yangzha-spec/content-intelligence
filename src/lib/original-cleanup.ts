import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.ts';
import { getSupabase } from './supabase.ts';
import { validateManifest, type ImportManifest } from './import-contract.ts';

export const CLEANUP_CONFIRMATION = '清理原文件';
export type CleanupPlan = { batch_id: string; project_id: string; state: 'retained' | 'deleting' | 'deleted'; files: ImportManifest };

// Irreversible Storage changes require an explicit user action. The SQL API
// returns authorized paths; caller-supplied paths are never accepted here.
export async function cleanupOriginals(batchId: string, confirmation: string, client: SupabaseClient<Database> = getSupabase()) {
  if (confirmation !== CLEANUP_CONFIRMATION) throw new Error('请输入「清理原文件」后再确认。');
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new Error('登录已过期，请重新登录。');
  const { data, error } = await client.rpc('begin_original_cleanup', { target_batch: batchId });
  if (error || !data) throw new Error('无法开始清理。仅空间所有者可操作；复核或入库中的批次请稍后重试。');
  const plan = data as unknown as CleanupPlan;
  if (plan.batch_id !== batchId || !['deleting','deleted'].includes(plan.state)) throw new Error('清理范围未通过校验，已停止。');
  if (plan.state === 'deleted') return { state: 'deleted' as const, alreadyComplete: true };
  const files = Array.isArray(plan.files) && !plan.files.length ? [] : validateManifest(plan.files,plan.project_id,plan.batch_id);
  if (files.length) {
    const removed = await client.storage.from('raw-imports').remove(files.map(file => file.path));
    if (removed.error) throw new Error('原文件尚未清理完成，批次保持「清理中」。可确认后继续重试，期间不能导入或补传本批文件。');
  }
  const finished = await client.rpc('finish_original_cleanup', { target_batch: batchId });
  if (finished.error || !finished.data || (finished.data as unknown as {state:string}).state !== 'deleted') throw new Error('尚未确认全部文件已清除。请刷新状态后继续清理；不会标记为已完成。');
  return { state: 'deleted' as const, alreadyComplete: false };
}
