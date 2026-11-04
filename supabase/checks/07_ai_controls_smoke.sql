-- No provider call, no files and no durable test data. All reservations roll back.
begin;
set local statement_timeout='20s';
do $smoke$
declare actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); workspace uuid; project uuid; run uuid:=gen_random_uuid(); token uuid:=gen_random_uuid(); result jsonb; next_run uuid;
begin
 insert into auth.users(id,email) values(actor,'ci-ai-'||actor||'@example.invalid'),(viewer,'ci-ai-'||viewer||'@example.invalid');
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 insert into public.workspaces(name) values('Rollback-only AI control') returning id into workspace;
 insert into public.projects(workspace_id,name) values(workspace,'Synthetic AI fixture') returning id into project;
 insert into public.workspace_members(workspace_id,user_id,role) values(workspace,viewer,'viewer');
 result:=public.reserve_ai_call(project,run,repeat('a',64),token,false);assert result->>'decision'='disabled','Disabled acquired unexpectedly';
 result:=public.reserve_ai_call(project,run,repeat('a',64),token,true);assert result->>'decision'='acquired','Reserve failed';
 assert public.reserve_ai_call(project,run,repeat('a',64),gen_random_uuid(),true)->>'decision'='in_progress','Duplicate reservation not gated';
 assert public.reserve_ai_call(project,gen_random_uuid(),repeat('a',64),gen_random_uuid(),true)->>'code'='AI_CONCURRENCY_LIMIT','Concurrency gate failed';
 begin perform public.finish_ai_call(run,gen_random_uuid(),'failed');raise exception 'WRONG_TOKEN_ALLOWED';exception when insufficient_privilege then null;end;
 result:=public.finish_ai_call(run,token,'generated','[{"id":"top-content","action":"人工复核后再验证表达。"}]'::jsonb);
 assert result->>'state'='generated','Checkpoint failed';
 assert public.reserve_ai_call(project,run,repeat('a',64),gen_random_uuid(),false)->>'decision'='cached','Disabled cache restore failed';
 assert (public.get_ai_call_status()->>'used_today')::integer=1,'Duplicate consumed quota';
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 begin perform public.reserve_ai_call(project,gen_random_uuid(),repeat('a',64),gen_random_uuid(),true);raise exception 'VIEWER_ALLOWED';exception when insufficient_privilege then null;end;
 begin perform 1 from private.ai_call_requests;raise exception 'PRIVATE_LEDGER_EXPOSED';exception when insufficient_privilege then null;end;
 assert (public.get_ai_call_status()->>'used_today')::integer=0,'Usage exposed another actor';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 for i in 1..4 loop next_run:=gen_random_uuid();token:=gen_random_uuid();perform public.reserve_ai_call(project,next_run,repeat('a',64),token,true);perform public.finish_ai_call(next_run,token,'failed');end loop;
 assert public.reserve_ai_call(project,gen_random_uuid(),repeat('a',64),gen_random_uuid(),true)->>'code'='AI_USER_DAILY_LIMIT','Daily cap failed';
 assert (public.get_ai_call_status()->>'remaining_today')::integer=0,'Failures incorrectly refunded';
 execute 'reset role';
end;
$smoke$;
rollback;
select true as cloud_ai_control_smoke_passed,true as no_provider_calls,true as all_synthetic_rows_rolled_back;
