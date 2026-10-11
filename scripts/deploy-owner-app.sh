#!/usr/bin/env bash
# Publishes dist/ (owner app at /, plus the static preview pages) to the Vercel project "command-deck-owner".
# Publishing is owner-approved work; the Vercel CLI must already be signed in.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/build-dist.sh
mkdir -p build/command-deck-owner
rsync -a --delete --exclude .vercel dist/ build/command-deck-owner/
vercel deploy build/command-deck-owner --prod --yes
