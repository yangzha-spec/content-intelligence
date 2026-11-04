-- Rollback-only DB permissions check. No Storage objects or physical files are created/deleted.
begin;
set local statement_timeout='20s';
do $smoke$
declare actor uuid:=gen_random_uuid(); editor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); workspace uuid; project uuid; batch uuid:=gen_random_uuid(); post uuid; plan jsonb;
begin
 insert into auth.users(id,email) values(actor,'ci-lifecycle-'||actor||'@example.invalid'),(editor,'ci-lifecycle-'||editor||'@example.invalid'),(viewer,'ci-lifecycle-'||viewer||'@example.invalid'),(outsider,'ci-lifecycle-'||outsider||'@example.invalid');
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 insert into public.workspaces(name) values('Rollback-only lifecycle') returning id into workspace;
 insert into public.projects(workspace_id,name) values(workspace,'Synthetic lifecycle') returning id into project;
 insert into public.workspace_members(workspace_id,user_id,role) values(workspace,editor,'editor'),(workspace,viewer,'viewer');
 insert into public.import_batches(id,project_id,file_name,file_hash,storage_path,file_size_bytes,mime_type,source_type,source_name,file_manifest)
 values(batch,project,'Synthetic.csv',repeat('a',64),project||'/'||batch||'/0.csv',1,'text/csv','synthetic','rollback-only',jsonb_build_array(jsonb_build_object('name','Synthetic.csv','path',project||'/'||batch||'/0.csv','size',1,'sha256',repeat('a',64),'mime','text/csv')));
 insert into public.content_posts(project_id,content_key,platform,title,content_type,publish_time,source_batch_id,source_row_number) values(project,'synthetic','youtube','Synthetic','video','2026-10-01T00:00:00Z',batch,2) returning id into post;
 update public.import_batches set status='success',committed_at=now() where id=batch;
 begin delete from public.projects where id=project; raise exception 'PROJECT_DELETE_UNEXPECTEDLY_ALLOWED';exception when raise_exception then if sqlerrm <> 'ORIGINALS_CLEANUP_REQUIRED' then raise;end if;end;
 foreach editor in array array[editor,viewer,outsider] loop
  perform set_config('request.jwt.claim.sub',editor::text,true);
  begin perform public.begin_original_cleanup(batch);raise exception 'NONOWNER_CLEANUP_UNEXPECTEDLY_ALLOWED';exception when insufficient_privilege then null;end;
 end loop;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 plan:=public.begin_original_cleanup(batch); assert plan->>'state'='deleting','Cleanup not started';
 assert public.begin_original_cleanup(batch)->>'state'='deleting','Retry did not reuse state';
 -- No Storage objects exist for this synthetic fixture. Only lifecycle state changes.
 assert public.finish_original_cleanup(batch)->>'state'='deleted','Finish failed';
 assert public.finish_original_cleanup(batch)->>'state'='deleted','Finish not idempotent';
 assert exists(select 1 from public.content_posts where id=post),'Imported data was removed';
 assert exists(select 1 from public.import_batches where id=batch and originals_cleanup_by=actor and originals_deleted_at is not null and jsonb_array_length(file_manifest)=1),'Provenance missing';
 begin update public.import_batches set originals_state='retained',originals_cleanup_started_at=null,originals_cleanup_by=null,originals_deleted_at=null where id=batch;raise exception 'RESTORE_UNEXPECTEDLY_ALLOWED';exception when raise_exception then if sqlerrm <> 'ORIGINALS_INVALID_TRANSITION' then raise;end if;end;
 execute 'reset role';
end;
$smoke$;
rollback;
select true as cloud_original_lifecycle_smoke_passed,true as no_storage_objects_touched,true as all_synthetic_rows_rolled_back;
