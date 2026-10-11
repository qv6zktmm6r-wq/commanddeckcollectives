#!/usr/bin/env bash
# Rebuilds dist/ (the static Sites output) from the preview/*.html pages and the assets they reference.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/assets
for page in preview/*.html; do
  sed 's#\.\./assets/#assets/#g' "$page" > "dist/$(basename "$page")"
done

# assets/ also holds the Shopify theme's files; copy only what the static pages and their stylesheet use.
for file in assets/*; do
  name="$(basename "$file")"
  if grep -q "$name" preview/*.html assets/command-deck.css; then
    cp "$file" dist/assets/
  fi
done

echo "dist/ rebuilt: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
