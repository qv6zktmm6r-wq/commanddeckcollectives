-- Row-level security check for the custom-order board. Runs as the database owner, switches roles, and always
-- rolls back by raising an exception whose message carries the results (PASS lines, or FAIL lines on regressions).
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  order_id uuid;
  n integer;
  out text := '';
begin
  insert into auth.users (id, email, aud, role) values
    (owner_id, 'rls-owner@example.invalid', 'authenticated', 'authenticated'),
    (other_id, 'rls-other@example.invalid', 'authenticated', 'authenticated');
  insert into public.owners (user_id) values (owner_id);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  insert into public.custom_orders (customer_name, email) values ('Seed Customer', 'seed@example.invalid')
    returning id into order_id;
  perform set_config('request.jwt.claims', '', true);

  -- Anonymous visitor
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from public.custom_orders;
    out := out || 'FAIL anon can read orders' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS anon read denied' || chr(10);
  end;
  begin
    insert into public.custom_orders (customer_name) values ('Spam');
    out := out || 'FAIL anon can insert orders' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS anon insert denied' || chr(10);
  end;
  begin
    select count(*) into n from public.owners;
    out := out || 'FAIL anon can read owners' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS anon owners denied' || chr(10);
  end;
  perform set_config('role', 'none', true);

  -- Signed-in account that is not an owner
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.custom_orders;
  out := out || case when n = 0 then 'PASS non-owner sees 0 orders' else 'FAIL non-owner sees ' || n || ' orders' end || chr(10);
  begin
    insert into public.custom_orders (customer_name) values ('Intruder');
    out := out || 'FAIL non-owner can insert' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS non-owner insert denied' || chr(10);
  end;
  update public.custom_orders set notes = 'hacked' where id = order_id;
  get diagnostics n = row_count;
  out := out || case when n = 0 then 'PASS non-owner update affects 0 rows' else 'FAIL non-owner updated rows' end || chr(10);
  delete from public.custom_orders where id = order_id;
  get diagnostics n = row_count;
  out := out || case when n = 0 then 'PASS non-owner delete affects 0 rows' else 'FAIL non-owner deleted rows' end || chr(10);
  begin
    insert into public.owners (user_id) values (other_id);
    out := out || 'FAIL non-owner can make themselves owner' || chr(10);
  exception when insufficient_privilege then out := out || 'PASS non-owner cannot self-promote' || chr(10);
  end;
  select count(*) into n from public.owners;
  out := out || case when n = 0 then 'PASS non-owner sees no owner rows' else 'FAIL non-owner sees owner rows' end || chr(10);
  perform set_config('role', 'none', true);

  -- Owner
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.custom_orders;
  out := out || case when n = 1 then 'PASS owner sees orders' else 'FAIL owner sees ' || n end || chr(10);
  select count(*) into n from public.owners where user_id = owner_id;
  out := out || case when n = 1 then 'PASS owner sees own owner row' else 'FAIL owner cannot see own owner row' end || chr(10);
  insert into public.custom_orders (customer_name, stage, created_by, created_at)
    values ('New Customer', 'new', other_id, '2000-01-01');
  select count(*) into n from public.custom_orders
    where customer_name = 'New Customer' and created_by = owner_id and created_at > now() - interval '1 minute';
  out := out || case when n = 1 then 'PASS insert stamps real creator and time' else 'FAIL insert kept spoofed creator/time' end || chr(10);
  update public.custom_orders set stage = 'quoting', created_by = other_id where id = order_id;
  get diagnostics n = row_count;
  out := out || case when n = 1 then 'PASS owner can add and update' else 'FAIL owner update' end || chr(10);
  select count(*) into n from public.custom_orders
    where id = order_id and stage = 'quoting' and created_by = owner_id and stage_changed_at >= created_at;
  out := out || case when n = 1 then 'PASS stage change stamped, created_by kept' else 'FAIL trigger' end || chr(10);
  begin
    insert into public.custom_orders (customer_name, stage) values ('Bad', 'teleported');
    out := out || 'FAIL invalid stage accepted' || chr(10);
  exception when check_violation then out := out || 'PASS invalid stage rejected' || chr(10);
  end;
  delete from public.custom_orders where id = order_id;
  get diagnostics n = row_count;
  out := out || case when n = 0 then 'PASS active order cannot be deleted' else 'FAIL active order deleted' end || chr(10);
  update public.custom_orders set stage = 'archived' where id = order_id;
  delete from public.custom_orders where id = order_id;
  get diagnostics n = row_count;
  out := out || case when n = 1 then 'PASS owner can delete archived order' else 'FAIL owner delete archived' end || chr(10);
  perform set_config('role', 'none', true);

  raise exception 'RLS RESULTS%', chr(10) || out;
end;
$$;
