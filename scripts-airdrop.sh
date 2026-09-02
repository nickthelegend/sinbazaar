#!/bin/bash
# Persistent devnet airdrop loop for the deployer key.
KP="$1"; TARGET="${2:-8}"
ADDR=$(solana address -k "$KP")
RPCS=("https://api.devnet.solana.com" "https://rpc.magicblock.app/devnet")
for i in $(seq 1 200); do
  BAL=$(solana balance -k "$KP" --url https://api.devnet.solana.com 2>/dev/null | awk '{print $1}')
  BAL=${BAL:-0}
  if awk "BEGIN{exit !($BAL >= $TARGET)}"; then echo "FUNDED $ADDR = $BAL SOL"; exit 0; fi
  for R in "${RPCS[@]}"; do
    OUT=$(solana airdrop 2 "$ADDR" --url "$R" 2>&1 | tail -1)
    echo "[$i] $R -> $OUT (bal=$BAL)"
    case "$OUT" in *"Signature"*) sleep 8;; *) sleep 20;; esac
  done
done
echo "GAVE UP at $(solana balance -k "$KP" --url https://api.devnet.solana.com)"
