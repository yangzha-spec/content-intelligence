-- Read-only. Expect eight existing tables with RLS and authenticated read access,
-- and no anonymous SELECT privilege. Does not replace authenticated-user tests.
with expected(table_name) as (
  values ('workspaces'), ('workspace_members'), ('projects'), ('social_accounts'),
         ('import_batches'), ('content_posts'), ('post_metrics'), ('comments')
), table_state as (
  select e.table_name, c.oid is not null as table_exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    case when c.oid is not null then has_table_privilege('authenticated', c.oid, 'SELECT')
      else false end as authenticated_can_select,
    case when c.oid is not null then has_table_privilege('anon', c.oid, 'SELECT')
      else false end as anonymous_can_select
  from expected e left join pg_catalog.pg_class c on c.relname = e.table_name
    and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
)
select jsonb_build_object(
  'tables', (select jsonb_agg(to_jsonb(t) order by t.table_name) from table_state t),
  'policies', (select jsonb_agg(jsonb_build_object('table', p.tablename,
      'policy', p.policyname, 'roles', p.roles, 'operation', p.cmd)
      order by p.tablename, p.policyname)
    from pg_catalog.pg_policies p where p.schemaname = 'public'
      and p.tablename in (select table_name from expected)),
  'foreign_keys', (select jsonb_agg(jsonb_build_object('table', conrelid::regclass::text,
      'name', conname, 'definition', pg_get_constraintdef(oid)) order by conname)
    from pg_catalog.pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace)
) as schema_verification;
