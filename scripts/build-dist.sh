#!/usr/bin/env bash
# Rebuilds dist/ (the static Sites output) from preview/index.html and the assets it references.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/assets
sed 's#\.\./assets/#assets/#g' preview/index.html > dist/index.html

# assets/ also holds the Shopify theme's files; copy only what the static page and its stylesheet use.
for file in assets/*; do
  name="$(basename "$file")"
  if grep -q "$name" preview/index.html assets/command-deck.css; then
    cp "$file" dist/assets/
  fi
done

echo "dist/ rebuilt: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
