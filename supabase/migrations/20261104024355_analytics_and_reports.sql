begin;
create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
  filters jsonb not null check(jsonb_typeof(filters)='object'), engine_version text not null,
  source_revision text not null, source_batch_ids jsonb not null check(jsonb_typeof(source_batch_ids)='array'),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  status text not null check(status in ('success','failed')), ai_status text not null default 'not_requested',
  model_version text, unique(project_id,id)
);
create index analysis_runs_project_created_idx on public.analysis_runs(project_id,created_at desc);
create index analysis_runs_creator_idx on public.analysis_runs(created_by);
create table public.analysis_results (
  id uuid primary key default gen_random_uuid(), project_id uuid not null,
  analysis_run_id uuid not null, result_key text not null, result jsonb not null check(jsonb_typeof(result)='object'),
  unique(analysis_run_id,result_key), foreign key(project_id,analysis_run_id) references public.analysis_runs(project_id,id) on delete cascade
);
create index analysis_results_project_run_idx on public.analysis_results(project_id,analysis_run_id);
create table public.comment_analyses (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, analysis_run_id uuid not null, comment_id uuid not null,
  status text not null check(status in ('success','unknown','failed')),
  sentiment text not null check(sentiment in ('positive','negative','neutral','unknown')),
  method_version text not null, evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array'),
  topics jsonb not null default '[]' check(jsonb_typeof(topics)='array'),
  unique(analysis_run_id,comment_id),
  check((status='success') = (sentiment<>'unknown')),
  foreign key(project_id,analysis_run_id) references public.analysis_runs(project_id,id) on delete cascade,
  foreign key(project_id,comment_id) references public.comments(project_id,id) on delete cascade
);
create index comment_analyses_project_run_idx on public.comment_analyses(project_id,analysis_run_id);
create index comment_analyses_project_comment_idx on public.comment_analyses(project_id,comment_id);
create table public.insights (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, analysis_run_id uuid not null,
  insight_key text not null, content jsonb not null check(jsonb_typeof(content)='object'),
  unique(analysis_run_id,insight_key), foreign key(project_id,analysis_run_id) references public.analysis_runs(project_id,id) on delete cascade
);
create index insights_project_run_idx on public.insights(project_id,analysis_run_id);
create table public.reports (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, analysis_run_id uuid not null,
  title text not null, format text not null check(format='markdown'), body text not null check(octet_length(body)<=2000000),
  created_at timestamptz not null default now(), unique(analysis_run_id,format),
  foreign key(project_id,analysis_run_id) references public.analysis_runs(project_id,id) on delete cascade
);
create index reports_project_run_idx on public.reports(project_id,analysis_run_id);
do $$ declare t text; begin
  foreach t in array array['analysis_runs','analysis_results','comment_analyses','insights','reports'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select,insert on public.%I to authenticated',t);
    execute format('create policy analysis_read on public.%I for select to authenticated using(private.can_access_project(project_id))',t);
    execute format('create policy analysis_write on public.%I for insert to authenticated with check(private.can_access_project(project_id,true))',t);
  end loop;
end $$;
alter policy analysis_write on public.analysis_runs with check(private.can_access_project(project_id,true) and created_by=(select auth.uid()));

-- One MVCC snapshot; return BIGINT as text before JSON serialization.
create function public.get_analysis_source(target_project uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb; zone text;
begin
  if auth.uid() is null or not private.can_access_project(target_project) then raise exception 'ANALYSIS_FORBIDDEN' using errcode='42501'; end if;
  select default_timezone into zone from public.projects where id=target_project;
  if (select count(*) from public.content_posts where project_id=target_project)>10000
    or (select count(*) from public.post_metrics where project_id=target_project)>50000
    or (select count(*) from public.comments where project_id=target_project)>10000
  then raise exception 'ANALYSIS_LIMIT: maximum 10000 posts, 50000 snapshots and 10000 comments per project'; end if;
  select jsonb_build_object(
    'posts',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from (select id,content_key,platform,title,content_type,topic,publish_time,source_batch_id from public.content_posts where project_id=target_project) p),'[]'::jsonb),
    'metrics',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from (select id,content_post_id,snapshot_time,snapshot_type,metric_profile,source_batch_id,views::text,impressions::text,reach::text,likes::text,comments_count::text,shares::text,saves::text from public.post_metrics where project_id=target_project) m),'[]'::jsonb),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from (select id,content_post_id,comment_text,comment_time,sample_type,source_batch_id from public.comments where project_id=target_project) c),'[]'::jsonb), 'timezone',zone) into data;
  if octet_length(data::text)>12000000 then raise exception 'ANALYSIS_LIMIT: source JSON exceeds 12 MB; use a smaller project'; end if;
  return data || jsonb_build_object('revision',md5(data::text),'captured_at',statement_timestamp());
end $$;
revoke all on function public.get_analysis_source(uuid) from public,anon,authenticated;
grant execute on function public.get_analysis_source(uuid) to authenticated;

create function public.save_analysis_bundle(target_project uuid, run_id uuid, source_data jsonb, analysis jsonb, report_body text, ai_state text default 'not_requested', model_name text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not private.can_access_project(target_project,true) then raise exception 'ANALYSIS_FORBIDDEN' using errcode='42501'; end if;
  perform 1 from public.projects where id=target_project for update;
  if exists(select 1 from public.analysis_runs where id=run_id and project_id=target_project) then return run_id; end if;
  if analysis->>'version'<>'analytics_v1.0' or jsonb_typeof(analysis->'metrics') is distinct from 'object'
    or jsonb_typeof(analysis->'comments'->'rows') is distinct from 'array' or jsonb_typeof(source_data) is distinct from 'object'
    or octet_length(source_data::text)>12000000 or octet_length(analysis::text)>12000000
    or analysis->>'sourceRevision' is distinct from source_data->>'revision'
    or ai_state not in ('not_requested','generated','not_configured','failed') then raise exception 'ANALYSIS_INVALID_BUNDLE'; end if;
  insert into public.analysis_runs(id,project_id,filters,engine_version,source_revision,source_batch_ids,source_snapshot,status,ai_status,model_version)
    values(run_id,target_project,analysis->'filters',analysis->>'version',analysis->>'sourceRevision',analysis->'sourceBatchIds',source_data,'success',ai_state,model_name);
  insert into public.analysis_results(project_id,analysis_run_id,result_key,result) values(target_project,run_id,'dashboard',analysis);
  insert into public.comment_analyses(project_id,analysis_run_id,comment_id,status,sentiment,method_version,evidence,topics)
    select target_project,run_id,(r->>'id')::uuid,r->>'status',r->>'label',r->>'method',r->'evidence',r->'topics' from jsonb_array_elements(analysis->'comments'->'rows') r;
  insert into public.insights(project_id,analysis_run_id,insight_key,content)
    select target_project,run_id,r->>'id',r from jsonb_array_elements(analysis->'insights') r;
  insert into public.reports(project_id,analysis_run_id,title,format,body) values(target_project,run_id,'内容表现与评论样本复盘','markdown',report_body);
  return run_id;
end $$;
revoke all on function public.save_analysis_bundle(uuid,uuid,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.save_analysis_bundle(uuid,uuid,jsonb,jsonb,text,text,text) to authenticated;
commit;
