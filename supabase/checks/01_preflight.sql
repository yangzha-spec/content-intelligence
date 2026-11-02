-- Read-only. Run before migrations against the intended new project.
-- A single result works in both SQL Editor and execute_sql.
select jsonb_build_object(
  'database_name', current_database(),
  'execution_role', current_user,
  'postgres_version', current_setting('server_version'),
  'tables', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
      'rls_enabled', c.relrowsecurity) order by n.nspname, c.relname), '[]'::jsonb)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')),
  'roles', (select jsonb_agg(rolname order by rolname) from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')),
  'auth_users_present', to_regclass('auth.users') is not null,
  'auth_uid_present', to_regprocedure('auth.uid()') is not null
) as preflight;
