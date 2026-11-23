import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import express from "express";
import { once } from "node:events";
import { pageHelmet } from "../src/security/page-helmet.js";
import { createMobileStreamParser } from "../src/web/mobile-console-stream.js";
import { mobileConsoleHtml, mobileConsoleScript } from "../src/web/mobile-console.js";

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const ending = frame("done", { provider: "test", model: "model" });

test("mobile SSE parses every byte boundary, multibyte UTF-8 and CRLF", () => {
  const events: string[] = [];
  const parser = createMobileStreamParser(event => events.push(event.event + ":" + String(event.data.text ?? "")));
  const bytes = encoder.encode((frame("request", { requestId: "1" }) + frame("provider", { id: "test", model: "model" }) + frame("delta", { text: "Halo 👋 你好" }) + ending).replaceAll("\n", "\r\n"));
  for (const byte of bytes) parser.push(new Uint8Array([byte]));
  parser.finish();
  assert.deepEqual(events, ["request:", "provider:", "delta:Halo 👋 你好", "done:"]);
});

test("mobile SSE fails closed on partial EOF, upstream error, invalid UTF-8 and oversized frames", () => {
  let parser = createMobileStreamParser(() => {});
  parser.push(encoder.encode(frame("delta", { text: "partial" })));
  assert.throws(() => parser.finish(), /AI_STREAM_INCOMPLETE/);
  parser = createMobileStreamParser(() => {});
  assert.throws(() => parser.push(encoder.encode(frame("error", { error: "AI_UPSTREAM_AUTH_ERROR" }))), /AI_UPSTREAM_AUTH_ERROR/);
  parser = createMobileStreamParser(() => {});
  assert.throws(() => parser.push(new Uint8Array([0xff])), /encoded data/i);
  parser = createMobileStreamParser(() => {});
  assert.throws(() => parser.push(encoder.encode("data: " + "a".repeat(65_537))), /AI_STREAM_FRAME_TOO_LARGE/);
});

test("mobile SSE rejects empty completion, unknown events, malformed JSON, post-completion data and excessive output", () => {
  let parser = createMobileStreamParser(() => {});
  assert.throws(() => parser.push(encoder.encode(ending)), /AI_EMPTY_RESPONSE/);
  parser = createMobileStreamParser(() => {});
  assert.throws(() => parser.push(encoder.encode(frame("unknown", {}))), /AI_STREAM_UNKNOWN_EVENT/);
  parser = createMobileStreamParser(() => {});
  assert.throws(() => parser.push(encoder.encode("event: delta\ndata: broken\n\n")), /AI_STREAM_INVALID_JSON/);
  parser = createMobileStreamParser(() => {});
  parser.push(encoder.encode(frame("delta", { text: "ok" }) + ending));
  assert.throws(() => parser.push(encoder.encode(frame("delta", { text: "late" }))), /AI_STREAM_AFTER_DONE/);
  parser = createMobileStreamParser(() => {});
  const block = encoder.encode(frame("delta", { text: "a".repeat(60_000) }));
  assert.throws(() => { for (let i = 0; i < 9; i++) parser.push(block); }, /AI_RESPONSE_TOO_LARGE/);
});

class FakeElement {
  value = "auto";
  textContent = "";
  disabled = false;
  className = "";
  children: FakeElement[] = [];
  handlers = new Map<string, (event: { preventDefault(): void }) => unknown>();
  classList = { add: (_value: string) => {} };
  get options() { return this.children; }
  get firstElementChild() { return this.children[0]; }
  addEventListener(event: string, handler: (event: { preventDefault(): void }) => unknown) { this.handlers.set(event, handler); }
  replaceChildren(...children: FakeElement[]) { this.children = children; }
  append(...children: FakeElement[]) { this.children.push(...children); }
  add(child: FakeElement) { this.children.push(child); }
  remove() {}
}

async function browserHarness(stream: string | ReadableStream<Uint8Array>, configured = true) {
  const elements = new Map<string, FakeElement>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id)!;
  };
  const calls: { path: string; init: RequestInit }[] = [];
  const context = vm.createContext({
    TextDecoder, Uint8Array, AbortController, console,
    navigator: { onLine: true },
    document: { hidden: false, getElementById: element, createElement: () => new FakeElement() },
    window: { addEventListener() {} },
    location: { replace() {} },
    Option: class extends FakeElement { constructor(text: string, value: string) { super(); this.textContent = text; this.value = value; } },
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    fetch: async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      if (path === "/api/me") return Response.json({ authenticated: true, csrfToken: "session-csrf", displayName: "Owner" });
      if (path === "/health") return Response.json({ ok: true, service: "nara-app" });
      if (path === "/api/ai/providers") return Response.json({ providers: [{ id: "test", model: "model", configured, health: { state: configured ? "ready" : "unavailable", circuitState: configured ? "healthy" : "unavailable" } }] });
      if (path === "/api/ai/stream") return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
      if (path === "/logout") return new Response(null, { status: 204 });
      throw new Error("Unexpected request: " + path);
    }
  });
  vm.runInContext(mobileConsoleScript(), context);
  await new Promise(resolve => setImmediate(resolve));
  return { element, calls };
}

test("delivered browser script verifies readiness, streams safely and uses same-origin CSRF session", async () => {
  const { element, calls } = await browserHarness(frame("provider", { id: "test", model: "model" }) + frame("delta", { text: "<img src=x onerror=alert(1)>👋" }) + ending);
  assert.equal(element("send").disabled, false);
  element("message").value = "Halo";
  await element("chat").handlers.get("submit")!({ preventDefault() {} });
  assert.match(element("activity").textContent, /stream terverifikasi/);
  const streamCall = calls.find(call => call.path === "/api/ai/stream")!;
  assert.equal(streamCall.init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(streamCall.init.body)), { message: "Halo", history: [], provider: "auto" });
  assert.equal((streamCall.init.headers as Record<string, string>)["X-CSRF-Token"], "session-csrf");
  const reply = element("transcript").children[1]!;
  assert.equal(reply.children[1]!.textContent, "<img src=x onerror=alert(1)>👋");
  await element("logout").handlers.get("click")!({ preventDefault() {} });
  assert.equal((calls.find(call => call.path === "/logout")!.init.headers as Record<string, string>)["X-CSRF-Token"], "session-csrf");
});

test("browser UI disables chat with no provider and never reports success for truncated stream", async () => {
  const unavailable = await browserHarness("", false);
  assert.equal(unavailable.element("send").disabled, true);
  assert.match(unavailable.element("readiness").textContent, /belum ada provider/);
  const truncated = await browserHarness(frame("delta", { text: "partial" }));
  truncated.element("message").value = "Halo";
  await truncated.element("chat").handlers.get("submit")!({ preventDefault() {} });
  assert.match(truncated.element("activity").textContent, /AI_STREAM_INCOMPLETE/);
  assert.equal(truncated.element("send").disabled, true);
  assert.doesNotMatch(truncated.element("activity").textContent, /stream terverifikasi/);
});

test("user cancellation cannot promote buffered completion into a successful live response", async () => {
  let upstream: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } });
  const { element } = await browserHarness(stream);
  element("message").value = "Halo";
  const pending = element("chat").handlers.get("submit")!({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  element("stop").handlers.get("click")!({ preventDefault() {} });
  upstream!.enqueue(encoder.encode(frame("delta", { text: "late response" }) + ending));
  upstream!.close();
  await pending;
  assert.match(element("activity").textContent, /AI_STREAM_ABORTED/);
  assert.equal(element("send").disabled, true);
  assert.doesNotMatch(element("activity").textContent, /stream terverifikasi/);
});

test("mobile page and assets preserve Owner auth and backend protected streaming/logout contracts", async () => {
  const [server, routes, ui] = await Promise.all([
    readFile(new URL("../src/apps/naraServer.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/ai.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/web/mobile-console.ts", import.meta.url), "utf8")
  ]);
  assert.match(server, /"\/"[\s\S]*?requirePageAuth[\s\S]*?findOwnerById[\s\S]*?owner\?\.is_active[\s\S]*?send\(mobileConsoleHtml\)/);
  for (const asset of ["mobile-console.js", "mobile-console.css"]) assert.match(server, new RegExp('"/' + asset.replace(".", "\\.") + '"[\\s\\S]*?requirePageAuth'));
  assert.match(routes, /router\.use\([\s\S]*?requireApiAuth/);
  assert.match(routes, /"\/stream"[\s\S]*?requireTrustedOrigin[\s\S]*?requireJsonContentType[\s\S]*?requireCsrf/);
  assert.match(server, /"\/logout"[\s\S]*?requireApiAuth[\s\S]*?requireTrustedOrigin[\s\S]*?requireCsrf/);
  assert.doesNotMatch(ui, /innerHTML|localStorage|OPENAI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|Authorization|type="password"/);
  assert.match(mobileConsoleHtml, /script src="\/mobile-console\.js" defer/);
  assert.doesNotMatch(mobileConsoleHtml, /<script>[^<]|onclick=/);
});

test("actual HTTP CSP permits local HTTP assets but retains production HTTPS upgrade and protection", async () => {
  for (const production of [false, true]) {
    const app = express();
    app.use(pageHelmet(production));
    app.get("/", (_req, res) => res.send(mobileConsoleHtml));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      const csp = response.headers.get("content-security-policy")!;
      assert.equal(csp.includes("upgrade-insecure-requests"), production);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /form-action 'self'/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
  const source = await readFile(new URL("../src/apps/naraServer.ts", import.meta.url), "utf8");
  assert.match(source, /app\.use\(pageHelmet\(isProduction\)\)/);
});

test("Owner SSO CSP allows only the configured app origin for login form redirect", async () => {
  const app = express();
  app.use(pageHelmet(false, "http://127.0.0.1:4200"));
  app.get("/", (_req, res) => res.send("Owner login"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const csp = response.headers.get("content-security-policy")!;
    assert.match(csp, /form-action 'self' http:\/\/127\.0\.0\.1:4200;/);
    assert.doesNotMatch(csp, /form-action[^;]*\*/);
    assert.match(csp, /script-src 'self'/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  const source = await readFile(new URL("../src/apps/authServer.ts", import.meta.url), "utf8");
  assert.match(source, /app\.use\(pageHelmet\(isProduction, env\.PUBLIC_NARA_ORIGIN\)\)/);
});
