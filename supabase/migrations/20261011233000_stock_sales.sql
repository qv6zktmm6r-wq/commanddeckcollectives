-- Log of in-person and invoiced sales recorded from the owner app's Stock screen.
-- The shopify-stock Edge Function writes these rows with the owner's own sign-in before and after it creates the
-- Shopify order, so a double tap (same request_id) can never record the same sale twice.

create table public.stock_sales (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  variant_id text not null check (variant_id ~ '^gid://shopify/ProductVariant/[0-9]+$'),
  title text check (char_length(title) <= 300),
  sku text check (char_length(sku) <= 100),
  quantity integer not null check (quantity between 1 and 10000),
  units_per_item integer not null default 1 check (units_per_item between 1 and 10000),
  paid boolean not null,
  unit_price_cents bigint check (unit_price_cents between 0 and 100000000),
  customer text check (char_length(customer) <= 200),
  email text check (char_length(email) <= 320),
  note text check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  shopify_order_id text check (char_length(shopify_order_id) <= 100),
  shopify_order_name text check (char_length(shopify_order_name) <= 50),
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);

create index stock_sales_created_at_idx on public.stock_sales (created_at desc);
create index stock_sales_created_by_idx on public.stock_sales (created_by);

alter table public.stock_sales enable row level security;

create policy "Owners can read stock sales"
  on public.stock_sales for select to authenticated
  using ((select private.is_owner()));

create policy "Owners can record stock sales"
  on public.stock_sales for insert to authenticated
  with check ((select private.is_owner()));

create policy "Owners can update stock sale status"
  on public.stock_sales for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

-- A sales log is kept, never deleted from the app.
revoke all on public.stock_sales from anon;
revoke delete, truncate, references, trigger on public.stock_sales from authenticated;

create function public.stock_sales_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.status := 'pending';
    new.shopify_order_id := null;
    new.shopify_order_name := null;
    new.error := null;
  else
    -- What was sold can't be rewritten after the fact; only the outcome fields change.
    new.request_id := old.request_id;
    new.variant_id := old.variant_id;
    new.quantity := old.quantity;
    new.paid := old.paid;
    new.unit_price_cents := old.unit_price_cents;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if old.status <> 'pending' then
      new.status := old.status;
      new.shopify_order_id := old.shopify_order_id;
      new.shopify_order_name := old.shopify_order_name;
    end if;
  end if;
  return new;
end;
$$;

create trigger stock_sales_touch
  before insert or update on public.stock_sales
  for each row execute function public.stock_sales_touch();
