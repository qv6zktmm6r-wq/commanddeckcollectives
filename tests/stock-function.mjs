// Tests the shopify-stock Edge Function handler under Node with stubbed Supabase and Shopify responses.
import assert from 'node:assert/strict';
import { createHandler, shapeStock, readSale } from '../supabase/functions/shopify-stock/handler.ts';

const ORIGIN = 'https://command-deck-owner.vercel.app';
const JWT = 'Bearer aaa.bbb.ccc';
const SHOP = 'fs8r63-zc.myshopify.com';
const v = (n) => `gid://shopify/ProductVariant/${n}`;

const COIN = { id: v(1), title: 'Default Title', sku: 'CDC-COIN-AAV', price: '15.00', inventoryQuantity: 60, requiresComponents: false, inventoryItem: { tracked: true }, product: { title: 'AAV Legacy Coin', status: 'ACTIVE' }, productVariantComponents: { nodes: [] } };
const BOX = { id: v(2), title: 'Default Title', sku: 'CDC-COIN-AAV-BX25', price: '300.00', inventoryQuantity: 0, requiresComponents: true, inventoryItem: { tracked: true }, product: { title: 'AAV Legacy Coin – Box of 25', status: 'ACTIVE' }, productVariantComponents: { nodes: [{ quantity: 25, productVariant: { id: v(1) } }] } };
const SHIRT = { id: v(3), title: 'Large', sku: 'CDC-TEE-L', price: '28.00', inventoryQuantity: 4, requiresComponents: false, inventoryItem: { tracked: true }, product: { title: 'Crest Tee', status: 'ACTIVE' }, productVariantComponents: { nodes: [] } };
const STICKER = { id: v(4), title: 'Default Title', sku: null, price: '3.00', inventoryQuantity: null, requiresComponents: false, inventoryItem: { tracked: false }, product: { title: 'Sticker', status: 'ACTIVE' }, productVariantComponents: { nodes: [] } };
const DRAFT = { id: v(5), title: 'Default Title', sku: 'OLD', price: '1.00', inventoryQuantity: 5, requiresComponents: false, inventoryItem: { tracked: true }, product: { title: 'Old', status: 'DRAFT' }, productVariantComponents: { nodes: [] } };
const KIT = { id: v(6), title: 'Default Title', sku: 'KIT', price: '40.00', inventoryQuantity: 0, requiresComponents: true, inventoryItem: { tracked: true }, product: { title: 'Starter kit', status: 'ACTIVE' }, productVariantComponents: { nodes: [{ quantity: 1, productVariant: { id: v(1) } }, { quantity: 2, productVariant: { id: v(3) } }] } };
const VARIANTS = [COIN, BOX, SHIRT, STICKER, DRAFT, KIT];

const withComponentStock = (variant) => ({
  ...variant,
  productVariantComponents: { nodes: variant.productVariantComponents.nodes.map((c) => {
    const part = VARIANTS.find((x) => x.id === c.productVariant.id);
    return { quantity: c.quantity, productVariant: { id: part.id, inventoryQuantity: part.inventoryQuantity, inventoryItem: part.inventoryItem } };
  }) },
});

function world({ owner = true, connected = true, completeFails = false, tokenStatus = 200, loseCompleteReply = false, nowMs = Date.parse('2026-10-11T12:00:00Z') } = {}) {
  const calls = [];
  const sales = new Map();
  const drafts = new Map();
  const flags = { loseCompleteReply };
  const env = {
    SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon',
    ...(connected ? { SHOPIFY_STORE_DOMAIN: SHOP, SHOPIFY_CLIENT_ID: 'client-id', SHOPIFY_CLIENT_SECRET: 'client-secret' } : {}),
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const body = init.body ? (typeof init.body === 'string' ? init.body : String(init.body)) : '';
    calls.push({ url: u, method: init.method || 'GET', headers, body });
    if (u.host === 'proj.supabase.co') {
      assert.equal(headers.get('authorization'), JWT, 'Supabase calls carry the caller sign-in');
      if (u.pathname === '/auth/v1/user') return json(200, { id: 'user-1' });
      if (u.pathname === '/rest/v1/owners') return json(200, owner ? [{ user_id: 'user-1' }] : []);
      if (u.pathname === '/rest/v1/stock_sales') {
        const reqId = (u.searchParams.get('request_id') || '').replace('eq.', '');
        if (init.method === 'POST') {
          const row = JSON.parse(body);
          if (sales.has(row.request_id)) return json(409, { code: '23505' });
          sales.set(row.request_id, { ...row, status: 'pending', created_at: new Date(nowMs).toISOString() });
          return json(201, [sales.get(row.request_id)]);
        }
        if (init.method === 'PATCH') { Object.assign(sales.get(reqId), JSON.parse(body)); return json(200, [sales.get(reqId)]); }
        return json(200, sales.has(reqId) ? [sales.get(reqId)] : []);
      }
    }
    if (u.host === SHOP && u.pathname === '/admin/oauth/access_token') {
      const form = new URLSearchParams(body);
      assert.equal(form.get('grant_type'), 'client_credentials');
      return tokenStatus === 200 ? json(200, { access_token: 'shpat_test', expires_in: 86399 }) : json(tokenStatus, { error: 'invalid_client' });
    }
    if (u.host === SHOP && u.pathname === '/admin/api/2026-07/graphql.json') {
      assert.equal(headers.get('x-shopify-access-token'), 'shpat_test');
      const { query, variables } = JSON.parse(body);
      if (query.includes('productVariants(')) {
        const start = variables.cursor ? Number(variables.cursor) : 0;
        const page = VARIANTS.slice(start, start + 4);
        return json(200, { data: { productVariants: { nodes: page, pageInfo: { hasNextPage: start + 4 < VARIANTS.length, endCursor: String(start + 4) } } } });
      }
      if (query.includes('productVariant(id')) {
        const found = VARIANTS.find((x) => x.id === variables.id);
        return json(200, { data: { shop: { currencyCode: 'USD' }, productVariant: found ? withComponentStock(found) : null } });
      }
      if (query.includes('draftOrderCreate')) {
        const id = `gid://shopify/DraftOrder/${drafts.size + 9}`;
        drafts.set(id, { status: 'OPEN', order: null });
        return json(200, { data: { draftOrderCreate: { draftOrder: { id }, userErrors: [] } } });
      }
      if (query.includes('draftOrderComplete')) {
        if (completeFails) return json(200, { data: { draftOrderComplete: { draftOrder: null, userErrors: [{ field: null, message: 'Payment terms required' }] } } });
        const draft = drafts.get(variables.id);
        draft.status = 'COMPLETED';
        draft.order = { id: 'gid://shopify/Order/77', name: '#1077' };
        if (flags.loseCompleteReply) { flags.loseCompleteReply = false; throw new TypeError('connection reset'); }
        return json(200, { data: { draftOrderComplete: { draftOrder: { order: draft.order }, userErrors: [] } } });
      }
      if (query.includes('draftOrder(id')) {
        const draft = drafts.get(variables.id);
        return json(200, { data: { draftOrder: draft ? { status: draft.status, order: draft.order } : null } });
      }
      if (query.includes('draftOrderDelete')) return json(200, { data: { draftOrderDelete: { deletedId: variables.input.id, userErrors: [] } } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }
  const clock = { now: nowMs };
  const handle = createHandler({ env: (k) => env[k], fetch, now: () => clock.now });
  const call = (body, { origin = ORIGIN, auth = JWT, method = 'POST' } = {}) => handle(new Request('https://proj.supabase.co/functions/v1/shopify-stock', {
    method, headers: { ...(origin ? { origin } : {}), ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }));
  return { call, calls, sales, drafts, clock };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const uuid = () => crypto.randomUUID();
const sale = (over = {}) => ({ action: 'record_sale', requestId: uuid(), variantId: v(2), quantity: 2, paid: true, ...over });

test('shapeStock: boxes attach to their single item with full-box counts', () => {
  const { items, bundles } = shapeStock(VARIANTS);
  const coin = items.find((i) => i.sku === 'CDC-COIN-AAV');
  assert.equal(coin.units, 60);
  assert.deepEqual(coin.boxes.map((b) => [b.sku, b.perBox, b.available]), [['CDC-COIN-AAV-BX25', 25, 2]]);
  assert.equal(items.find((i) => i.product === 'Sticker').units, null, 'untracked shows no count');
  assert.ok(!items.some((i) => i.product === 'Old'), 'draft products hidden');
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].available, 2, 'kit limited by 4 shirts / 2 per kit');
});

test('readSale: rejects bad input', () => {
  assert.throws(() => readSale({ requestId: 'x', variantId: v(1), quantity: 1, paid: true }), /request id/);
  assert.throws(() => readSale({ requestId: uuid(), variantId: 'javascript:alert(1)', quantity: 1, paid: true }), /Pick an item/);
  assert.throws(() => readSale({ requestId: uuid(), variantId: v(1), quantity: 0, paid: true }), /Quantity/);
  assert.throws(() => readSale({ requestId: uuid(), variantId: v(1), quantity: 1.5, paid: true }), /Quantity/);
  assert.throws(() => readSale({ requestId: uuid(), variantId: v(1), quantity: 1, paid: 'yes' }), /paid/);
  assert.throws(() => readSale({ requestId: uuid(), variantId: v(1), quantity: 1, paid: true, unitPrice: -1 }), /Price/);
  assert.throws(() => readSale({ requestId: uuid(), variantId: v(1), quantity: 1, paid: true, email: 'nope' }), /email/);
  assert.equal(readSale({ requestId: uuid(), variantId: v(1), quantity: 3, paid: false, unitPrice: '12.5' }).unitPriceCents, 1250);
});

test('rejects other websites, missing sign-in and non-owners before touching Shopify', async () => {
  const w = world();
  assert.equal((await w.call({ action: 'list' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await w.call({ action: 'list' }, { auth: null })).status, 401);
  const nonOwner = world({ owner: false });
  const res = await nonOwner.call({ action: 'list' });
  assert.equal(res.status, 403);
  assert.ok(!nonOwner.calls.some((c) => c.url.host === SHOP), 'no Shopify call for non-owner');
});

test('CORS preflight allowed for the owner app only', async () => {
  const w = world();
  const ok = await w.call(null, { method: 'OPTIONS', auth: null });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
});

test('not connected: owner gets a clear 503, no secrets needed', async () => {
  const res = await world({ connected: false }).call({ action: 'list' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'not_connected');
});

test('list: pages through Shopify and caches the access token', async () => {
  const w = world();
  const res = await w.call({ action: 'list' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.items.length, 3);
  assert.equal(data.truncated, false);
  await w.call({ action: 'list' });
  assert.equal(w.calls.filter((c) => c.url.pathname === '/admin/oauth/access_token').length, 1, 'token reused');
  assert.ok(!JSON.stringify(data).includes('shpat_test') && !JSON.stringify(data).includes('client-secret'), 'no credentials in response');
});

test('record a box sale: creates and completes a Shopify order, logs it', async () => {
  const w = world();
  const body = sale({ quantity: 2, paid: false, unitPrice: 280, customer: 'Sgt. Lopez' });
  const res = await w.call(body);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sale.status, 'done');
  assert.equal(data.sale.shopify_order_name, '#1077');
  assert.equal(data.sale.units_per_item, 25);
  const create = w.calls.find((c) => c.body.includes('draftOrderCreate'));
  const input = JSON.parse(create.body).variables.input;
  assert.deepEqual(input.lineItems, [{ variantId: v(2), quantity: 2, priceOverride: { amount: '280.00', currencyCode: 'USD' } }]);
  assert.ok(input.note.includes('Sgt. Lopez'));
  assert.ok(!('email' in input), 'customer is not emailed by Shopify');
  const complete = w.calls.find((c) => c.body.includes('draftOrderComplete'));
  assert.equal(JSON.parse(complete.body).variables.paymentPending, true);
});

test('double tap: the same request records one order', async () => {
  const w = world();
  const body = sale();
  await w.call(body);
  const again = await w.call(body);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  assert.equal(w.calls.filter((c) => c.body.includes('draftOrderCreate')).length, 1);
});

test('not enough stock: refused, nothing created, log marked failed', async () => {
  const w = world();
  const body = sale({ quantity: 3 });
  const res = await w.call(body);
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.code, 'not_enough_stock');
  assert.equal(data.available, 2);
  assert.ok(!w.calls.some((c) => c.body.includes('draftOrderCreate')));
  assert.equal(w.sales.get(body.requestId).status, 'failed');
});

test('Shopify refuses to complete: draft removed, log marked failed', async () => {
  const w = world({ completeFails: true });
  const body = sale({ variantId: v(1), quantity: 5 });
  const res = await w.call(body);
  assert.equal(res.status, 502);
  assert.match((await res.json()).message, /Payment terms required/);
  assert.ok(w.calls.some((c) => c.body.includes('draftOrderDelete')));
  assert.equal(w.sales.get(body.requestId).status, 'failed');
});

test('lost reply after Shopify placed the order: retry finds it, no second order', async () => {
  const w = world({ loseCompleteReply: true });
  const body = sale();
  const first = await w.call(body);
  assert.equal(first.status, 502);
  const data = await first.json();
  assert.equal(data.code, 'outcome_unknown');
  assert.equal(data.sameRequest, true);
  assert.equal(w.sales.get(body.requestId).status, 'pending', 'record kept pending, not failed');
  assert.ok(!w.calls.some((c) => c.body.includes('draftOrderDelete')), 'draft not deleted');
  const retry = await w.call(body);
  assert.equal(retry.status, 200);
  const done = await retry.json();
  assert.equal(done.duplicate, true);
  assert.equal(done.sale.shopify_order_name, '#1077');
  assert.equal(w.calls.filter((c) => c.body.includes('draftOrderCreate')).length, 1);
  assert.equal(w.calls.filter((c) => c.body.includes('draftOrderComplete')).length, 1, 'not completed twice');
});

test('retry while the saved draft is still open completes that same draft', async () => {
  const w = world();
  const body = sale({ variantId: v(1), quantity: 3 });
  const first = await w.call(body);
  assert.equal(first.status, 200);
  const req = w.sales.get(body.requestId);
  Object.assign(req, { status: 'pending', shopify_order_id: null });
  w.drafts.get(req.shopify_draft_id).status = 'OPEN';
  w.drafts.get(req.shopify_draft_id).order = null;
  const retry = await w.call(body);
  assert.equal(retry.status, 200);
  assert.equal(w.calls.filter((c) => c.body.includes('draftOrderCreate')).length, 1);
});

test('pending without a draft: "in progress" at first, failed once stale', async () => {
  const w = world();
  const body = sale();
  w.sales.set(body.requestId, { request_id: body.requestId, status: 'pending', created_at: new Date(w.clock.now).toISOString() });
  const busy = await w.call(body);
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).code, 'in_progress');
  w.clock.now += 3 * 60 * 1000;
  const stale = await w.call(body);
  assert.equal((await stale.json()).code, 'already_failed');
  assert.equal(w.sales.get(body.requestId).status, 'failed');
  assert.ok(!w.calls.some((c) => c.body.includes('draftOrderCreate')));
});

test('oversized request refused', async () => {
  const w = world();
  const res = await w.call({ action: 'record_sale', note: 'x'.repeat(9000) });
  assert.equal(res.status, 413);
});

test('bad Shopify credentials: clear error, no order', async () => {
  const w = world({ tokenStatus: 401 });
  const res = await w.call({ action: 'list' });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'shopify_auth');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   stock-function: ${name}`); } catch (error) { failed += 1; console.log(`FAIL stock-function: ${name}\n     ${error.message}`); }
}
if (failed) { console.log(`${failed} stock-function test(s) failed`); process.exit(1); }
