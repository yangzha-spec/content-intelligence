-- Cloud PostgreSQL role test. Synthetic users and rows are rolled back together.
-- Run through the trusted SQL connection, not through a browser client.
-- This tests actual RLS and auth.uid(), but not Auth HTTP login or JWT validation.
begin;
set local statement_timeout = '20s';

do $smoke$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  workspace_a uuid;
  project_a uuid;
  account_a uuid;
  batch_a uuid;
  post_a uuid;
  changed integer;
  item record;
begin
  insert into auth.users(id, email) values
    (user_a, 'ci-smoke-' || user_a || '@example.invalid'),
    (user_b, 'ci-smoke-' || user_b || '@example.invalid');

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.workspaces(name) values ('Rollback-only smoke test') returning id into workspace_a;
  assert (select count(*) = 1 from public.workspace_members where workspace_id = workspace_a and role = 'owner'),
    'Creator must receive owner membership';
  insert into public.projects(workspace_id, name) values (workspace_a, 'Synthetic') returning id into project_a;
  insert into public.social_accounts(project_id, platform, account_key)
    values (project_a, 'youtube', 'test_account') returning id into account_a;
  insert into public.import_batches(project_id, file_name, file_hash, storage_path,
    file_size_bytes, mime_type, source_type, source_name)
    values (project_a, 'synthetic.csv', repeat('a', 64), 'smoke/' || project_a || '/synthetic.csv',
      1, 'text/csv', 'synthetic', 'rollback-only') returning id into batch_a;
  insert into public.content_posts(project_id, platform, social_account_id, content_key,
    title, content_type, publish_time, source_batch_id, source_row_number)
    values (project_a, 'youtube', account_a, 'smoke_post', 'Synthetic', 'video', now(), batch_a, 1)
    returning id into post_a;
  insert into public.post_metrics(project_id, content_post_id, snapshot_time, metric_profile,
    views, likes, source_batch_id, source_row_number)
    values (project_a, post_a, now(), 'synthetic_v1', null, 0, batch_a, 1);
  insert into public.comments(project_id, content_post_id, dedupe_hash, dedupe_method,
    dedupe_confidence, comment_text, source_batch_id, source_row_number)
    values (project_a, post_a, repeat('b', 64), 'inferred', 'low', 'Synthetic', batch_a, 1);
  assert (select views is null and likes = 0 from public.post_metrics where content_post_id = post_a),
    'NULL and zero must remain distinct';

  -- B is not a member and must not see A's workspace or any of its project rows.
  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  assert not exists(select 1 from public.workspaces where id = workspace_a), 'Workspace isolation failed';
  assert not exists(select 1 from public.workspace_members where workspace_id = workspace_a), 'Membership isolation failed';
  assert not exists(select 1 from public.projects where id = project_a), 'Project isolation failed';
  for item in select unnest(array['social_accounts', 'import_batches', 'content_posts', 'post_metrics', 'comments']) as name loop
    execute format('select count(*) from public.%I where project_id = $1', item.name) into changed using project_a;
    assert changed = 0, 'Project data isolation failed';
  end loop;
  begin
    insert into public.projects(workspace_id, name) values (workspace_a, 'Denied');
    raise exception 'Nonmember write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  -- A adds B as viewer. B can now read but cannot write or promote themselves.
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert into public.workspace_members(workspace_id, user_id, role) values (workspace_a, user_b, 'viewer');
  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  assert exists(select 1 from public.content_posts where id = post_a), 'Viewer read failed';
  update public.content_posts set title = 'Denied' where id = post_a;
  get diagnostics changed = row_count;
  assert changed = 0, 'Viewer write unexpectedly succeeded';
  update public.workspace_members set role = 'owner' where workspace_id = workspace_a and user_id = user_b;
  get diagnostics changed = row_count;
  assert changed = 0, 'Viewer promotion unexpectedly succeeded';

  -- A makes B editor. B can write data, but still cannot manage membership.
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  update public.workspace_members set role = 'editor' where workspace_id = workspace_a and user_id = user_b;
  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  update public.content_posts set title = 'Editor allowed' where id = post_a;
  get diagnostics changed = row_count;
  assert changed = 1, 'Editor write failed';
  update public.workspace_members set role = 'owner' where workspace_id = workspace_a and user_id = user_b;
  get diagnostics changed = row_count;
  assert changed = 0, 'Editor promotion unexpectedly succeeded';
  execute 'reset role';
end;
$smoke$;

rollback;
select true as cloud_rls_smoke_passed, true as synthetic_rows_rolled_back;
