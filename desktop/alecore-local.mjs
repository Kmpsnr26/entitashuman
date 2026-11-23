import { validateChat } from './bridge.mjs';
import { humanaleSystemPrompt } from './humanale-brain.mjs';

export const ALECORE_LOCAL_ORIGIN = 'http://127.0.0.1:11434';
export const DEFAULT_ALECORE_LOCAL_MODEL = 'qwen3.5:2b';
export const ALECORE_LOCAL_CONTEXT_TOKENS = 4096;
const STATUS_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 120000;

function resolveModel(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._:/-]{1,160}$/.test(candidate)
    ? candidate
    : DEFAULT_ALECORE_LOCAL_MODEL;
}

export function parseAleCoreLocalResponse(payload) {
  const text = payload?.message?.content;
  return typeof text === 'string' ? text.trim() : '';
}

export class AleCoreLocalBridge {
  constructor({
    fetchImpl = globalThis.fetch,
    model = process.env.ALECORE_LOCAL_MODEL || DEFAULT_ALECORE_LOCAL_MODEL,
    origin = ALECORE_LOCAL_ORIGIN
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('Runtime fetch tidak tersedia untuk AleCore Local.');
    }
    if (origin !== ALECORE_LOCAL_ORIGIN) {
      throw new TypeError('AleCore Local hanya boleh mengakses runtime loopback.');
    }
    this.fetch = fetchImpl;
    this.model = resolveModel(model);
    this.origin = origin;
    this.pending = false;
    this.controller = null;
  }

  async status() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    try {
      const response = await this.fetch(this.origin + '/api/tags', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) {
        return { configured: false, runtimeAvailable: true, modelAvailable: false, model: this.model, mode: 'alecore-local' };
      }
      const payload = await response.json();
      const models = Array.isArray(payload?.models) ? payload.models : [];
      const modelAvailable = models.some(item =>
        item?.name === this.model || item?.model === this.model
      );
      return {
        configured: modelAvailable,
        runtimeAvailable: true,
        modelAvailable,
        model: this.model,
        mode: 'alecore-local'
      };
    } catch {
      return {
        configured: false,
        runtimeAvailable: false,
        modelAvailable: false,
        model: this.model,
        mode: 'alecore-local'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async ask(value) {
    const data = validateChat(value);
    if (this.pending) throw new Error('Tunggu balasan AleCore Local sebelumnya selesai.');

    this.pending = true;
    this.controller = new AbortController();
    const timer = setTimeout(() => this.controller?.abort(), REQUEST_TIMEOUT_MS);
    try {
      const instructions = humanaleSystemPrompt(
        data.message,
        'IDENTITAS UTAMA: Kamu adalah AleCore AI, asisten mandiri berbahasa Indonesia. Jangan memperkenalkan diri sebagai HumanALE god egine atau NARA; nama itu hanya nama lama lapisan aplikasi/avatar. Jawab dalam Bahasa Indonesia secara jelas, akurat, dan jujur. Gunakan Brain, aturan, memori yang diberikan, dan kemampuan yang benar-benar tersedia. Jangan mengklaim memiliki akses internet, file, aplikasi, atau perangkat kecuali kemampuan itu benar-benar diberikan. Jangan mengarang hasil tindakan. Jika tidak tahu, katakan tidak tahu.',
        data.memoryContext
      );
      const messages = [
        { role: 'system', content: instructions },
        ...data.history,
        {
          role: 'user',
          content: data.message,
          ...(data.image ? { images: [data.image.slice(data.image.indexOf(',') + 1)] } : {})
        }
      ];
      const response = await this.fetch(this.origin + '/api/chat', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          keep_alive: '5m',
          options: {
            num_ctx: ALECORE_LOCAL_CONTEXT_TOKENS,
            num_predict: 512,
            temperature: 0.7,
            top_p: 0.8
          }
        }),
        signal: this.controller.signal
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {}

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Model AleCore Local belum terpasang. Pasang Ollama lalu unduh model ' + this.model + '.');
        }
        throw new Error('Runtime AleCore Local menolak permintaan (' + response.status + '). Periksa status Ollama.');
      }

      const text = parseAleCoreLocalResponse(payload);
      if (!text) throw new Error('Model AleCore Local belum memberikan balasan teks.');
      return { text, provider: 'alecore-local', model: this.model };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('AleCore Local belum merespons dalam 120 detik. Coba lagi dengan pesan yang lebih singkat.');
      }
      if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
        throw new Error('Ollama tidak dapat dihubungi di komputer ini. Pastikan Ollama sedang berjalan.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.controller = null;
      this.pending = false;
    }
  }

  stop() {
    this.controller?.abort();
  }
}
