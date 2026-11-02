'use client';
import { useState } from 'react';
import { prepareImport, invokeImport } from '@/lib/import-client';
import type { ImportSource, ServerResult } from '@/lib/import-contract';
import type { ImportFileInfo, ImportTable, ValidationReport } from '@/lib/import-model';
import { Icon } from './icon';

export default function ImportCommit({ projectId, projectName, timezone, originals, files, tables, encoding, sample, canWrite, preview, onBusy, onReport, onSaved, onReset }: {
  projectId: string; projectName: string; timezone: string; originals: File[]; files: ImportFileInfo[]; tables: ImportTable[]; encoding: string;
  sample: boolean; canWrite: boolean; preview: boolean; onBusy: (busy: boolean) => void; onReport: (report: ValidationReport) => void; onSaved: () => void; onReset: () => void;
}) {
  const [source, setSource] = useState<ImportSource>({ source_name: sample ? '内置合成示例' : '', data_owner_or_provider: '', license_name: 'unknown', notes: '', contains_personal_data: !sample });
  const [accepted, setAccepted] = useState(false); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState('');
  const [batchId, setBatchId] = useState(''); const [result, setResult] = useState<ServerResult | null>(null); const [error, setError] = useState('');
  const locked = busy || !!batchId; const allowed = canWrite && !preview;
  async function run(commit = false) {
    if (busy || !allowed || !accepted) return;
    setBusy(true); onBusy(true); setError('');
    try {
      let id = batchId;
      if (!id) {
        const prepared = await prepareImport(projectId, originals, files, tables, encoding, timezone, source, sample, setProgress);
        id = prepared.batchId; setBatchId(id);
      }
      setProgress(commit ? '正在重新校验并整批入库…' : '服务器正在读取原文件并复核…');
      const data = await invokeImport(id, commit ? 'commit' : 'validate');
      setResult(data); onSaved();
      if (data.report && !data.ready) onReport(data.report);
    } catch (error) { setError(error instanceof Error ? error.message : '处理未完成，请重试。'); onSaved(); }
    finally { setBusy(false); onBusy(false); setProgress(''); }
  }
  return <section className="commit-panel" aria-label="来源与入库">
    <div className="commit-intro"><span className="eyebrow section-eyebrow">SAVE WITH CONTEXT</span><h2>保留来源，让每条记录有据可查。</h2><p>保存到「{projectName}」。先上传原文件并由服务器复核，确认后整批写入内容、指标和评论。</p></div>
    {!allowed && <div className="notice" role="status">{preview ? '当前是演示项目，仅支持本机预览。请登录并打开自己的真实项目后保存。' : '你目前拥有只读权限。空间所有者或编辑者可以保存数据。'}</div>}
    {result?.result ? <div className="commit-success" role="status"><Icon name="check" size={30}/><h2>{result.result.already_applied ? '这批数据已经保存。' : '本批数据已完整入库。'}</h2><p>内容 {result.result.counts.Posts || 0} 条 · 快照 {result.result.counts.Metrics || 0} 条 · 评论 {result.result.counts.Comments || 0} 条</p><p>重复提交不会重复新增。原文件、字段映射和批次记录已保留。</p><code>批次 {result.batch_id}</code><button className="primary-button" onClick={onReset}>再导入一批<Icon name="plus" size={16}/></button></div> : <>
      <fieldset className="source-form" disabled={locked || !allowed}>
        <label>来源名称 <em>*</em><input required maxLength={200} value={source.source_name} placeholder="例如：品牌账号后台导出 · 2026年10月" onChange={e => setSource({ ...source, source_name: e.target.value })}/></label>
        <label>数据提供方 <span>选填</span><input maxLength={200} value={source.data_owner_or_provider} placeholder="机构、团队或账号" onChange={e => setSource({ ...source, data_owner_or_provider: e.target.value })}/></label>
        <label>授权或许可名称<input maxLength={200} value={source.license_name} placeholder="不确定时保留 unknown" onChange={e => setSource({ ...source, license_name: e.target.value || 'unknown' })}/></label>
        <label>来源说明 <span>选填</span><textarea maxLength={2000} rows={3} value={source.notes} placeholder="导出时间、采样范围、已知口径与使用限制" onChange={e => setSource({ ...source, notes: e.target.value })}/></label>
        <label className="source-check"><input type="checkbox" checked={source.contains_personal_data} onChange={e => setSource({ ...source, contains_personal_data: e.target.checked })}/>文件含个人数据，或尚未确认是否包含</label>
      </fieldset>
      <div className="commit-explainer"><Icon name="lock" size={17}/><p>原文件保存在项目私有空间，项目成员可读取。填写许可名称不等于授权已核实；本批不开放为公共演示。上传后，即使复核失败，原文件和批次记录也会保留。</p></div>
      <label className="source-check source-consent"><input type="checkbox" checked={accepted} disabled={busy || !allowed} onChange={e => setAccepted(e.target.checked)}/>我有权在该项目中处理这些数据，并已阅读质量报告和指标口径、评论覆盖提示。</label>
      {batchId && <p className="batch-reference">批次编号 <code>{batchId}</code></p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {progress && <div className="commit-progress" role="status"><span className="spinner"/>{progress}</div>}
      {result?.ready && <div className="notice success" role="status">服务器已重新读取原文件，{result.report?.summary.total} 条记录通过复核。确认入库时会再次检查，已有数据冲突将整批回滚。</div>}
      <div className="commit-actions"><button className="secondary-button" disabled={!allowed || !accepted || busy || !source.source_name.trim()} onClick={() => void run()}>{batchId ? '重新复核本批' : '上传原文件并复核'}</button><button className="primary-button" disabled={!allowed || !accepted || busy || !result?.ready} onClick={() => void run(true)}>确认入库<Icon name="arrow" size={16}/></button></div>
    </>}
  </section>;
}
