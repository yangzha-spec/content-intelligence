'use client';
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { invokeImport } from '@/lib/import-client';
import { issueReportCsv } from '@/lib/import-validation';
import type { Database } from '@/types/database';
import type { ImportManifest, ServerResult } from '@/lib/import-contract';
import { Icon } from './icon';

type Batch = Database['public']['Tables']['import_batches']['Row'];
const labels: Record<string, string> = { pending: '待上传', uploaded: '待复核', validating: '复核中', ready: '待确认', committing: '入库中', success: '已入库', failed: '未完成' };
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export default function ImportHistory({ projectId, preview, canWrite, refresh }: { projectId: string; preview: boolean; canWrite: boolean; refresh: number }) {
  const [batches, setBatches] = useState<Batch[]>([]); const [page, setPage] = useState(0); const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [selected, setSelected] = useState<Batch | null>(null); const [result, setResult] = useState<ServerResult | null>(null); const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (preview) return;
    let alive = true; setLoading(true); setError('');
    void getSupabase().from('import_batches').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).order('id').range(page * 10, page * 10 + 9).then(({ data, error }) => {
      if (!alive) return;
      if (error) setError('导入历史暂时无法读取，请稍后刷新。'); else { setBatches(data || []); setSelected(previous => previous ? data?.find(b => b.id === previous.id) || previous : null); }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId, preview, page, revision, refresh]);
  async function original(path: string, name: string) {
    setBusy(true); setError('');
    try { const { data, error } = await getSupabase().storage.from('raw-imports').download(path); if (error || !data) throw new Error('原文件无法读取，请确认权限与文件上传状态。'); download(data, name); }
    catch (error) { setError(error instanceof Error ? error.message : '下载未完成。'); }
    finally { setBusy(false); }
  }
  async function retry(action: 'validate' | 'commit') {
    if (!selected || !canWrite || !accepted || busy) return;
    setBusy(true); setError('');
    try { setResult(await invokeImport(selected.id, action)); setRevision(n => n + 1); }
    catch (error) { setError(error instanceof Error ? error.message : '处理未完成。'); setRevision(n => n + 1); }
    finally { setBusy(false); }
  }
  return <section className="import-history" aria-label="导入历史"><div className="preview-panel-heading"><div><span className="eyebrow section-eyebrow">IMPORT HISTORY</span><h2>每次导入，都有记录。</h2></div><button className="secondary-button" disabled={preview || loading || busy} onClick={() => setRevision(n => n + 1)}>刷新历史</button></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {loading ? <div className="preview-empty"><span className="spinner"/>正在读取导入历史…</div> : !batches.length ? <div className="history-empty"><Icon name="layers" size={25}/><h3>{preview ? '演示项目不保存导入记录' : '还没有导入记录'}</h3><p>{preview ? '登录真实项目后，原文件、复核状态和入库数量会出现在这里。' : '完成上方文件预览，再上传原文件并确认入库。'}</p></div> : <div className="history-list">{batches.map(batch => <button key={batch.id} className={selected?.id === batch.id ? 'selected' : ''} disabled={busy} onClick={() => { setSelected(selected?.id === batch.id ? null : batch); setResult(null); setAccepted(false); setError(''); }}><span className="file-symbol"><Icon name="layers" size={20}/></span><div><b>{batch.file_name}</b><small>{new Date(batch.created_at).toLocaleString('zh-CN')} · {batch.source_name}</small></div><span className={`row-status ${batch.status === 'success' ? 'good' : batch.status === 'failed' ? 'bad' : 'warn'}`}>{labels[batch.status] || batch.status}</span><Icon name="chevron" size={14}/></button>)}</div>}
    {selected && <div className="history-detail"><h3>{selected.source_name}</h3><dl><div><dt>批次编号</dt><dd><code>{selected.id}</code></dd></div><div><dt>文件 / 映射版本</dt><dd>{selected.mapping_version} / {selected.processing_version}</dd></div><div><dt>来源与授权</dt><dd>{selected.source_type === 'synthetic' ? '合成示例' : '用户上传'} · {selected.license_name} · {selected.license_verified ? '已记录授权核实' : '授权尚未核实'}</dd></div><div><dt>数据提供方</dt><dd>{selected.data_owner_or_provider || '未提供'}</dd></div><div><dt>{selected.status === "success" ? "已入库数量" : "复核记录数"}</dt><dd>{Object.entries((selected.row_counts || {}) as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(' · ') || '尚未复核'}</dd></div></dl>
      {selected.notes && <p className="history-note">{selected.notes}</p>}
      {selected.error_message && <div className="notice error">{selected.error_message}</div>}
      {(selected.file_manifest as unknown as ImportManifest).map(file => <div className="history-file" key={file.path}><div><b>{file.name}</b><small>{(file.size / 1024).toFixed(1)} KiB</small><code>SHA-256 {file.sha256}</code></div><button className="text-link" disabled={busy} onClick={() => void original(file.path, file.name)}>下载原文件<Icon name="arrow" size={13}/></button></div>)}
      {selected.status !== 'success' && canWrite && <><p className="history-note">重试会使用本批保存的原文件、映射和时区重新复核。若要修改文件、映射或来源，请建立新批次。未传完的文件需重新选择同一组原文件上传。</p><label className="source-check"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)}/>我已核对来源和质量提示，确认有权处理本批数据。</label><div className="commit-actions"><button className="secondary-button" disabled={busy || !accepted} onClick={() => void retry('validate')}>{busy ? '正在处理…' : '重新复核'}</button><button className="primary-button" disabled={busy || !accepted || !result?.ready} onClick={() => void retry('commit')}>确认入库</button></div></>}
      {result?.ready && <div className="notice success" role="status">复核通过，共 {result.report?.summary.total} 条记录。确认后整批写入，已有数据冲突会回滚。</div>}
      {result?.report && <div className="history-review"><p>{result.report.issues.filter(i => i.severity === 'error').length} 个错误 · {result.report.issues.filter(i => i.severity === 'warning').length} 个提示</p>{result.report.issues.slice(0, 5).map((issue, i) => <p key={i}>{issue.source} · {issue.row || '整表'}：{issue.message}</p>)}<button className="text-link" onClick={() => download(new Blob([issueReportCsv(result.report!)], { type: 'text/csv;charset=utf-8' }), 'Content_Intelligence_Quality_Report.csv')}>下载完整问题清单</button></div>}
      {result?.result && <div className="notice success" role="status">{result.result.already_applied ? '本批此前已入库，没有重复新增。' : '本批已完整入库。'}</div>}
    </div>}
    {!preview && <div className="table-pagination"><span>每页最多 10 个批次</span><div><button disabled={!page || loading || busy} onClick={() => { setPage(n => n - 1); setSelected(null); }}>上一页</button><span>{page + 1}</span><button disabled={batches.length < 10 || loading || busy} onClick={() => { setPage(n => n + 1); setSelected(null); }}>下一页</button></div></div>}
  </section>;
}
