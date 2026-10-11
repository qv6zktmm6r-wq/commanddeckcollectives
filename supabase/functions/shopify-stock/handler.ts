// Server side of the owner app's Stock screen (Supabase Edge Function "shopify-stock").
// It holds the Shopify app credentials so the browser never sees them, and only answers signed-in accounts listed in
// public.owners. Kept free of Deno-only APIs so tests/stock-function.mjs can run it under Node with stubbed fetch.

export const SHOPIFY_API_VERSION = '2026-07';
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const MAX_BODY_BYTES = 8000;
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const STALE_PENDING_MS = 2 * 60 * 1000;
const DEFAULT_ORIGINS = 'https://command-deck-owner.vercel.app';

type Env = (name: string) => string | undefined;
export interface Deps { env: Env; fetch: typeof fetch; now?: () => number }
type Json = Record<string, any>;

class HttpError extends Error {
  status: number;
  code: string;
  extra: Json;
  constructor(status: number, code: string, message: string, extra: Json = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const STOCK_QUERY = `query Stock($cursor: String) {
  productVariants(first: ${PAGE_SIZE}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title sku price inventoryQuantity requiresComponents
      inventoryItem { tracked }
      product { title status }
      productVariantComponents(first: 10) { nodes { quantity productVariant { id } } }
    }
  }
}`;

const VARIANT_QUERY = `query Variant($id: ID!) {
  shop { currencyCode }
  productVariant(id: $id) {
    id title sku price inventoryQuantity requiresComponents
    inventoryItem { tracked }
    product { title status }
    productVariantComponents(first: 10) {
      nodes { quantity productVariant { id inventoryQuantity inventoryItem { tracked } } }
    }
  }
}`;

const DRAFT_CREATE = `mutation DraftCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } }
}`;

const DRAFT_COMPLETE = `mutation DraftComplete($id: ID!, $paymentPending: Boolean) {
  draftOrderComplete(id: $id, paymentPending: $paymentPending) {
    draftOrder { order { id name } }
    userErrors { field message }
  }
}`;

const DRAFT_STATUS = `query DraftStatus($id: ID!) {
  draftOrder(id: $id) { status order { id name } }
}`;

const DRAFT_REMOVE = `mutation DraftRemove($input: DraftOrderDeleteInput!) {
  draftOrderDelete(input: $input) { deletedId userErrors { message } }
}`;

const label = (variantTitle: string | null | undefined) => (variantTitle && variantTitle !== 'Default Title' ? variantTitle : null);

// Turns Shopify variants into the Stock screen's list: single items with the boxes (multipacks) made from them, plus
// any mixed bundles. Availability follows Shopify's bundle rule: untracked components don't limit it.
export function shapeStock(nodes: Json[]) {
  const active = nodes.filter((n) => n?.product?.status === 'ACTIVE');
  const items: Json[] = [];
  const byId = new Map<string, Json>();
  for (const n of active) {
    if (n.requiresComponents) continue;
    const tracked = n.inventoryItem?.tracked !== false;
    const item = {
      id: n.id, product: n.product.title, variant: label(n.title), sku: n.sku || null, price: n.price ?? null,
      tracked, units: tracked ? (n.inventoryQuantity ?? 0) : null, boxes: [] as Json[],
    };
    items.push(item);
    byId.set(n.id, item);
  }
  const bundles: Json[] = [];
  for (const n of active) {
    if (!n.requiresComponents) continue;
    const components = (n.productVariantComponents?.nodes || []).map((c: Json) => ({ id: c.productVariant?.id, quantity: c.quantity }));
    let available: number | null = null;
    for (const c of components) {
      const part = byId.get(c.id);
      if (!part) { available = null; break; }
      if (!part.tracked || !(c.quantity > 0)) continue;
      const fits = Math.floor(Math.max(part.units, 0) / c.quantity);
      available = available === null ? fits : Math.min(available, fits);
    }
    const entry = { id: n.id, product: n.product.title, variant: label(n.title), sku: n.sku || null, price: n.price ?? null, components, available };
    const single = components.length === 1 ? byId.get(components[0].id) : null;
    if (single) single.boxes.push({ id: entry.id, product: entry.product, variant: entry.variant, sku: entry.sku, price: entry.price, perBox: components[0].quantity, available });
    else bundles.push(entry);
  }
  const byName = (a: Json, b: Json) => `${a.product} ${a.variant || ''}`.localeCompare(`${b.product} ${b.variant || ''}`);
  for (const item of items) item.boxes.sort((a: Json, b: Json) => a.perBox - b.perBox);
  return { items: items.sort(byName), bundles: bundles.sort(byName) };
}

// Validates a "record sale" request from the browser. Returns clean values or throws a 400.
export function readSale(body: Json) {
  const bad = (message: string) => { throw new HttpError(400, 'invalid_sale', message); };
  const text = (value: unknown, max: number, name: string) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > max) bad(`${name} is too long.`);
    return (value as string).trim() || null;
  };
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) bad('Missing request id.');
  if (typeof body.variantId !== 'string' || !VARIANT_GID.test(body.variantId)) bad('Pick an item to sell.');
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10000) bad('Quantity must be a whole number from 1 to 10,000.');
  if (typeof body.paid !== 'boolean') bad('Say whether the sale is paid.');
  let unitPriceCents: number | null = null;
  if (body.unitPrice !== undefined && body.unitPrice !== null && body.unitPrice !== '') {
    const price = Number(body.unitPrice);
    if (!Number.isFinite(price) || price < 0 || price > 1000000) bad('Price must be between $0 and $1,000,000.');
    unitPriceCents = Math.round(price * 100);
  }
  const email = text(body.email, 320, 'Email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Check the email address.');
  return {
    requestId: body.requestId.toLowerCase(), variantId: body.variantId, quantity: body.quantity, paid: body.paid,
    unitPriceCents, customer: text(body.customer, 200, 'Customer'), email, note: text(body.note, 1000, 'Note'),
  };
}

export function createHandler(deps: Deps) {
  const { env } = deps;
  const now = deps.now || Date.now;
  let token: { value: string; expiresAt: number } | null = null;

  const allowedOrigins = () => (env('ALLOWED_ORIGINS') || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);

  function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && allowedOrigins().includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Max-Age'] = '600';
    }
    return headers;
  }

  // ---- Owner check (uses the caller's own sign-in, so row-level security applies) ----
  async function requireOwner(req: Request) {
    const auth = req.headers.get('authorization') || '';
    if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)) throw new HttpError(401, 'not_signed_in', 'Sign in again.');
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_ANON_KEY');
    if (!url || !key) throw new HttpError(500, 'misconfigured', 'The stock service is missing its Supabase settings.');
    const userRes = await deps.fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: auth } });
    const user = userRes.ok ? await userRes.json() : null;
    if (!user || typeof user.id !== 'string') throw new HttpError(401, 'not_signed_in', 'Sign in again.');
    const rest = (path: string, init: RequestInit = {}) => deps.fetch(`${url}/rest/v1/${path}`, {
      ...init, headers: { apikey: key, authorization: auth, 'content-type': 'application/json', ...(init.headers || {}) },
    });
    const ownerRes = await rest(`owners?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`);
    const rows = ownerRes.ok ? await ownerRes.json() : null;
    if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(403, 'not_owner', 'This account isn’t set up as an owner.');
    return { rest };
  }

  // ---- Shopify ----
  function shopifySettings() {
    const shop = (env('SHOPIFY_STORE_DOMAIN') || '').trim().toLowerCase();
    const clientId = env('SHOPIFY_CLIENT_ID');
    const clientSecret = env('SHOPIFY_CLIENT_SECRET');
    if (!shop || !clientId || !clientSecret) {
      throw new HttpError(503, 'not_connected', 'Shopify isn’t connected yet. Your stock shows here once the store connection is set up.');
    }
    if (!SHOP_DOMAIN.test(shop)) throw new HttpError(500, 'misconfigured', 'The Shopify store address setting is not a myshopify.com address.');
    return { shop, clientId, clientSecret };
  }

  async function accessToken(fresh = false) {
    if (!fresh && token && token.expiresAt > now()) return token.value;
    const { shop, clientId, clientSecret } = shopifySettings();
    const res = await deps.fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
    });
    const data = res.ok ? await res.json().catch(() => null) : null;
    if (!data || typeof data.access_token !== 'string') {
      token = null;
      throw new HttpError(502, 'shopify_auth', 'Shopify refused the store connection. Check the app’s client ID, secret and install.');
    }
    const lifetime = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
    token = { value: data.access_token, expiresAt: now() + Math.max(lifetime - 300, 60) * 1000 };
    return token.value;
  }

  async function shopify(query: string, variables: Json, retried = false): Promise<Json> {
    const { shop } = shopifySettings();
    const res = await deps.fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken(retried) },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 && !retried) return shopify(query, variables, true);
    if (res.status === 429) throw new HttpError(503, 'shopify_busy', 'Shopify is busy. Try again in a moment.');
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new HttpError(502, 'shopify_error', `Shopify returned an error (${res.status}).`);
    if (data.errors?.length) {
      if (data.errors.some((e: Json) => e?.extensions?.code === 'THROTTLED')) throw new HttpError(503, 'shopify_busy', 'Shopify is busy. Try again in a moment.');
      throw new HttpError(502, 'shopify_error', `Shopify: ${String(data.errors[0]?.message || 'request failed').slice(0, 200)}`);
    }
    return data.data;
  }

  // ---- Actions ----
  async function listStock() {
    const nodes: Json[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await shopify(STOCK_QUERY, { cursor });
      const connection = data.productVariants;
      nodes.push(...(connection?.nodes || []));
      if (!connection?.pageInfo?.hasNextPage) { cursor = null; break; }
      cursor = connection.pageInfo.endCursor;
    }
    return { ...shapeStock(nodes), truncated: cursor !== null, fetchedAt: new Date(now()).toISOString() };
  }

  async function recordSale(body: Json, rest: (path: string, init?: RequestInit) => Promise<Response>) {
    const sale = readSale(body);
    shopifySettings();
    const row = async (res: Response) => { const [r] = res.ok ? await res.json() : []; return r || null; };
    const getLog = async () => row(await rest(`stock_sales?select=*&request_id=eq.${sale.requestId}`));
    const log = async (fields: Json) => row(await rest(`stock_sales?request_id=eq.${sale.requestId}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields),
    }));
    const fail = async (error: unknown) => {
      const message = error instanceof HttpError ? error.message : 'Unexpected error talking to Shopify.';
      await log({ status: 'failed', error: message.slice(0, 500) }).catch(() => null);
      return error;
    };

    const created = await rest('stock_sales', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        request_id: sale.requestId, variant_id: sale.variantId, quantity: sale.quantity, paid: sale.paid,
        unit_price_cents: sale.unitPriceCents, customer: sale.customer, email: sale.email, note: sale.note,
      }),
    });
    if (created.status === 409) {
      const existing = await getLog();
      if (existing?.status === 'done') return { sale: existing, duplicate: true };
      if (existing?.status === 'pending' && existing.shopify_draft_id) return completeDraft(existing.shopify_draft_id, true);
      if (existing?.status === 'pending' && now() - Date.parse(existing.created_at) < STALE_PENDING_MS) {
        throw new HttpError(409, 'in_progress', 'This sale is still being recorded. Wait a moment, then tap Record sale again.', { sameRequest: true });
      }
      if (existing?.status === 'pending') await fail(new HttpError(500, 'stopped', 'Stopped before the order reached Shopify.'));
      throw new HttpError(409, 'already_failed', 'This sale wasn’t recorded. Close the form and start again.');
    }
    if (!created.ok) throw new HttpError(502, 'log_failed', 'Couldn’t start the sale record. Nothing was sold.');

    // Until the order is completed nothing has left stock, so any failure here is final for this request.
    let draftId: string | null = null;
    try {
      const data = await shopify(VARIANT_QUERY, { id: sale.variantId });
      const variant = data.productVariant;
      if (!variant || variant.product?.status !== 'ACTIVE') throw new HttpError(404, 'unknown_item', 'That item isn’t an active product in Shopify any more.');
      const components = variant.requiresComponents ? (variant.productVariantComponents?.nodes || []) : [];
      let available = Infinity;
      if (variant.requiresComponents) {
        for (const c of components) {
          if (c.productVariant?.inventoryItem?.tracked === false || !(c.quantity > 0)) continue;
          available = Math.min(available, Math.floor(Math.max(c.productVariant?.inventoryQuantity ?? 0, 0) / c.quantity));
        }
      } else if (variant.inventoryItem?.tracked !== false) {
        available = Math.max(variant.inventoryQuantity ?? 0, 0);
      }
      if (sale.quantity > available) {
        throw new HttpError(409, 'not_enough_stock', `Only ${available} available in Shopify. Update the stock count there if you have more.`, { available });
      }

      const noteLines = ['Recorded in the Command Deck owner app.', sale.customer ? `Customer: ${sale.customer}` : null, sale.note].filter(Boolean);
      const lineItem: Json = { variantId: sale.variantId, quantity: sale.quantity };
      if (sale.unitPriceCents !== null) lineItem.priceOverride = { amount: (sale.unitPriceCents / 100).toFixed(2), currencyCode: data.shop.currencyCode };
      const draft = (await shopify(DRAFT_CREATE, { input: { lineItems: [lineItem], note: noteLines.join('\n'), tags: ['owner-app', 'in-person'] } })).draftOrderCreate;
      if (draft?.userErrors?.length || !draft?.draftOrder?.id) {
        throw new HttpError(502, 'shopify_rejected', `Shopify: ${String(draft?.userErrors?.[0]?.message || 'couldn’t create the order').slice(0, 200)}`);
      }
      draftId = draft.draftOrder.id;
      const saved = await log({
        shopify_draft_id: draftId,
        title: [variant.product?.title, label(variant.title)].filter(Boolean).join(' – ').slice(0, 300),
        sku: variant.sku || null,
        units_per_item: components.length === 1 ? components[0].quantity : 1,
      });
      if (saved?.shopify_draft_id !== draftId) throw new HttpError(502, 'log_failed', 'Couldn’t save the sale record. Nothing was sold.');
    } catch (error) {
      if (draftId) await shopify(DRAFT_REMOVE, { input: { id: draftId } }).catch(() => null);
      throw await fail(error);
    }
    return completeDraft(draftId as string, false);

    // Completes the saved draft. If Shopify's answer is lost the record stays pending with its draft id, and a retry
    // with the same request id asks Shopify what happened to that draft instead of creating another order.
    async function completeDraft(id: string, retry: boolean) {
      const unknown = () => new HttpError(502, 'outcome_unknown', 'Shopify didn’t confirm the sale. Tap Record sale again to check; it won’t be recorded twice.', { sameRequest: true });
      let order: Json | null = null;
      if (retry) {
        const current = await shopify(DRAFT_STATUS, { id }).then((d) => d.draftOrder, () => { throw unknown(); });
        if (!current) throw await fail(new HttpError(409, 'already_failed', 'This sale wasn’t recorded. Close the form and start again.'));
        if (current.order?.id) order = current.order;
      }
      if (!order) {
        const result = await shopify(DRAFT_COMPLETE, { id, paymentPending: !sale.paid }).then((d) => d.draftOrderComplete, () => { throw unknown(); });
        if (result?.userErrors?.length) {
          await shopify(DRAFT_REMOVE, { input: { id } }).catch(() => null);
          throw await fail(new HttpError(502, 'shopify_rejected', `Shopify: ${String(result.userErrors[0]?.message || 'couldn’t complete the order').slice(0, 200)}`));
        }
        order = result?.draftOrder?.order || null;
        if (!order?.id) throw unknown();
      }
      const done = await log({ status: 'done', shopify_order_id: order.id, shopify_order_name: order.name }).catch(() => null);
      return { sale: done || { request_id: sale.requestId, status: 'done', shopify_order_name: order.name }, duplicate: retry };
    }
  }

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const headers = corsHeaders(origin);
    const reply = (status: number, body: Json) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !headers['Access-Control-Allow-Origin']) return reply(403, { code: 'origin_not_allowed', message: 'This site may not use the stock service.' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { code: 'method_not_allowed', message: 'Use POST.' });
    try {
      const { rest } = await requireOwner(req);
      if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request is too large.');
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request is too large.');
      let body: Json;
      try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'bad_json', 'Request was not valid JSON.'); }
      if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_json', 'Request was not valid JSON.');
      if (body.action === 'list') return reply(200, await listStock());
      if (body.action === 'record_sale') return reply(200, await recordSale(body, rest));
      throw new HttpError(400, 'unknown_action', 'Unknown action.');
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { code: error.code, message: error.message, ...error.extra });
      console.error('shopify-stock failed', error instanceof Error ? error.message : 'unknown error');
      return reply(500, { code: 'server_error', message: 'Something went wrong. Try again.' });
    }
  };
}
