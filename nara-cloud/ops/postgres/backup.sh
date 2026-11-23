#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/nara-$stamp.dump"
pg_dump --format=custom --no-owner --no-acl --file="$out" "$DATABASE_URL"
pg_restore --list "$out" >/dev/null
sha256sum "$out" > "$out.sha256"
find "$BACKUP_DIR" -type f \( -name 'nara-*.dump' -o -name 'nara-*.dump.sha256' \) -mtime +"$RETENTION_DAYS" -print
echo "Backup verified: $out"
echo "Retention candidates are listed only; deletion is intentionally manual."
