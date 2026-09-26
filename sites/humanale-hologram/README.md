# HumanALE Hologram (situs)

Folder ini berisi sumber statis HumanALE Hologram. Sumber ini sedang dikonsolidasikan untuk deployment utama di
`https://aleprinting.my.id/`; URL ChatGPT Sites lama diperlakukan sebagai sumber/riwayat deployment. Kode ini ditempatkan
terpisah dari aplikasi desktop di root repo; jangan mengganti `public/` atau
`desktop/` ketika mengerjakan situs ini.

## Struktur

- `dist/avatar.js`, `dist/face-rig.js`, `dist/neural-core.js`: wajah biner,
  anatomi, animasi, dan jaringan neural.
- Avatar wajah dibangun secara procedural dari `face-rig.js` + `avatar.js`; tidak ada PNG/JPG yang dipakai sebagai peta wajah.
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

`aleprinting.my.id` adalah target domain deployment yang diminta. Status DNS, sertifikat, dan routing hosting tetap harus diverifikasi pada platform yang memegang domain sebelum deployment dianggap selesai.
