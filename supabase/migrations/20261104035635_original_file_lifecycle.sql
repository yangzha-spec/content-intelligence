-- Manual owner-approved original-file cleanup; no scheduled deletion or elevated service role.
begin;
alter table public.import_batches
  add column originals_state text not null default 'retained' check (originals_state in ('retained','deleting','deleted')),
  add column originals_cleanup_started_at timestamptz,
  add column originals_cleanup_by uuid references auth.users(id),
  add column originals_deleted_at timestamptz,
  add constraint originals_state_audit check (
    (originals_state = 'retained' and originals_cleanup_started_at is null and originals_cleanup_by is null and originals_deleted_at is null)
    or (originals_state = 'deleting' and originals_cleanup_started_at is not null and originals_cleanup_by is not null and originals_deleted_at is null)
    or (originals_state = 'deleted' and originals_cleanup_started_at is not null and originals_cleanup_by is not null and originals_deleted_at is not null)
  );
create index import_batches_cleanup_by_idx on public.import_batches(originals_cleanup_by);
drop index public.import_batches_project_request_idx;
create unique index import_batches_project_request_idx on public.import_batches(project_id,request_hash)
  where originals_state = 'retained' or status = 'success';

create or replace function private.can_access_import_file(object_name text, write_access boolean default false)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.import_batches b
    where private.can_access_project(b.project_id, write_access)
      and (not write_access or (b.originals_state = 'retained' and b.created_by = (select auth.uid()) and b.status in ('pending','uploaded','failed')))
      and exists (select 1 from jsonb_array_elements(b.file_manifest) f
        where f->>'path' = object_name and starts_with(object_name,b.project_id::text || '/' || b.id::text || '/'))
  );
$$;

-- A write policy holds a batch row lock until Storage metadata is inserted.
-- Cleanup takes the same lock, so an in-flight upload cannot land after finish.
create function private.can_insert_import_file(object_name text)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
declare batch public.import_batches%rowtype;
begin
  select * into batch from public.import_batches b
    where b.originals_state='retained' and b.created_by=(select auth.uid())
      and b.status in ('pending','uploaded','failed') and private.can_access_project(b.project_id,true)
      and starts_with(object_name,b.project_id::text || '/' || b.id::text || '/')
      and exists(select 1 from jsonb_array_elements(b.file_manifest) f where f->>'path'=object_name)
    for share;
  return found;
end;
$$;
revoke all on function private.can_insert_import_file(text) from public,anon,authenticated;
grant execute on function private.can_insert_import_file(text) to authenticated;
alter policy raw_imports_insert on storage.objects with check (bucket_id='raw-imports' and private.can_insert_import_file(name));

create function private.guard_original_lifecycle()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare excluded text[] := array['originals_state','originals_cleanup_started_at','originals_cleanup_by','originals_deleted_at'];
begin
  if tg_op = 'INSERT' then
    if new.originals_state <> 'retained' or new.originals_cleanup_started_at is not null or new.originals_cleanup_by is not null or new.originals_deleted_at is not null
    then raise exception 'ORIGINALS_INVALID_INITIAL_STATE'; end if;
    return new;
  end if;
  if old.originals_state <> 'retained' and (to_jsonb(new) - excluded) is distinct from (to_jsonb(old) - excluded)
  then raise exception 'ORIGINALS_ARCHIVED: no import or batch changes after cleanup starts'; end if;
  if (new.originals_state,new.originals_cleanup_started_at,new.originals_cleanup_by,new.originals_deleted_at)
    is not distinct from (old.originals_state,old.originals_cleanup_started_at,old.originals_cleanup_by,old.originals_deleted_at)
  then return new; end if;
  if auth.uid() is null or not exists (select 1 from public.projects p where p.id=old.project_id and private.owns_workspace(p.workspace_id))
  then raise exception 'ORIGINALS_FORBIDDEN: only workspace owner may clean originals' using errcode='42501'; end if;
  if (to_jsonb(new) - excluded) is distinct from (to_jsonb(old) - excluded)
  then raise exception 'ORIGINALS_CLEANUP_ONLY: batch identity and results must remain unchanged'; end if;
  if old.originals_state='retained' and new.originals_state='deleting' then
    if old.status not in ('pending','uploaded','ready','failed','success') then raise exception 'ORIGINALS_BUSY'; end if;
    new.originals_cleanup_started_at:=clock_timestamp(); new.originals_cleanup_by:=auth.uid(); new.originals_deleted_at:=null;
  elsif old.originals_state='deleting' and new.originals_state='deleted' then
    if exists(select 1 from storage.objects o where o.bucket_id='raw-imports' and starts_with(o.name,old.project_id::text || '/' || old.id::text || '/'))
    then raise exception 'ORIGINALS_STILL_PRESENT: delete through Storage API before finishing'; end if;
    new.originals_cleanup_started_at:=old.originals_cleanup_started_at; new.originals_cleanup_by:=old.originals_cleanup_by; new.originals_deleted_at:=clock_timestamp();
  else raise exception 'ORIGINALS_INVALID_TRANSITION'; end if;
  return new;
end;
$$;
revoke all on function private.guard_original_lifecycle() from public,anon,authenticated;
create trigger a_guard_original_lifecycle before insert or update on public.import_batches
for each row execute function private.guard_original_lifecycle();

create or replace function private.protect_import_identity()
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
  if old.status = 'success' and (to_jsonb(new) - array['originals_state','originals_cleanup_started_at','originals_cleanup_by','originals_deleted_at']) is distinct from (to_jsonb(old) - array['originals_state','originals_cleanup_started_at','originals_cleanup_by','originals_deleted_at']) then
    raise exception 'IMPORT_ALREADY_COMMITTED: successful batch is immutable';
  end if;
  return new;
end;
$$;

create function private.can_delete_import_file(object_name text)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists (select 1 from public.import_batches b join public.projects p on p.id=b.project_id
    where b.originals_state='deleting' and private.owns_workspace(p.workspace_id)
      and starts_with(object_name,b.project_id::text || '/' || b.id::text || '/')
      and exists(select 1 from jsonb_array_elements(b.file_manifest) f where f->>'path'=object_name));
$$;
revoke all on function private.can_delete_import_file(text) from public,anon,authenticated;
grant execute on function private.can_delete_import_file(text) to authenticated;
create policy raw_imports_owner_cleanup on storage.objects for delete to authenticated
using (bucket_id='raw-imports' and private.can_delete_import_file(name));

create function public.begin_original_cleanup(target_batch uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare batch public.import_batches%rowtype; project uuid;
begin
  select b.project_id into project from public.import_batches b join public.projects p on p.id=b.project_id
    where b.id=target_batch and private.owns_workspace(p.workspace_id);
  if auth.uid() is null or project is null then raise exception 'ORIGINALS_FORBIDDEN' using errcode='42501'; end if;
  perform 1 from public.projects where id=project for update;
  select * into batch from public.import_batches where id=target_batch for update;
  if batch.originals_state='retained' then
    update public.import_batches set originals_state='deleting' where id=target_batch returning * into batch;
  end if;
  return jsonb_build_object('batch_id',batch.id,'project_id',batch.project_id,'state',batch.originals_state,'files',batch.file_manifest);
end;
$$;
create function public.finish_original_cleanup(target_batch uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare batch public.import_batches%rowtype; project uuid;
begin
  select b.project_id into project from public.import_batches b join public.projects p on p.id=b.project_id
    where b.id=target_batch and private.owns_workspace(p.workspace_id);
  if auth.uid() is null or project is null then raise exception 'ORIGINALS_FORBIDDEN' using errcode='42501'; end if;
  perform 1 from public.projects where id=project for update;
  select * into batch from public.import_batches where id=target_batch for update;
  if batch.originals_state='deleting' then
    update public.import_batches set originals_state='deleted' where id=target_batch returning * into batch;
  elsif batch.originals_state <> 'deleted' then raise exception 'ORIGINALS_NOT_STARTED'; end if;
  return jsonb_build_object('batch_id',batch.id,'state',batch.originals_state,'deleted_at',batch.originals_deleted_at);
end;
$$;
revoke all on function public.begin_original_cleanup(uuid),public.finish_original_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.begin_original_cleanup(uuid),public.finish_original_cleanup(uuid) to authenticated;

-- Preserve provenance until files have been removed by the Storage API. Checks
-- use batch state instead of Storage RLS, including BEFORE workspace/project CASCADE.
create function private.guard_original_parent_delete()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='import_batches' then
    if old.originals_state <> 'deleted' and jsonb_array_length(old.file_manifest)>0 then raise exception 'ORIGINALS_CLEANUP_REQUIRED'; end if;
  elsif tg_table_name='projects' then
    if exists(select 1 from public.import_batches b where b.project_id=old.id and b.originals_state <> 'deleted' and jsonb_array_length(b.file_manifest)>0)
    then raise exception 'ORIGINALS_CLEANUP_REQUIRED'; end if;
  elsif tg_table_name='workspaces' then
    if exists(select 1 from public.import_batches b join public.projects p on p.id=b.project_id where p.workspace_id=old.id and b.originals_state <> 'deleted' and jsonb_array_length(b.file_manifest)>0)
    then raise exception 'ORIGINALS_CLEANUP_REQUIRED'; end if;
  end if;
  return old;
end;
$$;
revoke all on function private.guard_original_parent_delete() from public,anon,authenticated;
create trigger guard_original_batch_delete before delete on public.import_batches for each row execute function private.guard_original_parent_delete();
create trigger guard_original_project_delete before delete on public.projects for each row execute function private.guard_original_parent_delete();
create trigger guard_original_workspace_delete before delete on public.workspaces for each row execute function private.guard_original_parent_delete();
commit;
