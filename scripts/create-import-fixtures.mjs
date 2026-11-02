// Synthetic browser-test fixtures only. No real user data is generated or read.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { sampleCsvFiles } from '../src/lib/import-samples.ts';

const output = path.resolve(process.argv[2] || '../tmp/import-fixtures');
await mkdir(output, { recursive: true });
const workbook = XLSX.utils.book_new();
for (const [kind, text] of Object.entries(sampleCsvFiles())) {
  await writeFile(path.join(output, `${kind}.csv`), text, 'utf8');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(Papa.parse(text).data), kind);
}
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['说明'], ['合成测试样本：不对应真实账号或用户。']]), 'Data_Dictionary');
await writeFile(path.join(output, 'Content_Intelligence_Synthetic.xlsx'), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }));
await writeFile(path.join(output, 'Invalid_Container.xlsx'), 'This is not an Excel file.');
console.log(output);
