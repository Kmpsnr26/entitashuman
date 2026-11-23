import { createMobileStreamParser } from "./mobile-console-stream.js";

export const mobileConsoleHtml = `<!doctype html>
<html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex,nofollow,noarchive"><title>NARA · Live AI</title><link rel="stylesheet" href="/mobile-console.css"><script src="/mobile-console.js" defer></script></head>
<body><main><header><div><p class="eyebrow">NARA / HUMANALE</p><h1>Live AI Console</h1><p id="owner">Memeriksa sesi Owner…</p></div><button id="logout" type="button" disabled>Keluar</button></header>
<section class="connection" aria-label="Koneksi runtime"><strong id="connection" role="status">Belum terhubung</strong><p id="readiness">Memeriksa server dan konfigurasi provider…</p><div class="controls"><label for="provider">Provider AI</label><select id="provider" disabled><option value="auto">Otomatis</option></select><button id="refresh" type="button">Periksa koneksi</button></div><ul id="providers"></ul></section>
<section id="transcript" aria-label="Percakapan"><p class="intro">Kirim pesan untuk menerima jawaban langsung dari AI Gateway. Percakapan hanya disimpan selama halaman ini terbuka. Kesiapan konfigurasi provider bukan bukti keberhasilan inferensi; hasil streaming akan mengonfirmasinya.</p></section>
<p id="activity" role="status" aria-live="polite">Menunggu koneksi.</p><form id="chat"><label for="message">Pesan untuk NARA</label><textarea id="message" maxlength="12000" rows="3" placeholder="Apa yang ingin kita kerjakan?" required></textarea><div class="actions"><button id="send" type="submit" disabled>Kirim</button><button id="stop" type="button" disabled>Hentikan</button></div></form>
<p class="footnote">Akses menggunakan sesi Owner yang sudah ada. Console ini menyediakan chat AI streaming; kontrol perangkat dan autopilot tidak dijalankan oleh halaman ini.</p></main></body></html>`;

export const mobileConsoleCss = `:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#06131c;color:#e3f5fc}*{box-sizing:border-box}body{margin:0}main{max-width:840px;margin:auto;padding:24px 18px calc(24px + env(safe-area-inset-bottom))}header{display:flex;justify-content:space-between;align-items:center;gap:16px}h1{font-size:clamp(1.5rem,5vw,2rem);margin:4px 0}.eyebrow{font-size:.72rem;letter-spacing:.2em;color:#70daec}p{line-height:1.6}.connection{background:#102633;border:1px solid #244450;border-radius:16px;padding:18px;margin:20px 0}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}button,select,textarea{font:inherit;color:inherit;border:1px solid #365461;border-radius:10px;padding:12px;background:#142d3b}button{cursor:pointer;min-height:44px}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #80eaff;outline-offset:3px}#send{background:#176478;border-color:#51cce9}#providers{padding-left:20px;font-size:.83rem;color:#a6cad7}#transcript{display:flex;flex-direction:column;gap:12px}.intro,.footnote{font-size:.85rem;color:#9bb9c5}.bubble{margin:0;padding:14px 16px;background:#102633;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}.bubble.user{background:#173b4a;margin-left:24px}.bubble.assistant{margin-right:24px}.bubble small{display:block;color:#70daec;margin-bottom:8px}.bubble.incomplete{border:1px solid #a46a4f}#activity{color:#80eaff;font-size:.88rem;min-height:1.5em}form label{display:block;margin-bottom:8px}textarea{width:100%;resize:vertical;min-height:92px}.actions{display:flex;gap:10px;margin-top:10px}.footnote{margin-top:22px}`;

function bootMobileConsole() {
  type Provider = { id: string; model: string; configured: boolean; health: { state: string; circuitState: string } };
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const connection = element("connection");
  const readiness = element("readiness");
  const activity = element("activity");
  const providerSelect = element<HTMLSelectElement>("provider");
  const send = element<HTMLButtonElement>("send");
  const stop = element<HTMLButtonElement>("stop");
  const logout = element<HTMLButtonElement>("logout");
  const refresh = element<HTMLButtonElement>("refresh");
  const message = element<HTMLTextAreaElement>("message");
  const transcript = element("transcript");
  let csrfToken = "";
  let available = false;
  let active: AbortController | null = null;
  let checking = false;
  const history: { role: "user" | "assistant"; content: string }[] = [];

  function controls() {
    send.disabled = !available || !!active || !navigator.onLine;
    stop.disabled = !active;
    logout.disabled = !csrfToken || !!active;
    providerSelect.disabled = !!active || !available;
    refresh.disabled = checking || !!active;
  }

  function code(error: unknown): string {
    return error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)
      ? error.message : "KONEKSI_GAGAL";
  }

  async function json(path: string, signal: AbortSignal) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
    if (!response.ok) throw new Error(response.status === 401 ? "SESI_BERAKHIR" : "SERVER_TIDAK_TERSEDIA");
    return response.json();
  }

  async function checkConnection() {
    if (checking || active) return;
    checking = true;
    available = false;
    connection.textContent = "Memeriksa koneksi…";
    controls();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      if (!navigator.onLine) throw new Error("PERANGKAT_OFFLINE");
      const [me, health, result] = await Promise.all([
        json("/api/me", controller.signal), json("/health", controller.signal), json("/api/ai/providers", controller.signal)
      ]);
      if (me.authenticated !== true || typeof me.csrfToken !== "string" || !me.csrfToken) throw new Error("SESI_BERAKHIR");
      if (health.ok !== true || health.service !== "nara-app") throw new Error("RUNTIME_TIDAK_SIAP");
      if (!Array.isArray(result.providers)) throw new Error("STATUS_PROVIDER_TIDAK_VALID");
      const providers: Provider[] = result.providers;
      if (providers.length > 20 || providers.some(p => !p || typeof p.id !== "string" || typeof p.model !== "string" || typeof p.configured !== "boolean" || !p.health || typeof p.health.state !== "string" || typeof p.health.circuitState !== "string")) throw new Error("STATUS_PROVIDER_TIDAK_VALID");
      csrfToken = me.csrfToken;
      element("owner").textContent = "Owner: " + String(me.displayName ?? "");
      const selected = providerSelect.value;
      providerSelect.replaceChildren(new Option("Otomatis", "auto"));
      const list = element("providers");
      list.replaceChildren();
      for (const p of providers) {
        const usable = p.configured && p.health.state !== "unavailable";
        const option = new Option(p.id + " · " + p.model, p.id);
        option.disabled = !usable;
        providerSelect.add(option);
        const row = document.createElement("li");
        row.textContent = p.id + " · " + p.model + " — " + (p.configured ? "dikonfigurasi / " + p.health.state + " / " + p.health.circuitState : "belum dikonfigurasi");
        list.append(row);
      }
      if (Array.from(providerSelect.options).some(o => o.value === selected && !o.disabled)) providerSelect.value = selected;
      available = providers.some(p => p.configured && p.health.state !== "unavailable");
      connection.textContent = "Server terhubung · sesi Owner aktif";
      readiness.textContent = available ? "AI Gateway tersedia untuk permintaan. Inferensi akan diverifikasi saat pesan dikirim." : "Server aktif, tetapi belum ada provider AI yang tersedia. Periksa konfigurasi provider di server.";
      activity.textContent = available ? "Siap mengirim pesan." : "Chat belum tersedia.";
    } catch (error) {
      controller.abort();
      available = false;
      csrfToken = "";
      connection.textContent = "Tidak terhubung";
      readiness.textContent = "Pemeriksaan gagal: " + code(error) + ". Periksa koneksi atau buka kembali halaman untuk login Owner.";
      activity.textContent = "Chat dihentikan sampai koneksi terverifikasi.";
    } finally {
      clearTimeout(timeout);
      checking = false;
      controls();
    }
  }

  function bubble(role: "user" | "assistant", text: string) {
    const container = document.createElement("article");
    container.className = "bubble " + role;
    const label = document.createElement("small");
    label.textContent = role === "user" ? "Anda" : "NARA";
    const content = document.createElement("span");
    content.textContent = text;
    container.append(label, content);
    transcript.append(container);
    while (transcript.children.length > 24) transcript.firstElementChild?.remove();
    return { container, label, content };
  }

  element<HTMLFormElement>("chat").addEventListener("submit", async event => {
    event.preventDefault();
    const prompt = message.value.trim();
    if (!prompt || prompt.length > 12_000 || !available || active || !csrfToken) return;
    const controller = new AbortController();
    active = controller;
    controls();
    bubble("user", prompt);
    const reply = bubble("assistant", "");
    message.value = "";
    activity.textContent = "Menghubungkan stream…";
    let text = "";
    let completed = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let idle = setTimeout(() => controller.abort(), 45_000);
    const deadline = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch("/api/ai/stream", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ message: prompt, history: history.slice(-12), provider: providerSelect.value })
      });
      if (!response.ok) throw new Error(response.status === 401 ? "SESI_BERAKHIR" : "AI_HTTP_" + response.status);
      if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body) throw new Error("AI_STREAM_TIDAK_TERSEDIA");
      const parser = createMobileStreamParser(({ event: kind, data }) => {
        if (kind === "provider") reply.label.textContent = "NARA · " + data.id + " / " + data.model;
        if (kind === "delta") {
          text += data.text as string;
          reply.content.textContent = text;
          activity.textContent = "Menerima jawaban langsung…";
        }
        if (kind === "done") reply.label.textContent = "NARA · " + data.provider + " / " + data.model;
      });
      reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new Error("AI_STREAM_ABORTED");
        if (chunk.done) break;
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), 45_000);
        parser.push(chunk.value);
      }
      parser.finish();
      completed = true;
      history.push({ role: "user", content: prompt.slice(0, 8_000) }, { role: "assistant", content: text.slice(0, 8_000) });
      while (history.length > 12) history.shift();
      activity.textContent = "Jawaban selesai · stream terverifikasi.";
    } catch (error) {
      controller.abort();
      reply.container.classList.add("incomplete");
      reply.label.textContent += " · tidak selesai";
      if (!text) reply.content.textContent = "Belum ada jawaban yang selesai diterima.";
      activity.textContent = "Jawaban tidak selesai: " + (code(error) === "KONEKSI_GAGAL" ? "stream terputus, dihentikan, atau melewati batas waktu" : code(error)) + ".";
      available = false;
      connection.textContent = "Koneksi perlu diperiksa kembali";
      readiness.textContent = "Tekan Periksa koneksi sebelum mengirim pesan berikutnya.";
    } finally {
      clearTimeout(idle);
      clearTimeout(deadline);
      if (!completed) await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      active = null;
      controls();
    }
  });

  stop.addEventListener("click", () => active?.abort());
  refresh.addEventListener("click", () => void checkConnection());
  logout.addEventListener("click", async () => {
    if (!csrfToken || active) return;
    logout.disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/logout", { method: "POST", credentials: "same-origin", signal: controller.signal, headers: { "X-CSRF-Token": csrfToken } });
      if (response.status !== 204) throw new Error("LOGOUT_GAGAL");
      csrfToken = "";
      available = false;
      history.length = 0;
      location.replace("/");
    } catch (error) {
      activity.textContent = "Keluar gagal: " + code(error) + ".";
    } finally {
      clearTimeout(timeout);
      controls();
    }
  });
  window.addEventListener("offline", () => {
    active?.abort();
    available = false;
    connection.textContent = "Perangkat offline";
    readiness.textContent = "Sambungkan jaringan lalu periksa koneksi.";
    controls();
  });
  window.addEventListener("online", () => void checkConnection());
  window.addEventListener("pagehide", () => active?.abort());
  setInterval(() => { if (!active && !document.hidden) void checkConnection(); }, 30_000);
  void checkConnection();
}

/** External same-origin JS works with Helmet's script-src 'self'. */
export function mobileConsoleScript(): string {
  // tsx preserves local function names with this esbuild helper in dev mode.
  // tsc does not need it; including the self-contained helper supports both.
  const nameHelper = "const __name = (fn, name) => Object.defineProperty(fn, 'name', { value: name, configurable: true });\n";
  return nameHelper + createMobileStreamParser.toString() + ";\n(" + bootMobileConsole.toString() + ")();";
}
