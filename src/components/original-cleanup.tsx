'use client';
import { useState } from 'react';
import type { Database } from '@/types/database';
import type { ImportManifest } from '@/lib/import-contract';
import { cleanupOriginals, CLEANUP_CONFIRMATION } from '@/lib/original-cleanup';
import { Icon } from './icon';
type Batch = Database['public']['Tables']['import_batches']['Row'];

export default function OriginalCleanup({ batch, preview=false, canManage=false, onChanged, onBusy }: {batch?:Batch; preview?:boolean; canManage?:boolean; onChanged?:()=>void; onBusy?:(busy:boolean)=>void}) {
  const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  const state=done?'deleted':batch?.originals_state||'retained';
  const files=batch?.file_manifest as unknown as ImportManifest|undefined;
  async function clean(){
    if(!batch||preview||!canManage||busy||confirmation!==CLEANUP_CONFIRMATION)return;
    setBusy(true);onBusy?.(true);setError('');
    try{await cleanupOriginals(batch.id,confirmation);setDone(true);setOpen(false);setConfirmation('');onChanged?.();}
    catch(error){setError(error instanceof Error?error.message:'清理未完成，请刷新后重试。');onChanged?.();}
    finally{setBusy(false);onBusy?.(false);}
  }
  return <section className="original-manager" aria-label="原文件保留与清理">
    <div className="original-heading"><Icon name="lock" size={20}/><div><span className="eyebrow section-eyebrow">ORIGINAL FILES</span><h3>保留有依据，清理有记录。</h3></div><span className="original-state">{preview?'合成演示':state==='deleted'?'原文件已清理':state==='deleting'?'清理中 · 可继续':'原文件保留中'}</span></div>
    <div className="retention-rules"><p><b>默认持续保留</b><span>不设置自动到期删除；空间所有者按实际授权和团队要求决定保留期限。</span></p><p><b>手动确认后清理</b><span>只处理所选批次，不批量清空空间。失败后可继续，完成前不会标为已清理。</span></p><p><b>保留来源与结果</b><span>文件名、哈希、来源和清理时间留存。已入库内容、评论及历史分析不会随原文件清理。</span></p></div>
    {preview?<p className="history-note">当前演示没有云端原文件。可以查看操作影响，实际清理需在真实项目由空间所有者执行。</p>:batch&&<p className="history-note">本批 {files?.length||0} 个文件 · {((files||[]).reduce((n,f)=>n+f.size,0)/1024).toFixed(1)} KiB{batch.originals_deleted_at?` · 清理完成于 ${new Date(batch.originals_deleted_at).toLocaleString('zh-CN')}`:''}</p>}
    {state==='deleted'&&!preview?<div className="notice success" role="status">原文件已清理，无法恢复或下载。来源记录与已入库结果仍可读取。此操作不等于删除数据库中的个人数据。</div>:<>
      {error&&<div className="notice error" role="alert">{error}</div>}
      {canManage||preview?<button className="secondary-button" disabled={busy} onClick={()=>{setOpen(!open);setConfirmation('');setError('');}}>{preview?'查看清理影响示例':state==='deleting'?'继续清理':'查看本批清理影响'}</button>:<p className="history-note">仅空间所有者可以清理原文件。编辑者和只读成员可查看保留状态。</p>}
      {open&&<div className="cleanup-impact"><h4>{preview?'合成示例 · 仅预览操作影响':'确认清理这批原始文件'}</h4><p>以下文件将永久移除，无法恢复；清理开始后本批不再接受补传或重新入库。</p><ul>{preview?['Posts.csv','Metrics.csv','Comments.csv'].map(name=><li key={name}>{name}<span>合成示例</span></li>):(files||[]).map(file=><li key={file.path}>{file.name}<span>{(file.size/1024).toFixed(1)} KiB</span></li>)}</ul><p>保留：批次记录、SHA-256、字段映射、已入库数据和分析报告。若需要删除个人数据，必须另行处理数据库记录、分析输入快照和本地导出文件。</p>
        {preview?<div className="notice" role="status">演示不执行清理，不修改任何云端文件或数据库。</div>:<><label className="cleanup-confirm">请输入「清理原文件」<input value={confirmation} disabled={busy} autoComplete="off" onChange={event=>setConfirmation(event.target.value)} placeholder="清理原文件"/></label><button className="primary-button cleanup-confirm-button" disabled={busy||confirmation!==CLEANUP_CONFIRMATION} onClick={()=>void clean()}>{busy?'正在清理…':state==='deleting'?'确认继续清理':'确认永久清理本批原文件'}</button></>}
      </div>}
    </>}
  </section>;
}
