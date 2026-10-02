#!/usr/bin/env bash
set -euo pipefail

# Read-only staging smoke test. It never deploys or changes remote state.
# Override the origins only when testing an explicitly approved staging environment.
AUTH_ORIGIN="${AUTH_ORIGIN:-https://staging-auth.aleprinting.my.id}"
NARA_ORIGIN="${NARA_ORIGIN:-https://staging-nara.aleprinting.my.id}"

check_health() {
  local name="$1"
  local origin="$2"
  local code

  code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}'     --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 15     "${origin%/}/health")"

  if [[ "$code" != "200" ]]; then
    printf '%s health check failed: HTTP %s\n' "$name" "$code" >&2
    return 1
  fi

  printf '%s health check passed (HTTP 200)\n' "$name"
}

check_health "staging-auth" "$AUTH_ORIGIN"
check_health "staging-nara" "$NARA_ORIGIN"
