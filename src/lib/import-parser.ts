import Papa from 'papaparse';
import { Temporal } from '@js-temporal/polyfill';
import type { CellObject } from 'xlsx';
import { MAX_BYTES, MAX_COLUMNS, MAX_ROWS, inferKind, isBlank, suggestMapping, type ImportTable, type ImportFileInfo, type RawCell } from './import-model.ts';

function checkHeaders(values: RawCell[]) {
  const headers = values.map(value => value === null ? '' : String(value).trim());
  while (headers.length && !headers.at(-1)) headers.pop();
  if (!headers.length) throw new Error('第一行没有表头，请把字段名放在第一行。');
  if (headers.length > MAX_COLUMNS) throw new Error(`列数超过 ${MAX_COLUMNS} 列，请先精简数据。`);
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (!header) throw new Error(`第 ${index + 1} 列表头为空，请补充字段名称。`);
    const key = header.toLowerCase();
    if (seen.has(key)) throw new Error(`表头「${header}」重复，请先为每列设置唯一名称。`);
    seen.add(key);
  });
  return headers;
}

function checkRow(cells: RawCell[], headers: string[], row: number) {
  if (cells.length > MAX_COLUMNS) throw new Error(`第 ${row} 条记录的列数超过 ${MAX_COLUMNS} 列。`);
  if (cells.slice(headers.length).some(value => !isBlank(value))) throw new Error(`第 ${row} 条记录含有超出表头的数据列，请检查分隔符或补齐表头。`);
  if (cells.some(value => typeof value === 'string' && value.length > 10000)) throw new Error(`第 ${row} 条记录含有超过 10000 字符的单元格，请先拆分或精简。`);
}

export function parseCsv(text: string, source = 'Posts.csv'): ImportTable {
  let headers: string[] = []; const rows: ImportTable['rows'] = []; let record = 0;
  const structural: string[] = [];
  Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    header: false, dynamicTyping: false, skipEmptyLines: false,
    delimitersToGuess: [',', '\t', ';'],
    step(result, parser) {
      record += 1;
      const problems = result.errors.filter(e => e.code !== 'UndetectableDelimiter');
      if (problems.length) { structural.push(`第 ${record} 条记录：引号或 CSV 结构不完整，请检查。`); parser.abort(); return; }
      if (record === 1) { headers = checkHeaders(result.data); return; }
      if (result.data.every(isBlank)) return;
      if (rows.length >= MAX_ROWS) { structural.push(`当前预览最多处理 ${MAX_ROWS} 条记录，请拆分文件。`); parser.abort(); return; }
      checkRow(result.data, headers, record);
      rows.push({ sourceRow: record, cells: result.data });
    },
  });
  if (structural.length) throw new Error(structural[0]);
  if (!headers.length) throw new Error('CSV 文件为空，或没有可识别的表头。');
  const kind = inferKind(source, headers);
  return { id: `${source}:csv`, source, kind, headers, rows, mapping: kind === 'ignore' ? {} : suggestMapping(kind, headers) };
}

// Read the central directory before decompression. No archive paths are extracted
// to disk. Oversized, encrypted, macro-bearing and ZIP64 containers are rejected.
export function checkXlsxContainer(buffer: ArrayBuffer) {
  const view = new DataView(buffer); const bytes = new Uint8Array(buffer);
  if (buffer.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) throw new Error('文件内容不是有效的 XLSX 工作簿，请勿只修改文件扩展名。');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Excel 文件不完整，请重新导出后上传。');
  const count = view.getUint16(end + 10, true); const offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 65535 || count > 2048 || offset === 0xffffffff) throw new Error('此工作簿的压缩结构不适合本地预览，请另存为普通 XLSX。');
  let cursor = offset; let expanded = 0; const names = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Excel 压缩目录损坏，请重新导出。');
    if (view.getUint16(cursor + 8, true) & 1) throw new Error('暂不支持加密或需要密码的工作簿。');
    const size = view.getUint32(cursor + 24, true); expanded += size;
    if (size === 0xffffffff || size > 40 * 1024 * 1024 || expanded > 80 * 1024 * 1024) throw new Error('工作簿解压后过大，请移除多余格式或拆分文件。');
    const length = view.getUint16(cursor + 28, true); const extra = view.getUint16(cursor + 30, true); const comment = view.getUint16(cursor + 32, true);
    if (cursor + 46 + length + extra + comment > end) throw new Error('Excel 压缩目录不完整。');
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + length));
    if (name.toLowerCase().includes('vbaproject')) throw new Error('暂不接受包含宏的工作簿，请另存为不含宏的 XLSX。');
    names.add(name); cursor += 46 + length + extra + comment;
  }
  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw new Error('文件不是可识别的 Excel 工作簿。');
}

export async function parseXlsx(buffer: ArrayBuffer, fileName: string): Promise<ImportTable[]> {
  checkXlsxContainer(buffer);
  const XLSX = await import('xlsx');
  let workbook: ReturnType<typeof XLSX.read>;
  try { workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellNF: true, cellFormula: true, cellHTML: false, sheetRows: MAX_ROWS + 2 }); }
  catch { throw new Error('工作簿无法解析，请确认它不是加密文件，并重新另存为 XLSX。'); }
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  function excelValue(cell: CellObject | undefined): { value: RawCell; formula: boolean } {
    if (!cell) return { value: null, formula: false };
    if (cell.f || cell.F || cell.t === 'e') return { value: '[公式或错误单元格]', formula: true };
    if (cell.t === 'n' && typeof cell.v === 'number' && Number.isSafeInteger(cell.v) && typeof cell.z === 'string' && /^0{2,}$/.test(cell.z)) {
      return { value: XLSX.SSF.format(cell.z!, cell.v), formula: false };
    }
    if (cell.t === 'n' && typeof cell.v === 'number' && cell.z && XLSX.SSF.is_date(cell.z)) {
      const d = XLSX.SSF.parse_date_code(cell.v, { date1904 });
      if (!d) throw new Error('工作簿中的日期数值无法解析。');
      const pad = (n: number) => String(n).padStart(2, '0');
      const base = `${d.y}-${pad(d.m)}-${pad(d.d)}T${pad(d.H)}:${pad(d.M)}:${pad(d.S)}`;
      // Excel dates are wall-clock values. Preserve sub-second precision but do
      // not add a browser-local time zone. Invalid Excel 1900-02-29 stays invalid.
      let value = base;
      try { value = Temporal.PlainDateTime.from(base).add({ microseconds: Math.round((d.u || 0) * 1e6) }).toString(); } catch {}
      return { value, formula: false };
    }
    return { value: typeof cell.v === 'string' || typeof cell.v === 'number' || typeof cell.v === 'boolean' ? cell.v : null, formula: false };
  }
  if (workbook.SheetNames.length > 8) throw new Error('当前预览最多接受 8 个工作表，请保留需要导入的表。');
  return workbook.SheetNames.filter(name => !!workbook.Sheets[name]['!ref']).map((name, index) => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']!);
    if (range.e.r > MAX_ROWS || range.e.c >= MAX_COLUMNS) throw new Error(`「${name}」超出 ${MAX_ROWS} 行或 ${MAX_COLUMNS} 列的预览上限，请同时清理多余空白格式。`);
    const header: RawCell[] = [];
    for (let col = 0; col <= range.e.c; col += 1) {
      const parsed = excelValue(sheet[XLSX.utils.encode_cell({ r: 0, c: col })]);
      if (parsed.formula) throw new Error(`「${name}」的表头包含公式，请先转换为文本。`);
      header[col] = parsed.value;
    }
    const headers = checkHeaders(Array.from(header, value => value ?? null));
    const rows: ImportTable['rows'] = [];
    for (let r = 1; r <= range.e.r; r += 1) {
      const cells: RawCell[] = []; const formulas: number[] = [];
      for (let col = 0; col <= range.e.c; col += 1) { const parsed = excelValue(sheet[XLSX.utils.encode_cell({ r, c: col })]); cells[col] = parsed.value; if (parsed.formula) formulas.push(col); }
      const filled = Array.from(cells, value => value ?? null);
      if (filled.every(isBlank)) continue;
      checkRow(filled, headers, r + 1); rows.push({ sourceRow: r + 1, cells: filled, formulas });
    }
    const kind = inferKind(name, headers);
    return { id: `${fileName}:${index}`, source: `${fileName} · ${name}`, kind, headers, rows, mapping: kind === 'ignore' ? {} : suggestMapping(kind, headers) };
  });
}

export async function readImportFiles(files: File[], encoding = 'utf-8') {
  if (!files.length) throw new Error('请先选择文件。');
  if (new Set(files.map(file => file.name)).size !== files.length) throw new Error('同批文件名称重复，请先重命名，确保来源可以区分。');
  if (files.some(file => !/\.(csv|xlsx)$/i.test(file.name))) throw new Error('仅支持 .csv 和 .xlsx；暂不接受 .xls、.xlsm 或压缩包。');
  const excel = files.filter(file => /\.xlsx$/i.test(file.name));
  if ((excel.length && files.length !== 1) || files.length > 3) throw new Error('请选择 1 个 Excel 工作簿，或一次选择最多 3 个 CSV 文件。');
  if (files.some(file => !file.size) || files.reduce((n, file) => n + file.size, 0) > MAX_BYTES) throw new Error('文件不能为空，一批文件合计不能超过 20 MiB。');
  const tables: ImportTable[] = []; const fileInfo: ImportFileInfo[] = [];
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    fileInfo.push({ name: file.name, size: file.size, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') });
    if (/\.xlsx$/i.test(file.name)) tables.push(...await parseXlsx(buffer, file.name));
    else {
      let text: string;
      try { text = new TextDecoder(encoding, { fatal: true }).decode(buffer); }
      catch { throw new Error(`「${file.name}」编码无法读取，可尝试选择 GB18030 后重新选择文件。`); }
      tables.push(parseCsv(text, file.name));
    }
  }
  if (!tables.length) throw new Error('没有找到包含表头的数据表。');
  if (tables.reduce((n, table) => n + table.rows.length, 0) > MAX_ROWS) throw new Error(`一批文件合计最多预览 ${MAX_ROWS} 条记录，请拆分文件。`);
  return { tables, files: fileInfo };
}
