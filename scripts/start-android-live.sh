#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_root"
command -v node >/dev/null || { printf '%s\n' 'Node.js belum tersedia. Pasang nodejs-lts melalui Termux.' >&2; exit 1; }
test -f node_modules/three/build/three.module.js || { printf '%s\n' 'Jalankan npm ci --omit=dev --omit=optional --ignore-scripts terlebih dahulu.' >&2; exit 1; }
export NARA_STUDIO_HOST=127.0.0.1
export NARA_STUDIO_PORT=4178
printf '%s\n' 'NARA Studio lokal: http://127.0.0.1:4178' 'Gunakan login Owner yang sudah tersimpan. Proses ini tidak mereset kredensial.'
exec node nara-core/studio/server.mjs
