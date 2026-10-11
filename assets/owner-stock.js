// Stock & bulk sales tab of the owner board (preview/board.html). Stock comes from Shopify through the
// "shopify-stock" Supabase Edge Function, which holds the Shopify credentials; this page only ever sends the owner's
// own sign-in. Shopify text is inserted with textContent only, never as HTML.
(() => {
  const LOW_STOCK_UNITS = 10;
  const $ = (sel, root = document) => root.querySelector(sel);
  const panels = { orders: $('[data-panel="orders"]'), stock: $('[data-panel="stock"]') };
  const titles = { orders: 'Custom orders', stock: 'Stock' };
  const state = { db: null, el: null, endpoint: '', key: '', stock: null, query: '', filter: null, selling: null, requestId: null, loading: false };

  // ---- Tabs ----
  function showTab(name) {
    for (const [id, panel] of Object.entries(panels)) panel.hidden = id !== name;
    for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
    $('.board-head h1').textContent = titles[name];
    if (name === 'stock' && state.db && !state.stock && !state.loading) loadStock();
  }
  for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

  document.addEventListener('cd:owner-ready', (event) => {
    const { db, el, config } = event.detail;
    Object.assign(state, { db, el, endpoint: `${config.supabaseUrl}/functions/v1/shopify-stock`, key: config.supabaseKey, stock: null });
    showTab(location.hash === '#stock' ? 'stock' : 'orders');
  });
  document.addEventListener('cd:owner-signed-out', () => {
    Object.assign(state, { db: null, stock: null, filter: null });
    $('[data-stock-list]').replaceChildren();
    $('[data-bundle-list]').replaceChildren();
    $('[data-recent-sales]').replaceChildren();
  });

  // ---- Talking to the stock service ----
  async function callStock(body) {
    const { data } = await state.db.auth.getSession();
    if (!data.session) return { ok: false, status: 401, code: 'not_signed_in', message: 'Sign in again.' };
    let res;
    try {
      res = await fetch(state.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, apikey: state.key },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: 'unreachable', sameRequest: true, message: 'Couldn’t reach the stock service. Check your connection and try again.' };
    }
    const payload = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: res.status, data: payload };
    if (res.status === 404 && !payload.code) return { ok: false, status: 404, code: 'not_connected', message: 'The stock connection isn’t set up yet.' };
    return {
      ok: false, status: res.status, code: payload.code || 'error', message: payload.message || `Stock service error (${res.status}).`,
      sameRequest: Boolean(payload.sameRequest) || (res.status >= 500 && !payload.code),
    };
  }

  const status = (message, tone) => {
    const banner = $('[data-stock-status]');
    banner.textContent = message || '';
    banner.className = `banner${tone ? ` ${tone}` : ''}`;
    banner.hidden = !message;
  };

  async function loadStock({ keepStatus = false } = {}) {
    if (!state.db) return;
    state.loading = true;
    $('[data-stock-refresh]').disabled = true;
    if (!state.stock && !keepStatus) status('Loading stock from Shopify…');
    const [result] = await Promise.all([callStock({ action: 'list' }), loadRecentSales()]);
    state.loading = false;
    $('[data-stock-refresh]').disabled = false;
    if (!result.ok) {
      state.stock = state.stock?.items.length ? state.stock : { items: [], bundles: [], unavailable: true };
      status(result.code === 'not_connected'
        ? 'Shopify isn’t connected yet. Once the store connection is set up, your products, SKUs and box counts show here, and sales you record subtract from Shopify stock.'
        : result.message, result.code === 'not_connected' ? '' : 'error');
      render();
      return;
    }
    state.stock = result.data;
    if (!keepStatus) status(result.data.truncated ? 'Showing the first 500 product variants.' : '');
    render();
  }

  async function loadRecentSales() {
    const { data, error } = await state.db.from('stock_sales')
      .select('created_at,title,sku,quantity,units_per_item,paid,status,shopify_order_name,customer,error')
      .order('created_at', { ascending: false }).limit(15);
    const list = $('[data-recent-sales]');
    const el = state.el;
    if (error) { list.replaceChildren(el('li', { class: 'empty' }, `Couldn’t load recent sales: ${error.message}`)); return; }
    if (!data.length) { list.replaceChildren(el('li', { class: 'empty' }, 'No in-person or invoiced sales recorded yet. Website orders show in Shopify.')); return; }
    list.replaceChildren(...data.map((s) => {
      const what = `${s.quantity.toLocaleString()} × ${s.title || 'Item'}${s.units_per_item > 1 ? ` (${(s.quantity * s.units_per_item).toLocaleString()} units)` : ''}`;
      const tags = s.status === 'done'
        ? [el('span', { class: 'tag money' }, s.shopify_order_name || 'Recorded'), el('span', { class: `tag${s.paid ? ' quiet' : ' soon'}` }, s.paid ? 'Paid' : 'Not paid yet')]
        : s.status === 'failed' ? [el('span', { class: 'tag overdue' }, 'Not recorded')] : [el('span', { class: 'tag soon' }, 'In progress')];
      return el('li', { class: 'recent-sale' },
        el('span', { class: 'recent-when' }, new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        el('span', { class: 'recent-what' }, what, s.customer ? el('span', { class: 'card-org' }, ` · ${s.customer}`) : null,
          s.status === 'failed' && s.error ? el('span', { class: 'recent-error' }, s.error) : null),
        el('span', { class: 'card-tags' }, tags));
    }));
  }

  // ---- Rendering ----
  const money = (amount) => (amount === null || amount === undefined || amount === '' ? null
    : Number(amount).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: Number(amount) % 1 ? 2 : 0 }));
  const name = (x) => [x.product, x.variant].filter(Boolean).join(' – ');
  const lowLine = (item) => Math.max(LOW_STOCK_UNITS, ...item.boxes.map((b) => b.perBox));
  const level = (item) => (!item.tracked ? null : item.units <= 0 ? 'out' : item.units < lowLine(item) ? 'low' : null);

  function matches(item) {
    if (state.filter && level(item) !== state.filter) return false;
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return [name(item), item.sku, ...item.boxes.flatMap((b) => [name(b), b.sku])].some((t) => (t || '').toLowerCase().includes(q));
  }

  function render() {
    const el = state.el;
    const items = state.stock?.items || [];
    const bundles = state.stock?.bundles || [];
    const low = items.filter((i) => level(i) === 'low').length;
    const out = items.filter((i) => level(i) === 'out').length;
    const units = items.reduce((sum, i) => sum + (i.tracked ? Math.max(i.units, 0) : 0), 0);
    const stat = (value, label, filter, tone) => el('button', {
      type: 'button', class: `stat${tone ? ` ${tone}` : ''}${filter && state.filter === filter ? ' on' : ''}`,
      'aria-pressed': filter ? String(state.filter === filter) : undefined, disabled: !filter,
      onclick: filter ? () => { state.filter = state.filter === filter ? null : filter; render(); } : undefined,
    }, el('strong', {}, String(value)), el('span', {}, label));
    $('[data-stock-stats]').hidden = Boolean(state.stock?.unavailable);
    $('[data-stock-stats]').replaceChildren(
      stat(items.length, 'Products'),
      stat(units.toLocaleString(), 'Units on hand'),
      stat(low, 'Low stock', 'low', low ? 'warn' : ''),
      stat(out, 'Out of stock', 'out', out ? 'alert' : ''),
    );

    const visible = items.filter(matches);
    const list = $('[data-stock-list]');
    if (!items.length) list.replaceChildren();
    else if (!visible.length) list.replaceChildren(el('li', { class: 'empty' }, 'No matches'));
    else list.replaceChildren(...visible.map(stockItem));

    const visibleBundles = bundles.filter((b) => !state.query || [name(b), b.sku].some((t) => (t || '').toLowerCase().includes(state.query.toLowerCase())));
    $('[data-bundles-section]').hidden = !visibleBundles.length || Boolean(state.filter);
    $('[data-bundle-list]').replaceChildren(...visibleBundles.map((b) => el('li', { class: 'stock-item' },
      el('div', { class: 'stock-main' }, el('strong', {}, name(b)), b.sku ? el('span', { class: 'sku' }, `SKU ${b.sku}`) : null,
        el('span', { class: 'card-org' }, `${b.components.length} items per bundle`)),
      el('div', { class: 'stock-count' }, el('strong', {}, b.available === null ? '—' : String(b.available)), el('span', {}, 'can be made')),
      el('button', { type: 'button', class: 'btn', onclick: () => openSale({ ...b, tracked: true, units: null, boxes: [] }, b) }, 'Record sale'))));
  }

  function stockItem(item) {
    const el = state.el;
    const lvl = level(item);
    return el('li', { class: `stock-item${lvl ? ` stock-${lvl}` : ''}` },
      el('div', { class: 'stock-main' },
        el('strong', {}, name(item)),
        item.sku ? el('span', { class: 'sku' }, `SKU ${item.sku}`) : el('span', { class: 'sku missing' }, 'No SKU in Shopify'),
        item.boxes.length ? el('ul', { class: 'stock-boxes' }, item.boxes.map((b) => el('li', {},
          `Box of ${b.perBox}`, b.sku ? el('span', { class: 'sku' }, ` · ${b.sku}`) : null,
          el('span', { class: 'tag quiet' }, b.available === null ? 'not tracked' : `${b.available} full box${b.available === 1 ? '' : 'es'}`)))) : null),
      el('div', { class: 'stock-count' },
        el('strong', {}, item.tracked ? item.units.toLocaleString() : '—'),
        el('span', {}, item.tracked ? 'on hand' : 'not tracked'),
        lvl ? el('span', { class: `tag ${lvl === 'out' ? 'overdue' : 'soon'}` }, lvl === 'out' ? 'Out of stock' : 'Low') : null),
      el('button', { type: 'button', class: 'btn', onclick: () => openSale(item) }, 'Record sale'));
  }

  // ---- Record-a-sale dialog ----
  const dialog = $('[data-sale-dialog]');
  const form = $('[data-sale-form]');
  const newRequestId = () => crypto.randomUUID();

  function openSale(item, onlyOption) {
    const el = state.el;
    const options = onlyOption
      ? [{ id: onlyOption.id, label: 'Bundle', perUnit: 1, price: onlyOption.price, sku: onlyOption.sku, available: onlyOption.available }]
      : [{ id: item.id, label: 'Single items', perUnit: 1, price: item.price, sku: item.sku, available: item.tracked ? Math.max(item.units, 0) : null },
        ...item.boxes.map((b) => ({ id: b.id, label: `Box of ${b.perBox}`, perUnit: b.perBox, price: b.price, sku: b.sku, available: b.available }))];
    state.selling = { item, options };
    state.requestId = newRequestId();
    form.reset();
    $('[data-sale-item]').replaceChildren(el('strong', {}, name(item)), item.sku ? el('span', { class: 'sku' }, ` · SKU ${item.sku}`) : null);
    const fieldset = $('[data-sale-units]');
    fieldset.replaceChildren(el('legend', {}, 'Selling'), ...options.map((o, i) => el('label', {},
      el('input', { type: 'radio', name: 'unit', value: String(i), checked: i === (options.length > 1 ? 1 : 0) }),
      ` ${o.label}`, o.price ? el('span', { class: 'muted' }, ` · ${money(o.price)}`) : null)));
    fieldset.hidden = options.length < 2;
    $('[data-sale-error]').hidden = true;
    updateSummary();
    dialog.showModal();
    form.elements.quantity.focus();
  }

  const chosen = () => state.selling.options[Number(form.elements.unit?.value || 0)] || state.selling.options[0];

  function updateSummary() {
    const option = chosen();
    $('[data-sale-price]').placeholder = option.price ? `Store price ${money(option.price)}` : 'Store price';
    $('[data-price-label]').textContent = option.perUnit > 1 ? 'Price per box ($)' : 'Price each ($)';
    const qty = parseInt(form.elements.quantity.value, 10);
    const summary = $('[data-sale-summary]');
    if (!(qty >= 1)) { summary.textContent = 'Enter how many.'; return; }
    const units = qty * option.perUnit;
    const paid = form.elements.paid.value === 'yes';
    const parts = [];
    if (option.perUnit > 1) parts.push(`Takes ${units.toLocaleString()} out of stock (${qty} × ${option.perUnit}).`);
    else parts.push(`Takes ${qty.toLocaleString()} out of stock.`);
    if (option.available !== null && option.available !== undefined) {
      parts.push(qty > option.available ? `Only ${option.available} available.` : `${(option.available - qty).toLocaleString()} ${option.perUnit > 1 ? 'full boxes' : 'left'} after this.`);
    }
    parts.push(`Creates a Shopify order marked ${paid ? 'paid' : 'not paid yet'}.`);
    summary.textContent = parts.join(' ');
  }
  form.addEventListener('input', updateSummary);
  form.addEventListener('change', updateSummary);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('[data-sale-error]');
    const option = chosen();
    const qty = Number(form.elements.quantity.value);
    const price = form.elements.unitPrice.value.trim();
    const problems = [];
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) problems.push('How many must be a whole number from 1 to 10,000.');
    if (price && !(Number(price) >= 0)) problems.push('The price must be a positive amount.');
    if (problems.length) { error.textContent = problems.join(' '); error.hidden = false; return; }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Recording…';
    const result = await callStock({
      action: 'record_sale', requestId: state.requestId, variantId: option.id, quantity: qty, paid: form.elements.paid.value === 'yes',
      unitPrice: price ? Number(price) : null, customer: form.elements.customer.value.trim() || null, note: form.elements.note.value.trim() || null,
    });
    button.disabled = false;
    button.textContent = 'Record sale';
    if (!result.ok) {
      // When the outcome is unknown the sale may have gone through, so the retry reuses the request id and the server
      // finishes or de-duplicates it. A definite refusal gets a fresh id so the owner can fix the form and try again.
      if (!result.sameRequest) state.requestId = newRequestId();
      error.textContent = result.status === 0 ? `${result.message} Tapping Record sale again won’t record it twice.` : result.message;
      error.hidden = false;
      return;
    }
    dialog.close();
    const order = result.data.sale?.shopify_order_name;
    status(`${result.data.duplicate ? 'Already recorded' : 'Recorded'}${order ? ` as Shopify order ${order}` : ''}. Stock updated.`, 'ok');
    await loadStock({ keepStatus: true });
  });

  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  // ---- Toolbar ----
  $('[data-stock-search]').addEventListener('input', (event) => { state.query = event.target.value.trim(); render(); });
  $('[data-stock-refresh]').addEventListener('click', () => { status(''); loadStock(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.db && !panels.stock.hidden && !dialog.open) loadStock();
  });
})();
