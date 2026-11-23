import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AleCoreLocalBridge,
  ALECORE_LOCAL_ORIGIN,
  DEFAULT_ALECORE_LOCAL_MODEL,
  parseAleCoreLocalResponse
} from '../desktop/alecore-local.mjs';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

test('AleCore Local defaults to a fixed loopback Ollama runtime and a compact model', () => {
  const bridge = new AleCoreLocalBridge({ fetchImpl: async () => response({ models: [] }) });
  assert.equal(bridge.origin, ALECORE_LOCAL_ORIGIN);
  assert.equal(bridge.model, DEFAULT_ALECORE_LOCAL_MODEL);
  assert.throws(
    () => new AleCoreLocalBridge({ fetchImpl: async () => response({}), origin: 'https://example.com' }),
    /loopback/
  );
});

test('AleCore Local status distinguishes a running runtime from a missing model', async () => {
  const bridge = new AleCoreLocalBridge({
    model: 'qwen3.5:2b',
    fetchImpl: async url => {
      assert.equal(url, ALECORE_LOCAL_ORIGIN + '/api/tags');
      return response({ models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] });
    }
  });
  assert.deepEqual(await bridge.status(), {
    configured: false,
    runtimeAvailable: true,
    modelAvailable: false,
    model: 'qwen3.5:2b',
    mode: 'alecore-local'
  });
});

test('AleCore Local status becomes ready only when the configured model is installed', async () => {
  const bridge = new AleCoreLocalBridge({
    model: 'qwen3.5:2b',
    fetchImpl: async () => response({ models: [{ name: 'qwen3.5:2b', model: 'qwen3.5:2b' }] })
  });
  assert.equal((await bridge.status()).configured, true);
});

test('AleCore Local reports a missing runtime without exposing network details', async () => {
  const bridge = new AleCoreLocalBridge({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const state = await bridge.status();
  assert.equal(state.configured, false);
  assert.equal(state.runtimeAvailable, false);
  assert.equal(state.modelAvailable, false);
});

test('AleCore Local sends bounded chat history and a single non-streaming local request', async () => {
  let sent;
  const bridge = new AleCoreLocalBridge({
    model: 'qwen3.5:2b',
    fetchImpl: async (url, init) => {
      assert.equal(url, ALECORE_LOCAL_ORIGIN + '/api/chat');
      sent = JSON.parse(init.body);
      return response({ message: { role: 'assistant', content: 'Halo, saya AleCore AI.' } });
    }
  });
  const result = await bridge.ask({
    message: 'Halo',
    history: [
      { role: 'user', content: 'Apa kabar?' },
      { role: 'assistant', content: 'Baik.' }
    ]
  });
  assert.equal(result.text, 'Halo, saya AleCore AI.');
  assert.equal(result.provider, 'alecore-local');
  assert.equal(sent.model, 'qwen3.5:2b');
  assert.equal(sent.stream, false);
  assert.equal(sent.options.num_ctx, 4096);
  assert.deepEqual(sent.messages.slice(-3), [
    { role: 'system', content: sent.messages[0].content },
    { role: 'user', content: 'Apa kabar?' },
    { role: 'assistant', content: 'Baik.' }
  ].length === 0 ? [] : sent.messages.slice(-3));
  assert.equal(sent.messages.at(-1).role, 'user');
  assert.equal(sent.messages.at(-1).content, 'Halo');
});

test('AleCore Local supports the validated JPEG payload without forwarding its data URL prefix', async () => {
  let sent;
  const bridge = new AleCoreLocalBridge({
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return response({ message: { content: 'Saya menerima gambar.' } });
    }
  });
  await bridge.ask({
    message: 'Jelaskan gambar ini.',
    image: 'data:image/jpeg;base64,QUJDRA=='
  });
  assert.deepEqual(sent.messages.at(-1).images, ['QUJDRA==']);
});

test('AleCore Local rejects missing model and malformed responses clearly', async () => {
  const missing = new AleCoreLocalBridge({ fetchImpl: async () => response({ error: 'model not found' }, 404) });
  await assert.rejects(missing.ask({ message: 'Halo' }), /belum terpasang/);

  const empty = new AleCoreLocalBridge({ fetchImpl: async () => response({ message: { content: '  ' } }) });
  await assert.rejects(empty.ask({ message: 'Halo' }), /belum memberikan balasan/);
});

test('Ollama response parser returns only assistant text', () => {
  assert.equal(parseAleCoreLocalResponse({ message: { content: '  Jawaban  ' } }), 'Jawaban');
  assert.equal(parseAleCoreLocalResponse({ message: { content: '' } }), '');
  assert.equal(parseAleCoreLocalResponse({ response: 'not a chat message' }), '');
});
