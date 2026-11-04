-- Per-account review drafts. All business access uses the caller's JWT and RLS.
begin;
create table public.comment_review_drafts (
 project_id uuid not null references public.projects(id) on delete cascade,
 actor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
 packet jsonb not null,
 revision integer not null default 1 check (revision > 0),
 -- Every writer must supply the version it read, including direct Data API writes.
 base_revision integer not null default 0 check (base_revision >= 0),
 updated_at timestamptz not null default now(),
 primary key (project_id, actor_id, scope_hash)
);
create index comment_review_drafts_actor_idx on public.comment_review_drafts(actor_id);
alter table public.comment_review_drafts enable row level security;
create policy review_draft_read on public.comment_review_drafts for select to authenticated
 using (actor_id = (select auth.uid()) and private.can_access_project(project_id));
create policy review_draft_create on public.comment_review_drafts for insert to authenticated
 with check (actor_id = (select auth.uid()) and private.can_access_project(project_id,true));
create policy review_draft_update on public.comment_review_drafts for update to authenticated
 using (actor_id = (select auth.uid()) and private.can_access_project(project_id,true))
 with check (actor_id = (select auth.uid()) and private.can_access_project(project_id,true));
revoke all on public.comment_review_drafts from public,anon,authenticated;
grant select on public.comment_review_drafts to authenticated;
grant insert (project_id,scope_hash,packet), update (packet,base_revision) on public.comment_review_drafts to authenticated;

create function private.validate_review_draft() returns trigger
 language plpgsql security invoker set search_path = '' as $$
declare c jsonb; a jsonb; t jsonb; seen text[] := '{}'; cid uuid;
begin
 if tg_op = 'UPDATE' then
  if (new.project_id,new.actor_id,new.scope_hash) is distinct from (old.project_id,old.actor_id,old.scope_hash)
    or new.base_revision <> old.revision then raise exception 'REVIEW_DRAFT_CONFLICT'; end if;
  new.revision := old.revision + 1;
 else
  if new.base_revision <> 0 then raise exception 'REVIEW_DRAFT_CONFLICT'; end if;
  new.revision := 1;
 end if;
 new.updated_at := clock_timestamp();
 if jsonb_typeof(new.packet) is distinct from 'object' or octet_length(new.packet::text)>16777216
  or new.packet->>'schema' is distinct from 'ci_review_v1'
  or (new.packet - array['schema','context','savedAt','annotations']) <> '{}'::jsonb
  or jsonb_typeof(new.packet->'annotations') is distinct from 'array'
  then raise exception 'REVIEW_DRAFT_INVALID'; end if;
 c := new.packet->'context';
 if jsonb_typeof(c) is distinct from 'object' or c->>'projectId' is distinct from new.project_id::text
  or c->>'scopeHash' is distinct from new.scope_hash or c->'synthetic' is distinct from 'false'::jsonb
  or (c - array['projectId','scopeHash','sourceRevision','filters','methods','synthetic','rowCount']) <> '{}'::jsonb
  or jsonb_typeof(c->'sourceRevision') is distinct from 'string' or length(c->>'sourceRevision') not between 1 and 200
  or jsonb_typeof(c->'filters') is distinct from 'object' or octet_length((c->'filters')::text)>4096
  or jsonb_typeof(c->'methods') is distinct from 'array'
  or jsonb_typeof(c->'rowCount') is distinct from 'number' or (c->>'rowCount') !~ '^\d{1,5}$'
  then raise exception 'REVIEW_DRAFT_INVALID'; end if;
 if (c->>'rowCount')::int>10000 or jsonb_array_length(new.packet->'annotations')>(c->>'rowCount')::int
  or jsonb_array_length(c->'methods')>10 then raise exception 'REVIEW_DRAFT_INVALID'; end if;
 for t in select value from jsonb_array_elements(c->'methods') loop
  if jsonb_typeof(t) <> 'string' or length(t#>>'{}') not between 1 and 160 then raise exception 'REVIEW_DRAFT_INVALID'; end if;
 end loop;
 if jsonb_typeof(new.packet->'savedAt') is distinct from 'string'
  or (new.packet->>'savedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then raise exception 'REVIEW_DRAFT_INVALID'; end if;
 perform (new.packet->>'savedAt')::timestamptz;
 for a in select value from jsonb_array_elements(new.packet->'annotations') loop
  if jsonb_typeof(a) is distinct from 'object'
   or (a - array['commentId','label','topics','note','reviewer','reviewedAt','origin']) <> '{}'::jsonb
   or jsonb_typeof(a->'commentId') is distinct from 'string'
   or a->>'commentId' = any(seen) or a->>'label' is null
   or a->>'label' not in ('positive','negative','neutral','uncertain')
   or a->>'origin' is distinct from 'manual'
   or jsonb_typeof(a->'note') is distinct from 'string' or length(a->>'note')>240
   or jsonb_typeof(a->'reviewer') is distinct from 'string' or length(btrim(a->>'reviewer')) not between 1 and 80
   or jsonb_typeof(a->'reviewedAt') is distinct from 'string'
   or (a->>'reviewedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   then raise exception 'REVIEW_DRAFT_INVALID'; end if;
  cid := (a->>'commentId')::uuid;
  if not exists(select 1 from public.comments where id=cid and project_id=new.project_id) then raise exception 'REVIEW_DRAFT_COMMENT_SCOPE'; end if;
  seen := array_append(seen,a->>'commentId');
  perform (a->>'reviewedAt')::timestamptz;
  if a->'topics' is distinct from 'null'::jsonb then
   if jsonb_typeof(a->'topics') is distinct from 'array' then raise exception 'REVIEW_DRAFT_INVALID'; end if;
   if jsonb_array_length(a->'topics')>5 or jsonb_array_length(a->'topics') <> (select count(distinct value) from jsonb_array_elements(a->'topics')) then raise exception 'REVIEW_DRAFT_INVALID'; end if;
   for t in select value from jsonb_array_elements(a->'topics') loop
    if jsonb_typeof(t)<>'string' or (t#>>'{}') not in ('内容质量','教程需求','产品体验','价格与成本','发布与互动') then raise exception 'REVIEW_DRAFT_INVALID'; end if;
   end loop;
  end if;
 end loop;
 return new;
end; $$;
revoke all on function private.validate_review_draft() from public,anon,authenticated;
create trigger validate_review_draft before insert or update on public.comment_review_drafts
 for each row execute function private.validate_review_draft();

create function public.save_comment_review_draft(target_project uuid,target_scope text,expected_revision integer,draft_packet jsonb)
 returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.comment_review_drafts;
begin
 if (select auth.uid()) is null or not private.can_access_project(target_project,true) then raise exception 'REVIEW_DRAFT_DENIED' using errcode='42501'; end if;
 if expected_revision is null or expected_revision<0 then raise exception 'REVIEW_DRAFT_INVALID'; end if;
 -- Serialize saves for this actor/project/scope. Includes missing rows.
 perform pg_advisory_xact_lock(hashtextextended(target_project::text||':'||(select auth.uid())::text||':'||target_scope,0));
 select * into d from public.comment_review_drafts where project_id=target_project and actor_id=(select auth.uid()) and scope_hash=target_scope for update;
 if found then
  -- A lost HTTP response may be confirmed without writing a second version.
  if d.packet->'context'=draft_packet->'context' and d.packet->'annotations'=draft_packet->'annotations' and draft_packet->>'schema'='ci_review_v1'
   and (draft_packet - array['schema','context','savedAt','annotations'])='{}'::jsonb then
   return jsonb_build_object('packet',d.packet,'revision',d.revision,'updated_at',d.updated_at);
  end if;
  if d.revision<>expected_revision then raise exception 'REVIEW_DRAFT_CONFLICT'; end if;
  update public.comment_review_drafts set packet=draft_packet,base_revision=expected_revision
   where project_id=target_project and actor_id=(select auth.uid()) and scope_hash=target_scope returning * into d;
 else
  if expected_revision<>0 then raise exception 'REVIEW_DRAFT_CONFLICT'; end if;
  insert into public.comment_review_drafts(project_id,scope_hash,packet) values(target_project,target_scope,draft_packet) returning * into d;
 end if;
 return jsonb_build_object('packet',d.packet,'revision',d.revision,'updated_at',d.updated_at);
end; $$;
revoke all on function public.save_comment_review_draft(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_comment_review_draft(uuid,text,integer,jsonb) to authenticated;
-- Some hosted projects auto-grant service_role access to new objects. It is unused here.
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
 revoke all on public.comment_review_drafts from service_role;
 revoke all on function private.validate_review_draft() from service_role;
 revoke all on function public.save_comment_review_draft(uuid,text,integer,jsonb) from service_role;
end if; end $$;
commit;
