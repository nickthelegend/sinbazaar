#!/usr/bin/env bash
# One-time setup: the toolchain, the MagicBlock dev skill, and the official
# examples this project was built from.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> MagicBlock dev skill"
npx --yes skills add https://github.com/magicblock-labs/magicblock-dev-skill || true

echo "==> official examples (the organs this project transplanted)"
mkdir -p vendor
[ -d vendor/magicblock-engine-examples ] || \
  git clone --depth 1 https://github.com/magicblock-labs/magicblock-engine-examples.git \
    vendor/magicblock-engine-examples

echo "==> local MagicBlock cluster binaries"
command -v mb-stack   >/dev/null || npm install -g @magicblock-labs/ephemeral-validator
command -v vrf-oracle >/dev/null || {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && ARCH=arm64
  npm install -g "@magicblock-labs/vrf-oracle-${OS}-${ARCH}"
}

echo "==> node deps"
npm install
(cd app && npm install)

echo "==> a wallet for the local validator"
[ -f "$HOME/.config/solana/id.json" ] || solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json"

cat <<'MSG'

Setup done. Next:
  anchor build
  bash scripts/local-stack.sh --detach
  . ./scripts/local-env.sh && npm test
  . ./scripts/local-env.sh && npm run seed
  cd app && npm run dev
MSG
