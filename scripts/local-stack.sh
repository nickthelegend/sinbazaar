#!/usr/bin/env bash
# Bring up a complete local MagicBlock cluster for SINBAZAAR and hold it up.
#
#   base solana validator   :8899 / ws :8900
#   ephemeral validator (ER):7799 / ws :7800
#   query filtering service :6699 / ws :6700   <- the PER/TEE read path
#   VRF oracle (base)                          <- fulfils base-layer randomness
#   VRF oracle (ER)                            <- fulfils randomness while delegated
#
# The SINBAZAAR program is preloaded as an upgradeable program at its keypair
# address, which is what `anchor deploy` would have produced.
#
# Usage:  bash scripts/local-stack.sh          (foreground, Ctrl-C to stop)
#         bash scripts/local-stack.sh --detach (background; writes .stack.pids)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENDOR="$ROOT/vendor/magicblock-engine-examples"
VALIDATOR_KEY="$VENDOR/scripts/mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev.json"
WALLET="${HOME}/.config/solana/id.json"
WALLET_PUBKEY="$(solana-keygen pubkey "$WALLET")"
LOGDIR="$ROOT/.logs"
mkdir -p "$LOGDIR"

for bin in mb-stack vrf-oracle; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "ERROR: '$bin' not on PATH."
    echo "  mb-stack:   npm install -g @magicblock-labs/ephemeral-validator"
    echo "  vrf-oracle: npm install -g @magicblock-labs/vrf-oracle-\$(uname -s | tr A-Z a-z)-\$(uname -m)"
    exit 1
  }
done

[ -f target/deploy/sinbazaar.so ] || { echo "ERROR: run 'anchor build' first."; exit 1; }

cleanup() {
  echo ""
  echo "Stopping local stack..."
  for pid in ${PIDS:-}; do kill "$pid" 2>/dev/null || true; done
  sleep 1
  pkill -f "solana-test-validator" 2>/dev/null || true
  pkill -f "ephemeral-validator" 2>/dev/null || true
  pkill -f "vrf-oracle" 2>/dev/null || true
  rm -f "$ROOT/.stack.pids"
}
trap cleanup EXIT INT TERM

rm -rf "$ROOT/magicblock-test-storage" "$ROOT/test-ledger"

echo "Starting MagicBlock stack (base + ER + QFS)..."
RUST_LOG=info mb-stack --reset \
  --account mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev "$VALIDATOR_KEY" \
  --upgradeable-program target/deploy/sinbazaar-keypair.json target/deploy/sinbazaar.so "$WALLET_PUBKEY" \
  > "$LOGDIR/mb-stack.log" 2>&1 < /dev/null &
MB_PID=$!
PIDS="$MB_PID"

echo "  waiting for base :8899, ER :7799 and QFS :6699 ..."
READY=0
for i in $(seq 1 180); do
  kill -0 "$MB_PID" 2>/dev/null || { echo "mb-stack died:"; tail -40 "$LOGDIR/mb-stack.log"; exit 1; }
  if curl -s -m 2 -X POST -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://localhost:8899 2>/dev/null | grep -q ok \
     && curl -s -m 2 -X POST -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://localhost:7799 2>/dev/null | grep -q ok \
     && curl -s -m 2 -X POST -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://localhost:6699 2>/dev/null | grep -q ok; then
    READY=1; break
  fi
  sleep 1
done
[ "$READY" = "1" ] || { echo "stack not ready in time:"; tail -40 "$LOGDIR/mb-stack.log"; exit 1; }
echo "  stack ready."

# Two oracles: one watching the base layer, one watching the ER. SINBAZAAR requests
# randomness while the market is delegated, so the ER oracle is the one that matters.
echo "Starting VRF oracles..."
VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:8899 WEBSOCKET_URL=ws://localhost:8900 \
  RUST_LOG=info vrf-oracle > "$LOGDIR/vrf-base.log" 2>&1 < /dev/null &
PIDS="$PIDS $!"
VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:7799 WEBSOCKET_URL=ws://localhost:7800 \
  RUST_LOG=info vrf-oracle > "$LOGDIR/vrf-er.log" 2>&1 < /dev/null &
PIDS="$PIDS $!"
sleep 3
for pid in $PIDS; do
  kill -0 "$pid" 2>/dev/null || { echo "a stack process died early; see $LOGDIR/"; tail -30 "$LOGDIR"/vrf-*.log; exit 1; }
done

echo "$PIDS" > "$ROOT/.stack.pids"
echo ""
echo "  base  http://localhost:8899   ER  http://localhost:7799   QFS http://localhost:6699"
echo "  program $(solana-keygen pubkey target/deploy/sinbazaar-keypair.json)"
echo "  logs in $LOGDIR/"
echo ""

if [ "${1:-}" = "--detach" ]; then
  trap - EXIT INT TERM   # leave it running for the caller
  echo "Detached. Stop with: bash scripts/stop-stack.sh"
  exit 0
fi

echo "Stack is up. Ctrl-C to stop."
while true; do sleep 5; done
