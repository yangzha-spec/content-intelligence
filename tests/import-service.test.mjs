import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { sampleCsvFiles } from '../src/lib/import-samples.ts';
import { readImportFiles, parseCsv } from '../src/lib/import-parser.ts';
import { processImport } from '../src/lib/import-service.ts';
import { importConfig, requestHash, applyImportConfig, validateManifest, sha256 } from '../src/lib/import-contract.ts';
import { validateImport } from '../src/lib/import-validation.ts';
import { prepareImport } from '../src/lib/import-client.ts';

const projectId = '10000000-0000-4000-8000-000000000001';
const batchId = '20000000-0000-4000-8000-000000000001';
const actorId = '30000000-0000-4000-8000-000000000001';
const source = { source_name: 'Synthetic service fixture', data_owner_or_provider: '', license_name: 'unknown', notes: '', contains_personal_data: false };
async function fixture(withErrors = false) {
  const samples = sampleCsvFiles(withErrors);
  const files = Object.entries(samples).map(([kind, text]) => new File([text], `${kind}.csv`, { type: 'text/csv' }));
  const parsed = await readImportFiles(files);
  const config = importConfig(parsed.tables, 'utf-8', 'Asia/Shanghai');
  const manifest = parsed.files.map((file, i) => ({ ...file, path: `${projectId}/${batchId}/${i}.csv`, mime: 'text/csv' }));
  const batch = { id: batchId, project_id: projectId, created_by: actorId, ...source, source_type: 'synthetic', file_manifest: manifest, import_config: config, request_hash: await requestHash(projectId, parsed.files, config, source, true), status: 'uploaded' };
  const state = { batch, files, parsed, role: 'owner', requests: [], commits: [], patches: [], existing: [], commitError: null, uploadFail: false };
  const client = createClient('https://fixture.invalid', 'publishable-fixture-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: 'Bearer fixture-user' }, fetch: async (input, options) => {
    const url = new URL(String(input)); const path = url.pathname; const method = options?.method || 'GET';
    state.requests.push({ path, method, authorization: new Headers(options?.headers).get('Authorization') });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (path.endsWith('/auth/v1/user')) return json({ id: actorId, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-02T00:00:00Z' });
    if (path.endsWith('/import_batches') && method === 'POST') return json({ code: '23505', message: 'Duplicate request hash' }, 409);
    if (path.endsWith('/import_batches') && method === 'GET') return json(state.batch);
    if (path.endsWith('/import_batches') && method === 'PATCH') { const patch = JSON.parse(options.body); state.patches.push(patch); Object.assign(state.batch, patch); return json(null); }
    if (path.endsWith('/projects')) return json({ id: projectId, workspace_id: '40000000-0000-4000-8000-000000000001', default_timezone: 'Asia/Shanghai' });
    if (path.endsWith('/workspace_members')) return json({ role: state.role });
    if (path.endsWith('/content_posts')) return json(state.existing);
    if (path.includes('/storage/v1/object/') && method === 'POST') return state.uploadFail ? json({ statusCode: '503', message: 'Temporary upload failure' }, 503) : json({ statusCode: '409', message: 'The resource already exists' }, 409);
    if (path.includes('/storage/v1/object/')) { const index = Number(path.split('/').at(-1).split('.')[0]); return new Response(state.files[index], { headers: { 'Content-Type': 'text/csv' } }); }
    if (path.endsWith('/rpc/commit_import_batch')) { const body = JSON.parse(options.body); state.commits.push(body); if (state.commitError) return json(state.commitError, 409); return json({ batch_id: batchId, already_applied: false, counts: { Posts: body.payload.Posts.length, Metrics: body.payload.Metrics.length, Comments: body.payload.Comments.length } }); }
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  } } });
  return { state, client };
}

test('server re-reads private CSV originals using user authorization, with a separate confirmation step', async () => {
  const { state, client } = await fixture();
  const validation = await processImport(client, batchId, 'validate', actorId);
  assert.equal(validation.ready, true); assert.equal(validation.report.summary.total, 6);
  assert.equal(state.commits.length, 0);
  assert.equal(state.requests.filter(r => r.path.includes('/storage/v1/object/')).length, 3);
  assert.ok(state.requests.every(r => r.authorization === 'Bearer fixture-user'));
  const result = await processImport(client, batchId, 'commit', actorId);
  assert.deepEqual(result.result.counts, { Posts: 2, Metrics: 2, Comments: 2 });
  assert.equal(state.commits.length, 1);
  assert.equal(state.requests.filter(r => r.path.includes('/storage/v1/object/')).length, 6);
  assert.equal(state.commits[0].payload.Metrics[1].views, null);
  assert.equal(state.commits[0].payload.Metrics[1].likes, '0');
  assert.match(state.commits[0].payload.Comments[0].dedupe_hash, /^[a-f0-9]{64}$/);
});

test('server refuses changed original bytes before committing', async () => {
  const { state, client } = await fixture();
  const bytes = new Uint8Array(await state.files[0].arrayBuffer());
  const index = bytes.findIndex((v, i) => v === 49 && bytes[i - 1] === 48 && bytes[i - 2] === 48 && bytes[i - 3] === 95);
  assert.ok(index > 0); bytes[index] = 57;
  state.files[0] = new File([bytes], 'Posts.csv');
  await assert.rejects(processImport(client, batchId, 'commit', actorId), /哈希/);
  assert.equal(state.commits.length, 0);
});

test('server reports original-file errors and does not accept a browser-ready claim', async () => {
  const { state, client } = await fixture(true); state.batch.status = 'ready'; state.batch.quality_summary = { errors: 0 };
  const result = await processImport(client, batchId, 'commit', actorId);
  assert.equal(result.ready, false); assert.ok(result.report.issues.some(i => i.severity === 'error'));
  assert.equal(state.commits.length, 0); assert.equal(state.batch.status, 'failed');
});

test('viewer role is refused before downloading any original file', async () => {
  const { state, client } = await fixture(); state.role = 'viewer';
  await assert.rejects(processImport(client, batchId, 'commit', actorId), /编辑者/);
  assert.equal(state.requests.filter(r => r.path.includes('/storage/v1/object/')).length, 0);
});

test('successful retry returns the original result without parsing or adding rows', async () => {
  const { state, client } = await fixture(); state.batch.status = 'success'; state.batch.row_counts = { Posts: 2, Metrics: 2, Comments: 2 };
  const result = await processImport(client, batchId, 'commit', actorId);
  assert.equal(result.result.already_applied, true); assert.equal(state.commits.length, 0);
  assert.equal(state.requests.filter(r => r.path.includes('/storage/v1/object/')).length, 0);
});

test('a late database conflict becomes a safe failure with a retryable history entry', async () => {
  const { state, client } = await fixture(); state.commitError = { code: '23505', message: 'internal index name' };
  await assert.rejects(processImport(client, batchId, 'commit', actorId), error => /重复/.test(error.message) && !/internal/.test(error.message));
  assert.equal(state.batch.status, 'failed');
});

test('request fingerprints are stable across object key order but change with mapping, source or file content', async () => {
  const { state } = await fixture(); const { files } = state.parsed; const config = state.batch.import_config;
  const a = await requestHash(projectId, files, config, source, true);
  assert.equal(a, await requestHash(projectId, files, { tables: config.tables, timezone: config.timezone, encoding: config.encoding }, source, true));
  assert.notEqual(a, await requestHash(projectId, files, config, { ...source, notes: 'new note' }, true));
  assert.notEqual(a, await requestHash(projectId, [{ ...files[0], sha256: await sha256('changed') }, ...files.slice(1)], config, source, true));
});

test('fresh source tables reject tampered mapping IDs, columns and private paths', async () => {
  const { state } = await fixture(); const config = structuredClone(state.batch.import_config);
  config.tables[0].mapping.title = 999;
  assert.throws(() => applyImportConfig(state.parsed.tables, config), /无效源列/);
  assert.throws(() => validateManifest([{ ...state.batch.file_manifest[0], path: 'another-project/raw.csv' }], projectId, batchId), /存储位置/);
});

test('incremental children may refer to verified historical content, while duplicate Posts are rejected', () => {
  const existing = [{ content_key: 'p1', platform: 'youtube', external_content_id: null, publish_time: '2026-10-01T00:00:00Z' }];
  const child = parseCsv('content_key,snapshot_time,likes\np1,2026-10-02 10:00:00,0', 'Metrics.csv');
  const result = validateImport([child], 'Asia/Shanghai', existing);
  assert.equal(result.issues.filter(i => i.severity === 'error').length, 0);
  const post = parseCsv('content_key,platform,title,content_type,publish_time\np1,youtube,Existing,video,2026-10-01 08:00:00', 'Posts.csv');
  assert.ok(validateImport([post, child], 'Asia/Shanghai', existing).issues.some(i => i.code === 'EXISTING_CONTENT'));
});

test('interrupted upload retries reuse the original batch and immutable file paths', async () => {
  const { state, client } = await fixture();
  const run = () => prepareImport(projectId, state.files, state.parsed.files, state.parsed.tables, 'utf-8', 'Asia/Shanghai', source, true, () => {}, client);
  state.uploadFail = true;
  await assert.rejects(run(), /上传未完成/);
  state.uploadFail = false;
  assert.equal((await run()).batchId, batchId);
  const uploads = state.requests.filter(r => r.path.includes('/storage/v1/object/') && r.method === 'POST');
  assert.ok(uploads.length >= 4); assert.ok(uploads.every(r => r.path.includes(batchId)));
  assert.equal(state.batch.status, 'uploaded');
});

test('a previously validated or successful identical batch does not upload originals again', async () => {
  const { state, client } = await fixture();
  const run = () => prepareImport(projectId, state.files, state.parsed.files, state.parsed.tables, 'utf-8', 'Asia/Shanghai', source, true, () => {}, client);
  state.batch.status = 'ready'; assert.equal((await run()).complete, false);
  state.batch.status = 'success'; assert.equal((await run()).complete, true);
  assert.equal(state.requests.filter(r => r.path.includes('/storage/v1/object/')).length, 0);
});


test('cleanup in progress refuses import before any original is downloaded or revalidated', async () => {
  const { state, client } = await fixture(); state.batch.originals_state = 'deleting';
  await assert.rejects(processImport(client, batchId, 'commit', actorId), /清理/);
  assert.equal(state.requests.filter(r => r.path.includes('/storage/v1/object/')).length, 0);
  assert.equal(state.commits.length,0);
});
