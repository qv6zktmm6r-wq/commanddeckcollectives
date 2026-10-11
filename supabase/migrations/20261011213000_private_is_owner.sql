-- Move the owner check out of the API-exposed public schema so it cannot be called as /rest/v1/rpc/is_owner.
-- Policies reference the function itself, so they keep working after the move.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_owner() set schema private;
