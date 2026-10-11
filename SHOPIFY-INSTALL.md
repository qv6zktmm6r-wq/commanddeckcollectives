
# Shopify installation plan

This repository is a complete Shopify Online Store 2.0 theme built on Dawn, plus a standalone preview. Dawn provides the product, collection, cart, search, account, blog, policy and password pages; Command Deck provides the header, footer, homepage, custom-project page and black-and-gold color schemes.

## Before touching the live store
1. Export or duplicate the current live Shopify theme.
2. Upload this repository as a new **unpublished** theme (for example `shopify theme push --unpublished`, or connect the GitHub branch in Online Store → Themes).
3. Create a Shopify page with the handle `custom-project` and assign the `page.custom-project` template.
4. In the theme editor, check the homepage:
   - Each "Featured product" block should point at the right product (the defaults are the three coin handles). Empty or unpublished products fall back to the bundled photos.
   - Each Service block has an Image picker; replace the generic art with approved product photography when the owner provides it.
   - Add "Gallery photo" blocks (up to 12) to show a Recent work gallery after the featured products, and "Testimonial" blocks (up to 6) to show quotes after How it works. Both stay hidden until they have content. Use real customer words only, with permission.
   - Optional: upload a Favicon (Theme settings) and a Social sharing image (Online Store → Preferences). Without them the theme uses the bundled crest icons and `command-deck-share.jpg`.
5. Test desktop, mobile, add to cart (opens the cart page), search, account links, policy links, contact-form delivery and collection links.
6. Only publish after owner approval.

## Theme notes
- The cart is set to "Page". The custom header has no drawer or popup, so keep that setting.
- Headings and body text use the Command Deck fonts set in `assets/command-deck.css`, so the theme editor's Typography settings have no visible effect.
- The header's Account link only appears when customer accounts are enabled.
- Custom-order requests arrive through Shopify's contact form; the quantity, needed-by date and budget fields appear in the notification email. Shopify's contact form cannot accept file uploads.
- Updating Dawn: Dawn files are unmodified apart from `layout/theme.liquid` (loads `command-deck.css`/`.js`, fallback favicons, hero preload and Organization JSON-LD), `snippets/meta-tags.liquid` (fallback share image), `sections/cart-icon-bubble.liquid`, the section groups, `config/` and `templates/index.json`.

## Alternative: keep the current Spotlight theme
The live store runs Spotlight, which is also built on Dawn. Instead of switching themes you can copy into a duplicate of it: `sections/command-deck-home.liquid`, `sections/custom-project.liquid`, `sections/cd-header.liquid`, `sections/cd-footer.liquid`, `snippets/cd-contact-form.liquid`, `snippets/cd-cart-icon.liquid`, `assets/command-deck.*` and the WebP images, then add the stylesheet/script lines from `layout/theme.liquid`.

## Domain
No DNS changes are required if the storefront continues using the existing Shopify store and domain. The new theme can replace the existing published theme after approval.

## Current status
The repository is the working source of truth. The live Shopify storefront has not been changed.
