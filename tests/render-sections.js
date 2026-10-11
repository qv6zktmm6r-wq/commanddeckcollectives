// Renders Command Deck sections with mocked Shopify objects to catch Liquid logic errors.
// Run with `npm test`; set RENDER_OUT=<dir> to keep the rendered HTML for inspection.
const { Liquid, Tag, Hash } = require('liquidjs');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.RENDER_OUT;

const engine = new Liquid({ root: [path.join(ROOT, 'snippets')], extname: '.liquid', strictFilters: true, strictVariables: false, dynamicPartials: true, relativeReference: false });

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
engine.registerFilter('asset_url', (f) => `/assets/${f}`);
engine.registerFilter('image_url', (img, opts) => ({ __img: img, toString() { return img.src; } }));
engine.registerFilter('image_tag', function (u, ...args) {
  const opts = {}; for (const a of args) if (Array.isArray(a)) opts[a[0]] = a[1];
  const img = u.__img;
  return `<img src="${img.src}" width="${img.width}" height="${img.height}" alt="${esc(opts.alt ?? img.alt ?? '')}"${opts.loading ? ` loading="${opts.loading}"` : ''}${opts.sizes ? ` sizes="${opts.sizes}"` : ''}>`;
});
engine.registerFilter('money', (cents) => `$${(cents / 100).toFixed(2)}`);
engine.registerFilter('t', (key, ...args) => { const o = {}; for (const a of args) if (Array.isArray(a)) o[a[0]] = a[1]; return key === 'sections.header.cart_count' ? (o.count === 1 ? '1 item' : `${o.count} items`) : key; });
engine.registerFilter('default_errors', (errs) => `<ul>${errs.messages.map((m) => `<li>${m}</li>`).join('')}</ul>`);

engine.registerTag('schema', class extends Tag {
  constructor(token, remainTokens, liquid) { super(token, remainTokens, liquid); while (remainTokens.length) { const t = remainTokens.shift(); if (t.name === 'endschema') return; } }
  * render() {}
});
engine.registerTag('form', class extends Tag {
  constructor(token, remainTokens, liquid, parser) {
    super(token, remainTokens, liquid);
    this.args = new Hash(token.args.replace(/^'contact',?\s*/, ''));
    this.tpls = [];
    const stream = parser.parseStream(remainTokens).on('tag:endform', () => stream.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('form not closed'); });
    stream.start();
  }
  * render(ctx, emitter) {
    const h = yield this.args.render(ctx);
    const scope = ctx.getAll().__form || {};
    ctx.push({ form: scope });
    emitter.write(`<form method="post" action="/contact" id="${h.id}" class="${h.class}">`);
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    emitter.write('</form>');
    ctx.pop();
  }
});

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const products = {
  'aav-legacy-challenge-coin': { title: 'AAV Legacy Challenge Coin', url: '/products/aav-legacy-challenge-coin', price: 3500, available: true, description: '<p>A tribute to five generations of amphibious vehicles. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.</p>', featured_image: { src: '/cdn/aav.jpg', width: 1000, height: 1000, alt: '' } },
  'aztec-ega-collector-coin': { title: 'Aztec EGA Collector Coin', url: '/products/aztec-ega-collector-coin', price: 4000, available: false, description: '<p>Aztec detail.</p>', featured_image: { src: '/cdn/aztec.jpg', width: 1000, height: 1000, alt: 'Aztec coin front & back' } },
  'lvt-2-water-buffalo-challenge-coin': { title: 'LVT-2 <Water> Buffalo', url: '/products/lvt-2', price: 3000, available: true, description: '', featured_image: null },
};

function sectionFromTemplate(json, key) {
  const s = json.sections[key];
  const blocks = (s.block_order || Object.keys(s.blocks || {})).map((id) => {
    const b = { ...s.blocks[id] }; b.id = id; b.settings = { ...(b.settings || {}) }; b.shopify_attributes = `data-block="${id}"`;
    if (b.type === 'product') b.settings.product = products[b.settings.product] || null;
    return b;
  });
  return { id: key, settings: s.settings || {}, blocks };
}
function schemaDefaults(file) {
  const m = read(file).match(/\{% schema %\}([\s\S]*?)\{% endschema %\}/);
  const schema = JSON.parse(m[1]); const out = {};
  for (const st of schema.settings || []) if ('default' in st) out[st.id] = st.default;
  return out;
}

const base = {
  routes: { root_url: '/', cart_url: '/cart', search_url: '/search', account_url: '/account', all_products_collection_url: '/collections/all', collections_url: '/collections' },
  shop: { name: 'Command Deck Collective', customer_accounts_enabled: true, policies: [{ title: 'Privacy policy', url: '/policies/privacy-policy' }, { title: 'Refund policy', url: '/policies/refund-policy' }] },
  cart: { item_count: 0 },
  template: { name: 'index', suffix: null },
  request: { page_type: 'index' },
};

async function run(name, file, ctx) {
  try {
    const all = { ...base, ...ctx };
    const html = await engine.parseAndRender(read(file), all, { globals: all });
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${name}.html`), html); }
    return html;
  } catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; return ''; }
}
const check = (name, cond, msg) => { if (!cond) { console.log(`FAIL ${name}: ${msg}`); process.exitCode = 1; } else console.log(`ok   ${name}: ${msg}`); };

(async () => {
  const indexJson = JSON.parse(read('templates/index.json'));
  const homeKey = Object.keys(indexJson.sections).find((k) => indexJson.sections[k].type === 'command-deck-home');
  const homeDefaults = schemaDefaults('sections/command-deck-home.liquid');
  const homeSection = sectionFromTemplate(indexJson, homeKey);
  homeSection.settings = { ...homeDefaults, ...homeSection.settings };

  let h = await run('home-live', 'sections/command-deck-home.liquid', { section: homeSection });
  check('home-live', (h.match(/class="service-card"/g) || []).length === 5, '5 service cards');
  check('home-live', (h.match(/class="shop-product"/g) || []).length === 3, '3 live product cards');
  check('home-live', h.includes('$35.00') && h.includes('Sold out'), 'prices and sold-out state');
  check('home-live', h.includes('LVT-2 &lt;Water&gt; Buffalo'), 'product title escaped');
  check('home-live', !h.includes('id="recent-work"') && !h.includes('id="testimonials"'), 'gallery/testimonials hidden without content');
  check('home-live', h.includes('id="services-heading"'), 'services heading present');
  check('home-live', h.includes('category-apparel-480.webp 480w') && h.includes('lvt-2-water-buffalo-challenge-coin-500.webp 500w'), 'fallback srcsets');

  const noProducts = JSON.parse(JSON.stringify(homeSection));
  noProducts.blocks.forEach((b) => { if (b.type === 'product') b.settings.product = null; });
  h = await run('home-fallback', 'sections/command-deck-home.liquid', { section: noProducts });
  check('home-fallback', (h.match(/class="shop-product"/g) || []).length === 3 && h.includes('/products/aav-legacy-challenge-coin'), 'falls back to 3 bundled products');

  const withContent = JSON.parse(JSON.stringify(homeSection));
  withContent.blocks.push(
    { id: 'g1', type: 'gallery_image', settings: { image: { src: '/cdn/g1.jpg', width: 1200, height: 900, alt: '' }, caption: 'Unit coin & box' }, shopify_attributes: '' },
    { id: 'g2', type: 'gallery_image', settings: { image: null, caption: 'empty' }, shopify_attributes: '' },
    { id: 't1', type: 'testimonial', settings: { quote: 'Line one\nLine <two>', name: 'Sgt. Example', role: '' }, shopify_attributes: '' },
    { id: 't2', type: 'testimonial', settings: { quote: '', name: 'Hidden', role: 'x' }, shopify_attributes: '' },
  );
  h = await run('home-content', 'sections/command-deck-home.liquid', { section: withContent });
  check('home-content', (h.match(/class="gallery-item"/g) || []).length === 1 && h.includes('alt=""') && h.includes('<figcaption class="gallery-caption"><strong>Unit coin &amp; box</strong></figcaption>') && h.includes('href="/cdn/g1.jpg"') && h.includes('data-lightbox') && h.includes('href="/pages/our-work"'), '1 uncropped gallery photo with caption, viewer and see-all link');
  check('home-content', (h.match(/class="testimonial-card"/g) || []).length === 1 && h.includes('Line one<br />') && h.includes('Line &lt;two&gt;') && !h.includes('Hidden'), '1 testimonial, escaped with line breaks');
  check('home-content', h.indexOf('id="recent-work"') > h.indexOf('id="featured-products"') && h.indexOf('id="testimonials"') > h.indexOf('id="how-it-works"') && h.indexOf('id="testimonials"') < h.indexOf('id="about"'), 'sections in intended order');

  for (const [n, count, expect] of [['0', 0, 'hidden'], ['3', 3, '>3<'], ['120', 120, '99+']]) {
    h = await run(`header-cart-${n}`, 'sections/cd-header.liquid', { cart: { item_count: count } });
    check(`header-cart-${n}`, expect === 'hidden' ? !/class="cart-count"[^>]*>\d/.test(h) : h.includes(expect), `cart badge for ${count}`);
  }
  h = await run('header-index', 'sections/cd-header.liquid', {});
  check('header-index', (h.match(/<nav[\s\S]*?<\/nav>/)?.[0].match(/<a /g) || []).length === 6, '6 desktop nav links incl. Our Work');
  check('header-index', !h.includes('LLC') && h.includes('Command Deck<br>Collective'), 'brand label without LLC');
  h = await run('header-collection', 'sections/cd-header.liquid', { template: { name: 'collection' } });
  check('header-collection', /aria-current="page"[^>]*>Shop|href="[^"]*collections\/all"[^>]*aria-current/.test(h) || h.includes('aria-current'), 'Shop marked current on collection');
  h = await run('header-noaccounts', 'sections/cd-header.liquid', { shop: { ...base.shop, customer_accounts_enabled: false } });
  check('header-noaccounts', !h.includes('/account'), 'account link hidden when accounts disabled');

  h = await run('footer', 'sections/cd-footer.liquid', { section: { settings: { legal_name: 'Command Deck Collective LLC' } } });
  check('footer', /© \d{4} Command Deck Collective LLC\. All rights reserved\./.test(h) && h.includes('/policies/refund-policy'), 'legal name and policy links');
  h = await run('footer-default', 'sections/cd-footer.liquid', { section: { settings: {} } });
  check('footer-default', h.includes('© ') && h.includes('Command Deck Collective. All rights reserved.'), 'falls back to shop name');

  const formSnippet = "{%- render 'cd-contact-form', form_id: 'T' -%}";
  for (const [n, form, expect] of [
    ['form-empty', {}, (x) => !x.includes('form-status') && x.includes('name="contact[budget]"') && x.includes('name="contact[quantity]"') && x.includes('name="contact[needed_by]"')],
    ['form-success', { 'posted_successfully?': true }, (x) => x.includes('your project request was sent')],
    ['form-error', { errors: { messages: ['Email is invalid'] }, name: '"><script>x</script>', email: 'a@b', body: '</textarea><b>' }, (x) => x.includes('role="alert"') && x.includes('Email is invalid') && !x.includes('<script>x') && !x.includes('</textarea><b>')],
  ]) {
    const all = { ...base, __form: form };
    const out = await engine.parseAndRender(formSnippet, all, { globals: all });
    if (OUT) fs.writeFileSync(path.join(OUT, `${n}.html`), out);
    check(n, expect(out), n === 'form-error' ? 'errors shown, echoed values escaped' : n === 'form-success' ? 'success message' : 'all fields present, no status');
  }
  const workDefaults = schemaDefaults('sections/cd-our-work.liquid');
  let w = await run('work-empty', 'sections/cd-our-work.liquid', { section: { settings: workDefaults, blocks: [] } });
  check('work-empty', (w.match(/class="gallery-item"/g) || []).length === 3 && w.includes('/assets/aav-legacy-challenge-coin-500.webp 500w') && !w.includes('work-editor-note') && w.includes('<h1 class="intake-title">Pieces we’ve made.</h1>') && w.includes('href="/pages/custom-project"'), '3 store coins shown until photos are uploaded');
  w = await run('work-editor', 'sections/cd-our-work.liquid', { section: { settings: workDefaults, blocks: [] }, request: { design_mode: true } });
  check('work-editor', w.includes('work-editor-note'), 'upload hint shown only in the theme editor');
  w = await run('work-photos', 'sections/cd-our-work.liquid', { section: { settings: { ...workDefaults, cta_link: '/pages/contact' }, blocks: [
    { id: 'p1', type: 'photo', settings: { image: { src: '/cdn/p1.jpg', width: 900, height: 1200, alt: 'Coin for 1st Battalion' }, title: '1st Battalion <coin>', details: 'Challenge coin · 2025' }, shopify_attributes: 'data-block="p1"' },
    { id: 'p2', type: 'photo', settings: { image: null, title: 'empty' }, shopify_attributes: '' },
    { id: 'p3', type: 'photo', settings: { image: { src: '/cdn/p3.jpg', width: 1200, height: 800, alt: 'Retirement plaque' }, title: 'Retirement plaque', details: '' }, shopify_attributes: '' },
  ] } });
  check('work-photos', (w.match(/class="gallery-item"/g) || []).length === 2 && !w.includes('aav-legacy') && !w.includes('empty'), 'uploaded photos replace the samples, empty blocks skipped');
  check('work-photos', w.includes('<strong>1st Battalion &lt;coin&gt;</strong><span>Challenge coin · 2025</span>') && w.includes('data-caption="1st Battalion &lt;coin&gt; — Challenge coin · 2025"') && w.includes('href="/cdn/p1.jpg"') && w.includes('data-block="p1"'), 'title and details escaped, viewer caption and full-size link');
  check('work-photos', w.includes('alt="Coin for 1st Battalion"') && w.includes('<img src="/cdn/p3.jpg" width="1200" height="800" alt=""'), 'alt kept when different from title, dropped when same');
  check('work-photos', w.includes('href="/pages/contact"'), 'custom button link');
  const hw = await run('header-work', 'sections/cd-header.liquid', { template: { name: 'page', suffix: 'our-work' } });
  check('header-work', /href="\/pages\/our-work" class="active" aria-current="page">Our Work/.test(hw), 'Our Work marked current on its page');
  const proj = await run('custom-project', 'sections/custom-project.liquid', {});
  check('custom-project', proj.includes('id="ContactForm-custom-project"') && proj.includes('<h1 class="intake-title">'), 'custom project page form');

  h = await run('404', 'sections/main-404.liquid', {});
  check('404', (h.match(/<h1/g) || []).length === 1 && h.includes('templates.404.title') && h.includes('href="/collections/all" class="button"') && h.includes('href="/pages/custom-project" class="button button--secondary"'), 'one h1, translated title, shop + custom project buttons');
})();
