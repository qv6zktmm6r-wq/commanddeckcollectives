-- Hardening after security review.
-- Orders can only be deleted once archived, so a stolen session or a mis-tap can't wipe active work in one request.
alter policy "Owners can delete orders" on public.custom_orders
  using ((select private.is_owner()) and stage = 'archived');

-- TRUNCATE ignores row level security; the API can't issue it, but keep the grant closed anyway.
revoke truncate, references, trigger on public.custom_orders from authenticated;

-- Functions added to the private schema later stay closed unless granted explicitly.
alter default privileges in schema private revoke execute on functions from public;

-- New rows always record who added them and when, whatever the client sends.
create or replace function public.custom_orders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.stage_changed_at := now();
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    if new.stage is distinct from old.stage then
      new.stage_changed_at := now();
    else
      new.stage_changed_at := old.stage_changed_at;
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
