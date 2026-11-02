import assert from 'node:assert/strict';
import { test } from 'node:test';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseCsv, parseXlsx, readImportFiles, checkXlsxContainer } from '../src/lib/import-parser.ts';
import { normalizeCount, normalizeDate, validateImport, csvText, issueReportCsv } from '../src/lib/import-validation.ts';
import { suggestMapping, MAX_ROWS } from '../src/lib/import-model.ts';
import { sampleCsvFiles, templateCsv } from '../src/lib/import-samples.ts';

const posts = (rows = [['p1', 'youtube', 'Synthetic title', 'video', '2026-10-01 10:00:00']]) =>
  parseCsv(Papa.unparse([['content_key', 'platform', 'title', 'content_type', 'publish_time'], ...rows]), 'Posts.csv');
const metrics = (rows) => parseCsv(Papa.unparse([['content_key', 'snapshot_time', 'views', 'likes'], ...rows]), 'Metrics.csv');
const comments = (rows) => parseCsv(Papa.unparse([['content_key', 'comment_text', 'comment_time', 'external_comment_id'], ...rows]), 'Comments.csv');
const issue = (report, code) => report.issues.filter(item => item.code === code);
function workbookBuffer(date1904 = false) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['content_key', 'platform', 'title', 'content_type', 'publish_time'], ['p1', 'youtube', 'Synthetic', 'video', 'placeholder']]);
  sheet.E2 = { t: 'n', v: date1904 ? 1 + 10 / 24 : 46296 + 10 / 24, z: 'yyyy-mm-dd hh:mm:ss' };
  XLSX.utils.book_append_sheet(wb, sheet, 'Posts');
  if (date1904) wb.Workbook = { WBProps: { date1904: true } };
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
}

test('CSV supports UTF-8 BOM, quoted commas, multiline text and blank rows without renumbering', () => {
  const table = parseCsv('\uFEFFcontent_key,title\r\np1,"第一行,第二项\n下一行"\r\n\r\np2,标题\r\n', 'Posts.csv');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].cells[1], '第一行,第二项\n下一行');
  assert.equal(table.rows[1].sourceRow, 4);
});
test('CSV detects semicolon delimiters and rejects duplicate or missing headers', () => {
  assert.deepEqual(parseCsv('content_key;title\np1;Example').headers, ['content_key', 'title']);
  assert.throws(() => parseCsv('title,title\na,b'), /重复/);
  assert.throws(() => parseCsv('content_key,,title\np1,x,t'), /表头为空/);
});
test('malformed CSV and data outside the header are rejected instead of silently dropped', () => {
  assert.throws(() => parseCsv('a,b\nx,"unclosed'), /引号|结构/);
  assert.throws(() => parseCsv('a,b\nx,y,z'), /超出表头/);
});
test('CSV record limit rejects oversized batches', () => {
  assert.throws(() => parseCsv('a,b\n' + 'x,y\n'.repeat(MAX_ROWS + 1)), /最多处理/);
});
test('Chinese aliases map to the intended standard fields', () => {
  assert.equal(suggestMapping('Posts', ['作品编号', '标题', '发布时间']).content_key, 0);
  assert.equal(suggestMapping('Metrics', ['点赞数']).likes, 0);
});
test('downloadable templates include required headers and contain no fake observations', () => {
  const table = parseCsv(templateCsv('Posts'), 'Posts.csv');
  assert.ok(table.headers.includes('content_key')); assert.ok(table.headers.includes('publish_time'));
  assert.equal(table.rows.length, 0);
});
test('NULL, observed zero and complete BIGINT precision are preserved', () => {
  assert.equal(normalizeCount(''), null);
  assert.equal(normalizeCount(0), '0');
  assert.equal(normalizeCount('9223372036854775807'), '9223372036854775807');
  for (const value of ['-1', '1.5', '1e3', true, 9007199254740992, '9223372036854775808']) assert.throws(() => normalizeCount(value));
});
test('local dates use the project zone, and explicit offsets resolve to the same instant', () => {
  assert.equal(normalizeDate('2026-10-01 10:00:00', 'Asia/Shanghai'), '2026-10-01T02:00:00Z');
  assert.equal(normalizeDate('2026-10-01T10:00:00+08:00', 'UTC'), '2026-10-01T02:00:00Z');
});
test('impossible dates, ambiguous formats and DST gaps or overlaps are rejected', () => {
  for (const [value, zone] of [['2026-02-30 10:00:00', 'UTC'], ['10/01/2026', 'UTC'], ['2026-03-08 02:30:00', 'America/New_York'], ['2026-11-01 01:30:00', 'America/New_York']]) assert.throws(() => normalizeDate(value, zone));
});
test('stable content keys retain leading zeroes', () => {
  const report = validateImport([posts([['0000123', 'youtube', 'Title', 'video', '2026-10-01 10:00:00']])]);
  assert.equal(report.tables[0].rows[0].values.content_key, '0000123');
});
test('metric blanks are NULL and observed zero remains zero after full validation', () => {
  const report = validateImport([posts(), metrics([['p1', '2026-10-02 10:00:00', '', '0']])]);
  const row = report.tables.find(table => table.kind === 'Metrics').rows[0];
  assert.equal(row.values.views, null); assert.equal(row.values.likes, '0');
  assert.equal(report.summary.errors, 0);
});
test('orphan comments and snapshots are identified by source record', () => {
  const report = validateImport([posts(), metrics([['missing', '2026-10-02 10:00:00', '2', '1']]), comments([['missing', 'Synthetic', '', 'c1']])]);
  assert.equal(issue(report, 'ORPHAN_CONTENT').length, 2);
  assert.ok(issue(report, 'ORPHAN_CONTENT').every(item => item.row === 2));
});
test('all duplicate content rows and their ambiguous children are flagged', () => {
  const report = validateImport([posts([['p1', 'youtube', 'One', 'video', '2026-10-01 10:00:00'], ['p1', 'youtube', 'Two', 'video', '2026-10-01 11:00:00']]), metrics([['p1', '2026-10-02 10:00:00', '1', '0']])]);
  assert.equal(issue(report, 'DUPLICATE_CONTENT').length, 2);
  assert.equal(issue(report, 'INVALID_PARENT').length, 1);
});
test('equivalent time-zone snapshots collide after normalization', () => {
  const report = validateImport([posts(), metrics([['p1', '2026-10-02 10:00:00', '1', '0'], ['p1', '2026-10-02T02:00:00Z', '1', '0']])]);
  assert.equal(issue(report, 'DUPLICATE_SNAPSHOT').length, 2);
});
test('stable comment duplicates are errors; inferred identical text remains a warning', () => {
  const stable = validateImport([posts(), comments([['p1', 'One', '', 'c1'], ['p1', 'Two', '', 'c1']])]);
  assert.equal(issue(stable, 'DUPLICATE_COMMENT_ID').length, 2);
  const inferred = validateImport([posts(), comments([['p1', 'Same', '', ''], ['p1', 'Same', '', '']])]);
  assert.equal(issue(inferred, 'POSSIBLE_DUPLICATE_COMMENT').length, 2);
  assert.ok(issue(inferred, 'POSSIBLE_DUPLICATE_COMMENT').every(i => i.severity === 'warning'));
  assert.equal(inferred.tables.find(t => t.kind === 'Comments').rows.length, 2);
});
test('comment times before publication are review warnings, not deleted rows', () => {
  const report = validateImport([posts(), comments([['p1', 'Synthetic', '2026-09-30 10:00:00', 'c1']])]);
  assert.equal(issue(report, 'BEFORE_PUBLICATION')[0].severity, 'warning');
  assert.equal(report.summary.total, 2); assert.equal(report.summary.errors, 0);
});
test('missing mappings, reused columns and unsupported period snapshots are explicit errors', () => {
  const post = posts(); post.mapping.title = undefined; post.mapping.content_text = post.mapping.platform;
  const metric = metrics([['p1', '2026-10-02 10:00:00', '1', '0']]); metric.headers.push('type'); metric.mapping.snapshot_type = 4; metric.rows[0].cells.push('period');
  const report = validateImport([post, metric]);
  assert.ok(issue(report, 'REQUIRED_MAPPING').length); assert.ok(issue(report, 'REUSED_COLUMN').length); assert.ok(issue(report, 'UNSUPPORTED_PERIOD').length);
});
test('unknown platform values do not silently become a supported platform', () => {
  const report = validateImport([posts([['p1', 'invented', 'Title', 'video', '2026-10-01 10:00:00']])]);
  assert.equal(issue(report, 'UNKNOWN_PLATFORM').length, 1);
});
test('a numeric zero is not silently accepted as an omitted time zone', () => {
  const table = posts(); table.headers.push('timezone'); table.mapping.timezone = 5; table.rows[0].cells.push(0);
  assert.ok(issue(validateImport([table]), 'INVALID_TIMEZONE').length);
});
test('XLSX validates its container and reads formatted date serials', async () => {
  const tables = await parseXlsx(workbookBuffer(), 'test.xlsx');
  assert.equal(tables[0].kind, 'Posts');
  const report = validateImport(tables);
  assert.equal(report.summary.errors, 0);
  assert.match(report.tables[0].rows[0].values.publish_time, /^2026-10-01T02:00:00/);
});
test('XLSX respects the 1904 epoch and does not treat it as 1900', async () => {
  const tables = await parseXlsx(workbookBuffer(true), 'epoch.xlsx');
  assert.match(validateImport(tables).tables[0].rows[0].values.publish_time, /^1904-01-02T02:00:00/);
});
test('an explicit Excel zero-padding format preserves an identifier leading zero', async () => {
  const wb = XLSX.read(workbookBuffer(), { type: 'array' }); wb.Sheets.Posts.A2 = { t: 'n', v: 123, z: '000000' };
  const parsed = await parseXlsx(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'padded.xlsx');
  assert.equal(validateImport(parsed).tables[0].rows[0].values.content_key, '000123');
});
test('formula cache values are rejected instead of used as observations', async () => {
  const wb = XLSX.read(workbookBuffer(), { type: 'array' });
  wb.Sheets.Posts.C2 = { t: 's', f: '"computed"', v: 'cached title' };
  const parsed = await parseXlsx(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'formula.xlsx');
  assert.equal(issue(validateImport(parsed), 'FORMULA_CELL').length, 1);
});
test('fake XLSX files and oversized uncompressed ZIP entries are rejected before parsing', () => {
  assert.throws(() => checkXlsxContainer(new TextEncoder().encode('not an excel file at all').buffer));
  const buffer = workbookBuffer(); const view = new DataView(buffer);
  for (let i = 0; i < buffer.byteLength - 46; i += 1) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 0x7fffffff, true); break; }
  assert.throws(() => checkXlsxContainer(buffer), /解压后过大/);
});
test('file batches validate extension, total size, names and produce stable SHA-256', async () => {
  const file = new File(['content_key,title\np1,Example'], 'Posts.csv');
  const result = await readImportFiles([file]);
  assert.match(result.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.files[0].sha256, (await readImportFiles([file])).files[0].sha256);
  await assert.rejects(readImportFiles([new File(['x'], 'fake.xls')]), /仅支持/);
  await assert.rejects(readImportFiles([file, file]), /名称重复/);
  await assert.rejects(readImportFiles([new File([], 'empty.csv')]), /不能为空/);
});
test('downloaded reports neutralize spreadsheet formulas and correctly quote multiline text', () => {
  const result = Papa.parse(csvText([['=HYPERLINK("x")', 'line1\nline2', '"quote"']])).data[0];
  assert.equal(result[0], '\'=HYPERLINK("x")'); assert.equal(result[1], 'line1\nline2'); assert.equal(result[2], '"quote"');
  const report = validateImport([posts()]); assert.ok(issueReportCsv(report).includes('处理建议'));
});
test('built-in synthetic samples cover a clean six-record flow and an explicit error flow', () => {
  const parse = values => Object.entries(values).map(([kind, csv]) => parseCsv(csv, `${kind}.csv`));
  const clean = validateImport(parse(sampleCsvFiles()));
  assert.equal(clean.summary.total, 6); assert.equal(clean.summary.errors, 0);
  const bad = validateImport(parse(sampleCsvFiles(true)));
  assert.ok(bad.summary.errors > 0); assert.ok(issue(bad, 'DUPLICATE_CONTENT').length); assert.ok(issue(bad, 'ORPHAN_CONTENT').length);
});
test('multiple tables for one dataset are flagged and none of their records disappear', () => {
  const first = posts(); const second = posts([['p2', 'youtube', 'Second', 'video', '2026-10-02 10:00:00']]);
  second.id = 'second-posts'; second.source = 'Other.csv';
  const report = validateImport([first, second]);
  assert.equal(issue(report, 'MULTIPLE_TABLES').length, 1); assert.equal(report.summary.total, 2);
  assert.equal(report.tables.filter(t => t.kind === 'Posts').length, 2);
});
