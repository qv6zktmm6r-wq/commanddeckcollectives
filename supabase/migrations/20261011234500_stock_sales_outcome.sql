-- Lets the shopify-stock function finish a sale whose Shopify reply was lost: the draft order id is saved before the
-- order is completed, so a retry with the same request id checks that draft instead of creating a second order.
-- Also locks a sale record completely once it is done or failed.

alter table public.stock_sales
  add column shopify_draft_id text check (shopify_draft_id ~ '^gid://shopify/DraftOrder/[0-9]+$');

alter table public.stock_sales
  add constraint stock_sales_done_has_order check (status <> 'done' or shopify_order_id is not null);

create or replace function public.stock_sales_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    new.created_at := now();
    new.created_by := auth.uid();
    new.status := 'pending';
    new.shopify_draft_id := null;
    new.shopify_order_id := null;
    new.shopify_order_name := null;
    new.error := null;
    return new;
  end if;
  -- A finished sale (done or failed) is a permanent record.
  if old.status <> 'pending' then
    return old;
  end if;
  new.updated_at := now();
  new.id := old.id;
  new.request_id := old.request_id;
  new.variant_id := old.variant_id;
  new.quantity := old.quantity;
  new.paid := old.paid;
  new.unit_price_cents := old.unit_price_cents;
  new.customer := old.customer;
  new.email := old.email;
  new.note := old.note;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  if old.shopify_draft_id is not null then
    new.shopify_draft_id := old.shopify_draft_id;
  end if;
  return new;
end;
$$;
