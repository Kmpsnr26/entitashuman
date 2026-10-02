#!/usr/bin/env bash
set -euo pipefail
umask 077

# CI-only integration test against an isolated PostgreSQL service.
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGUSER:-}" == nara ]] || {
  echo 'Roundtrip test requires the isolated CI PostgreSQL service.' >&2; exit 2;
}
for tool in pg_dump pg_restore psql createdb dropdb; do command -v "$tool" > /dev/null; done
ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_base="$ops_dir/tests/.work"
mkdir -p "$test_base"
test_base="$(cd -- "$test_base" && pwd)"
temp_root="$(mktemp -d "$test_base/postgres-XXXXXX")"
suffix="${temp_root##*/}"
suffix="${suffix//-/_}"
source_db="nara_ops_${suffix}_source"
recovery_db="nara_ops_${suffix}_recovery"
cleanup() {
  local status="$?"
  for db in "$source_db" "$recovery_db"; do
    [[ "$db" =~ ^nara_ops_postgres_[A-Za-z0-9]+_(source|recovery)$ ]] || continue
    dropdb --no-password --if-exists --force --maintenance-db=nara "$db" > /dev/null 2>&1 || true
  done
  case "$temp_root" in "$test_base"/postgres-*) rm -rf -- "$temp_root" ;; esac
  exit "$status"
}
trap cleanup EXIT
createdb --no-password --maintenance-db=nara "$source_db"
createdb --no-password --maintenance-db=nara "$recovery_db"
psql --no-password --dbname "$source_db" -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE ops_restore_probe(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO ops_restore_probe VALUES (1, 'first recovery row'), (2, 'second recovery row');" > /dev/null
export PGDATABASE="$source_db" BACKUP_DIR="$temp_root/backups"
bash "$ops_dir/postgres/backup.sh"
mapfile -t archives < <(find "$BACKUP_DIR" -type f -name 'nara-*.dump')
[[ "${#archives[@]}" == 1 ]]
bash "$ops_dir/postgres/restore-dry-run.sh" "${archives[0]}"
pg_restore --no-password --exit-on-error --no-owner --no-acl --dbname "$recovery_db" "${archives[0]}"
result="$(psql --no-password --dbname "$recovery_db" -v ON_ERROR_STOP=1 -At -c \
  "SELECT string_agg(id::text || ':' || value, '|' ORDER BY id) FROM ops_restore_probe;")"
[[ "$result" == '1:first recovery row|2:second recovery row' ]]
echo 'PASS: real PostgreSQL custom archive restores exact fixture rows into a separate disposable database.'
