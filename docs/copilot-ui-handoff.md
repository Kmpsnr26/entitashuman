# HumanALE UI handoff

Tahap ini menambahkan `conversation-stage.css` sebagai dock percakapan browser penuh. `chatDialog` tetap menjadi satu-satunya DOM chat: history, composer, submit, TTS, kamera, dan dikte tetap memakai alur existing di `public/app.js`. Dock browser penuh selalu terbuka, tidak draggable, tidak ditutup oleh dialog Pengaturan, dan tombol tutupnya disembunyikan. `surface.js` memberi kelas `stage-surface` sebelum stylesheet dimuat; kontur dan seluruh warna panggung baru hanya aktif dalam scope itu, sehingga widget popup transparan dan panel Electron tetap memakai aturan lama termasuk tema terang.

Pada layar landscape pendek, avatar dan dock memakai dua kolom dengan gap agar kotaknya tidak bertumpuk. Pada portrait, layout bertumpuk dengan dock flex berketinggian eksplisit; history menjadi satu-satunya area scroll dan header/composer/mikrofon tetap terlihat. Jika viewport sangat pendek, dock menyediakan fallback scroll yang dapat diakses. Tombol dikte memakai ikon SVG berukuran tetap pada browser, popup, dan detached panel, serta menyamakan status busy/listening/pressed dengan kontrol mikrofon existing. Dock stage tidak draggable, sedangkan `chatDialog` tetap draggable dan ter-clamp pada popup/detached non-stage.

Kontur panggung dibuat sebagai SVG inline baru, bukan artwork pihak ketiga. Tema browser penuh dipaksa midnight agar AleCore AI tetap cyan meskipun sistem Windows memilih tema terang. Popup assistant disembunyikan hanya pada browser penuh agar tidak menimpa dock, dan tetap tersedia pada mode popup/transparan.

## Verifikasi supervisor — 25 September 2026

- `npm run verify`: 81 test lulus, build web selesai. Lima regression test khusus stage ditambahkan.
- `npm audit --audit-level=high`: 0 vulnerability.
- `npm run package:desktop`: berhasil; executable paket dengan `--ci-smoke` keluar dengan kode 0 dan memuat renderer serta detached panel.
- Browser: ukuran CSS 839x612, 1440x900, 390x844, dan 844x390 diperiksa. Avatar terpisah dari dock; composer, kirim, dan mikrofon berada dalam viewport; tidak ada overflow horizontal.
- Pesan `halo`, balasan perintah lokal, Shift+Enter, buka/tutup Pengaturan tanpa kehilangan dock, serta log console tanpa error diperiksa.
- Mikrofon memakai mock lokal: izin ditolak, start/stop, cleanup track probe, dan hasil dikte `jam berapa` masuk ke chat. Ini bukan uji rekaman mikrofon fisik atau akurasi transkripsi layanan nyata. Mock dibersihkan dengan reload.
- Popup `?popup=1`: background `rgba(0, 0, 0, 0)`, kontur disembunyikan, ikon mikrofon 14px. Supervisor memperbaiki struktur composer lintas surface agar tombol Kirim tidak memakai ukuran ikon lama; camera preview dapat di-scroll agar kontrolnya tidak terpotong.

## Kelanjutan Codex

Source tersedia di branch GitHub `codex/humanale-god-engine-phase1`; tidak perlu mengambil file dari komputer pembuat. Copilot CLI mengerjakan implementasi UI, Codex melakukan audit, pengujian, dan koreksi regresi kecil.

Belum diverifikasi: keyboard virtual pada perangkat mobile fisik, mikrofon/kamera fisik, percakapan provider live, dan `/run` end-to-end. Android APK dan migrasi renderer ke Three.js/WebGL adalah tahap terpisah; avatar aktif tetap engine AleCore AI dari situs HumanALE. Jangan mengklaim stage ini telah memakai Three.js hanya karena alternatif renderer WebGL ada di repo. Penyimpanan source ke GitHub bukan deployment ke Sites atau rilis EXE/APK baru.
