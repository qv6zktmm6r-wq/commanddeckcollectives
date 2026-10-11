// Reads a pasted Shopify "New customer message" email (or any "Label: value" text) into custom-order fields.
// Shared by the board page (window.CDBoardParse) and the Node tests (module.exports).
(function (root) {
  const LABELS = {
    name: 'customer_name', 'full name': 'customer_name', 'customer name': 'customer_name',
    email: 'email', 'e mail': 'email', 'email address': 'email',
    phone: 'phone', 'phone number': 'phone', telephone: 'phone',
    organization: 'organization', organisation: 'organization', company: 'organization', unit: 'organization',
    'unit business organization': 'organization',
    'project type': 'project_type', type: 'project_type',
    quantity: 'quantity', 'estimated quantity': 'quantity', qty: 'quantity',
    'needed by': 'needed_by', 'needed by date': 'needed_by', deadline: 'needed_by', 'date needed': 'needed_by',
    budget: 'budget', 'budget range': 'budget',
    body: 'details', message: 'details', comments: 'details', 'project details': 'details',
  };
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const normalizeLabel = (s) => s.toLowerCase().replace(/[_\-/]+/g, ' ').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const pad = (n) => String(n).padStart(2, '0');

  function toIso(y, m, d) {
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  // Dates without a year are assumed to be the next occurrence on or after `today`.
  function parseDate(text, today) {
    const s = String(text || '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
    if (!s) return null;
    const ref = today || new Date();
    const thisYear = ref.getFullYear();
    const todayIso = `${thisYear}-${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}`;
    const withYear = (m, d, y) => {
      if (y !== undefined) return toIso(y < 100 ? 2000 + y : y, m, d);
      const guess = toIso(thisYear, m, d);
      return guess && guess < todayIso ? toIso(thisYear + 1, m, d) : guess;
    };
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return toIso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/))) return withYear(+m[1], +m[2], m[3] === undefined ? undefined : +m[3]);
    if ((m = s.match(/^(?:[a-z]+,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2}),?(?:\s+(\d{4}))?$/))) {
      const month = MONTHS.indexOf(m[1].slice(0, 3)) + 1;
      if (month) return withYear(month, +m[2], m[3] === undefined ? undefined : +m[3]);
    }
    if ((m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?(?:\s+(\d{4}))?$/))) {
      const month = MONTHS.indexOf(m[2].slice(0, 3)) + 1;
      if (month) return withYear(month, +m[1], m[3] === undefined ? undefined : +m[3]);
    }
    return null;
  }

  function parseQuantity(text) {
    const m = String(text || '').replace(/(\d),(\d{3})/g, '$1$2').match(/\d+/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return n >= 1 && n <= 1000000 ? n : null;
  }

  function parseRequestEmail(text, today) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const raw = {};
    let current = null;
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z][A-Za-z _\-/]{0,40}?)\s*:\s*(.*)$/);
      const field = m && LABELS[normalizeLabel(m[1])];
      if (field && !(field in raw)) {
        raw[field] = m[2].trim();
        current = field === 'details' ? field : null;
      } else if (current === 'details') {
        raw.details += (raw.details ? '\n' : '') + line;
      }
    }
    if (raw.details !== undefined) raw.details = raw.details.trim();

    const fields = {};
    const extra = [];
    for (const key of ['customer_name', 'email', 'phone', 'organization', 'project_type', 'budget', 'details']) {
      if (raw[key]) fields[key] = raw[key];
    }
    if (fields.email) {
      const email = fields.email.match(/[^\s<>()"']+@[^\s<>()"']+\.[^\s<>()"']+/);
      if (email) fields.email = email[0].replace(/[.,;]+$/, ''); else { extra.push(`Email (as written): ${fields.email}`); delete fields.email; }
    }
    if (raw.quantity) {
      const q = parseQuantity(raw.quantity);
      if (q) fields.quantity = q;
      if (!q || !/^\s*[\d,]+\s*$/.test(raw.quantity)) extra.push(`Quantity (as written): ${raw.quantity}`);
    }
    if (raw.needed_by) {
      const d = parseDate(raw.needed_by, today);
      if (d) fields.needed_by = d; else extra.push(`Needed by (as written): ${raw.needed_by}`);
    }
    if (extra.length) fields.details = [extra.join('\n'), fields.details].filter(Boolean).join('\n\n');
    const recognized = Object.keys(raw).length;
    if (!recognized) fields.details = String(text || '').trim();
    return { fields, recognized };
  }

  const api = { parseRequestEmail, parseDate, parseQuantity };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CDBoardParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
