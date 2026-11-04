-- Only synthetic transaction fixtures. No Storage objects or provider requests.
begin;
set local statement_timeout='20s';
do $smoke$
declare actor uuid:=gen_random_uuid(); editor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); workspace uuid; project uuid; batch uuid; post uuid; comment uuid; p jsonb; result jsonb;
begin
 insert into auth.users(id,email) values(actor,'ci-review-'||actor||'@example.invalid'),(editor,'ci-review-'||editor||'@example.invalid'),(viewer,'ci-review-'||viewer||'@example.invalid');
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 insert into public.workspaces(name) values('Rollback-only review draft') returning id into workspace;
 insert into public.projects(workspace_id,name) values(workspace,'Synthetic review fixture') returning id into project;
 insert into public.workspace_members(workspace_id,user_id,role) values(workspace,editor,'editor'),(workspace,viewer,'viewer');
 insert into public.import_batches(project_id,file_name,file_hash,storage_path,file_size_bytes,mime_type,source_type,source_name)
 values(project,'rollback.csv',repeat('a',64),'rollback/'||project||'.csv',100,'text/csv','synthetic','rollback test') returning id into batch;
 insert into public.content_posts(project_id,content_key,platform,title,content_type,publish_time,source_batch_id,source_row_number)
 values(project,'fixture','youtube','Synthetic','video',now(),batch,1) returning id into post;
 insert into public.comments(project_id,content_post_id,comment_text,dedupe_hash,dedupe_method,dedupe_confidence,source_batch_id,source_row_number)
 values(project,post,'Synthetic review comment',repeat('b',64),'inferred','low',batch,1) returning id into comment;
 p:=jsonb_build_object('schema','ci_review_v1','savedAt','2026-11-04T08:00:00.000Z','context',jsonb_build_object('projectId',project,'scopeHash',repeat('a',64),'sourceRevision','fixture','synthetic',false,'rowCount',1,'methods',jsonb_build_array('lexicon_zh_en_v1'),'filters','{}'::jsonb),'annotations',jsonb_build_array(jsonb_build_object('commentId',comment,'label','neutral','topics',null,'note','','reviewer','Synthetic reviewer','reviewedAt','2026-11-04T08:00:00.000Z','origin','manual')));
 result:=public.save_comment_review_draft(project,repeat('a',64),0,p);assert result->>'revision'='1','Initial save failed';
 assert public.save_comment_review_draft(project,repeat('a',64),0,p)->>'revision'='1','Identical retry wrote another version';
 p:=jsonb_set(p,'{annotations,0,note}','"Updated"'::jsonb);
 assert public.save_comment_review_draft(project,repeat('a',64),1,p)->>'revision'='2','Update failed';
 begin perform public.save_comment_review_draft(project,repeat('a',64),1,jsonb_set(p,'{annotations,0,note}','"Stale"'::jsonb));raise exception 'STALE_ALLOWED';exception when raise_exception then if sqlerrm<>'REVIEW_DRAFT_CONFLICT' then raise;end if;end;
 begin update public.comment_review_drafts set packet=p;raise exception 'DIRECT_STALE_ALLOWED';exception when raise_exception then if sqlerrm<>'REVIEW_DRAFT_CONFLICT' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',editor::text,true);
 assert not exists(select 1 from public.comment_review_drafts),'Editor read another author draft';
 assert public.save_comment_review_draft(project,repeat('a',64),0,p)->>'revision'='1','Editor own save denied';
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 assert not exists(select 1 from public.comment_review_drafts),'Viewer read another author draft';
 begin perform public.save_comment_review_draft(project,repeat('a',64),0,p);raise exception 'VIEWER_ALLOWED';exception when insufficient_privilege then null;end;
 execute 'reset role';
end;
$smoke$;
rollback;
select true as cloud_review_draft_smoke_passed,true as all_synthetic_rows_rolled_back;
