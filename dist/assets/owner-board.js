// Custom-order board (preview/board.html). Data lives in Supabase; row-level security limits it to owner accounts.
// Once an owner signs in it fires "cd:owner-ready" so the Stock tab (owner-stock.js) can share the session.
// Customer text is only ever inserted with textContent / form values, never as HTML.
(() => {
  const STAGES = [
    { id: 'new', label: 'New' },
    { id: 'quoting', label: 'Quoting' },
    { id: 'design', label: 'Design' },
    { id: 'approved', label: 'Approved' },
    { id: 'production', label: 'In production' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'archived', label: 'Archived' },
  ];
  const ACTIVE = ['quoting', 'design', 'approved', 'production'];
  const DUE_SOON_DAYS = 7;
  const FIELDS = ['customer_name', 'email', 'phone', 'organization', 'project_type', 'quantity', 'needed_by', 'budget', 'details', 'notes', 'stage'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  };

  const config = window.CD_BOARD_CONFIG || {};
  const errorBanner = $('[data-error]');
  const showError = (message) => { errorBanner.textContent = message; errorBanner.hidden = !message; };

  if (!window.supabase || !config.supabaseUrl || !config.supabaseKey) {
    showError('The board is not configured. Check board-config.js.');
    $('[data-view="loading"]').hidden = true;
    return;
  }
  const db = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const state = { orders: [], query: '', showArchived: false, filter: null, editing: null, recovering: false, changingPassword: false, loadedFor: null };

  function show(view) {
    for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== view;
    $('[data-sign-out]').hidden = !['board', 'no-access', 'set-password'].includes(view);
  }

  // ---- Dates and money ----
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const daysUntil = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86400000);
  const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: iso.slice(0, 4) === todayIso().slice(0, 4) ? undefined : 'numeric' });
  const money = (cents) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 });
  const daysAgo = (ts) => Math.max(0, Math.floor((Date.now() - Date.parse(ts)) / 86400000));
  const inStage = (order) => { const d = daysAgo(order.stage_changed_at); return d === 0 ? 'Moved today' : `${d} day${d === 1 ? '' : 's'} in stage`; };

  function dueInfo(order) {
    if (!order.needed_by || ['shipped', 'archived'].includes(order.stage)) return null;
    const days = daysUntil(order.needed_by);
    if (days < 0) return { level: 'overdue', text: `Overdue ${-days} day${days === -1 ? '' : 's'}` };
    if (days === 0) return { level: 'overdue', text: 'Due today' };
    if (days <= DUE_SOON_DAYS) return { level: 'soon', text: `Due in ${days} day${days === 1 ? '' : 's'}` };
    return { level: 'later', text: `Due ${shortDate(order.needed_by)}` };
  }

  // ---- Auth ----
  async function route(session) {
    showError('');
    if (state.recovering) return openPasswordForm(false);
    if (state.changingPassword && session) return;
    if (!session) {
      state.orders = []; state.loadedFor = null;
      document.dispatchEvent(new CustomEvent('cd:owner-signed-out'));
      return show('sign-in');
    }
    if (state.loadedFor === session.user.id) return;
    const { data, error } = await db.from('owners').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (error) { show('board'); return showError(`Couldn’t check access: ${error.message}`); }
    if (!data) return show('no-access');
    state.loadedFor = session.user.id;
    show('board');
    document.dispatchEvent(new CustomEvent('cd:owner-ready', { detail: { db, el, config } }));
    await loadOrders();
  }

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') state.recovering = true;
    if (event === 'SIGNED_OUT') { state.recovering = false; state.changingPassword = false; state.loadedFor = null; }
    if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'PASSWORD_RECOVERY'].includes(event)) setTimeout(() => route(session), 0);
  });

  $('[data-sign-in-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('[data-auth-message]');
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { message.textContent = 'Enter your email and password.'; return; }
    form.querySelector('button').disabled = true;
    message.textContent = 'Signing in…';
    const { error } = await db.auth.signInWithPassword({ email, password });
    form.querySelector('button').disabled = false;
    message.textContent = error ? 'That email and password didn’t match. Try again or reset your password.' : '';
    if (!error) form.password.value = '';
  });

  $('[data-forgot]').addEventListener('click', async () => {
    const message = $('[data-auth-message]');
    const email = $('#si-email').value.trim();
    if (!email) { message.textContent = 'Type your email above first, then tap “Forgot password?”.'; $('#si-email').focus(); return; }
    message.textContent = 'Sending…';
    const redirectTo = new URL('board.html', location.href).href;
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
    message.textContent = error && error.status === 429
      ? 'Too many reset emails. Wait an hour and try again.'
      : 'If that email belongs to an owner account, a reset link is on its way. Open it on this device.';
  });

  // The same form serves a reset link (recovering) and "Change password" while signed in; the latter asks for the
  // current password first so an unlocked phone left signed in can't be used to lock the owner out.
  const notice = $('[data-notice]');
  const showNotice = (text) => { notice.textContent = text; notice.hidden = false; setTimeout(() => { notice.hidden = true; }, 6000); };

  function openPasswordForm(changing) {
    state.changingPassword = changing;
    const form = $('[data-set-password-form]');
    form.reset();
    for (const node of document.querySelectorAll('[data-current-password]')) node.hidden = !changing;
    form.current.required = changing;
    $('[data-cancel-password]').hidden = !changing;
    $('#set-pw-h').textContent = changing ? 'Change your password' : 'Set a new password';
    $('[data-set-password-message]').textContent = '';
    show('set-password');
    (changing ? form.current : form.password).focus();
  }

  $('[data-change-password]').addEventListener('click', () => openPasswordForm(true));
  $('[data-cancel-password]').addEventListener('click', () => { state.changingPassword = false; show('board'); });

  $('[data-set-password-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('[data-set-password-message]');
    const button = form.querySelector('[type="submit"]');
    if (state.changingPassword && !form.current.value) { message.textContent = 'Enter your current password.'; form.current.focus(); return; }
    if (form.password.value.length < 12) { message.textContent = 'Use at least 12 characters.'; form.password.focus(); return; }
    if (state.changingPassword && form.current.value === form.password.value) { message.textContent = 'Choose a password different from your current one.'; return; }
    button.disabled = true;
    message.textContent = 'Saving…';
    if (state.changingPassword) {
      const { data } = await db.auth.getSession();
      const email = data.session?.user?.email;
      const check = email ? await db.auth.signInWithPassword({ email, password: form.current.value }) : { error: true };
      if (check.error) { button.disabled = false; message.textContent = 'Your current password isn’t right.'; form.current.focus(); return; }
    }
    const { error } = await db.auth.updateUser({ password: form.password.value });
    button.disabled = false;
    if (error) { message.textContent = `Couldn’t save the password: ${error.message}`; return; }
    form.reset();
    message.textContent = '';
    if (state.changingPassword) {
      state.changingPassword = false;
      show('board');
      showNotice('Password changed. Use the new one next time you sign in.');
      return;
    }
    state.recovering = false;
    history.replaceState(null, '', location.pathname);
    const { data } = await db.auth.getSession();
    route(data.session);
  });

  $('[data-sign-out]').addEventListener('click', async () => {
    await db.auth.signOut();
  });

  // ---- Data ----
  async function loadOrders() {
    let query = db.from('custom_orders').select('*').order('needed_by', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    if (!state.showArchived) query = query.neq('stage', 'archived');
    const { data, error } = await query;
    if (error) return showError(`Couldn’t load orders: ${error.message}`);
    showError('');
    state.orders = data;
    render();
  }

  async function saveOrder(values, id) {
    const request = id ? db.from('custom_orders').update(values).eq('id', id) : db.from('custom_orders').insert(values);
    const { error } = await request;
    return error;
  }

  // ---- Rendering ----
  function matches(order) {
    if (state.filter === 'overdue' && dueInfo(order)?.level !== 'overdue') return false;
    if (state.filter === 'soon' && !['soon', 'overdue'].includes(dueInfo(order)?.level)) return false;
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return ['customer_name', 'email', 'phone', 'organization', 'project_type', 'details', 'notes', 'budget']
      .some((k) => (order[k] || '').toLowerCase().includes(q));
  }

  function render() {
    const orders = state.orders;
    const count = (fn) => orders.filter(fn).length;
    const stats = $('[data-stats]');
    const overdue = count((o) => dueInfo(o)?.level === 'overdue');
    const soon = count((o) => ['soon', 'overdue'].includes(dueInfo(o)?.level));
    const quoted = orders.filter((o) => ['approved', 'production'].includes(o.stage) && o.quote_cents).reduce((sum, o) => sum + o.quote_cents, 0);
    const stat = (value, label, filter, tone) => el('button', {
      type: 'button', class: `stat${tone ? ` ${tone}` : ''}${state.filter === filter && filter ? ' on' : ''}`,
      'aria-pressed': filter ? String(state.filter === filter) : undefined, disabled: !filter,
      onclick: filter ? () => { state.filter = state.filter === filter ? null : filter; render(); } : undefined,
    }, el('strong', {}, String(value)), el('span', {}, label));
    stats.replaceChildren(
      stat(count((o) => o.stage === 'new'), 'New requests'),
      stat(count((o) => ACTIVE.includes(o.stage)), 'In progress'),
      stat(soon, 'Due this week', 'soon', soon ? 'warn' : ''),
      stat(overdue, 'Overdue', 'overdue', overdue ? 'alert' : ''),
      stat(quoted ? money(quoted) : '—', 'Approved work'),
    );

    const visible = orders.filter(matches);
    const stages = STAGES.filter((s) => s.id !== 'archived' || state.showArchived);
    const nav = $('[data-stage-nav]');
    nav.replaceChildren(...stages.map((s) => el('a', { href: `#stage-${s.id}` }, `${s.label} `, el('span', { class: 'count' }, String(visible.filter((o) => o.stage === s.id).length)))));

    const board = $('[data-board]');
    board.replaceChildren(...stages.map((stage) => {
      const items = visible.filter((o) => o.stage === stage.id);
      return el('section', { class: 'column', id: `stage-${stage.id}`, 'aria-labelledby': `col-${stage.id}` },
        el('h3', { id: `col-${stage.id}` }, stage.label, el('span', { class: 'count' }, String(items.length))),
        items.length ? el('ol', { class: 'cards' }, items.map(card)) : el('p', { class: 'empty' }, state.query || state.filter ? 'No matches' : 'Nothing here'));
    }));
    if (!orders.length && !state.showArchived) {
      board.prepend(el('p', { class: 'first-run' }, 'No custom orders yet. Tap ', el('strong', {}, '+ New'), ' or ', el('strong', {}, 'Paste email'), ' to add your first request.'));
    }
  }

  function card(order) {
    const due = dueInfo(order);
    const index = STAGES.findIndex((s) => s.id === order.stage);
    const next = STAGES[index + 1];
    const summary = [order.project_type, order.quantity ? `${order.quantity.toLocaleString()} pcs` : null].filter(Boolean).join(' · ');
    return el('li', { class: `card${due ? ` due-${due.level}` : ''}` },
      el('button', { type: 'button', class: 'card-open', onclick: () => openOrder(order) },
        el('strong', { class: 'card-name' }, order.customer_name),
        order.organization ? el('span', { class: 'card-org' }, order.organization) : null,
        summary ? el('span', { class: 'card-line' }, summary) : null,
        el('span', { class: 'card-tags' },
          due ? el('span', { class: `tag ${due.level}` }, due.text) : null,
          order.quote_cents ? el('span', { class: 'tag money' }, money(order.quote_cents)) : order.budget ? el('span', { class: 'tag' }, order.budget) : null,
          el('span', { class: 'tag quiet' }, inStage(order)))),
      next && order.stage !== 'shipped' ? el('button', {
        type: 'button', class: 'card-move', 'aria-label': `Move ${order.customer_name} to ${next.label}`,
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          const error = await saveOrder({ stage: next.id }, order.id);
          if (error) showError(`Couldn’t move the order: ${error.message}`);
          await loadOrders();
        },
      }, `${next.label} ›`) : null);
  }

  // ---- Order dialog ----
  const dialog = $('[data-order-dialog]');
  const form = $('[data-order-form]');
  $('[data-stage-select]').replaceChildren(...STAGES.map((s) => el('option', { value: s.id }, s.label)));

  function openOrder(order, prefill) {
    state.editing = order || null;
    form.reset();
    const values = order || { stage: 'new', ...prefill };
    for (const name of FIELDS) if (form.elements[name]) form.elements[name].value = values[name] ?? '';
    form.elements.quote.value = values.quote_cents ? (values.quote_cents / 100).toFixed(2) : '';
    $('[data-order-title]').textContent = order ? order.customer_name : 'New request';
    $('[data-delete]').hidden = !(order && order.stage === 'archived');
    const mail = $('[data-email-customer]');
    mail.hidden = !(order && order.email);
    if (order && order.email) {
      const subject = encodeURIComponent('Your custom order with Command Deck Collective');
      mail.href = `mailto:${encodeURIComponent(order.email).replace(/%40/g, '@')}?subject=${subject}`;
    }
    $('[data-order-meta]').textContent = order
      ? `Added ${new Date(order.created_at).toLocaleDateString()} · ${STAGES.find((s) => s.id === order.stage)?.label || order.stage}: ${inStage(order).toLowerCase()}`
      : '';
    $('[data-order-error]').hidden = true;
    dialog.showModal();
    form.elements.customer_name.focus();
  }

  function readForm() {
    const v = (name) => form.elements[name].value.trim();
    const values = {};
    for (const name of ['customer_name', 'email', 'phone', 'organization', 'project_type', 'budget', 'details', 'notes']) values[name] = v(name) || null;
    values.stage = v('stage');
    values.quantity = v('quantity') ? parseInt(v('quantity'), 10) : null;
    values.needed_by = v('needed_by') || null;
    values.quote_cents = v('quote') ? Math.round(parseFloat(v('quote')) * 100) : null;
    return values;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('[data-order-error]');
    const values = readForm();
    const problems = [];
    if (!values.customer_name) problems.push('Add the customer’s name.');
    if (values.email && !form.elements.email.checkValidity()) problems.push('Check the email address.');
    if (values.quantity !== null && !(values.quantity >= 1 && values.quantity <= 1000000)) problems.push('Quantity must be between 1 and 1,000,000.');
    if (values.quote_cents !== null && !(values.quote_cents >= 0)) problems.push('The quote must be a positive amount.');
    if (problems.length) { error.textContent = problems.join(' '); error.hidden = false; return; }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const failed = await saveOrder(values, state.editing?.id);
    button.disabled = false;
    if (failed) { error.textContent = `Couldn’t save: ${failed.message}`; error.hidden = false; return; }
    dialog.close();
    await loadOrders();
  });

  $('[data-delete]').addEventListener('click', async () => {
    if (!state.editing || !confirm(`Permanently delete the request from ${state.editing.customer_name}? This can’t be undone.`)) return;
    const { data, error } = await db.from('custom_orders').delete().eq('id', state.editing.id).eq('stage', 'archived').select('id');
    const failed = error ? error.message : (data && data.length ? null : 'only archived requests can be deleted.');
    if (failed) { $('[data-order-error]').textContent = `Couldn’t delete: ${failed}`; $('[data-order-error]').hidden = false; return; }
    dialog.close();
    await loadOrders();
  });

  // ---- Paste dialog ----
  const pasteDialog = $('[data-paste-dialog]');
  const pasteForm = $('[data-paste-form]');
  pasteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const { fields } = window.CDBoardParse.parseRequestEmail(pasteForm.elements.text.value);
    pasteDialog.close();
    pasteForm.reset();
    openOrder(null, fields);
  });

  for (const d of [dialog, pasteDialog]) {
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.addEventListener('click', (event) => { if (event.target === d) d.close(); });
  }

  // ---- Toolbar ----
  $('[data-new]').addEventListener('click', () => openOrder(null));
  $('[data-paste]').addEventListener('click', () => { pasteDialog.showModal(); pasteForm.elements.text.focus(); });
  $('[data-search]').addEventListener('input', (event) => { state.query = event.target.value.trim(); render(); });
  $('[data-show-archived]').addEventListener('change', (event) => { state.showArchived = event.target.checked; loadOrders(); });

  // ---- Freshness and connectivity ----
  const offline = $('[data-offline]');
  const updateOnline = () => { offline.hidden = navigator.onLine; };
  addEventListener('online', updateOnline);
  addEventListener('offline', updateOnline);
  updateOnline();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.loadedFor && !dialog.open) loadOrders();
  });
})();
