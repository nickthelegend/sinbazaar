#!/usr/bin/env bash
# Deploy SINBAZAAR to Solana devnet and point the client at the devnet TEE.
#
# The privacy claim is only fully exercised here: the local query-filtering service
# does not refuse unauthorised reads the way the devnet TEE validator does. See the
# "Known limitations" section of the README.
#
# Usage:
#   bash scripts/deploy-devnet.sh                 # uses keys/deployer.json
#   DEPLOYER=~/.config/solana/id.json bash scripts/deploy-devnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOYER="${DEPLOYER:-$ROOT/keys/deployer.json}"
RPC="${RPC:-https://api.devnet.solana.com}"
PROGRAM_KP="target/deploy/sinbazaar-keypair.json"

[ -f "$DEPLOYER" ] || { echo "ERROR: no deployer keypair at $DEPLOYER"; exit 1; }
[ -f target/deploy/sinbazaar.so ] || { echo "ERROR: run 'anchor build' first."; exit 1; }

ADDR="$(solana address -k "$DEPLOYER")"
PROGRAM="$(solana address -k "$PROGRAM_KP")"
SIZE_BYTES="$(wc -c < target/deploy/sinbazaar.so | tr -d ' ')"

echo "deployer  $ADDR"
echo "program   $PROGRAM"
echo "binary    $SIZE_BYTES bytes"

BAL="$(solana balance -k "$DEPLOYER" --url "$RPC" | awk '{print $1}')"
echo "balance   $BAL SOL"

# A program deploy needs roughly 2x the binary's rent, plus fees.
NEED="$(awk "BEGIN{printf \"%.2f\", ($SIZE_BYTES * 2 * 0.00000696) + 1}")"
if awk "BEGIN{exit !($BAL < $NEED)}"; then
  echo ""
  echo "Not enough devnet SOL: need about $NEED, have $BAL."
  echo "Devnet's faucet is aggressively rate limited. Options:"
  echo "  solana airdrop 2 $ADDR --url $RPC     # retry until it lands"
  echo "  https://faucet.solana.com             # web faucet, paste $ADDR"
  echo "  transfer from another funded devnet wallet"
  exit 1
fi

echo ""
echo "Deploying..."
solana program deploy target/deploy/sinbazaar.so \
  --program-id "$PROGRAM_KP" \
  --url "$RPC" \
  -k "$DEPLOYER"

cat > .env.devnet <<EOF
# Devnet. Source this instead of scripts/local-env.sh to run against the real
# MagicBlock cluster, including the TEE that actually enforces private reads.
export PROVIDER_ENDPOINT=https://api.devnet.solana.com
export WS_ENDPOINT=wss://api.devnet.solana.com
# Both the market and its secret are delegated to the TEE validator, so the ER
# connection has to be the TEE host too — not a regional ER, which would not host
# these accounts. This is the configuration the devnet privacy run used.
export EPHEMERAL_PROVIDER_ENDPOINT=https://devnet-tee.magicblock.app
export EPHEMERAL_WS_ENDPOINT=wss://devnet-tee.magicblock.app
export TEE_PROVIDER_ENDPOINT=https://devnet-tee.magicblock.app
export TEE_WS_ENDPOINT=wss://devnet-tee.magicblock.app
export ROUTER_ENDPOINT=https://devnet-router.magicblock.app
export ROUTER_WS_ENDPOINT=wss://devnet-router.magicblock.app
# The TEE validator identity — both the market and its secret must be delegated here.
export VALIDATOR=MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo
# ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE
export VRF_EPHEMERAL_QUEUE=5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc
export ANCHOR_PROVIDER_URL=\$PROVIDER_ENDPOINT
export ANCHOR_WALLET=$DEPLOYER
EOF

echo ""
echo "Deployed $PROGRAM to devnet."
echo "Wrote .env.devnet — source it to run the client against devnet:"
echo "  . ./.env.devnet && npx ts-node scripts/smoke.ts"
echo ""
echo "Explorer: https://explorer.solana.com/address/$PROGRAM?cluster=devnet"
