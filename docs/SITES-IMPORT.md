# Sites source

Original source: https://github.com/qv6zktmm6r-wq/commanddeckcollectives, main commit 4107bdb7e7c39e5b75b364d4b4888f38ff940cbf.

Updated to match the user-supplied approved photographic mockup. The original reference supplies the actual desktop hero product scene. Category blocks now use standalone images: a real Shopify coin photograph and four generated design concepts. See CATEGORY-ART.md. The original logo remains intact. The left background and mobile hero use a clean scene reconstructed with the built-in image-generation tool. HTML supplies all headlines, buttons and navigation. Shopify Liquid and standalone preview share the updated design.

Generation prompt: reconstruct the original panoramic black-and-gold workshop hero without webpage UI; preserve the CD coin, tumbler, leather case, framed sign, pen and drawing; dark open space at left for live HTML copy. Asset: assets/hero-workshop.webp. Reference: assets/approved-product-reference.webp.

Custom-order delivery remains Shopify-dependent; standalone preview explicitly labels its form as a demonstration. No live Shopify or DNS changes.

Static output: run scripts/build-dist.sh before packaging.
