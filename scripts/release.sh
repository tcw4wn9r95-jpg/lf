#!/usr/bin/env bash
# Bump the build stamp in js/version.js and sw.js together.
#
# The service worker keeps a cache named after this version and drops every other
# one on activate. Forget to bump it and phones keep serving the previous deploy,
# which is exactly how the unit-economics and verdict releases went out invisible.
#
# Usage: scripts/release.sh [version]   (default: today's date plus a counter)
set -euo pipefail
cd "$(dirname "$0")/.."

current=$(grep -oE "[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+" js/version.js | head -1)
if [ $# -ge 1 ]; then
  next="$1"
else
  today=$(date -u +%Y.%m.%d)
  if [[ "$current" == "$today-"* ]]; then
    next="$today-$(( ${current##*-} + 1 ))"
  else
    next="$today-1"
  fi
fi

sed -i.bak -E "s/[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+/$next/" js/version.js sw.js
rm -f js/version.js.bak sw.js.bak

echo "$current -> $next"
grep -n "$next" js/version.js sw.js
