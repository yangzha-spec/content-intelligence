-- Narrow the dashboard helper's API access and add covering foreign-key indexes.
-- No new server-role privileges are granted in this migration.
begin;

-- The dashboard's automatic-RLS option may create this event-trigger helper in
-- public. Event triggers do not need ordinary API users to execute their function.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

create index comments_project_content_idx on public.comments(project_id, content_post_id);
create index comments_project_batch_idx on public.comments(project_id, source_batch_id);
create index content_posts_project_account_idx
  on public.content_posts(project_id, platform, social_account_id);
create index content_posts_project_batch_idx on public.content_posts(project_id, source_batch_id);
create index import_batches_creator_idx on public.import_batches(created_by);
create index post_metrics_project_content_idx on public.post_metrics(project_id, content_post_id);
create index post_metrics_project_batch_idx on public.post_metrics(project_id, source_batch_id);

commit;
