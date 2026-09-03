#!/usr/bin/env bash
# Every standing check this project has, in one command.
#
# The point is a single exit code. Each of these already existed and each had to
# be remembered separately, which is how the IDL copy drifted and how the test
# count went stale on the landing page: a check nobody runs is not a check.
#
# Ordered cheapest first, so a broken build fails in seconds rather than after
# the twelve-minute suite.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=()
run() {
  local name="$1"; shift
  printf "\n\033[1m── %s\033[0m\n" "$name"
  if "$@"; then printf "   \033[32mok\033[0m\n"; else printf "   \033[31mFAILED\033[0m\n"; FAILED+=("$name"); fi
}

run "IDL matches the built program"      bash scripts/sync-idl.sh --check
run "test count matches the specs"       node scripts/gen-counts.mjs --check
run "no mocks, stubs, fakes or TODOs"    bash -c '! grep -rqniE "\bTODO\b|\bFIXME\b|\bmock\b|\bstub\b|\bdummy\b|\bfake\b" programs/sinbazaar/src sdk/src app/src scripts tests'
run "no em or en dashes in the app"      bash -c '[ "$(grep -ro "—\|–" app/src --include="*.tsx" --include="*.css" 2>/dev/null | wc -l | tr -d " ")" = "0" ]'
run "web typecheck"                      bash -c 'cd app && npx tsc --noEmit -p tsconfig.json'
run "production build"                   bash -c 'cd app && npm run build:check >/dev/null'
run "deployed program is this build"     bash -c '. ./scripts/local-env.sh && npx ts-node scripts/verify-program.ts'
run "every buried market verifies"       bash -c '. ./scripts/local-env.sh && npx ts-node scripts/verify-market.ts --all >/dev/null'

printf "\n%s\n" "────────────────────────────────────────────────────────────"
if [ ${#FAILED[@]} -eq 0 ]; then
  printf "  \033[32mall standing checks passed\033[0m\n"
  printf "  (npm test is not run here: it needs a live cluster and 12 minutes)\n\n"
  exit 0
fi
printf "  \033[31m%d failed:\033[0m %s\n\n" "${#FAILED[@]}" "${FAILED[*]}"
exit 1
