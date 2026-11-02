-- P0 database foundation. Apply once to a new Supabase project.
-- auth.users, auth.uid(), authenticated and anon are provided by Supabase.
begin;

create schema if not exists private;
revoke all on schema private from public;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  owner_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);
create index workspaces_owner_idx on public.workspaces(owner_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  brand_name text,
  description text,
  default_timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_workspace_idx on public.projects(workspace_id);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  platform text not null check (length(btrim(platform)) > 0),
  account_key text check (account_key is null or length(btrim(account_key)) > 0),
  external_account_id text,
  account_name text,
  account_url text,
  account_type text,
  language text,
  created_at timestamptz not null default now(),
  unique (project_id, id),
  unique (project_id, platform, account_key),
  unique (project_id, platform, external_account_id),
  unique (project_id, platform, id)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  file_name text not null check (length(btrim(file_name)) > 0),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null default 'raw-imports' check (storage_bucket = 'raw-imports'),
  storage_path text not null check (length(btrim(storage_path)) > 0),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 20971520),
  mime_type text not null check (mime_type in (
    'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  source_type text not null check (source_type in ('public_dataset', 'user_upload', 'synthetic', 'api')),
  source_name text not null,
  source_url text,
  license_name text not null default 'unknown',
  license_verified boolean not null default false,
  usage_scope text,
  data_owner_or_provider text,
  contains_personal_data boolean not null default true,
  public_demo_allowed boolean not null default false,
  notes text,
  platform text,
  field_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(field_mapping) = 'object'),
  row_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(row_counts) = 'object'),
  quality_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(quality_summary) = 'object'),
  mapping_version text not null default 'standard_v1',
  processing_version text not null default 'v1',
  status text not null default 'pending' check (status in (
    'pending', 'uploaded', 'validating', 'ready', 'committing', 'success', 'failed'
  )),
  error_message text,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (project_id, id),
  unique (storage_bucket, storage_path),
  check (not public_demo_allowed or license_verified),
  check ((status = 'success') = (committed_at is not null))
);
-- A hash identifies repeat uploads but is not unique: a failed batch may be retried
-- with a different mapping. The commit service must lock the batch and use one transaction.
create index import_batches_project_hash_idx on public.import_batches(project_id, file_hash);
create index import_batches_project_created_idx on public.import_batches(project_id, created_at);

create table public.content_posts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  social_account_id uuid,
  platform text not null check (length(btrim(platform)) > 0),
  content_key text not null check (length(btrim(content_key)) > 0),
  external_content_id text,
  title text not null check (length(btrim(title)) > 0),
  content_type text not null check (length(btrim(content_type)) > 0),
  raw_content_type text,
  publish_time timestamptz not null,
  content_text text,
  topic text,
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  content_url text,
  language text,
  source_batch_id uuid not null,
  source_row_number integer not null check (source_row_number > 0),
  created_at timestamptz not null default now(),
  unique (project_id, id),
  unique (project_id, content_key),
  unique (project_id, platform, external_content_id),
  unique (source_batch_id, source_row_number),
  foreign key (project_id, platform, social_account_id)
    references public.social_accounts(project_id, platform, id),
  foreign key (project_id, source_batch_id)
    references public.import_batches(project_id, id) deferrable initially deferred
);
create index content_posts_project_publish_idx on public.content_posts(project_id, publish_time);
create index content_posts_account_idx on public.content_posts(social_account_id);
create index content_posts_batch_idx on public.content_posts(source_batch_id);

create table public.post_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  content_post_id uuid not null,
  snapshot_time timestamptz not null,
  -- P0 accepts cumulative snapshots only. Period snapshots need explicit boundaries.
  snapshot_type text not null default 'cumulative' check (snapshot_type = 'cumulative'),
  metric_profile text not null check (length(btrim(metric_profile)) > 0),
  views bigint check (views >= 0),
  impressions bigint check (impressions >= 0),
  reach bigint check (reach >= 0),
  likes bigint check (likes >= 0),
  comments_count bigint check (comments_count >= 0),
  shares bigint check (shares >= 0),
  saves bigint check (saves >= 0),
  raw_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_metrics) = 'object'),
  missing_reasons jsonb not null default '{}'::jsonb check (jsonb_typeof(missing_reasons) = 'object'),
  source_batch_id uuid not null,
  source_row_number integer not null check (source_row_number > 0),
  created_at timestamptz not null default now(),
  unique (project_id, id),
  unique (content_post_id, snapshot_time, snapshot_type, metric_profile),
  unique (source_batch_id, source_row_number),
  foreign key (project_id, content_post_id)
    references public.content_posts(project_id, id) on delete cascade,
  foreign key (project_id, source_batch_id)
    references public.import_batches(project_id, id) deferrable initially deferred
);
create index post_metrics_project_snapshot_idx on public.post_metrics(project_id, snapshot_time);
create index post_metrics_batch_idx on public.post_metrics(source_batch_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  content_post_id uuid not null,
  comment_key text check (comment_key is null or length(btrim(comment_key)) > 0),
  external_comment_id text,
  dedupe_hash text not null check (dedupe_hash ~ '^[0-9a-f]{64}$'),
  dedupe_method text not null check (dedupe_method in ('external_id', 'file_key', 'inferred')),
  dedupe_confidence text not null check (dedupe_confidence in ('high', 'medium', 'low')),
  comment_text text not null check (length(btrim(comment_text)) > 0),
  comment_time timestamptz,
  comment_likes bigint check (comment_likes >= 0),
  reply_count bigint check (reply_count >= 0),
  parent_comment_external_id text,
  language text,
  sample_type text not null default 'unknown' check (sample_type in (
    'all', 'latest', 'top', 'random', 'manual', 'unknown'
  )),
  source_batch_id uuid not null,
  source_row_number integer not null check (source_row_number > 0),
  created_at timestamptz not null default now(),
  unique (project_id, id),
  unique (content_post_id, external_comment_id),
  unique (source_batch_id, comment_key),
  unique (source_batch_id, source_row_number),
  check (dedupe_method <> 'external_id' or nullif(btrim(external_comment_id), '') is not null),
  check (dedupe_method <> 'file_key' or comment_key is not null),
  check (dedupe_method <> 'inferred' or dedupe_confidence <> 'high'),
  foreign key (project_id, content_post_id)
    references public.content_posts(project_id, id) on delete cascade,
  foreign key (project_id, source_batch_id)
    references public.import_batches(project_id, id) deferrable initially deferred
);
-- Inferred hashes are deliberately not unique: identical comments can be legitimate.
create index comments_dedupe_review_idx on public.comments(content_post_id, dedupe_hash);
create index comments_project_time_idx on public.comments(project_id, comment_time);
create index comments_batch_idx on public.comments(source_batch_id);

create function private.can_access_workspace(target uuid, write_access boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = target and (
      w.owner_id = (select auth.uid()) or exists (
        select 1 from public.workspace_members m
        where m.workspace_id = w.id and m.user_id = (select auth.uid())
          and (not write_access or m.role = 'editor')
      )
    )
  );
$$;

create function private.owns_workspace(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspaces
    where id = target and owner_id = (select auth.uid()));
$$;

create function private.can_access_project(target uuid, write_access boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects p
    where p.id = target and private.can_access_workspace(p.workspace_id, write_access));
$$;

create function private.add_workspace_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
create trigger workspace_owner_after_insert after insert on public.workspaces
for each row execute function private.add_workspace_owner();

create function private.touch_project()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger projects_before_update before update on public.projects
for each row execute function private.touch_project();

-- Enable RLS before granting access. No unauthenticated access to business data.
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;

create policy workspace_read on public.workspaces for select to authenticated
-- INSERT ... RETURNING must also pass SELECT before the new row is visible to
-- the STABLE helper's snapshot. Check the row owner directly for this case.
using (owner_id = (select auth.uid()) or private.can_access_workspace(id));
create policy workspace_create on public.workspaces for insert to authenticated
with check (owner_id = (select auth.uid()));
create policy workspace_rename on public.workspaces for update to authenticated
using (private.owns_workspace(id)) with check (private.owns_workspace(id));
create policy workspace_delete on public.workspaces for delete to authenticated
using (private.owns_workspace(id));

create policy members_read on public.workspace_members for select to authenticated
using (private.can_access_workspace(workspace_id));
create policy members_add on public.workspace_members for insert to authenticated
with check (private.owns_workspace(workspace_id) and role in ('editor', 'viewer'));
create policy members_edit on public.workspace_members for update to authenticated
using (private.owns_workspace(workspace_id) and role <> 'owner')
with check (private.owns_workspace(workspace_id) and role in ('editor', 'viewer'));
create policy members_remove on public.workspace_members for delete to authenticated
using (private.owns_workspace(workspace_id) and role <> 'owner');

create policy project_read on public.projects for select to authenticated
using (private.can_access_workspace(workspace_id));
create policy project_create on public.projects for insert to authenticated
with check (private.can_access_workspace(workspace_id, true));
create policy project_edit on public.projects for update to authenticated
using (private.can_access_workspace(workspace_id, true))
with check (private.can_access_workspace(workspace_id, true));
create policy project_delete on public.projects for delete to authenticated
using (private.owns_workspace(workspace_id));

-- Only the owner manages membership. Editors change project data; viewers read.
revoke all on public.workspaces, public.workspace_members, public.projects from anon, authenticated;
grant select, delete on public.workspaces to authenticated;
grant insert (name, owner_id), update (name) on public.workspaces to authenticated;
grant select, delete on public.workspace_members to authenticated;
grant insert (workspace_id, user_id, role), update (role) on public.workspace_members to authenticated;
grant select, insert, update, delete on public.projects to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'social_accounts', 'import_batches', 'content_posts', 'post_metrics', 'comments'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('create policy project_data_read on public.%I for select to authenticated
      using (private.can_access_project(project_id))', table_name);
    execute format('create policy project_data_create on public.%I for insert to authenticated
      with check (private.can_access_project(project_id, true))', table_name);
    execute format('create policy project_data_edit on public.%I for update to authenticated
      using (private.can_access_project(project_id, true))
      with check (private.can_access_project(project_id, true))', table_name);
    execute format('create policy project_data_delete on public.%I for delete to authenticated
      using (private.can_access_project(project_id, true))', table_name);
  end loop;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_access_workspace(uuid, boolean) to authenticated;
grant execute on function private.owns_workspace(uuid) to authenticated;
grant execute on function private.can_access_project(uuid, boolean) to authenticated;

comment on column public.post_metrics.views is 'NULL means unavailable, not zero; metric_profile identifies the platform definition.';
comment on column public.content_posts.content_key is 'Stable, project-wide import key. Duplicate keys across platforms are rejected in P0.';
comment on column public.comments.dedupe_hash is 'Review fingerprint only; inferred equality must not automatically delete comments.';

commit;
