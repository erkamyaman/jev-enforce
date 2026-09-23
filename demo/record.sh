#!/bin/bash
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
CLI="$(cd "$SRC/.." && pwd)/dist/src/cli.js"
export TYPESAFE_API_KEY=$(cat "$HOME/.jev-key")
export HOME=/tmp/jev-demo-home
rm -rf "$HOME" && mkdir -p "$HOME/shop"
cp -R "$SRC/CLAUDE.md" "$SRC/src" "$HOME/shop/"
cd "$HOME/shop"

type_line() {
  printf '\n  $ '
  sleep 0.6
  for ((i = 0; i < ${#1}; i++)); do
    printf '%s' "${1:i:1}"
    sleep 0.03
  done
  printf '\n\n'
  sleep 0.3
}

command -v clear >/dev/null && clear || true
type_line 'cat src/orders.ts    # what Claude just wrote'
cat src/orders.ts
sleep 2.5
type_line 'jev-enforce check --as code src/orders.ts'
node "$CLI" check --as code src/orders.ts || true
printf '\n'
sleep 3
