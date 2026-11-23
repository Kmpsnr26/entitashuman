#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then echo "usage: $0 BACKUP.dump" >&2; exit 2; fi
backup="$1"
test -f "$backup"
test -f "$backup.sha256"
sha256sum --check "$backup.sha256"
pg_restore --list "$backup" >/dev/null
echo "Dry-run OK: checksum and archive catalog verified."
echo "No database was modified. Actual restore requires a separate explicit operator action."
