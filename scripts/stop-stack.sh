#!/usr/bin/env bash
pkill -f "mb-stack" 2>/dev/null || true
pkill -f "solana-test-validator" 2>/dev/null || true
pkill -f "ephemeral-validator" 2>/dev/null || true
pkill -f "vrf-oracle" 2>/dev/null || true
rm -f "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.stack.pids"
echo "local stack stopped"
