-- public.rls_auto_enable() is the SECURITY DEFINER function behind the
-- project-level `ensure_rls` event trigger (it turns on row-level security
-- for every new public table; see docs/production-database-migrations.md).
-- No migration creates it, and Supabase grants EXECUTE on public functions
-- to its API roles, so anyone could call it through /rest/v1/rpc
-- (Supabase advisor 0028/0029). The event trigger doesn't need those
-- grants: Postgres doesn't check EXECUTE when it fires a trigger.
--
-- Guarded because local and CI databases have neither the function nor
-- Supabase's roles.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
    END IF;
  END IF;
END
$$;
