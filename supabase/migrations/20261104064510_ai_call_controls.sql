-- Global request accounting must include other workspaces without exposing their
-- rows. Private SECURITY DEFINER gates are intentionally limited to this ledger;
-- every entry point checks auth.uid() and project editing rights. No service role.
begin;
create table private.ai_call_policy (
 id integer primary key check(id=1),
 user_daily_limit integer not null check(user_daily_limit between 0 and 1000),
 global_daily_limit integer not null check(global_daily_limit between 0 and 10000),
 concurrency_limit integer not null check(concurrency_limit between 1 and 10),
 lease_seconds integer not null check(lease_seconds between 90 and 600)
);
insert into private.ai_call_policy values(1,5,20,1,120);
create table private.ai_call_requests (
 run_id uuid primary key, project_id uuid not null, actor_id uuid not null,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 lease_token uuid not null, started_at timestamptz not null default clock_timestamp(),
 lease_expires_at timestamptz not null, completed_at timestamptz,
 state text not null check(state in ('running','generated','failed','uncertain')),
 actions jsonb not null default '[]'::jsonb check(jsonb_typeof(actions)='array' and jsonb_array_length(actions)<=3 and octet_length(actions::text)<=5000),
 failure_code text, provider_request_id text check(length(provider_request_id)<=512),
 check((state='running')=(completed_at is null))
);
-- No project FK cascade: deleting/recreating projects must not reset daily quota.
create index ai_call_requests_started_idx on private.ai_call_requests(started_at);
create index ai_call_requests_actor_started_idx on private.ai_call_requests(actor_id,started_at);
create index ai_call_requests_active_idx on private.ai_call_requests(lease_expires_at) where state='running';
alter table private.ai_call_policy enable row level security;
alter table private.ai_call_requests enable row level security;
revoke all on private.ai_call_policy,private.ai_call_requests from public,anon,authenticated;

create function private.ai_call_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare policy private.ai_call_policy%rowtype; start_day timestamptz; used integer;
begin
 if auth.uid() is null then raise exception 'AI_FORBIDDEN' using errcode='42501';end if;
 select * into strict policy from private.ai_call_policy where id=1;
 start_day:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select count(*)::integer into used from private.ai_call_requests where actor_id=auth.uid() and started_at>=start_day;
 return jsonb_build_object('user_daily_limit',policy.user_daily_limit,'global_daily_limit',policy.global_daily_limit,'concurrency_limit',policy.concurrency_limit,'used_today',used,'remaining_today',greatest(0,policy.user_daily_limit-used),'resets_at',start_day+interval '1 day','day_timezone','UTC');
end;
$$;

create function private.reserve_ai_call(target_project uuid,target_run uuid,input_hash text,token uuid,allow_acquire boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare policy private.ai_call_policy%rowtype; previous private.ai_call_requests%rowtype; start_day timestamptz; checked_at timestamptz; used integer; global_used integer; active integer; retry_after integer;
begin
 if auth.uid() is null or not private.can_access_project(target_project,true) then raise exception 'AI_FORBIDDEN' using errcode='42501';end if;
 if target_run is null or token is null or input_hash is null or input_hash !~ '^[0-9a-f]{64}$' then raise exception 'AI_INVALID_REQUEST';end if;
 perform pg_advisory_xact_lock(108014,1);
 checked_at:=clock_timestamp();
 select * into previous from private.ai_call_requests where run_id=target_run;
 if found then
  if previous.project_id<>target_project or previous.actor_id<>auth.uid() or previous.request_hash<>input_hash then raise exception 'AI_REQUEST_CHANGED';end if;
  if previous.state='running' and previous.lease_expires_at<=checked_at then
   update private.ai_call_requests set state='uncertain',completed_at=checked_at,failure_code='lease_expired' where run_id=target_run returning * into previous;
  end if;
  if previous.state='running' then return jsonb_build_object('decision','in_progress','retry_after',greatest(1,ceil(extract(epoch from previous.lease_expires_at-checked_at))::integer));end if;
  return jsonb_build_object('decision','cached','state',previous.state,'actions',previous.actions,'failure_code',previous.failure_code);
 end if;
 if allow_acquire is not true then return jsonb_build_object('decision','disabled');end if;
 select * into strict policy from private.ai_call_policy where id=1;
 start_day:=date_trunc('day',checked_at at time zone 'UTC') at time zone 'UTC';
 retry_after:=greatest(1,ceil(extract(epoch from start_day+interval '1 day'-checked_at))::integer);
 select count(*)::integer into used from private.ai_call_requests where actor_id=auth.uid() and started_at>=start_day;
 if used>=policy.user_daily_limit then return jsonb_build_object('decision','limited','code','AI_USER_DAILY_LIMIT','retry_after',retry_after);end if;
 select count(*)::integer into global_used from private.ai_call_requests where started_at>=start_day;
 if global_used>=policy.global_daily_limit then return jsonb_build_object('decision','limited','code','AI_GLOBAL_DAILY_LIMIT','retry_after',retry_after);end if;
 select count(*)::integer into active from private.ai_call_requests where state='running' and lease_expires_at>checked_at;
 if active>=policy.concurrency_limit then return jsonb_build_object('decision','limited','code','AI_CONCURRENCY_LIMIT','retry_after',5);end if;
 insert into private.ai_call_requests(run_id,project_id,actor_id,request_hash,lease_token,started_at,lease_expires_at,state)
 values(target_run,target_project,auth.uid(),input_hash,token,checked_at,checked_at+make_interval(secs=>policy.lease_seconds),'running');
 return jsonb_build_object('decision','acquired','lease_seconds',policy.lease_seconds);
end;
$$;

create function private.finish_ai_call(target_run uuid,token uuid,final_state text,outcome jsonb,failure text,provider_id text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare previous private.ai_call_requests%rowtype; checked_at timestamptz;
begin
 if auth.uid() is null then raise exception 'AI_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(108014,1);
 select * into previous from private.ai_call_requests where run_id=target_run;
 if not found or previous.actor_id<>auth.uid() or previous.lease_token is distinct from token or not private.can_access_project(previous.project_id,true)
 then raise exception 'AI_FORBIDDEN' using errcode='42501';end if;
 if previous.state<>'running' then return jsonb_build_object('state',previous.state,'actions',previous.actions);end if;
 if final_state not in ('generated','failed','uncertain') or final_state is null then raise exception 'AI_INVALID_STATE';end if;
 if final_state='generated' and (
   jsonb_typeof(outcome) is distinct from 'array' or jsonb_array_length(outcome) not between 1 and 3
   or octet_length(outcome::text)>5000
 ) then raise exception 'AI_INVALID_ACTIONS';end if;
 if final_state='generated' then
  if exists(select 1 from jsonb_array_elements(outcome) a where jsonb_typeof(a) is distinct from 'object'
    or a->>'id' not in ('top-content','comment-topic','missing-data') or a->>'id' is null
    or jsonb_typeof(a->'action') is distinct from 'string' or length(btrim(a->>'action')) not between 1 and 240 or a->>'action' ~ '[0-9]')
    or (select count(*)<>count(distinct a->>'id') from jsonb_array_elements(outcome) a)
  then raise exception 'AI_INVALID_ACTIONS';end if;
 end if;
 checked_at:=clock_timestamp();
 if previous.lease_expires_at<=checked_at then final_state:='uncertain';failure:='lease_expired';end if;
 update private.ai_call_requests set state=final_state,completed_at=checked_at,
  actions=case when final_state='generated' then outcome else '[]'::jsonb end,
  failure_code=case when final_state='generated' then null else case when failure in ('provider_http','invalid_output','incomplete','timeout_network','lease_expired') then failure else 'unknown' end end,
  provider_request_id=left(provider_id,512) where run_id=target_run returning * into previous;
 return jsonb_build_object('state',previous.state,'actions',previous.actions);
end;
$$;
revoke all on function private.ai_call_status(),private.reserve_ai_call(uuid,uuid,text,uuid,boolean),private.finish_ai_call(uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.ai_call_status(),private.reserve_ai_call(uuid,uuid,text,uuid,boolean),private.finish_ai_call(uuid,uuid,text,jsonb,text,text) to authenticated;

create function public.get_ai_call_status() returns jsonb language sql stable security invoker set search_path='' as $$select private.ai_call_status();$$;
create function public.reserve_ai_call(target_project uuid,target_run uuid,input_hash text,token uuid,allow_acquire boolean default false)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.reserve_ai_call(target_project,target_run,input_hash,token,allow_acquire);$$;
create function public.finish_ai_call(target_run uuid,token uuid,final_state text,outcome jsonb default '[]'::jsonb,failure text default null,provider_id text default null)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.finish_ai_call(target_run,token,final_state,outcome,failure,provider_id);$$;
revoke all on function public.get_ai_call_status(),public.reserve_ai_call(uuid,uuid,text,uuid,boolean),public.finish_ai_call(uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.get_ai_call_status(),public.reserve_ai_call(uuid,uuid,text,uuid,boolean),public.finish_ai_call(uuid,uuid,text,jsonb,text,text) to authenticated;
-- Also remove any platform default privileges on these new objects only.
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  execute 'revoke all on private.ai_call_policy,private.ai_call_requests from service_role';
  execute 'revoke all on function private.ai_call_status(),private.reserve_ai_call(uuid,uuid,text,uuid,boolean),private.finish_ai_call(uuid,uuid,text,jsonb,text,text) from service_role';
  execute 'revoke all on function public.get_ai_call_status(),public.reserve_ai_call(uuid,uuid,text,uuid,boolean),public.finish_ai_call(uuid,uuid,text,jsonb,text,text) from service_role';
 end if;
end $$;
commit;
