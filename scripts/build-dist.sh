#!/usr/bin/env bash
# Rebuilds dist/ (the static Sites output) from the preview/ pages, owner-app files and the assets they reference.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/assets
for page in preview/*.html preview/*.webmanifest; do
  sed 's#\.\./assets/#assets/#g' "$page" > "dist/$(basename "$page")"
done
cp preview/*.js dist/

# assets/ also holds the Shopify theme's files; copy only what the static pages, manifest and stylesheet use.
for file in assets/*; do
  name="$(basename "$file")"
  if grep -q "$name" preview/*.html preview/*.webmanifest assets/command-deck.css; then
    cp "$file" dist/assets/
  fi
done

echo "dist/ rebuilt: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
