-- Custom-order board for the owner app (preview/board.html).
-- Only accounts listed in public.owners can read or change orders. Sign-ups are disabled in Auth settings;
-- owner accounts are created in the Supabase dashboard and added here with:
--   insert into public.owners (user_id) select id from auth.users where email = '<owner email>';

create table public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.owners enable row level security;

create policy "Owners can see their own owner row"
  on public.owners for select to authenticated
  using (user_id = (select auth.uid()));

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.owners where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create table public.custom_orders (
  id uuid primary key default gen_random_uuid(),
  stage text not null default 'new'
    check (stage in ('new', 'quoting', 'design', 'approved', 'production', 'shipped', 'archived')),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 200),
  organization text check (char_length(organization) <= 200),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 50),
  project_type text check (char_length(project_type) <= 100),
  quantity integer check (quantity between 1 and 1000000),
  needed_by date,
  budget text check (char_length(budget) <= 100),
  quote_cents bigint check (quote_cents between 0 and 100000000000),
  details text check (char_length(details) <= 20000),
  notes text check (char_length(notes) <= 20000),
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);

create index custom_orders_stage_needed_by_idx on public.custom_orders (stage, needed_by);
create index custom_orders_created_by_idx on public.custom_orders (created_by);

alter table public.custom_orders enable row level security;

create policy "Owners can read orders"
  on public.custom_orders for select to authenticated
  using ((select public.is_owner()));

create policy "Owners can add orders"
  on public.custom_orders for insert to authenticated
  with check ((select public.is_owner()));

create policy "Owners can update orders"
  on public.custom_orders for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

create policy "Owners can delete orders"
  on public.custom_orders for delete to authenticated
  using ((select public.is_owner()));

revoke all on public.owners, public.custom_orders from anon;
revoke insert, update, delete, truncate, references, trigger on public.owners from authenticated;

create function public.custom_orders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger custom_orders_touch
  before insert or update on public.custom_orders
  for each row execute function public.custom_orders_touch();
