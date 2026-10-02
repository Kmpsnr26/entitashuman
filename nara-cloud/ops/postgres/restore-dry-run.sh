#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then echo "usage: $0 BACKUP.dump" >&2; exit 2; fi
backup="$1"
test -f "$backup"
test -f "$backup.sha256"
backup_dir="$(cd -- "$(dirname -- "$backup")" && pwd)"
backup_name="$(basename -- "$backup")"
(
  cd -- "$backup_dir"
  sha256sum --check --strict -- "$backup_name.sha256"
)
pg_restore --list "$backup" >/dev/null
echo "Archive preflight OK: checksum and archive catalog checked."
echo "No database was modified. This does not prove the data can be restored."
echo "Restore viability requires a separate restore into an approved disposable database."
