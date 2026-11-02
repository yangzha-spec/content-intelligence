-- Cloud DB/RLS smoke test; every synthetic row is rolled back.
-- Storage rows below are transaction-only metadata fixtures, not actual uploads.
-- This does NOT substitute for authenticated Auth + Storage + Edge HTTP acceptance.
begin;
set local statement_timeout = '20s';
do $smoke$
declare
  actor uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  workspace uuid; project uuid; batch uuid := gen_random_uuid(); object_path text;
  manifest jsonb; config jsonb := '{"timezone":"Asia/Shanghai","encoding":"utf-8","tables":[]}'::jsonb;
  payload jsonb; result jsonb; changed integer;
begin
  assert (select not public and file_size_limit = 20971520 from storage.buckets where id='raw-imports'), 'Bucket must be private and bounded';
  assert not (select prosecdef from pg_proc where oid='public.commit_import_batch(uuid,jsonb,jsonb,jsonb)'::regprocedure), 'Commit must use caller RLS';
  assert not has_function_privilege('anon','public.commit_import_batch(uuid,jsonb,jsonb,jsonb)','execute'), 'Anonymous RPC execution must be denied';
  insert into auth.users(id,email) values(actor,'ci-import-'||actor||'@example.invalid'),(outsider,'ci-import-'||outsider||'@example.invalid');
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.workspaces(name) values('Rollback-only import smoke') returning id into workspace;
  insert into public.projects(workspace_id,name) values(workspace,'Synthetic import') returning id into project;
  object_path := project||'/'||batch||'/0.csv';
  manifest := jsonb_build_array(jsonb_build_object('name','Posts.csv','path',object_path,'size',100,'sha256',repeat('a',64),'mime','text/csv'));
  insert into public.import_batches(id,project_id,file_name,file_hash,storage_path,file_size_bytes,mime_type,source_type,source_name,file_manifest,import_config,request_hash)
    values(batch,project,'Posts.csv',repeat('a',64),object_path,100,'text/csv','synthetic','rollback-only',manifest,config,repeat('b',64));
  insert into storage.objects(bucket_id,name) values('raw-imports',object_path);
  update public.import_batches set status='ready' where id=batch;
  payload := jsonb_build_object('Posts',jsonb_build_array(jsonb_build_object('content_key','synthetic_p1','platform','youtube','title','Synthetic','content_type','video','publish_time','2026-10-01T00:00:00Z','source_row_number',2,'source_table','Posts.csv')),
    'Metrics',jsonb_build_array(jsonb_build_object('content_key','synthetic_p1','snapshot_time','2026-10-02T00:00:00Z','snapshot_type','cumulative','metric_profile','synthetic_v1','views',null,'likes','0','source_row_number',2,'source_table','Metrics.csv')),
    'Comments',jsonb_build_array(jsonb_build_object('content_key','synthetic_p1','comment_text','Synthetic','dedupe_hash',repeat('c',64),'dedupe_method','inferred','dedupe_confidence','low','sample_type','unknown','source_row_number',2,'source_table','Comments.csv')));
  result := public.commit_import_batch(batch,config,manifest,payload);
  assert not (result->>'already_applied')::boolean, 'First commit failed';
  result := public.commit_import_batch(batch,config,manifest,payload);
  assert (result->>'already_applied')::boolean, 'Repeated commit must return existing result';
  assert (select count(*)=1 from public.content_posts where source_batch_id=batch), 'Duplicate posts';
  assert (select views is null and likes=0 from public.post_metrics where source_batch_id=batch), 'NULL/zero changed';
  assert (select status='success' and committed_at is not null from public.import_batches where id=batch), 'Commit status missing';
  update storage.objects set name='changed' where name=object_path;
  get diagnostics changed = row_count;
  assert changed=0, 'Original overwrites must be denied';
  perform set_config('request.jwt.claim.sub', outsider::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  assert not exists(select 1 from storage.objects where name=object_path), 'Cross-workspace original exposed';
  assert not exists(select 1 from public.import_batches where id=batch), 'Cross-workspace history exposed';
  begin
    perform public.commit_import_batch(batch,config,manifest,payload);
    raise exception 'Outsider commit unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end;
$smoke$;
rollback;
select true as cloud_import_smoke_passed, true as all_synthetic_rows_rolled_back;
