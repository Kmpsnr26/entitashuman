#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${PGHOST:?PGHOST must be set}"
: "${PGDATABASE:?PGDATABASE must be set to a database name}"
: "${PGUSER:?PGUSER must be set}"
if [[ "$PGDATABASE" == *'='* || "$PGDATABASE" == *'://'* ]]; then
  echo "PGDATABASE must be a database name, not a connection string." >&2
  exit 2
fi
export PGHOST PGDATABASE PGUSER
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "RETENTION_DAYS must be a non-negative integer." >&2
  exit 2
fi
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$(mktemp "$BACKUP_DIR/.nara-$stamp-XXXXXX.dump.partial")"
dump_published=false
checksum_published=false
backup_complete=false
cleanup() {
  rm -f -- "$partial" "$partial.sha256"
  if [[ "$backup_complete" != true ]]; then
    if [[ "$dump_published" == true ]]; then rm -f -- "$out"; fi
    if [[ "$checksum_published" == true ]]; then rm -f -- "$out.sha256"; fi
  fi
}
trap cleanup EXIT
pg_dump --no-password --format=custom --no-owner --no-acl --file="$partial"
pg_restore --list "$partial" >/dev/null
backup_name="${partial##*/}"
out="$BACKUP_DIR/${backup_name#.}"
out="${out%.partial}"
(
  cd -- "$BACKUP_DIR"
  digest="$(sha256sum -- "${partial##*/}")"
  digest="${digest%% *}"
  [[ "$digest" =~ ^[a-fA-F0-9]{64}$ ]]
  printf '%s  %s\n' "$digest" "${out##*/}" > "${partial##*/}.sha256"
)
mv --no-clobber -- "$partial" "$out"
[[ ! -e "$partial" ]] || { echo 'Backup output already exists.' >&2; exit 1; }
dump_published=true
mv --no-clobber -- "$partial.sha256" "$out.sha256"
[[ ! -e "$partial.sha256" ]] || { echo 'Backup checksum output already exists.' >&2; exit 1; }
checksum_published=true
backup_complete=true
find "$BACKUP_DIR" -type f \( -name 'nara-*.dump' -o -name 'nara-*.dump.sha256' \) -mtime +"$RETENTION_DAYS" -print
echo "Backup archive created: $out (checksum and catalog checked)."
echo "Restore viability is unverified until a disposable-database restore succeeds."
echo "Retention candidates are listed only; deletion is intentionally manual."
