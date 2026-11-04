import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { analyze } from '../src/lib/analytics.ts';

// PostgreSQL engine, with a minimal stand-in for Supabase Auth.
// Hosted Supabase Auth, Storage and HTTP integration still require a separate smoke test.
const db = new PGlite();
const users = {
  extra: '00000000-0000-0000-0000-000000000005',
  alice: '00000000-0000-0000-0000-000000000001',
  bob: '00000000-0000-0000-0000-000000000002',
  editor: '00000000-0000-0000-0000-000000000003',
  viewer: '00000000-0000-0000-0000-000000000004',
};
const fixture = {};
const hash = 'a'.repeat(64);

async function one(sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}

async function asUser(user, action, role = 'authenticated') {
  await db.exec('begin; set constraints all immediate;');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    await db.exec(`set local role ${role}`);
    await action();
  } finally {
    await db.exec('rollback');
  }
}

async function expectError(sql, args, code) {
  await db.exec('savepoint expected_failure');
  try {
    await assert.rejects(db.query(sql, args), (error) => error.code === code);
  } finally {
    await db.exec('rollback to savepoint expected_failure');
  }
}

async function addBatch(projectId, owner, path) {
  return (await one(`insert into public.import_batches
    (project_id, created_by, file_name, file_hash, storage_path, file_size_bytes,
     mime_type, source_type, source_name)
    values ($1, $2, 'fixture.csv', $3, $4, 100, 'text/csv', 'synthetic', 'database-test')
    returning id`, [projectId, owner, hash, path])).id;
}

async function addPost(projectId, batchId, title = 'Fixture post', row = 1) {
  return (await one(`insert into public.content_posts
    (project_id, platform, content_key, title, content_type, publish_time,
     source_batch_id, source_row_number)
    values ($1, 'youtube', $2, $3, 'video', '2026-10-01T00:00:00Z', $4, $5)
    returning id`, [projectId, `post_${row}`, title, batchId, row])).id;
}

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon;
    grant select, insert, update, delete on storage.objects to authenticated;
    create function public.rls_auto_enable() returns event_trigger
      language plpgsql security definer set search_path = '' as $$ begin end; $$;
  `);
  for (const user of Object.values(users)) {
    await db.query('insert into auth.users values ($1)', [user]);
  }
  const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
  const migrations = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    await db.exec(await readFile(new URL(name, migrationsDir), 'utf8'));
  }
  fixture.workspaceA = (await one(`insert into public.workspaces(name, owner_id)
    values ('A', $1) returning id`, [users.alice])).id;
  fixture.workspaceB = (await one(`insert into public.workspaces(name, owner_id)
    values ('B', $1) returning id`, [users.bob])).id;
  await db.query(`insert into public.workspace_members(workspace_id, user_id, role)
    values ($1, $2, 'editor'), ($1, $3, 'viewer')`,
    [fixture.workspaceA, users.editor, users.viewer]);
  fixture.projectA = (await one(`insert into public.projects(workspace_id, name)
    values ($1, 'A project') returning id`, [fixture.workspaceA])).id;
  fixture.projectA2 = (await one(`insert into public.projects(workspace_id, name)
    values ($1, 'Another A project') returning id`, [fixture.workspaceA])).id;
  fixture.projectB = (await one(`insert into public.projects(workspace_id, name)
    values ($1, 'B project') returning id`, [fixture.workspaceB])).id;
  fixture.batchA = await addBatch(fixture.projectA, users.alice, 'test/a.csv');
  fixture.batchA2 = await addBatch(fixture.projectA2, users.alice, 'test/a2.csv');
  fixture.batchB = await addBatch(fixture.projectB, users.bob, 'test/b.csv');
  fixture.postA = await addPost(fixture.projectA, fixture.batchA);
  fixture.postA2 = await addPost(fixture.projectA2, fixture.batchA2);
  fixture.postB = await addPost(fixture.projectB, fixture.batchB);
  for (const key of ['A', 'B']) {
    await db.query(`insert into public.social_accounts(project_id, platform, account_key)
      values ($1, 'youtube', 'account_1')`, [fixture[`project${key}`]]);
    await db.query(`insert into public.post_metrics
      (project_id, content_post_id, snapshot_time, metric_profile, views, likes,
       source_batch_id, source_row_number)
      values ($1, $2, '2026-10-02T00:00:00Z', 'youtube_fixture_v1', NULL, 0, $3, 1)`,
      [fixture[`project${key}`], fixture[`post${key}`], fixture[`batch${key}`]]);
    await db.query(`insert into public.comments
      (project_id, content_post_id, dedupe_hash, dedupe_method, dedupe_confidence,
       comment_text, source_batch_id, source_row_number)
      values ($1, $2, $3, 'inferred', 'low', 'Synthetic comment', $4, 1)`,
      [fixture[`project${key}`], fixture[`post${key}`], hash, fixture[`batch${key}`]]);
  }
});

after(async () => { await db.close(); });

const reserveAi=(project=fixture.projectA,run=randomUUID(),token=randomUUID(),enabled=true)=>({sql:'select public.reserve_ai_call($1,$2,$3,$4,$5) as result',args:[project,run,hash,token,enabled],run,token});
const finishAi=(request,state='failed',actions=[])=>one('select public.finish_ai_call($1,$2,$3,$4::jsonb) as result',[request.run,request.token,state,JSON.stringify(actions)]);
test('AI ledger stays private, anonymous and non-editors cannot reserve, and usage is actor-scoped',async()=>{
 await asUser(users.viewer,async()=>{await expectError('select public.reserve_ai_call($1,$2,$3,$4,true)',[fixture.projectA,randomUUID(),hash,randomUUID()],'42501');assert.equal((await one('select public.get_ai_call_status() as data')).data.used_today,0);await expectError('select * from private.ai_call_requests',[],'42501');});
 await asUser(users.bob,async()=>{const r=reserveAi();await expectError(r.sql,r.args,'42501');});
 await asUser(null,async()=>{await expectError('select public.get_ai_call_status()',[],'42501');},'anon');
 await asUser(users.editor,async()=>{const r=reserveAi();assert.equal((await one(r.sql,r.args)).result.decision,'acquired');await finishAi(r);assert.equal((await one('select public.get_ai_call_status() as data')).data.used_today,1);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.alice]);assert.equal((await one('select public.get_ai_call_status() as data')).data.used_today,0);});
});
test('AI reservations are one-shot, secret-bound and cached without spending quota twice',async()=>{
 await asUser(users.alice,async()=>{const disabled=reserveAi(fixture.projectA,randomUUID(),randomUUID(),false);assert.equal((await one(disabled.sql,disabled.args)).result.decision,'disabled');
  const r=reserveAi();assert.equal((await one(r.sql,r.args)).result.decision,'acquired');assert.equal((await one(r.sql,[...r.args.slice(0,3),randomUUID(),true])).result.decision,'in_progress');
  const other=reserveAi();assert.equal((await one(other.sql,other.args)).result.code,'AI_CONCURRENCY_LIMIT');
  await expectError('select public.finish_ai_call($1,$2,$3)',[r.run,randomUUID(),'failed'],'42501');
  await expectError('select public.finish_ai_call($1,$2,$3,$4::jsonb)',[r.run,r.token,'generated',JSON.stringify([{id:'top-content',action:'提升 50%'}])],'P0001');
  const actions=[{id:'top-content',action:'人工核对后再验证表达。'}];assert.equal((await finishAi(r,'generated',actions)).result.state,'generated');
  const cached=(await one(r.sql,[...r.args.slice(0,3),randomUUID(),false])).result;assert.equal(cached.decision,'cached');assert.deepEqual(cached.actions,actions);assert.ok(!('lease_token' in cached));
  assert.equal((await finishAi(r,'failed')).result.state,'generated');assert.equal((await one('select public.get_ai_call_status() as data')).data.used_today,1);
  await expectError(r.sql,[fixture.projectA,r.run,'b'.repeat(64),r.token,true],'P0001');
 });
});
test('personal daily cap includes failures across projects and cannot be edited or refunded by API users',async()=>{
 await asUser(users.alice,async()=>{for(let i=0;i<5;i++){const r=reserveAi(i%2?fixture.projectA2:fixture.projectA);assert.equal((await one(r.sql,r.args)).result.decision,'acquired');await finishAi(r);}
  const r=reserveAi();assert.equal((await one(r.sql,r.args)).result.code,'AI_USER_DAILY_LIMIT');const status=(await one('select public.get_ai_call_status() as data')).data;assert.equal(status.used_today,5);assert.equal(status.remaining_today,0);assert.equal(status.day_timezone,'UTC');
  await expectError('delete from private.ai_call_requests',[],'42501');await expectError('update private.ai_call_policy set user_daily_limit=999',[],'42501');
 });
});
test('global daily cap accounts for other users without exposing their rows',async()=>{
 await asUser(users.alice,async()=>{
  for(const actor of [users.alice,users.bob,users.editor,users.viewer]){await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);const w=(await one("insert into public.workspaces(name) values('Global quota fixture') returning id")).id;const p=(await one("insert into public.projects(workspace_id,name) values($1,'Fixture') returning id",[w])).id;for(let i=0;i<5;i++){const r=reserveAi(p);assert.equal((await one(r.sql,r.args)).result.decision,'acquired');await finishAi(r);}}
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.extra]);const w=(await one("insert into public.workspaces(name) values('Extra actor fixture') returning id")).id;const p=(await one("insert into public.projects(workspace_id,name) values($1,'Fixture') returning id",[w])).id;
  const r=reserveAi(p);const result=(await one(r.sql,r.args)).result;assert.equal(result.code,'AI_GLOBAL_DAILY_LIMIT');assert.ok(result.retry_after>0);assert.equal((await one('select public.get_ai_call_status() as data')).data.used_today,0);
 });
});
test('expired AI reservations become uncertain and never reacquire for the same run',async()=>{
 await asUser(users.alice,async()=>{const r=reserveAi();await one(r.sql,r.args);
  await db.exec('reset role');await db.query("update private.ai_call_requests set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=$1",[r.run]);await db.exec('set local role authenticated');
  const cached=(await one(r.sql,[...r.args.slice(0,3),randomUUID(),true])).result;assert.equal(cached.decision,'cached');assert.equal(cached.state,'uncertain');assert.equal((await finishAi(r,'generated',[{id:'top-content',action:'保留证据并复核。'}])).result.state,'uncertain');
  const next=reserveAi();assert.equal((await one(next.sql,next.args)).result.decision,'acquired');assert.equal((await one('select public.get_ai_call_status() as data')).data.used_today,2);
 });
});
test('project deletion cannot reset AI quota receipts',async()=>{
 await asUser(users.alice,async()=>{const r=reserveAi();await one(r.sql,r.args);await finishAi(r);await db.query('delete from public.projects where id=$1',[fixture.projectA]);assert.equal((await one('select public.get_ai_call_status() as data')).data.used_today,1);});
});

test('analysis source uses caller RLS and serializes large integer observations as text', async () => {
  await asUser(users.alice, async () => {
    await db.query('update public.post_metrics set impressions=9223372036854775807 where project_id=$1',[fixture.projectA]);
    const source=(await one('select public.get_analysis_source($1) as data',[fixture.projectA])).data;
    assert.equal(source.metrics[0].impressions,'9223372036854775807');assert.equal(source.posts.length,1);assert.equal(source.comments.length,1);assert.ok(source.revision);
  });
  await asUser(users.bob,async()=>{await expectError('select public.get_analysis_source($1)',[fixture.projectA],'42501');});
});
test('analysis bundle is atomic, immutable, idempotent and readable by viewers', async () => {
  await asUser(users.alice,async()=>{
    const source=(await one('select public.get_analysis_source($1) as data',[fixture.projectA])).data;
    const result=analyze(source,{platform:'youtube',profile:'youtube_fixture_v1',start:'2026-10-01',end:'2026-10-31',metric:'views',topic:'',timezone:'Asia/Shanghai'});
    const id=randomUUID();const sql='select public.save_analysis_bundle($1,$2,$3,$4,$5) as id';const args=[fixture.projectA,id,JSON.stringify(source),JSON.stringify(result),'# Synthetic report'];
    assert.equal((await one(sql,args)).id,id);assert.equal((await one(sql,args)).id,id);
    assert.equal((await one('select count(*)::int as n from public.analysis_results where analysis_run_id=$1',[id])).n,1);
    assert.equal((await one('select count(*)::int as n from public.comment_analyses where analysis_run_id=$1',[id])).n,1);
    await expectError('update public.analysis_runs set status=\'failed\' where id=$1',[id],'42501');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.viewer]);
    assert.equal((await one('select count(*)::int as n from public.reports where analysis_run_id=$1',[id])).n,1);
    await expectError(sql,[fixture.projectA,randomUUID(),JSON.stringify(source),JSON.stringify(result),'Denied'],'42501');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.bob]);
    assert.equal((await one('select count(*)::int as n from public.reports where analysis_run_id=$1',[id])).n,0);
  });
});
test('invalid cross-project comment results roll back the entire analysis bundle', async () => {
  await asUser(users.alice,async()=>{
    const source=(await one('select public.get_analysis_source($1) as data',[fixture.projectA])).data;
    const result=analyze(source,{platform:'youtube',profile:'youtube_fixture_v1',start:'2026-10-01',end:'2026-10-31',metric:'views',topic:'',timezone:'Asia/Shanghai'});
    result.comments.rows[0].id=randomUUID();const id=randomUUID();
    await expectError('select public.save_analysis_bundle($1,$2,$3,$4,$5)',[fixture.projectA,id,JSON.stringify(source),JSON.stringify(result),'# Synthetic'],'23503');
    assert.equal((await one('select count(*)::int as n from public.analysis_runs where id=$1',[id])).n,0);
  });
});

async function importBatch(projectId = fixture.projectA, creator = users.alice) {
  const id = randomUUID(); const path = `${projectId}/${id}/0.csv`;
  const config = { timezone: 'Asia/Shanghai', encoding: 'utf-8', tables: [] };
  const manifest = [{ name: 'Posts.csv', path, size: 100, sha256: hash, mime: 'text/csv' }];
  await db.query(`insert into public.import_batches(id,project_id,created_by,file_name,file_hash,storage_path,file_size_bytes,mime_type,source_type,source_name,file_manifest,import_config,request_hash)
    values($1,$2,$3,'Posts.csv',$4,$5,100,'text/csv','synthetic','atomic-test',$6,$7,$8)`, [id, projectId, creator, hash, path, JSON.stringify(manifest), JSON.stringify(config), id.replaceAll('-', '').padEnd(64, 'a')]);
  await db.query(`insert into storage.objects(bucket_id,name) values('raw-imports',$1)`, [path]);
  await db.query(`update public.import_batches set status='ready' where id=$1`, [id]);
  return { id, config, manifest, path };
}
const newPost = (key = 'atomic_new') => ({ content_key: key, platform: 'youtube', account_key: 'new-account', title: 'Synthetic atomic post', content_type: 'video', publish_time: '2026-10-01T00:00:00Z', source_row_number: 2, source_table: 'Posts.csv' });
const snapshot = (key = 'atomic_new') => ({ content_key: key, snapshot_time: '2026-10-03T00:00:00Z', snapshot_type: 'cumulative', metric_profile: 'synthetic_v1', views: null, likes: '0', impressions: '9223372036854775807', source_row_number: 2, source_table: 'Metrics.csv' });
const comment = (key = 'atomic_new') => ({ content_key: key, comment_text: 'Synthetic comment', dedupe_hash: hash, dedupe_method: 'inferred', dedupe_confidence: 'low', sample_type: 'unknown', source_row_number: 2, source_table: 'Comments.csv' });
const commitSql = 'select public.commit_import_batch($1,$2::jsonb,$3::jsonb,$4::jsonb) as result';
const commitArgs = (batch, payload) => [batch.id, JSON.stringify(batch.config), JSON.stringify(batch.manifest), JSON.stringify(payload)];

test('owner cleanup retains imported rows and provenance; direct, early and cross-role deletion are denied', async () => {
  await asUser(users.alice, async () => {
    const batch=await importBatch();
    await one(commitSql,commitArgs(batch,{Posts:[newPost()],Metrics:[snapshot()],Comments:[comment()]}));
    assert.equal((await one("delete from storage.objects where name=$1 returning name",[batch.path])),undefined);
    await expectError('select public.finish_original_cleanup($1)',[batch.id],'P0001');
    await expectError('delete from public.projects where id=$1',[fixture.projectA],'P0001');
    await expectError('delete from public.workspaces where id=$1',[fixture.workspaceA],'P0001');
    for(const actor of [users.editor,users.viewer,users.bob]){
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
      await expectError('select public.begin_original_cleanup($1)',[batch.id],'42501');
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.alice]);
    const plan=(await one('select public.begin_original_cleanup($1) as data',[batch.id])).data;
    assert.equal(plan.state,'deleting'); assert.deepEqual(plan.files,batch.manifest);
    assert.equal((await one('select public.begin_original_cleanup($1) as data',[batch.id])).data.state,'deleting');
    await expectError('select public.finish_original_cleanup($1)',[batch.id],'P0001');
    await expectError("insert into storage.objects(bucket_id,name) values('raw-imports',$1)",[batch.path],'42501');
    await expectError("update public.import_batches set error_message='tampered' where id=$1",[batch.id],'P0001');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.editor]);
    assert.equal(await one('delete from storage.objects where name=$1 returning name',[batch.path]),undefined);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.alice]);
    // PGlite models metadata only; the real app removes bytes through Storage API.
    assert.equal((await one('delete from storage.objects where name=$1 returning name',[batch.path])).name,batch.path);
    assert.equal((await one('select public.finish_original_cleanup($1) as data',[batch.id])).data.state,'deleted');
    assert.equal((await one('select public.finish_original_cleanup($1) as data',[batch.id])).data.state,'deleted');
    const audit=await one('select originals_cleanup_by,originals_deleted_at,file_manifest from public.import_batches where id=$1',[batch.id]);
    assert.equal(audit.originals_cleanup_by,users.alice); assert.ok(audit.originals_deleted_at); assert.deepEqual(audit.file_manifest,batch.manifest);
    assert.equal((await one('select count(*)::int as n from public.content_posts where source_batch_id=$1',[batch.id])).n,1);
    assert.equal((await one(commitSql,commitArgs(batch,{Posts:[],Metrics:[],Comments:[]}))).result.already_applied,true);
    await expectError("update public.import_batches set originals_state='retained',originals_cleanup_started_at=null,originals_cleanup_by=null,originals_deleted_at=null where id=$1",[batch.id],'P0001');
    await db.query('delete from public.projects where id=$1',[fixture.projectA]);
    assert.equal((await one('select count(*)::int as n from public.projects where id=$1',[fixture.projectA])).n,0);
  });
});

test('abandoned batches stop imports after cleanup starts and allow a fresh batch with the same fingerprint', async () => {
  await asUser(users.alice,async()=>{
    const batch=await importBatch();
    const request=(await one('select request_hash from public.import_batches where id=$1',[batch.id])).request_hash;
    await db.query("update public.import_batches set status='failed' where id=$1",[batch.id]);
    await one('select public.begin_original_cleanup($1)',[batch.id]);
    await expectError(commitSql,commitArgs(batch,{Posts:[newPost()],Metrics:[],Comments:[]}),'P0001');
    await expectError("update public.import_batches set status='ready' where id=$1",[batch.id],'P0001');
    await expectError('delete from public.import_batches where id=$1',[batch.id],'P0001');
    const other=await importBatch();
    await expectError('update public.import_batches set request_hash=$1 where id=$2',[request,other.id],'P0001');
    const id=randomUUID();
    await db.query(`insert into public.import_batches(id,project_id,file_name,file_hash,storage_path,file_size_bytes,mime_type,source_type,source_name,request_hash) values($1,$2,'Reupload.csv',$3,$4,1,'text/csv','synthetic','retry',$5)`,[id,fixture.projectA,hash,`${fixture.projectA}/${id}/0.csv`,request]);
    assert.notEqual(id,batch.id);
  });
});

test('atomic import writes three datasets once, preserves NULL/zero/BIGINT, and records provenance', async () => {
  await asUser(users.alice, async () => {
    const batch = await importBatch();
    const args = commitArgs(batch, { Posts: [newPost()], Metrics: [snapshot()], Comments: [comment()] });
    const first = (await one(commitSql, args)).result;
    assert.equal(first.already_applied, false);
    assert.deepEqual(first.counts, { Posts: 1, Metrics: 1, Comments: 1 });
    assert.equal((await one(commitSql, args)).result.already_applied, true);
    assert.equal((await one('select count(*)::int as n from public.content_posts where source_batch_id=$1', [batch.id])).n, 1);
    const metric = await one('select views, likes::text, impressions::text, missing_reasons,source_table from public.post_metrics where source_batch_id=$1', [batch.id]);
    assert.equal(metric.views, null); assert.equal(metric.likes, '0'); assert.equal(metric.impressions, '9223372036854775807');
    assert.equal(metric.missing_reasons.views, 'not_provided'); assert.equal(metric.source_table, 'Metrics.csv');
    assert.equal((await one('select status from public.import_batches where id=$1', [batch.id])).status, 'success');
    await expectError('update public.import_batches set error_message=$2 where id=$1', [batch.id, 'tampered'], 'P0001');
  });
});

test('late duplicate snapshot rolls back new posts, accounts, comments and committing status', async () => {
  await asUser(users.alice, async () => {
    const batch = await importBatch();
    const duplicate = { ...snapshot('post_1'), snapshot_time: '2026-10-02T00:00:00Z', metric_profile: 'youtube_fixture_v1' };
    await expectError(commitSql, commitArgs(batch, { Posts: [newPost()], Metrics: [duplicate], Comments: [comment()] }), '23505');
    assert.equal((await one('select count(*)::int as n from public.content_posts where source_batch_id=$1', [batch.id])).n, 0);
    assert.equal((await one("select count(*)::int as n from public.social_accounts where project_id=$1 and account_key='new-account'", [fixture.projectA])).n, 0);
    assert.equal((await one('select status from public.import_batches where id=$1', [batch.id])).status, 'ready');
    const retry = await one(commitSql, commitArgs(batch, { Posts: [newPost()], Metrics: [snapshot()], Comments: [comment()] }));
    assert.equal(retry.result.already_applied, false);
  });
});

test('historical content accepts incremental snapshots/comments without inserting or overwriting Posts', async () => {
  await asUser(users.editor, async () => {
    const batch = await importBatch(fixture.projectA, users.editor);
    const result = await one(commitSql, commitArgs(batch, { Posts: [], Metrics: [snapshot('post_1')], Comments: [comment('post_1')] }));
    assert.equal(result.result.counts.Posts, 0);
    assert.equal((await one('select count(*)::int as n from public.content_posts where project_id=$1', [fixture.projectA])).n, 1);
  });
});

test('orphan and negative-count failures cannot leave a partial batch', async () => {
  await asUser(users.alice, async () => {
    const batch = await importBatch();
    await expectError(commitSql, commitArgs(batch, { Posts: [newPost()], Metrics: [snapshot('unknown')], Comments: [] }), 'P0001');
    await expectError(commitSql, commitArgs(batch, { Posts: [newPost()], Metrics: [{ ...snapshot(), likes: '-1' }], Comments: [] }), '23514');
    assert.equal((await one('select count(*)::int as n from public.content_posts where source_batch_id=$1', [batch.id])).n, 0);
  });
});


async function discardLocalBatch(batch) {
  // The in-memory test database contains no physical Storage files.
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.alice]);
    await one('select public.begin_original_cleanup($1)',[batch.id]);
    await one('select public.finish_original_cleanup($1)',[batch.id]);
    await db.query('delete from public.import_batches where id=$1',[batch.id]);
    await db.exec('commit');
  } catch(error) { await db.exec('rollback'); throw error; }
}
test('batch identity changes and missing private originals stop the commit', async () => {
  await asUser(users.alice, async () => {
    const batch = await importBatch();
    await expectError('update public.import_batches set import_config=$2 where id=$1', [batch.id, '{}'], 'P0001');
    const args = commitArgs(batch, { Posts: [newPost()], Metrics: [], Comments: [] });
    await expectError(commitSql, [args[0], '{}', args[2], args[3]], 'P0001');
  });
  const batch = await importBatch();
  await db.query('delete from storage.objects where name=$1', [batch.path]);
  await asUser(users.alice, async () => { await expectError(commitSql, commitArgs(batch, { Posts: [newPost()], Metrics: [], Comments: [] }), 'P0001'); });
  await discardLocalBatch(batch);
});

test('private originals stay project-scoped and immutable; viewers can read but cannot upload or commit', async () => {
  const batch = await importBatch();
  for (const user of [users.alice, users.editor, users.viewer]) await asUser(user, async () => {
    assert.equal((await one('select count(*)::int as n from storage.objects where name=$1', [batch.path])).n, 1);
    assert.equal((await db.query('update storage.objects set name=$2 where name=$1 returning id', [batch.path, 'changed'])).rows.length, 0);
    assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [batch.path])).rows.length, 0);
  });
  await asUser(users.bob, async () => {
    assert.equal((await one('select count(*)::int as n from storage.objects where name=$1', [batch.path])).n, 0);
    await expectError(commitSql, commitArgs(batch, { Posts: [newPost()], Metrics: [], Comments: [] }), '42501');
    await expectError("insert into storage.objects(bucket_id,name) values('raw-imports',$1)", [batch.path], '42501');
  });
  await asUser(users.viewer, async () => { await expectError(commitSql, commitArgs(batch, { Posts: [newPost()], Metrics: [], Comments: [] }), '42501'); });
  await asUser(null, async () => { await expectError(commitSql, commitArgs(batch, { Posts: [], Metrics: [], Comments: [] }), '42501'); }, 'anon');
  await db.query('delete from storage.objects where name=$1', [batch.path]); await discardLocalBatch(batch);
});

test('migration creates fourteen business tables and enables RLS on every table', async () => {
  const { rows } = await db.query(`select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'`);
  assert.equal(rows.length, 14);
  assert.ok(rows.every((row) => row.relrowsecurity));
});

test('a signed-in user creates a workspace and receives its owner membership', async () => {
  await asUser(users.alice, async () => {
    const workspace = await one(`insert into public.workspaces(name)
      values ('New workspace') returning id`);
    const member = await one(`select role from public.workspace_members
      where workspace_id = $1 and user_id = $2`, [workspace.id, users.alice]);
    assert.equal(member.role, 'owner');
  });
});

test('a user cannot create a workspace owned by someone else', async () => {
  await asUser(users.alice, () => expectError(`insert into public.workspaces(name, owner_id)
    values ('Forged ownership', $1)`, [users.bob], '42501'));
});

test('nonmembers cannot read another workspace or any of its project data', async () => {
  await asUser(users.bob, async () => {
    assert.equal((await one('select count(*)::int as n from public.workspaces')).n, 1);
    assert.equal((await one('select count(*)::int as n from public.workspace_members')).n, 1);
    assert.equal((await one('select count(*)::int as n from public.projects')).n, 1);
    for (const table of ['social_accounts', 'import_batches', 'content_posts', 'post_metrics', 'comments']) {
      const rows = (await db.query(`select project_id from public.${table}`)).rows;
      assert.ok(rows.length > 0);
      assert.ok(rows.every((row) => row.project_id === fixture.projectB));
    }
  });
});

test('an editor who is not the owner can read and change workspace project data', async () => {
  await asUser(users.editor, async () => {
    const changed = (await db.query(`update public.content_posts set title = 'Edited'
      where id = $1 returning title`, [fixture.postA])).rows;
    assert.equal(changed[0].title, 'Edited');
    assert.equal((await one('select count(*)::int as n from public.workspace_members')).n, 3);
  });
});

test('a viewer can read but cannot insert or change project data', async () => {
  await asUser(users.viewer, async () => {
    assert.equal((await one('select count(*)::int as n from public.content_posts')).n, 2);
    const updated = await db.query(`update public.content_posts set title = 'Denied'
      where id = $1 returning id`, [fixture.postA]);
    assert.equal(updated.rows.length, 0);
    await expectError(`insert into public.projects(workspace_id, name) values ($1, 'Denied')`,
      [fixture.workspaceA], '42501');
  });
});

test('an editor cannot grant themselves owner access or delete the project', async () => {
  await asUser(users.editor, async () => {
    const result = await db.query(`update public.workspace_members set role = 'owner'
      where user_id = $1 returning id`, [users.editor]);
    assert.equal(result.rows.length, 0);
    const deleted = await db.query('delete from public.projects where id = $1 returning id', [fixture.projectA]);
    assert.equal(deleted.rows.length, 0);
    await expectError(`insert into public.workspace_members(workspace_id, user_id, role)
      values ($1, $2, 'editor')`, [fixture.workspaceA, users.bob], '42501');
  });
});

test('the owner can add a viewer but cannot forge an additional owner', async () => {
  await asUser(users.alice, async () => {
    await db.query(`insert into public.workspace_members(workspace_id, user_id, role)
      values ($1, $2, 'viewer')`, [fixture.workspaceA, users.bob]);
    await expectError(`update public.workspace_members set role = 'owner'
      where workspace_id = $1 and user_id = $2`, [fixture.workspaceA, users.bob], '42501');
  });
});

test('workspace ownership cannot be reassigned through ordinary table updates', async () => {
  await asUser(users.alice, () => expectError(`update public.workspaces set owner_id = $1
    where id = $2`, [users.bob, fixture.workspaceA], '42501'));
});

test('anonymous requests have no business-table access', async () => {
  await asUser(null, async () => {
    for (const table of ['workspaces', 'workspace_members', 'projects', 'social_accounts',
      'import_batches', 'content_posts', 'post_metrics', 'comments']) {
      await expectError(`select * from public.${table}`, [], '42501');
    }
  }, 'anon');
});

test('the automatic-RLS event helper is not executable by API users', async () => {
  const access = await one(`select
    has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') as anon_access,
    has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') as user_access`);
  assert.equal(access.anon_access, false);
  assert.equal(access.user_access, false);
});

test('an inaccessible project rejects inserts even if its UUID is known', async () => {
  await asUser(users.bob, () => expectError(`insert into public.social_accounts
    (project_id, platform) values ($1, 'youtube')`, [fixture.projectA], '42501'));
});

test('composite foreign keys reject cross-project content and source-batch links', async () => {
  await asUser(users.alice, async () => {
    await expectError(`insert into public.post_metrics
      (project_id, content_post_id, snapshot_time, metric_profile, source_batch_id, source_row_number)
      values ($1, $2, now(), 'test', $3, 2)`,
      [fixture.projectA, fixture.postA2, fixture.batchA], '23503');
    await expectError(`insert into public.comments
      (project_id, content_post_id, dedupe_hash, dedupe_method, dedupe_confidence,
       comment_text, source_batch_id, source_row_number)
      values ($1, $2, $3, 'inferred', 'low', 'Test', $4, 2)`,
      [fixture.projectA, fixture.postA, hash, fixture.batchA2], '23503');
  });
});

test('an account must match both the content project and its platform', async () => {
  await asUser(users.alice, async () => {
    const account = await one(`select id from public.social_accounts where project_id = $1`, [fixture.projectA]);
    await expectError(`update public.content_posts set social_account_id = $1, platform = 'weibo'
      where id = $2`, [account.id, fixture.postA], '23503');
  });
});

test('NULL and observed zero remain distinct and NULL does not contribute to averages', async () => {
  await asUser(users.alice, async () => {
    const metric = await one('select views, likes from public.post_metrics where content_post_id = $1', [fixture.postA]);
    assert.equal(metric.views, null);
    assert.equal(Number(metric.likes), 0);
    const stats = await one('select avg(views) as mean, count(views)::int as samples from public.post_metrics');
    assert.equal(stats.mean, null);
    assert.equal(stats.samples, 0);
  });
});

test('negative counts and period snapshots are rejected', async () => {
  await asUser(users.alice, async () => {
    await expectError('update public.post_metrics set views = -1 where content_post_id = $1', [fixture.postA], '23514');
    await expectError("update public.post_metrics set snapshot_type = 'period' where content_post_id = $1", [fixture.postA], '23514');
  });
});

test('a repeated snapshot in the same metric profile is rejected', async () => {
  await asUser(users.alice, () => expectError(`insert into public.post_metrics
    (project_id, content_post_id, snapshot_time, metric_profile, source_batch_id, source_row_number)
    values ($1, $2, '2026-10-02T00:00:00Z', 'youtube_fixture_v1', $3, 2)`,
    [fixture.projectA, fixture.postA, fixture.batchA], '23505'));
});

test('historical snapshots are separate rows and retain NULL instead of defaulting to zero', async () => {
  await asUser(users.alice, async () => {
    await db.query(`insert into public.post_metrics
      (project_id, content_post_id, snapshot_time, metric_profile, source_batch_id, source_row_number)
      values ($1, $2, '2026-10-03T00:00:00Z', 'youtube_fixture_v1', $3, 2)`,
      [fixture.projectA, fixture.postA, fixture.batchA]);
    const stats = await one(`select count(*)::int as n, count(views)::int as available
      from public.post_metrics where content_post_id = $1`, [fixture.postA]);
    assert.equal(stats.n, 2);
    assert.equal(stats.available, 0);
  });
});

test('project-wide content keys reject ambiguous cross-platform duplicates', async () => {
  await asUser(users.alice, () => expectError(`insert into public.content_posts
    (project_id, platform, content_key, title, content_type, publish_time, source_batch_id, source_row_number)
    values ($1, 'weibo', 'post_1', 'Other platform', 'text', now(), $2, 2)`,
    [fixture.projectA, fixture.batchA], '23505'));
});

test('inferred duplicate comment fingerprints are preserved for human review', async () => {
  await asUser(users.alice, async () => {
    await db.query(`insert into public.comments
      (project_id, content_post_id, dedupe_hash, dedupe_method, dedupe_confidence,
       comment_text, source_batch_id, source_row_number)
      values ($1, $2, $3, 'inferred', 'low', 'Synthetic comment', $4, 2)`,
      [fixture.projectA, fixture.postA, hash, fixture.batchA]);
    const result = await one('select count(*)::int as n from public.comments where content_post_id = $1', [fixture.postA]);
    assert.equal(result.n, 2);
  });
});

test('stable platform comment IDs and same-batch row identities cannot be duplicated', async () => {
  await asUser(users.alice, async () => {
    await db.query(`update public.comments set external_comment_id = 'platform_1', dedupe_method = 'external_id'
      where content_post_id = $1`, [fixture.postA]);
    await expectError(`insert into public.comments
      (project_id, content_post_id, external_comment_id, dedupe_hash, dedupe_method,
       dedupe_confidence, comment_text, source_batch_id, source_row_number)
      values ($1, $2, 'platform_1', $3, 'external_id', 'high', 'Other text', $4, 2)`,
      [fixture.projectA, fixture.postA, hash, fixture.batchA], '23505');
    await expectError(`insert into public.comments
      (project_id, content_post_id, dedupe_hash, dedupe_method, dedupe_confidence,
       comment_text, source_batch_id, source_row_number)
      values ($1, $2, $3, 'inferred', 'low', 'Other text', $4, 1)`,
      [fixture.projectA, fixture.postA, hash, fixture.batchA], '23505');
  });
});

test('empty comment text and an inferred hash marked high confidence are rejected', async () => {
  await asUser(users.alice, async () => {
    await expectError("update public.comments set comment_text = '  ' where content_post_id = $1", [fixture.postA], '23514');
    await expectError("update public.comments set dedupe_confidence = 'high' where content_post_id = $1", [fixture.postA], '23514');
  });
});

test('public-demo permission is false by default and requires license verification', async () => {
  await asUser(users.alice, async () => {
    const batch = await one('select public_demo_allowed, license_name from public.import_batches where id = $1', [fixture.batchA]);
    assert.equal(batch.public_demo_allowed, false);
    assert.equal(batch.license_name, 'unknown');
    await expectError('update public.import_batches set public_demo_allowed = true where id = $1', [fixture.batchA], '23514');
  });
});

test('successful imports require a commit timestamp and referenced sources cannot be deleted', async () => {
  await asUser(users.alice, async () => {
    await expectError("update public.import_batches set status = 'success' where id = $1", [fixture.batchA], '23514');
    await expectError('delete from public.import_batches where id = $1', [fixture.batchA], '23503');
  });
});

test('project deletion cascades through its data while preserving other projects', async () => {
  await asUser(users.alice, async () => {
    await db.query('delete from public.projects where id = $1', [fixture.projectA]);
    for (const table of ['social_accounts', 'import_batches', 'content_posts', 'post_metrics', 'comments']) {
      const result = await one(`select count(*)::int as n from public.${table} where project_id = $1`, [fixture.projectA]);
      assert.equal(result.n, 0);
    }
    assert.equal((await one('select count(*)::int as n from public.projects where id = $1', [fixture.projectA2])).n, 1);
  });
});


async function draftPacket(project=fixture.projectA,changes={}) {
 const comment=await one('select id from public.comments where project_id=$1 limit 1',[project]);
 return {schema:'ci_review_v1',context:{projectId:project,scopeHash:hash,sourceRevision:'fixture_v1',synthetic:false,rowCount:1,methods:['rules_v1'],filters:{platform:'youtube',profile:'fixture',metric:'views',topic:'',start:'2026-10-01',end:'2026-10-31',timezone:'UTC'}},savedAt:'2026-11-04T08:00:00.000Z',annotations:[{commentId:comment.id,label:'neutral',topics:null,note:'',reviewer:'Review A',reviewedAt:'2026-11-04T08:00:00.000Z',origin:'manual'}],...changes};
}
const saveDraft=(packet,expected=0)=>one('select public.save_comment_review_draft($1,$2,$3,$4::jsonb) as result',[packet.context.projectId,packet.context.scopeHash,expected,JSON.stringify(packet)]);

test('review drafts persist labels, confirm lost responses idempotently and reject stale versions',async()=>{
 await asUser(users.alice,async()=>{const p=await draftPacket();const first=(await saveDraft(p)).result;assert.equal(first.revision,1);assert.deepEqual(first.packet,p);
 const retry=(await saveDraft({...p,savedAt:'2026-11-04T08:01:00.000Z'})).result;assert.equal(retry.revision,1);
 const changed=structuredClone(p);changed.annotations[0].note='Reviewed again';assert.equal((await saveDraft(changed,1)).result.revision,2);
 p.annotations[0].label='positive';await expectError('select public.save_comment_review_draft($1,$2,$3,$4::jsonb)',[fixture.projectA,hash,1,JSON.stringify(p)],'P0001');
 assert.equal((await one('select revision from public.comment_review_drafts')).revision,2);
 });
});
test('review drafts are private to the authenticated author even within one workspace',async()=>{
 await asUser(users.editor,async()=>{const p=await draftPacket();await saveDraft(p);
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.alice]);assert.equal((await one('select count(*)::int n from public.comment_review_drafts')).n,0);
 await saveDraft(p);assert.equal((await one('select count(*)::int n from public.comment_review_drafts')).n,1);
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.bob]);assert.equal((await one('select count(*)::int n from public.comment_review_drafts')).n,0);
 });
});
test('review draft writes deny viewers, nonmembers and anonymous callers',async()=>{
 const p=await draftPacket();for(const user of [users.viewer,users.bob])await asUser(user,()=>expectError('select public.save_comment_review_draft($1,$2,0,$3::jsonb)',[fixture.projectA,hash,JSON.stringify(p)],'42501'));
 await asUser(null,()=>expectError('select * from public.comment_review_drafts',[],'42501'),'anon');
 await asUser(null,()=>expectError('select public.save_comment_review_draft($1,$2,0,$3::jsonb)',[fixture.projectA,hash,JSON.stringify(p)],'42501'),'anon');
});
test('review drafts reject invalid records atomically without modifying stored labels',async()=>{
 await asUser(users.alice,async()=>{const p=await draftPacket();await saveDraft(p);
 const bads=[];for(const mutate of [q=>q.annotations.push(q.annotations[0]),q=>q.annotations[0].note='x'.repeat(241),q=>q.annotations[0].topics=['wrong'],q=>q.annotations[0].origin='example',q=>q.context.synthetic=true,q=>q.context.scopeHash='b'.repeat(64),q=>q.annotations[0].rawText='unapproved']){const q=structuredClone(p);mutate(q);bads.push(q);}
 for(const q of bads)await expectError('select public.save_comment_review_draft($1,$2,1,$3::jsonb)',[fixture.projectA,hash,JSON.stringify(q)],'P0001');
 assert.equal((await one('select revision from public.comment_review_drafts')).revision,1);
 });
});
test('review draft comments cannot refer to a different project and context cannot move ownership',async()=>{
 await asUser(users.alice,async()=>{const p=await draftPacket();p.annotations[0].commentId=(await one('select id from public.comments where project_id=$1',[fixture.projectA2]))?.id||randomUUID();
 await expectError('select public.save_comment_review_draft($1,$2,0,$3::jsonb)',[fixture.projectA,hash,JSON.stringify(p)],'P0001');
 await expectError('insert into public.comment_review_drafts(project_id,actor_id,scope_hash,packet) values($1,$2,$3,$4::jsonb)',[fixture.projectA,users.editor,hash,JSON.stringify(p)],'42501');
 });
});
test('direct Data API updates also require a current revision and cannot alter ownership or server metadata',async()=>{
 await asUser(users.alice,async()=>{const p=await draftPacket();await saveDraft(p);p.annotations[0].note='Changed';
 await expectError('update public.comment_review_drafts set packet=$1::jsonb',[JSON.stringify(p)],'P0001');
 const updated=await one('update public.comment_review_drafts set packet=$1::jsonb,base_revision=1 returning revision',[JSON.stringify(p)]);assert.equal(updated.revision,2);
 await expectError('update public.comment_review_drafts set actor_id=$1',[users.editor],'42501');await expectError('update public.comment_review_drafts set revision=100',[],'42501');
 await expectError('delete from public.comment_review_drafts',[],'42501');
 });
});
