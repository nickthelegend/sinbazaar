#!/usr/bin/env bash
# Stop the local MagicBlock cluster and wait for its ports to actually be free.
# Without the wait, an immediate restart races the OS releasing the sockets and
# mb-stack dies with "Address already in use".
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for pat in mb-stack solana-test-validator ephemeral-validator vrf-oracle; do
  pkill -f "$pat" 2>/dev/null || true
done
rm -f "$ROOT/.stack.pids"

for _ in $(seq 1 60); do
  busy=0
  for p in 8899 8900 9900 7799 7800 6699 6700; do
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || lsof -nP -iUDP:"$p" >/dev/null 2>&1; then
      busy=1; break
    fi
  done
  [ "$busy" = "0" ] && { echo "local stack stopped, ports free"; exit 0; }
  sleep 1
done
echo "local stack stopped, but some ports are still held:"
for p in 8899 8900 9900 7799 7800 6699 6700; do
  lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | tail -n +2
done
exit 1
