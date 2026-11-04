'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
import { readImportFiles } from '@/lib/import-parser';
import { validateImport, issueReportCsv } from '@/lib/import-validation';
import { sampleCsvFiles, templateCsv } from '@/lib/import-samples';
import { findExistingPosts } from '@/lib/import-service';
import { getSupabase } from '@/lib/supabase';
import ImportCommit from './import-commit';
import ImportHistory from './import-history';
import { complexCsvFiles } from '@/lib/demo-data';
import { FIELDS, KINDS, KIND_LABELS, displayCell, isBlank, suggestMapping, type DatasetKind, type ImportTable, type ImportFileInfo, type ValidationReport } from '@/lib/import-model';

function download(text: string, name: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const short = (value: unknown, length = 48) => { const text = displayCell(value); return text.length > length ? `${text.slice(0, length)}…` : text; };
const PAGE = 10;

export default function ImportPreview({ projectId, projectName, timezone, canWrite, canManage, preview, onBack }: { projectId: string; projectName: string; timezone: string; canWrite: boolean; canManage: boolean; preview: boolean; onBack: () => void }) {
  const [step, setStep] = useState(1); const [tables, setTables] = useState<ImportTable[]>([]);
  const [files, setFiles] = useState<ImportFileInfo[]>([]); const [activeId, setActiveId] = useState('');
  const [originals, setOriginals] = useState<File[]>([]); const [historyRefresh, setHistoryRefresh] = useState(0);
  const [encoding, setEncoding] = useState('utf-8'); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [dragging, setDragging] = useState(false); const [sample, setSample] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null); const [reportKind, setReportKind] = useState<DatasetKind>('Posts');
  const [onlyErrors, setOnlyErrors] = useState(false); const [page, setPage] = useState(0); const [issuePage, setIssuePage] = useState(0);
  const input = useRef<HTMLInputElement>(null); const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [step]);
  const active = tables.find(table => table.id === activeId) || tables[0];
  const selectedTables = tables.filter(table => table.kind !== 'ignore');
  async function choose(selected: File[], isSample = false) {
    const current = ++request.current; setBusy(true); setError(''); setReport(null); setTables([]); setFiles([]); setOriginals([]); setSample(isSample); setStep(1);
    try {
      const data = await readImportFiles(selected, encoding);
      if (request.current !== current) return;
      setTables(data.tables); setFiles(data.files); setOriginals(selected); setActiveId(data.tables[0].id);
    } catch (error) { if (request.current === current) setError(error instanceof Error ? error.message : '文件无法读取，请重新选择。'); }
    finally { if (request.current === current) setBusy(false); if (input.current) input.current.value = ''; }
  }
  function updateTable(id: string, changes: Partial<ImportTable>) { setTables(previous => previous.map(table => table.id === id ? { ...table, ...changes } : table)); setReport(null); }
  async function runValidation() {
    const current = ++request.current; setBusy(true);
    try { setError(''); const existing = preview ? [] : await findExistingPosts(getSupabase(), projectId, tables); if (request.current !== current) return; setReport(validateImport(tables, timezone, existing)); setStep(3); setPage(0); setIssuePage(0); setOnlyErrors(false); setReportKind('Posts'); }
    catch (error) { if (request.current === current) setError(error instanceof Error ? error.message : '校验未完成，请检查文件格式与时区设置后重试。'); }
    finally { if (request.current === current) setBusy(false); }
  }
  function loadSamples(withErrors = false) {
    const data = sampleCsvFiles(withErrors);
    void choose(KINDS.map(kind => new File([data[kind]], `${kind}.csv`, { type: 'text/csv' })), true);
  }
  function loadComplex() { const data = complexCsvFiles(); void choose(KINDS.map(kind => new File([data[kind]], `${kind}.csv`, { type: 'text/csv' })), true); }
  const reportTables = report?.tables.filter(table => table.kind === reportKind) || [];
  const reportRows = reportTables.flatMap(table => table.rows.map(row => ({ ...row, source: table.source, tableId: table.tableId })));
  const filteredRows = reportRows.filter(row => !onlyErrors || row.issues.some(issue => issue.severity === 'error'));
  const previewRows = filteredRows.slice(page * PAGE, (page + 1) * PAGE);
  const issueRows = report?.issues.slice(issuePage * PAGE, (issuePage + 1) * PAGE) || [];
  const hasErrors = !!report?.issues.some(issue => issue.severity === 'error');
  return <section className="import-workspace" aria-label="数据导入与预览">
    <button className="back-link" disabled={busy} onClick={onBack}><Icon name="arrow" size={16} style={{ transform: 'rotate(180deg)' }}/>返回项目详情</button>
    <div className="page-heading import-heading"><div><div className="eyebrow section-eyebrow">IMPORT YOUR CONTENT</div><h1>导入与入库<span className="heading-dot">.</span></h1><p className="muted">{projectName} <span className="project-separator">/</span> 先把数据看清楚，再确认保存。</p></div><span className="local-badge"><Icon name="lock" size={14}/>{preview ? "本机演示" : "项目私有保存"}</span></div>
    <nav className="import-steps" aria-label="导入步骤">{['选择文件', '字段映射', '校验预览', '来源与入库'].map((label, index) => <button key={label} className={`${step === index + 1 ? 'current' : ''} ${step > index + 1 ? 'completed' : ''}`} disabled={busy || (index === 1 && !tables.length) || (index === 2 && !report) || (index === 3 && (!report || hasErrors))} onClick={() => setStep(index + 1)} aria-current={step === index + 1 ? 'step' : undefined}><span>{step > index + 1 ? <Icon name="check" size={15}/> : index + 1}</span><b>{label}</b>{index < 3 && <i/>}</button>)}</nav>
    <div className="import-privacy"><Icon name="lock" size={17}/><div><b>{preview ? "演示文件只保留在本机。" : "点击「上传原文件并复核」后，文件才会私有保存。"}</b><p>{preview ? "演示不会上传或写入数据库。" : "前面三步在浏览器解析和预览；真实项目会核对已有内容编号。服务器复核通过后，还需点击「确认入库」写入业务数据。"}未上传的文件会在刷新或离开页面后清除。</p></div></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {sample && !!tables.length && <div className="sample-notice"><Icon name="eye" size={15}/>当前使用合成示例，内容与数值均不来自真实用户。</div>}
    {step === 1 && <>
      <div className="import-upload-layout"><div>
        <div className={`upload-zone ${dragging ? 'dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) void choose(Array.from(event.dataTransfer.files)); }}>
          <input ref={input} type="file" accept=".csv,.xlsx" multiple aria-label="选择 CSV 或 Excel 数据文件" hidden onChange={event => { if (event.target.files) void choose(Array.from(event.target.files)); }}/>
          <span className="upload-symbol">{busy ? <span className="spinner"/> : <Icon name="upload" size={30}/>}</span><h2>{busy ? '正在本机读取文件…' : '把内容数据放到这里'}</h2><p>拖入一个 Excel 工作簿，或一次选择最多三个 CSV 文件。</p><button className="primary-button" disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" size={17}/>{tables.length ? '重新选择文件' : '选择文件'}</button><small>仅 .xlsx / .csv · 合计不超过 20 MiB · 最多 10,000 条记录</small>
        </div>
        <div className="encoding-row"><label>CSV 编码 <select aria-label="CSV 文件编码" value={encoding} disabled={busy} onChange={event => { setEncoding(event.target.value); request.current += 1; setTables([]); setFiles([]); setOriginals([]); setReport(null); setSample(false); setError(''); }}><option value="utf-8">UTF-8（推荐）</option><option value="gb18030">GB18030 / GBK</option></select></label><span>编码改变后需重新选择文件。</span></div>
        {!!files.length && <div className="loaded-files" aria-label="已读取文件">{files.map(file => <div key={file.name}><span className="file-symbol"><Icon name="layers" size={19}/></span><div><b>{file.name}</b><small>{(file.size / 1024).toFixed(1)} KiB · SHA-256 {file.sha256.slice(0, 12)}…</small></div><span className="file-ready"><Icon name="check" size={13}/>已读取</span></div>)}</div>}
      </div><aside className="import-guide"><span className="eyebrow section-eyebrow">A LITTLE PREPARATION</span><h2>三类数据，各有位置。</h2><p>第一行放字段名。内容编号 <code>content_key</code> 用来连接内容、快照与评论。</p><div className="data-type-list">{KINDS.map((kind, index) => <div key={kind}><span className={`project-symbol color-${index}`}><Icon name={['folder', 'chart', 'bubble'][index]} size={18}/></span><div><b>{KIND_LABELS[kind]} <code>{kind}</code></b><small>{['一行，一篇内容', '一行，一个采集时刻', '一行，一条用户评论'][index]}</small></div><button className="text-link" onClick={() => download(templateCsv(kind), `${kind}_Template.csv`)}>CSV 模板<Icon name="arrow" size={12}/></button></div>)}</div><div className="guide-note">Excel 建议命名为 Posts、Metrics、Comments。自定义表名和字段可在下一步手动指定。</div><button className="secondary-button sample-button" onClick={() => loadSamples()} disabled={busy}><Icon name="spark" size={16}/>先用合成示例试一下</button><button className="secondary-button sample-button" style={{marginTop:10}} onClick={loadComplex} disabled={busy}><Icon name="chart" size={16}/>复杂样本：360 内容 / 2,400 评论</button><button className="text-link error-sample-link" onClick={() => loadSamples(true)} disabled={busy}>也可以看看含错误的示例</button></aside></div>
      {!!tables.length && <div className="import-bottom"><span><b>{tables.length}</b> 张表 · <b>{tables.reduce((sum, table) => sum + table.rows.length, 0)}</b> 条非空记录已读取</span><button className="primary-button" onClick={() => setStep(2)}>继续：字段映射<Icon name="arrow" size={17}/></button></div>}
    </>}
    {step === 2 && <>
      <div className="mapping-intro"><h2>让每一列，找到对应的位置。</h2><p>已自动匹配常见中英文字段。请确认数据类型和必填字段，也可以忽略不参与本次预览的表。</p></div>
      <div className="source-table-tabs" role="tablist" aria-label="来源数据表">{tables.map(table => <button key={table.id} role="tab" aria-selected={active?.id === table.id} className={active?.id === table.id ? 'selected' : ''} onClick={() => setActiveId(table.id)}><Icon name="layers" size={15}/><span>{table.source}</span><small>{table.rows.length} 条</small></button>)}</div>
      {active && <div className="mapping-panel"><div className="mapping-panel-heading"><div><h3>{active.source}</h3><p>{active.rows.length} 条记录 · 第一行为表头</p></div><label>这张表是 <select aria-label="当前表的数据类型" value={active.kind} onChange={event => { const kind = event.target.value as ImportTable['kind']; updateTable(active.id, { kind, mapping: kind === 'ignore' ? {} : suggestMapping(kind, active.headers) }); }}><option value="ignore">忽略这张表</option>{KINDS.map(kind => <option key={kind} value={kind}>{KIND_LABELS[kind]} · {kind}</option>)}</select></label></div>
        {active.kind === 'ignore' ? <div className="ignored-table"><Icon name="layers" size={27}/><h3>这张表暂不参与预览。</h3><p>如果它包含内容、指标或评论，可在右上方指定数据类型。</p></div> : <div className="mapping-scroll"><table className="mapping-table"><thead><tr><th>标准字段</th><th>你的源列</th><th>第一条记录示例</th></tr></thead><tbody>{FIELDS[active.kind].map(field => { const col = active.mapping[field.key]; return <tr key={field.key}><td><span className="field-label">{field.label}{field.required && <em>*</em>}</span><code>{field.key}</code></td><td><select aria-label={`映射 ${field.key}`} className={field.required && col === undefined ? 'needs-mapping' : ''} value={col ?? ''} onChange={event => updateTable(active.id, { mapping: { ...active.mapping, [field.key]: event.target.value === '' ? undefined : Number(event.target.value) } })}><option value="">{field.required ? '请选择必填字段' : '不提供此字段'}</option>{active.headers.map((header, index) => <option value={index} key={index}>{header}</option>)}</select></td><td title={col === undefined ? '' : displayCell(active.rows[0]?.cells[col])}>{col === undefined ? <span className="missing-value">未映射</span> : short(active.rows[0]?.cells[col])}</td></tr>; })}</tbody></table></div>}
      </div>}
      <p className="mapping-hint"><Icon name="help" size={15}/>新增内容需提供 Posts；为已有内容补充指标或评论时可仅提供对应文件，并使用项目内原内容编号。日期未注明时区时，按项目时区 {timezone} 解析。</p>
      <div className="import-bottom"><button className="secondary-button" onClick={() => setStep(1)}>返回选择文件</button><button className="primary-button" disabled={!selectedTables.length || busy} onClick={() => void runValidation()}>{busy ? "正在核对项目数据…" : "运行校验并预览"}<Icon name="arrow" size={17}/></button></div>
    </>}
    {step === 3 && report && <>
      <div className={`quality-status ${hasErrors ? 'has-errors' : 'is-valid'}`}><span><Icon name={hasErrors ? 'help' : 'check'} size={24}/></span><div><h2>{hasErrors ? '发现需要修正的记录。' : '核心字段校验通过，可以继续核对数据。'}</h2><p>{hasErrors ? '原始数据没有被修改。你可以返回调整映射，或下载问题清单后修正原文件。' : '请继续确认平台口径、评论覆盖和来源授权；通过结构校验不代表数据已入库或授权已核实。'}</p></div><button className="secondary-button" onClick={() => download(issueReportCsv(report), 'Content_Intelligence_Quality_Report.csv')}>下载问题清单<Icon name="arrow" size={15}/></button></div>
      <div className="quality-cards">{[['总记录', report.summary.total, '不含表头与全空白行'], ['通过核心校验', report.summary.valid, '无错误的记录，可能仍有提示'], ['需修正', report.summary.errors, '含至少一个错误的记录'], ['重复 / 疑似重复', report.summary.duplicateRows, '已包含在前述记录中，不相加']].map(([label, value, note], index) => <div key={label} className={index === 2 && report.summary.errors ? 'quality-error' : ''}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
      <div className="quality-rate">有效记录率 = 通过核心校验的记录数 ÷ 总输入记录数：<b>{report.summary.total ? `${(report.summary.valid / report.summary.total * 100).toFixed(1)}%` : '不可计算'}</b>。整表级错误需另行处理；提示不代表错误。</div>
      <section className="data-preview-panel"><div className="preview-panel-heading"><h2>标准化数据预览</h2><label className="error-only"><input type="checkbox" checked={onlyErrors} onChange={event => { setOnlyErrors(event.target.checked); setPage(0); }}/>只看错误记录</label></div><div className="dataset-tabs" role="tablist" aria-label="预览数据类型">{KINDS.map(kind => <button role="tab" aria-selected={reportKind === kind} className={reportKind === kind ? 'selected' : ''} key={kind} onClick={() => { setReportKind(kind); setPage(0); }}>{KIND_LABELS[kind]}<span>{report.tables.filter(table => table.kind === kind).reduce((n, table) => n + table.rows.length, 0)}</span></button>)}</div><p className="table-note">时间以 UTC 展示；「未提供」表示 NULL，不会变成 0。计数保留完整整数精度，可左右滑动查看。</p>
        {previewRows.length ? <div className="data-table-scroll"><table className="preview-data-table"><thead><tr><th>来源记录号</th><th>状态</th>{FIELDS[reportKind].map(field => <th key={field.key}>{field.label}<code>{field.key}</code></th>)}</tr></thead><tbody>{previewRows.map(row => <tr className={row.issues.some(issue => issue.severity === 'error') ? 'error-row' : ''} key={`${row.tableId}:${row.sourceRow}`}><td title={row.source}>{row.sourceRow}<small className="row-source">{short(row.source, 22)}</small></td><td><span className={`row-status ${row.issues.some(issue => issue.severity === 'error') ? 'bad' : row.issues.length ? 'warn' : 'good'}`}>{row.issues.some(issue => issue.severity === 'error') ? '需修正' : row.issues.length ? '有提示' : '通过'}</span></td>{FIELDS[reportKind].map(field => <td key={field.key} title={displayCell(row.values[field.key])}>{isBlank(row.values[field.key]) ? <span className="missing-value">未提供</span> : short(row.values[field.key], 70)}</td>)}</tr>)}</tbody></table></div> : <div className="preview-empty">{!reportTables.length ? '本批没有提供这类数据。' : onlyErrors ? '这类数据没有错误记录。' : '这张表没有数据记录。'}</div>}
        <div className="table-pagination"><span>{KIND_LABELS[reportKind]} · {filteredRows.length} 条记录</span><div><button disabled={page === 0} onClick={() => setPage(n => n - 1)}>上一页</button><span>{Math.min(page + 1, Math.max(1, Math.ceil(filteredRows.length / PAGE)))} / {Math.max(1, Math.ceil(filteredRows.length / PAGE))}</span><button disabled={(page + 1) * PAGE >= filteredRows.length} onClick={() => setPage(n => n + 1)}>下一页</button></div></div>
      </section>
      <section className="issues-panel"><div className="preview-panel-heading"><h2>数据问题与处理建议 <span>{report.issues.length}</span></h2><span>{report.issues.filter(issue => issue.severity === 'error').length} 个错误 · {report.issues.filter(issue => issue.severity === 'warning').length} 个提示</span></div>{issueRows.length ? <div className="issues-list">{issueRows.map((issue, index) => <div className="issue-item" key={`${issue.tableId}-${issue.row}-${issue.code}-${index}`}><span className={`row-status ${issue.severity === 'error' ? 'bad' : 'warn'}`}>{issue.severity === 'error' ? '错误' : '提示'}</span><div><b>{issue.message}</b><small>{issue.source} · {issue.row ? `记录 ${issue.row}` : '整表检查'}{issue.field ? ` · ${issue.field}` : ''}</small><p>{issue.suggestion}</p></div></div>)}</div> : <div className="preview-empty">没有发现问题。</div>}<div className="table-pagination"><span>同一条记录可能对应多个问题。</span><div><button disabled={!issuePage} onClick={() => setIssuePage(n => n - 1)}>上一页</button><span>{issuePage + 1} / {Math.max(1, Math.ceil(report.issues.length / PAGE))}</span><button disabled={(issuePage + 1) * PAGE >= report.issues.length} onClick={() => setIssuePage(n => n + 1)}>下一页</button></div></div></section>
      <details className="coverage-panel"><summary>查看字段覆盖率与文件校验信息</summary><p>覆盖率 = 标准化后非空值数 ÷ 该类型记录数；它只反映字段可用性，不代表数据已获授权。</p><div className="coverage-grid">{report.coverage.filter(field => field.total).map(field => <div key={`${field.kind}-${field.field}`}><span>{KIND_LABELS[field.kind]} · {field.label}</span><b>{field.present} / {field.total}</b></div>)}</div>{files.map(file => <p className="file-hash" key={file.name}>{file.name}<code>SHA-256 {file.sha256}</code></p>)}</details>
      <div className="import-bottom"><button className="secondary-button" onClick={() => setStep(2)}>返回调整映射</button><div className="next-phase"><span>{hasErrors ? '请先修正所有错误。' : '下一步填写来源，再私有保存。'}</span><button className="primary-button" disabled={hasErrors || !report.summary.total} onClick={() => setStep(4)}>继续：来源与入库<Icon name="arrow" size={16}/></button></div></div>
    </>}
    {report && <div hidden={step !== 4}><ImportCommit projectId={projectId} projectName={projectName} timezone={timezone} originals={originals} files={files} tables={tables} encoding={encoding} sample={sample} canWrite={canWrite} preview={preview} onBusy={setBusy} onReport={report => { setReport(report); setStep(3); }} onSaved={() => setHistoryRefresh(n => n + 1)} onReset={() => { setOriginals([]); setFiles([]); setTables([]); setReport(null); setSample(false); setStep(1); }}/></div>}
    <ImportHistory projectId={projectId} preview={preview} canWrite={canWrite} canManage={canManage} refresh={historyRefresh}/>
  </section>;
}
