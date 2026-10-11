-- Row-level security check for the stock sales log. Runs as the database owner, switches roles, and always rolls
-- back by raising an exception whose message carries the results (PASS lines, or FAIL lines on regressions).
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  req uuid := gen_random_uuid();
  n integer;
  r record;
  out text := '';
begin
  insert into auth.users (id, email, aud, role) values
    (owner_id, 'rls-owner@example.invalid', 'authenticated', 'authenticated'),
    (other_id, 'rls-other@example.invalid', 'authenticated', 'authenticated');
  insert into public.owners (user_id) values (owner_id);

  -- Anonymous visitor
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from public.stock_sales;
    out := out || 'FAIL anon can read sales' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS anon read denied' || chr(10);
  end;
  begin
    insert into public.stock_sales (request_id, variant_id, quantity, paid) values (gen_random_uuid(), 'gid://shopify/ProductVariant/1', 1, true);
    out := out || 'FAIL anon can insert sales' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS anon insert denied' || chr(10);
  end;
  perform set_config('role', 'none', true);

  -- Owner records a sale
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.stock_sales (request_id, variant_id, quantity, paid, status, shopify_order_name, created_by)
    values (req, 'gid://shopify/ProductVariant/42', 2, false, 'done', '#FAKE', other_id);
  select * into r from public.stock_sales where request_id = req;
  out := out || case when r.status = 'pending' and r.shopify_order_name is null and r.created_by = owner_id
    then 'PASS insert forced to pending, real creator' else 'FAIL insert kept client status/creator' end || chr(10);
  begin
    insert into public.stock_sales (request_id, variant_id, quantity, paid) values (req, 'gid://shopify/ProductVariant/42', 2, false);
    out := out || 'FAIL duplicate request accepted' || chr(10);
  exception when unique_violation then out := out || 'PASS duplicate request rejected' || chr(10);
  end;
  begin
    insert into public.stock_sales (request_id, variant_id, quantity, paid) values (gen_random_uuid(), 'javascript:alert(1)', 1, true);
    out := out || 'FAIL bad variant id accepted' || chr(10);
  exception when check_violation then out := out || 'PASS bad variant id rejected' || chr(10);
  end;
  begin
    update public.stock_sales set status = 'done' where request_id = req;
    out := out || 'FAIL done without a Shopify order accepted' || chr(10);
  exception when check_violation then out := out || 'PASS done requires a Shopify order' || chr(10);
  end;
  update public.stock_sales set shopify_draft_id = 'gid://shopify/DraftOrder/5' where request_id = req;
  update public.stock_sales set shopify_draft_id = 'gid://shopify/DraftOrder/6', customer = 'Changed' where request_id = req;
  select * into r from public.stock_sales where request_id = req;
  out := out || case when r.shopify_draft_id = 'gid://shopify/DraftOrder/5' and r.customer is null
    then 'PASS draft id and sale details locked once set' else 'FAIL draft id or details changed' end || chr(10);
  update public.stock_sales set status = 'done', shopify_order_id = 'gid://shopify/Order/1', shopify_order_name = '#1001', quantity = 99 where request_id = req;
  select * into r from public.stock_sales where request_id = req;
  out := out || case when r.status = 'done' and r.shopify_order_name = '#1001' and r.quantity = 2
    then 'PASS outcome recorded, quantity locked' else 'FAIL update' end || chr(10);
  update public.stock_sales set status = 'failed', shopify_order_name = '#9999', title = 'Edited' where request_id = req;
  select * into r from public.stock_sales where request_id = req;
  out := out || case when r.status = 'done' and r.shopify_order_name = '#1001' and r.title is null
    then 'PASS finished sale cannot be rewritten' else 'FAIL finished sale changed' end || chr(10);
  begin
    delete from public.stock_sales where request_id = req;
    out := out || 'FAIL owner can delete sales log' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS sales log cannot be deleted' || chr(10);
  end;
  perform set_config('role', 'none', true);

  -- Signed-in account that is not an owner
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.stock_sales;
  out := out || case when n = 0 then 'PASS non-owner sees 0 sales' else 'FAIL non-owner sees ' || n || ' sales' end || chr(10);
  begin
    insert into public.stock_sales (request_id, variant_id, quantity, paid) values (gen_random_uuid(), 'gid://shopify/ProductVariant/1', 1, true);
    out := out || 'FAIL non-owner can insert' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS non-owner insert denied' || chr(10);
  end;
  update public.stock_sales set note = 'hacked' where request_id = req;
  get diagnostics n = row_count;
  out := out || case when n = 0 then 'PASS non-owner update affects 0 rows' else 'FAIL non-owner updated rows' end || chr(10);
  perform set_config('role', 'none', true);

  raise exception 'RLS RESULTS%', chr(10) || out;
end;
$$;
