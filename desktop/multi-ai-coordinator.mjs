import { validateChat } from './bridge.mjs';

export const ALECORE_COLLABORATION_MODES = Object.freeze([
  'auto',
  'full-team',
  'local-only',
  'manual'
]);

const CLOUD_PROVIDERS = Object.freeze(['chatgpt', 'copilot']);
const PROVIDER_LABELS = Object.freeze({
  'alecore-local': 'AleCore Local',
  chatgpt: 'ChatGPT',
  copilot: 'GitHub Copilot'
});
const MAX_COLLABORATOR_CHARS = 1500;

export function isComplexCollaborationRequest(message = '') {
  const text = String(message || '').trim();
  if (!text) return false;

  const complexitySignals = /\b(implement|implementation|architecture|architect|debug|diagnose|refactor|review|audit|security|threat|regression|migration|integrat(e|ion)|deploy|build|compile|test|benchmark|compare|evaluate|analy[sz]e|research|plan|workflow|orchestrat(e|ion)|multi.?step|repository|repo|code|bug|error|gagal|perbaiki|perbaikan|implementasi|arsitektur|debug|periksa|audit|keamanan|migrasi|integrasi|uji|pengujian|bandingkan|evaluasi|analisis|rencana|alur kerja|orchestrasi|kolaborasi|proyek|kode)\b/i;
  const sentenceCount = text.split(/[.!?]+/).filter(part => part.trim()).length;
  return complexitySignals.test(text) || text.length >= 260 || sentenceCount >= 3;
}

function bounded(value, limit) {
  const text = String(value || '').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1) + '…';
}

function reviewPrompt(provider, request, draft) {
  return [
    'Anda adalah rekan penelaah independen untuk AleCore AI.',
    'Ini hanya tugas analisis percakapan. Jangan memakai shell, browser, file, plugin, MCP, subagent, atau alat apa pun.',
    'Nilai ketepatan draf, temukan asumsi yang lemah, risiko, dan koreksi penting. Jangan sekadar menyetujui.',
    'Balas dalam Bahasa Indonesia. Bedakan fakta, dugaan, dan hal yang perlu diverifikasi.',
    'Provider reviewer: ' + PROVIDER_LABELS[provider] + '.',
    'PERMINTAAN PENGGUNA:\n' + bounded(request, MAX_COLLABORATOR_CHARS),
    'DRAF AWAL ALECORE LOCAL:\n' + bounded(draft, MAX_COLLABORATOR_CHARS)
  ].join('\n\n').slice(0, 3900);
}

function synthesisPrompt(request, draft, reviews) {
  const reviewText = reviews.map(item =>
    PROVIDER_LABELS[item.provider] + ':\n' + bounded(item.text, 1100)
  ).join('\n\n');
  return [
    'Anda adalah AleCore AI sebagai koordinator dan penyusun jawaban akhir.',
    'Satukan hasil secara kritis. Jangan menyalin semua pendapat secara mentah.',
    'Pertahankan bagian draf yang benar, perbaiki kekeliruan yang didukung alasan kuat, dan sebutkan ketidakpastian yang belum terverifikasi.',
    'Jangan mengklaim provider yang gagal telah berkontribusi. Jawab langsung kepada pengguna dalam Bahasa Indonesia.',
    'PERMINTAAN PENGGUNA:\n' + bounded(request, 900),
    'DRAF ALECORE LOCAL:\n' + bounded(draft, 1100),
    'ULASAN REKAN:\n' + bounded(reviewText, 1700)
  ].join('\n\n').slice(0, 3900);
}

function summarize(mode, participants, cloudShared, reason) {
  const completed = participants
    .filter(item => item.status === 'completed')
    .map(item => PROVIDER_LABELS[item.provider] || item.provider);
  const waiting = participants
    .filter(item => item.status !== 'completed')
    .map(item => (PROVIDER_LABELS[item.provider] || item.provider) + ': ' + item.detail);

  let line = 'Kolaborasi ' + mode.toUpperCase() + ' · ';
  line += completed.length ? 'berhasil: ' + completed.join(', ') : 'AleCore Local saja';
  if (waiting.length) line += ' · belum tersedia: ' + waiting.join('; ');
  if (cloudShared) line += ' · pesan dan draf dibagikan ke provider cloud yang berhasil dipanggil';
  else if (reason === 'cloud-consent-required') line += ' · cloud tidak dipanggil karena izin berbagi belum diberikan';
  else if (reason === 'image-kept-local') line += ' · foto tetap diproses lokal';
  else if (reason === 'simple-request') line += ' · pertanyaan sederhana tidak perlu provider cloud';
  else if (mode === 'local-only') line += ' · tidak ada data yang dikirim ke provider cloud';
  return line;
}

export class AleCoreMultiAICoordinator {
  constructor({ bridges } = {}) {
    if (!bridges || typeof bridges !== 'object') {
      throw new TypeError('AleCore Multi-AI Coordinator membutuhkan kumpulan provider bridge.');
    }
    this.bridges = bridges;
    this.pending = false;
  }

  async statusOf(provider) {
    const bridge = this.bridges[provider];
    if (!bridge || typeof bridge.status !== 'function') {
      return { configured: false, reason: 'bridge-unavailable' };
    }
    try {
      const status = await bridge.status();
      return status && typeof status === 'object'
        ? status
        : { configured: false, reason: 'invalid-status' };
    } catch {
      return { configured: false, reason: 'status-failed' };
    }
  }

  async run(value = {}) {
    if (this.pending) throw new Error('Tunggu kolaborasi AleCore AI sebelumnya selesai.');
    this.pending = true;
    try {
      return await this.execute(value);
    } finally {
      this.pending = false;
    }
  }

  async execute(value = {}) {
    const data = validateChat(value);
    const requestedMode = String(value.mode || 'auto');
    const mode = ALECORE_COLLABORATION_MODES.includes(requestedMode)
      ? requestedMode
      : 'auto';

    if (mode === 'manual') {
      const provider = String(value.provider || 'chatgpt');
      if (provider !== 'alecore-local' && value.allowCloud !== true) {
        throw new Error('Provider cloud dipilih secara manual, tetapi izin cloud untuk pesan ini belum diberikan.');
      }
      const bridge = this.bridges[provider];
      if (!bridge || typeof bridge.ask !== 'function') {
        throw new Error('Provider manual tidak tersedia.');
      }
      const result = await bridge.ask(data);
      if (!result || typeof result.text !== 'string' || !result.text.trim()) {
        throw new Error('Provider manual belum memberikan balasan teks yang dapat digunakan.');
      }
      return {
        ...result,
        collaboration: {
          mode,
          cloudShared: provider !== 'alecore-local',
          participants: [{ provider, status: 'completed', detail: 'provider manual dipilih pengguna' }],
          summary: 'Mode manual · ' + (PROVIDER_LABELS[provider] || provider)
        }
      };
    }

    const local = this.bridges['alecore-local'];
    if (!local || typeof local.ask !== 'function') {
      throw new Error('AleCore Local tidak tersedia. Tidak ada fallback otomatis ke provider cloud.');
    }

    const localStatus = await this.statusOf('alecore-local');
    if (localStatus.configured !== true) {
      if (localStatus.runtimeAvailable === false) {
        throw new Error('AleCore Local belum siap: Ollama di komputer ini belum berjalan. Tidak ada fallback otomatis ke cloud.');
      }
      if (localStatus.modelAvailable === false) {
        throw new Error('AleCore Local belum siap: model lokal belum terpasang. Tidak ada fallback otomatis ke cloud.');
      }
      throw new Error('Status AleCore Local belum terverifikasi. Periksa Ollama dan model lokal; tidak ada fallback otomatis ke cloud.');
    }

    const primary = await local.ask(data);
    if (!primary || typeof primary.text !== 'string' || !primary.text.trim()) {
      throw new Error('AleCore Local belum memberikan balasan teks yang dapat digunakan.');
    }

    const participants = [{
      provider: 'alecore-local',
      status: 'completed',
      detail: 'jawaban awal'
    }];

    if (mode === 'local-only') {
      return {
        ...primary,
        provider: 'alecore-local',
        collaboration: {
          mode,
          cloudShared: false,
          participants,
          summary: summarize(mode, participants, false, '')
        }
      };
    }

    const complex = isComplexCollaborationRequest(data.message);
    const requested = mode === 'full-team'
      ? [...CLOUD_PROVIDERS]
      : complex
        ? (/\b(code|coding|program|programming|bug|error|repo|repository|git|build|test|implement|kode|program|perbaiki|proyek)\b/i.test(data.message)
          ? ['copilot', 'chatgpt']
          : ['chatgpt'])
        : [];

    let reason = '';
    if (!requested.length) {
      reason = 'simple-request';
    } else if (data.image) {
      reason = 'image-kept-local';
      for (const provider of requested) {
        participants.push({ provider, status: 'skipped', detail: 'foto tidak dibagikan ke cloud' });
      }
    } else if (value.allowCloud !== true) {
      reason = 'cloud-consent-required';
      for (const provider of requested) {
        participants.push({ provider, status: 'skipped', detail: 'izin berbagi belum diberikan' });
      }
    }

    const reviews = [];
    let cloudShared = false;
    if (requested.length && !reason) {
      const readiness = await Promise.all(requested.map(async provider => ({
        provider,
        status: await this.statusOf(provider)
      })));
      const isReady = item => item.status.configured === true
        && item.status.busy !== true
        && (item.provider !== 'copilot' || item.status.verified === true);

      for (const item of readiness) {
        if (!isReady(item)) {
          participants.push({
            provider: item.provider,
            status: 'unavailable',
            detail: item.provider === 'copilot' && item.status.configured === true && item.status.verified !== true
              ? 'CLI tersedia tetapi login Copilot belum terverifikasi'
              : item.status.busy === true
                ? 'provider sedang mengerjakan permintaan lain'
                : 'belum siap atau belum terautentikasi'
          });
        }
      }

      const ready = readiness.filter(isReady);
      const outcomes = await Promise.all(ready.map(async item => {
        try {
          const result = await this.bridges[item.provider].ask({
            message: reviewPrompt(item.provider, data.message, primary.text)
          });
          if (!result || typeof result.text !== 'string' || !result.text.trim()) {
            throw new Error('empty-response');
          }
          return { provider: item.provider, status: 'completed', text: result.text };
        } catch {
          return { provider: item.provider, status: 'failed' };
        }
      }));

      for (const outcome of outcomes) {
        if (outcome.status === 'completed') {
          cloudShared = true;
          reviews.push(outcome);
          participants.push({
            provider: outcome.provider,
            status: 'completed',
            detail: 'ulasan independen diterima'
          });
        } else {
          participants.push({
            provider: outcome.provider,
            status: 'failed',
            detail: 'permintaan gagal atau autentikasi diperlukan'
          });
        }
      }
    }

    let finalText = primary.text;
    let synthesis = 'not-needed';
    if (reviews.length) {
      try {
        const result = await local.ask({
          message: synthesisPrompt(data.message, primary.text, reviews)
        });
        if (typeof result?.text === 'string' && result.text.trim()) {
          finalText = result.text.trim();
          synthesis = 'completed';
        } else {
          synthesis = 'kept-local-draft';
        }
      } catch {
        synthesis = 'kept-local-draft';
      }
    }

    return {
      ...primary,
      text: finalText,
      provider: 'alecore-local',
      collaboration: {
        mode,
        cloudShared,
        synthesis,
        participants,
        summary: summarize(mode, participants, cloudShared, reason)
      }
    };
  }
}
