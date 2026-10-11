// Tests the owner board's request-email reader (assets/owner-board-parse.js). Run with `npm test`.
const assert = require('assert');
const { parseRequestEmail, parseDate, parseQuantity } = require('../assets/owner-board-parse.js');

const today = new Date(2026, 9, 11);
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok   board-parse: ${name}`); } catch (e) { failures++; console.log(`FAIL board-parse: ${name}\n     ${e.message}`); }
};

check('Shopify contact email', () => {
  const { fields, recognized } = parseRequestEmail(`You received a new message from your online store's contact form.
Country Code: US
Name: Sgt. Maria Lopez
Email: maria.lopez@example.com
Organization: 3rd Assault Amphibian Bn
Project type: Challenge coins
Quantity: 150
Needed by: 2026-11-20
Budget: $1,500 – $5,000
Body:
Unit coin for our reunion.
Front: unit crest. Back: names of the fallen.`, today);
  assert.strictEqual(recognized, 8);
  assert.deepStrictEqual(fields, {
    customer_name: 'Sgt. Maria Lopez', email: 'maria.lopez@example.com', organization: '3rd Assault Amphibian Bn',
    project_type: 'Challenge coins', budget: '$1,500 – $5,000', quantity: 150, needed_by: '2026-11-20',
    details: 'Unit coin for our reunion.\nFront: unit crest. Back: names of the fallen.',
  });
});

check('raw field keys and Windows line endings', () => {
  const { fields } = parseRequestEmail('name: Ana\r\nemail: <ana@example.org>\r\nproject_type: Bulk order\r\nneeded_by: 12/5\r\nbody: 300 shirts', today);
  assert.strictEqual(fields.customer_name, 'Ana');
  assert.strictEqual(fields.email, 'ana@example.org');
  assert.strictEqual(fields.project_type, 'Bulk order');
  assert.strictEqual(fields.needed_by, '2026-12-05');
  assert.strictEqual(fields.details, '300 shirts');
});

check('unreadable values kept in details as written', () => {
  const { fields } = parseRequestEmail('Name: Joe\nQuantity: about 200-300\nNeeded by: before the ball\nBody: Hoodies', today);
  assert.strictEqual(fields.quantity, 200);
  assert.strictEqual(fields.needed_by, undefined);
  assert.strictEqual(fields.details, 'Quantity (as written): about 200-300\nNeeded by (as written): before the ball\n\nHoodies');
});

check('text without labels goes to details', () => {
  const { fields, recognized } = parseRequestEmail('Hi, can you make 50 coins for our retirement?', today);
  assert.strictEqual(recognized, 0);
  assert.deepStrictEqual(fields, { details: 'Hi, can you make 50 coins for our retirement?' });
});

check('body lines that look like labels stay in details', () => {
  const { fields } = parseRequestEmail('Name: Kim\nBody: Line one\nName: engraved on back\nThanks', today);
  assert.strictEqual(fields.customer_name, 'Kim');
  assert.strictEqual(fields.details, 'Line one\nName: engraved on back\nThanks');
});

check('dates', () => {
  assert.strictEqual(parseDate('2026-11-20', today), '2026-11-20');
  assert.strictEqual(parseDate('11/20/2026', today), '2026-11-20');
  assert.strictEqual(parseDate('11/20/26', today), '2026-11-20');
  assert.strictEqual(parseDate('Nov 20', today), '2026-11-20');
  assert.strictEqual(parseDate('November 20th, 2026', today), '2026-11-20');
  assert.strictEqual(parseDate('Friday, Nov 20', today), '2026-11-20');
  assert.strictEqual(parseDate('20 Nov', today), '2026-11-20');
  assert.strictEqual(parseDate('1/15', today), '2027-01-15', 'past month/day rolls to next year');
  assert.strictEqual(parseDate('Oct 11', today), '2026-10-11', 'today stays this year');
  assert.strictEqual(parseDate('2/30/2027', today), null, 'impossible date');
  assert.strictEqual(parseDate('ASAP', today), null);
});

check('quantities', () => {
  assert.strictEqual(parseQuantity('1,000'), 1000);
  assert.strictEqual(parseQuantity('150 coins'), 150);
  assert.strictEqual(parseQuantity('0'), null);
  assert.strictEqual(parseQuantity('lots'), null);
});

if (failures) process.exitCode = 1;
