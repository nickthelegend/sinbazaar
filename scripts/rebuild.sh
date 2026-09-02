#!/usr/bin/env bash
# Rebuild the program and restart the local stack so the ER actually runs it.
#
# Why the restart: `solana program deploy` upgrades the base layer, but the
# ephemeral validator keeps its own copy of the program. Until it reloads, ER
# transactions execute the OLD bytecode — which shows up as confusing account
# mismatches ("Not enough account keys", "InvalidWritableAccount") whenever the
# instruction's account list changed. local-stack.sh preloads the freshly built
# .so at genesis, so restarting is the reliable local redeploy.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> anchor build"
anchor build

echo "==> restarting the local stack with the new binary"
bash scripts/stop-stack.sh || true
bash scripts/local-stack.sh --detach

echo ""
echo "Ready. Run:  . ./scripts/local-env.sh && npm test"
