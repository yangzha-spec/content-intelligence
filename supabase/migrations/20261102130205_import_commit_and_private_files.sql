-- Private originals and an atomic, user-scoped import API. No service_role grants.
begin;

alter table public.import_batches
  add column file_manifest jsonb not null default '[]'::jsonb
    check (jsonb_typeof(file_manifest) = 'array' and jsonb_array_length(file_manifest) <= 3),
  add column request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  add column import_config jsonb not null default '{}'::jsonb check (jsonb_typeof(import_config) = 'object');
create unique index import_batches_project_request_idx on public.import_batches(project_id, request_hash);
alter policy project_data_create on public.import_batches with check (
  private.can_access_project(project_id, true) and created_by = (select auth.uid())
);
alter table public.content_posts add column source_table text;
alter table public.post_metrics add column source_table text;
alter table public.comments add column source_table text;

-- Originals have fixed paths. Existing objects cannot be overwritten by clients.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('raw-imports', 'raw-imports', false, 20971520,
  array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create function private.can_access_import_file(object_name text, write_access boolean default false)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.import_batches b
    where private.can_access_project(b.project_id, write_access)
      and (not write_access or (b.created_by = (select auth.uid()) and b.status in ('pending','uploaded','failed')))
      and exists (select 1 from jsonb_array_elements(b.file_manifest) f
        where f->>'path' = object_name
          and object_name like b.project_id::text || '/' || b.id::text || '/%')
  );
$$;
revoke all on function private.can_access_import_file(text, boolean) from public, anon, authenticated;
grant execute on function private.can_access_import_file(text, boolean) to authenticated;
create policy raw_imports_read on storage.objects for select to authenticated
using (bucket_id = 'raw-imports' and private.can_access_import_file(name));
create policy raw_imports_insert on storage.objects for insert to authenticated
with check (bucket_id = 'raw-imports' and private.can_access_import_file(name, true));
-- Retain originals for provenance, including failed batches. No UPDATE/DELETE policy.

create function private.protect_import_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.project_id is distinct from old.project_id or new.created_by is distinct from old.created_by
    or new.file_manifest is distinct from old.file_manifest or new.import_config is distinct from old.import_config
    or new.request_hash is distinct from old.request_hash or new.file_hash is distinct from old.file_hash
    or new.storage_path is distinct from old.storage_path or new.storage_bucket is distinct from old.storage_bucket
    or new.file_name is distinct from old.file_name or new.file_size_bytes is distinct from old.file_size_bytes
    or new.mime_type is distinct from old.mime_type or new.field_mapping is distinct from old.field_mapping
    or new.mapping_version is distinct from old.mapping_version or new.processing_version is distinct from old.processing_version
    or new.source_type is distinct from old.source_type or new.source_name is distinct from old.source_name
    or new.license_name is distinct from old.license_name or new.data_owner_or_provider is distinct from old.data_owner_or_provider
    or new.contains_personal_data is distinct from old.contains_personal_data or new.notes is distinct from old.notes
  then raise exception 'IMPORT_IDENTITY_IMMUTABLE: create a new batch for changed files, mapping or source'; end if;
  if old.status = 'success' and new is distinct from old then
    raise exception 'IMPORT_ALREADY_COMMITTED: successful batch is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_import_identity() from public, anon, authenticated;
create trigger protect_import_identity before update on public.import_batches
for each row execute function private.protect_import_identity();

-- Runs with the caller's JWT and existing RLS. Every call is a single transaction.
-- Server code re-reads private originals before calling; SQL repeats authorization,
-- identity, bounds, associations and uniqueness checks, and never upserts records.
create function public.commit_import_batch(target_batch uuid, expected_config jsonb, expected_manifest jsonb, payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  batch public.import_batches%rowtype;
  project uuid;
  counts jsonb;
  n integer;
begin
  select project_id into project from public.import_batches where id = target_batch;
  if auth.uid() is null or project is null or not private.can_access_project(project, true) then
    raise exception 'IMPORT_FORBIDDEN: no write access' using errcode = '42501';
  end if;
  -- A consistent lock order serializes concurrent batches in the same project.
  perform 1 from public.projects where id = project for update;
  select * into batch from public.import_batches where id = target_batch for update;
  if batch.status = 'success' then
    return jsonb_build_object('batch_id', batch.id, 'already_applied', true, 'counts', batch.row_counts);
  end if;
  if batch.import_config <> expected_config or batch.file_manifest <> expected_manifest
    or batch.request_hash is null or jsonb_array_length(batch.file_manifest) not between 1 and 3 then
    raise exception 'IMPORT_CHANGED: files or configuration changed';
  end if;
  if batch.status not in ('ready','failed','uploaded','validating') then
    raise exception 'IMPORT_NOT_READY: originals must be uploaded and revalidated';
  end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or jsonb_typeof(payload->'Posts') is distinct from 'array'
    or jsonb_typeof(payload->'Metrics') is distinct from 'array'
    or jsonb_typeof(payload->'Comments') is distinct from 'array' then
    raise exception 'IMPORT_INVALID_PAYLOAD';
  end if;
  n := jsonb_array_length(payload->'Posts') + jsonb_array_length(payload->'Metrics') + jsonb_array_length(payload->'Comments');
  if n not between 1 and 10000 or octet_length(payload::text) > 16000000 then raise exception 'IMPORT_LIMIT_EXCEEDED'; end if;
  if exists (
    select 1 from jsonb_each(payload) t cross join lateral jsonb_array_elements(t.value) r
    where t.key not in ('Posts','Metrics','Comments') or jsonb_typeof(r) <> 'object'
      or nullif(btrim(r->>'content_key'), '') is null
      or nullif(btrim(r->>'source_table'), '') is null
      or coalesce((r->>'source_row_number')::integer, 0) < 2
  ) then raise exception 'IMPORT_INVALID_SOURCE'; end if;

  -- Original files must actually exist in the private bucket before any rows land.
  if exists (select 1 from jsonb_array_elements(batch.file_manifest) f
    where not exists (select 1 from storage.objects o where o.bucket_id = 'raw-imports' and o.name = f->>'path'))
  then raise exception 'IMPORT_ORIGINAL_MISSING'; end if;
  update public.import_batches set status = 'committing', error_message = null where id = target_batch;

  insert into public.social_accounts(project_id, platform, account_key)
  select distinct project, r->>'platform', r->>'account_key' from jsonb_array_elements(payload->'Posts') r
  where nullif(r->>'account_key', '') is not null
  on conflict (project_id, platform, account_key) do nothing;

  insert into public.content_posts(project_id, social_account_id, platform, content_key, external_content_id,
    title, content_type, raw_content_type, publish_time, content_text, topic, tags, content_url, language,
    source_batch_id, source_row_number, source_table)
  select project, a.id, r->>'platform', r->>'content_key', r->>'external_content_id', r->>'title',
    r->>'content_type', r->>'raw_content_type', (r->>'publish_time')::timestamptz,
    r->>'content_text', r->>'topic', coalesce(nullif(r->'tags', 'null'::jsonb), '[]'::jsonb),
    r->>'content_url', r->>'language', target_batch, (r->>'source_row_number')::integer, r->>'source_table'
  from jsonb_array_elements(payload->'Posts') r left join public.social_accounts a
    on a.project_id = project and a.platform = r->>'platform' and a.account_key = r->>'account_key';

  if exists (select 1 from (
    select r from jsonb_array_elements(payload->'Metrics') r union all select r from jsonb_array_elements(payload->'Comments') r
  ) children where not exists (select 1 from public.content_posts p where p.project_id = project and p.content_key = children.r->>'content_key'))
  then raise exception 'IMPORT_ORPHAN_CONTENT'; end if;

  insert into public.post_metrics(project_id, content_post_id, snapshot_time, snapshot_type, metric_profile,
    views, impressions, reach, likes, comments_count, shares, saves, raw_metrics, missing_reasons,
    source_batch_id, source_row_number, source_table)
  select project, p.id, (r->>'snapshot_time')::timestamptz, r->>'snapshot_type', r->>'metric_profile',
    (r->>'views')::bigint, (r->>'impressions')::bigint, (r->>'reach')::bigint, (r->>'likes')::bigint,
    (r->>'comments_count')::bigint, (r->>'shares')::bigint, (r->>'saves')::bigint,
    coalesce(nullif(r->'raw_metrics','null'::jsonb), '{}'::jsonb),
    (select coalesce(jsonb_object_agg(k, 'not_provided'), '{}'::jsonb) from unnest(array['views','impressions','reach','likes','comments_count','shares','saves']) k where r->>k is null),
    target_batch, (r->>'source_row_number')::integer, r->>'source_table'
  from jsonb_array_elements(payload->'Metrics') r join public.content_posts p on p.project_id = project and p.content_key = r->>'content_key';

  insert into public.comments(project_id, content_post_id, comment_key, external_comment_id, dedupe_hash,
    dedupe_method, dedupe_confidence, comment_text, comment_time, comment_likes, reply_count,
    parent_comment_external_id, language, sample_type, source_batch_id, source_row_number, source_table)
  select project, p.id, r->>'comment_key', r->>'external_comment_id', r->>'dedupe_hash', r->>'dedupe_method',
    r->>'dedupe_confidence', r->>'comment_text', (r->>'comment_time')::timestamptz,
    (r->>'comment_likes')::bigint, (r->>'reply_count')::bigint, r->>'parent_comment_id', r->>'language',
    r->>'sample_type', target_batch, (r->>'source_row_number')::integer, r->>'source_table'
  from jsonb_array_elements(payload->'Comments') r join public.content_posts p on p.project_id = project and p.content_key = r->>'content_key';

  counts := jsonb_build_object('Posts', jsonb_array_length(payload->'Posts'), 'Metrics', jsonb_array_length(payload->'Metrics'), 'Comments', jsonb_array_length(payload->'Comments'));
  update public.import_batches set status = 'success', committed_at = now(), row_counts = counts,
    error_message = null where id = target_batch;
  return jsonb_build_object('batch_id', target_batch, 'already_applied', false, 'counts', counts);
end;
$$;
revoke all on function public.commit_import_batch(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_import_batch(uuid, jsonb, jsonb, jsonb) to authenticated;
commit;
