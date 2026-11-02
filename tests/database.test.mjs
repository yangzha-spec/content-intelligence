import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';

// PostgreSQL engine, with a minimal stand-in for Supabase Auth.
// Hosted Supabase Auth, Storage and HTTP integration still require a separate smoke test.
const db = new PGlite();
const users = {
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
  await db.query('delete from public.import_batches where id=$1', [batch.id]);
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
  await db.query('delete from storage.objects where name=$1', [batch.path]); await db.query('delete from public.import_batches where id=$1', [batch.id]);
});

test('migration creates eight business tables and enables RLS on every table', async () => {
  const { rows } = await db.query(`select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'`);
  assert.equal(rows.length, 8);
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
