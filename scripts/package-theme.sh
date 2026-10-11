#!/usr/bin/env bash
# Builds build/command-deck-theme.zip for Online Store → Themes → Add theme → Upload zip file.
# The zip holds only the theme folders; Shopify rejects uploads with unrelated top-level files.
# The owner app (preview/owner.html) is hosted with the static site, so its assets/owner* files stay out of the theme.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p build
rm -f build/command-deck-theme.zip
zip -qr -X build/command-deck-theme.zip assets config layout locales sections snippets templates -x '*.DS_Store' 'assets/owner*'

echo "build/command-deck-theme.zip: $(unzip -l build/command-deck-theme.zip | tail -1 | awk '{print $2}') files, $(du -h build/command-deck-theme.zip | cut -f1)"
