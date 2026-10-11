#!/usr/bin/env bash
# Rebuilds dist/ (the static Sites output) from preview/index.html and assets/.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist
cp -R assets dist/assets
sed 's#\.\./assets/#assets/#g' preview/index.html > dist/index.html

echo "dist/ rebuilt: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
