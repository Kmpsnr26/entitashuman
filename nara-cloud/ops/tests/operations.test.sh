#!/usr/bin/env bash
set -euo pipefail

# Fake PostgreSQL/curl tools: these tests never connect to a database or host.
ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_base="$ops_dir/tests/.work"
mkdir -p -- "$test_base"
test_base="$(cd -- "$test_base" && pwd)"
temp_root="$(mktemp -d "$test_base/operations-XXXXXX")"
cleanup() {
  case "$temp_root" in
    "$test_base"/operations-*) rm -rf -- "$temp_root" ;;
    *) echo "Refusing cleanup outside test workspace." >&2 ;;
  esac
}
trap cleanup EXIT
mkdir -p "$temp_root/bin" "$temp_root/backups with spaces" "$temp_root/elsewhere"
export TEST_LOG="$temp_root/tools.log"
export TEST_UMASK="$temp_root/umask.log"
export TEST_REAL_SHA256SUM="$(command -v sha256sum)"
export TEST_REAL_MV="$(command -v mv)"
export PATH="$temp_root/bin:$PATH"

cat > "$temp_root/bin/pg_dump" <<'FAKE_DUMP'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_dump' >> "$TEST_LOG"
printf ' <%s>' "$@" >> "$TEST_LOG"
printf '\n' >> "$TEST_LOG"
umask > "$TEST_UMASK"
[[ "${PGHOST:-}" == '127.0.0.1' && "${PGDATABASE:-}" == 'nara_test' && "${PGUSER:-}" == 'backup_test' ]]
output=''
for arg in "$@"; do
  if [[ "$arg" == --file=* ]]; then output="${arg#--file=}"; fi
done
[[ -n "$output" ]]
printf 'fake custom archive\n' > "$output"
if [[ "${TEST_DUMP_FAIL:-0}" == 1 ]]; then exit 1; fi
FAKE_DUMP

cat > "$temp_root/bin/pg_restore" <<'FAKE_RESTORE'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_restore' >> "$TEST_LOG"
printf ' <%s>' "$@" >> "$TEST_LOG"
printf '\n' >> "$TEST_LOG"
[[ "$#" == 2 && "$1" == '--list' && -f "$2" ]]
if [[ "${TEST_RESTORE_FAIL:-0}" == 1 ]]; then exit 1; fi
printf 'fake archive catalog\n'
FAKE_RESTORE

cat > "$temp_root/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl' >> "$TEST_LOG"
printf ' <%s>' "$@" >> "$TEST_LOG"
printf '\n' >> "$TEST_LOG"
printf '%s' "${TEST_HTTP_CODE:-200}"
FAKE_CURL
chmod +x "$temp_root/bin/pg_dump" "$temp_root/bin/pg_restore" "$temp_root/bin/curl"

cat > "$temp_root/bin/sha256sum" <<'FAKE_CHECKSUM'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${TEST_CHECKSUM_FAIL:-0}" == 1 ]]; then exit 1; fi
exec "$TEST_REAL_SHA256SUM" "$@"
FAKE_CHECKSUM
chmod +x "$temp_root/bin/sha256sum"

cat > "$temp_root/bin/mv" <<'FAKE_MOVE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${TEST_PUBLISH_FAIL:-0}" == 1 && "$3" == *.sha256 ]]; then exit 1; fi
exec "$TEST_REAL_MV" "$@"
FAKE_MOVE
chmod +x "$temp_root/bin/mv"

export PGHOST=127.0.0.1 PGDATABASE=nara_test PGUSER=backup_test
export DATABASE_URL='postgresql://app:TEST_SECRET_NEVER_ARG@127.0.0.1/app'
export BACKUP_DIR="$temp_root/backups with spaces"
bash "$ops_dir/postgres/backup.sh" > "$temp_root/backup.out"
mapfile -t archives < <(find "$BACKUP_DIR" -type f -name 'nara-*.dump')
[[ "${#archives[@]}" == 1 ]]
backup="${archives[0]}"
[[ -f "$backup.sha256" && "$(cat "$TEST_UMASK")" == 0077 ]]
! grep -q 'TEST_SECRET_NEVER_ARG\|postgresql://' "$TEST_LOG"
grep -q -- '<--no-password>' "$TEST_LOG"
(
  cd "$temp_root/elsewhere"
  bash "$ops_dir/postgres/restore-dry-run.sh" "$backup" > "$temp_root/preflight.out"
)
grep -q 'does not prove the data can be restored' "$temp_root/preflight.out"
bash "$ops_dir/postgres/backup.sh" > "$temp_root/second-backup.out"
mapfile -t archives < <(find "$BACKUP_DIR" -type f -name 'nara-*.dump')
[[ "${#archives[@]}" == 2 ]]
touch -d '20 days ago' "$backup" "$backup.sha256"
bash "$ops_dir/postgres/backup.sh" > "$temp_root/retention.out"
[[ -f "$backup" && -f "$backup.sha256" ]]
grep -Fq "$backup" "$temp_root/retention.out"
printf 'tamper\n' >> "$backup"
if bash "$ops_dir/postgres/restore-dry-run.sh" "$backup" > /dev/null 2>&1; then
  echo 'Tampered archive incorrectly passed checksum preflight.' >&2; exit 1
fi
printf 'PASS: credentials stay out of argv, private umask, unique backups, retention never deletes, portable checksum, tamper rejection\n'

export BACKUP_DIR="$temp_root/dump-failure"
if TEST_DUMP_FAIL=1 bash "$ops_dir/postgres/backup.sh" > /dev/null 2>&1; then
  echo 'Failed dump unexpectedly succeeded.' >&2; exit 1
fi
[[ -z "$(find "$BACKUP_DIR" -type f -print -quit)" ]]
export BACKUP_DIR="$temp_root/catalog-failure"
if TEST_RESTORE_FAIL=1 bash "$ops_dir/postgres/backup.sh" > /dev/null 2>&1; then
  echo 'Unreadable catalog unexpectedly succeeded.' >&2; exit 1
fi
[[ -z "$(find "$BACKUP_DIR" -type f -print -quit)" ]]
export BACKUP_DIR="$temp_root/checksum-failure"
if TEST_CHECKSUM_FAIL=1 bash "$ops_dir/postgres/backup.sh" > /dev/null 2>&1; then
  echo 'Failed checksum unexpectedly succeeded.' >&2; exit 1
fi
[[ -z "$(find "$BACKUP_DIR" -type f -print -quit)" ]]
export BACKUP_DIR="$temp_root/publication-failure"
if TEST_PUBLISH_FAIL=1 bash "$ops_dir/postgres/backup.sh" > /dev/null 2>&1; then
  echo 'Failed sidecar publication unexpectedly succeeded.' >&2; exit 1
fi
[[ -z "$(find "$BACKUP_DIR" -type f -print -quit)" ]]
printf 'PASS: failed dump, catalog, checksum or sidecar publication leaves no final or partial archive\n'

before="$(wc -l < "$TEST_LOG")"
if PGDATABASE='' bash "$ops_dir/postgres/backup.sh" > /dev/null 2>&1; then exit 1; fi
if PGDATABASE='postgresql://x:y@localhost/db' bash "$ops_dir/postgres/backup.sh" > /dev/null 2>&1; then exit 1; fi
if RETENTION_DAYS='invalid' bash "$ops_dir/postgres/backup.sh" > /dev/null 2>&1; then exit 1; fi
[[ "$(wc -l < "$TEST_LOG")" == "$before" ]]
printf 'PASS: missing database, connection string and invalid retention are rejected before tools run\n'

bash "$ops_dir/smoke-staging.sh" > "$temp_root/smoke.out"
[[ "$(grep -c '^curl' "$TEST_LOG")" == 2 ]]
if TEST_HTTP_CODE=503 bash "$ops_dir/smoke-staging.sh" > /dev/null 2>&1; then exit 1; fi
printf 'PASS: health smoke checks both hosts and fails on non-200 response\n'
