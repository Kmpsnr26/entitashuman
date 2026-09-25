# HumanALE Hologram (situs)

Folder ini berisi sumber statis dari situs HumanALE Hologram yang sudah terbit di
`https://humanale-hologram.sitihasnah109.chatgpt.site/`. Kode ini ditempatkan
terpisah dari aplikasi desktop di root repo; jangan mengganti `public/` atau
`desktop/` ketika mengerjakan situs ini.

## Struktur

- `dist/avatar.js`, `dist/face-rig.js`, `dist/neural-core.js`: wajah biner,
  anatomi, animasi, dan jaringan neural.
- `dist/assets/reference-face.png`: peta wajah rujukan yang digunakan renderer.
- `dist/site.js`: kontrol situs, suara browser, dan interaksi avatar.
- `dist/index.html`, `dist/style.css`, `dist/zoom.css`: halaman dan tampilan.
- `.openai/hosting.json`: identitas proyek Sites dan direktori statisnya;
  bukan berkas kredensial.

## Menjalankan dan menguji

Dari folder ini, jalankan `python -m http.server 4174 --directory dist`, lalu
buka `http://127.0.0.1:4174/`. Untuk pemeriksaan cepat, jalankan
`node --check dist/avatar.js` dan `node --check dist/site.js`. Pastikan wajah
tetap terlihat stabil selama beberapa puluh detik dan sesudah berpindah tab.
Kelopak mata memang berkedip; seluruh wajah atau kode tidak boleh berkedip
cepat. Coba juga pointer, zoom, pilihan material, dan tombol suara.

## Penerbitan dan akses

GitHub dipakai untuk kolaborasi dan tinjauan kode. Push atau merge di GitHub
**tidak otomatis menerbitkan** situs: perubahan harus disinkronkan ke sumber
proyek Sites yang tertera di `.openai/hosting.json`, lalu dibuat versi dan
diterbitkan melalui akun Sites yang berwenang. Jangan menaruh token, API key,
cookie, atau berkas `.env` berisi nilai rahasia di repo.

`avatar.aleprinting.my.id` disiapkan sebagai domain khusus agar situs utama
`aleprinting.my.id` tidak berubah. Status DNS, sertifikat, dan pembatasan akses
harus diverifikasi sebelum menganggap domain tersebut siap dipakai secara
privat.
