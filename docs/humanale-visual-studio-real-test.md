# HumanALE Visual Studio — Uji Nyata Windows

Candidate: `d71733f8c22f67475ff289ebfd6d0d8ee9ba4eda`

## Tujuan

Menyelesaikan tahap terakhir HumanALE Visual Studio tanpa membuka integrasi final ke Nara Core.

Automated CI sudah membuktikan status `READY_FOR_REAL_TEST`. Uji berikut wajib dilakukan pada PC Windows target.

## Urutan uji

1. Jalankan installer atau portable HumanALE candidate.
2. Buka HumanALE Visual Studio.
3. Pastikan panel `FINAL REAL-TEST PREFLIGHT` menampilkan automated checks PASS.
4. Uji **Visual motion**:
   - blink natural
   - gaze mengikuti target
   - bibir bergerak saat speech
   - telinga tidak deform/flicker
   - neural/core zoom dan motion stabil
5. Uji **Voice Indonesia**:
   - izin mikrofon hanya ketika diminta
   - STT Bahasa Indonesia
   - TTS Bahasa Indonesia
   - Wake ALE dan fallback
   - mic kembali idle setelah selesai
6. Uji **Display scaling** pada 100%, 125%, dan 150%:
   - avatar tidak crop
   - panel tidak overlap bila layar cukup
   - tombol tetap dapat diklik
   - teks dan controls tetap terbaca
7. Uji **Panel interaction**:
   - click-through avatar
   - buka/tutup detached panel
   - pindahkan panel
   - ubah material/accent/brain zoom
   - renderer utama sinkron tanpa avatar kedua
8. Uji **Installer/portable**:
   - install/start
   - tray
   - reopen
   - shutdown bersih
   - catat SmartScreen/signing behavior

## Runner

Jalankan PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\humanale-real-test.ps1
```

Runner membuat `humanale-real-test-result.json`.

Status akhir hanya `REAL_TEST_PASS` bila kelima pemeriksaan real-device berstatus PASS.

## Boundary

Walaupun `REAL_TEST_PASS`, final HumanALE `FINAL_READY` masih memerlukan gate release/security lengkap dan persetujuan eksplisit pencipta sebelum Nara Core integration boleh dibuka.
