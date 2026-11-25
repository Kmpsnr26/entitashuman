import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CopilotBridge } from '../desktop/copilot.mjs';
import {
  AleCoreMultiAICoordinator,
  isComplexCollaborationRequest
} from '../desktop/multi-ai-coordinator.mjs';

function fakeBridge({
  configured = true,
  responses = ['jawaban'],
  statusResult = null,
  failAsk = false,
  verified = true,
  busy = false
} = {}) {
  const calls = [];
  let index = 0;
  return {
    calls,
    pending: false,
    async status() {
      return statusResult || { configured, verified, busy };
    },
    async ask(payload) {
      calls.push(payload);
      if (failAsk) throw new Error('provider failure');
      const text = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return { text };
    }
  };
}

test('AUTO keeps ordinary questions on AleCore Local only', async () => {
  const local = fakeBridge({ responses: ['Halo dari lokal.'] });
  const chatgpt = fakeBridge();
  const copilot = fakeBridge();
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const result = await coordinator.run({
    mode: 'auto',
    allowCloud: true,
    message: 'Apa ibu kota Jepang?'
  });

  assert.equal(result.text, 'Halo dari lokal.');
  assert.equal(local.calls.length, 1);
  assert.equal(chatgpt.calls.length, 0);
  assert.equal(copilot.calls.length, 0);
  assert.equal(result.collaboration.cloudShared, false);
  assert.match(result.collaboration.summary, /pertanyaan sederhana/);
});

test('AUTO does not contact cloud providers without per-message consent', async () => {
  const local = fakeBridge({ responses: ['Draf lokal.'] });
  const chatgpt = fakeBridge();
  const copilot = fakeBridge();
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const result = await coordinator.run({
    mode: 'auto',
    allowCloud: false,
    message: 'Tolong audit keamanan dan review arsitektur repository AleCore secara menyeluruh.'
  });

  assert.equal(result.text, 'Draf lokal.');
  assert.equal(chatgpt.calls.length, 0);
  assert.equal(copilot.calls.length, 0);
  assert.equal(result.collaboration.cloudShared, false);
  assert.match(result.collaboration.summary, /izin berbagi belum diberikan/);
});

test('AUTO routes complex coding requests to Copilot and ChatGPT, then asks local model to synthesize', async () => {
  const local = fakeBridge({ responses: ['Draf awal lokal.', 'Jawaban final hasil sintesis.'] });
  const chatgpt = fakeBridge({ responses: ['ChatGPT menemukan satu risiko tambahan.'] });
  const copilot = fakeBridge({ responses: ['Copilot menyarankan pengujian regresi.'] });
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const result = await coordinator.run({
    mode: 'auto',
    allowCloud: true,
    message: 'Review dan perbaiki bug pada kode repository, lalu susun pengujian regresi.',
    history: [{ role: 'user', content: 'konteks percakapan sebelumnya' }],
    memoryContext: null
  });

  assert.equal(local.calls.length, 2);
  assert.equal(chatgpt.calls.length, 1);
  assert.equal(copilot.calls.length, 1);
  assert.equal(result.text, 'Jawaban final hasil sintesis.');
  assert.equal(result.collaboration.cloudShared, true);
  assert.equal(result.collaboration.synthesis, 'completed');
  assert.deepEqual(
    result.collaboration.participants.filter(item => item.status === 'completed').map(item => item.provider).sort(),
    ['alecore-local', 'chatgpt', 'copilot']
  );
  for (const call of [...chatgpt.calls, ...copilot.calls]) {
    assert.equal(call.history, undefined);
    assert.equal(call.memoryContext, undefined);
    assert.equal(call.image, undefined);
    assert.match(call.message, /DRAF AWAL ALECORE LOCAL/);
  }
});

test('FULL TEAM honors the cloud consent gate and reports unavailable providers honestly', async () => {
  const local = fakeBridge({ responses: ['Draf lokal.'] });
  const chatgpt = fakeBridge({ configured: false });
  const copilot = fakeBridge({ responses: ['Ulasan Copilot.'], failAsk: true });
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const blocked = await coordinator.run({
    mode: 'full-team',
    allowCloud: false,
    message: 'Buat analisis lengkap untuk proyek ini.'
  });
  assert.equal(chatgpt.calls.length, 0);
  assert.equal(copilot.calls.length, 0);
  assert.equal(blocked.collaboration.cloudShared, false);

  const permitted = await coordinator.run({
    mode: 'full-team',
    allowCloud: true,
    message: 'Buat analisis lengkap untuk proyek ini.'
  });
  assert.equal(chatgpt.calls.length, 0);
  assert.equal(copilot.calls.length, 1);
  assert.equal(permitted.collaboration.cloudShared, true);
  assert.match(permitted.collaboration.summary, /respons bisa berhasil atau gagal/);
  assert.ok(permitted.collaboration.participants.some(item =>
    item.provider === 'chatgpt' && item.status === 'unavailable'
  ));
  assert.ok(permitted.collaboration.participants.some(item =>
    item.provider === 'copilot' && item.status === 'failed'
  ));
  assert.equal(permitted.text, 'Draf lokal.');
});

test('LOCAL ONLY never checks or contacts cloud providers', async () => {
  const local = fakeBridge({ responses: ['Jawaban privat.'] });
  const chatgpt = fakeBridge();
  const copilot = fakeBridge();
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const result = await coordinator.run({
    mode: 'local-only',
    allowCloud: true,
    message: 'Analisis arsitektur dan keamanan.',
    memoryContext: null
  });

  assert.equal(result.text, 'Jawaban privat.');
  assert.equal(chatgpt.calls.length, 0);
  assert.equal(copilot.calls.length, 0);
  assert.equal(result.collaboration.cloudShared, false);
  assert.match(result.collaboration.summary, /tidak ada data yang dikirim/);
});

test('image attachments always remain local during collaboration', async () => {
  const local = fakeBridge({ responses: ['Saya memeriksa foto secara lokal.'] });
  const chatgpt = fakeBridge();
  const copilot = fakeBridge();
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const result = await coordinator.run({
    mode: 'full-team',
    allowCloud: true,
    message: 'Analisis gambar ini untuk audit visual.',
    image: 'data:image/jpeg;base64,QUJDRA=='
  });

  assert.equal(local.calls.length, 1);
  assert.equal(chatgpt.calls.length, 0);
  assert.equal(copilot.calls.length, 0);
  assert.equal(result.collaboration.cloudShared, false);
  assert.match(result.collaboration.summary, /foto tetap diproses lokal/);
});

test('local unavailability blocks collaboration instead of silently falling back to cloud', async () => {
  const local = fakeBridge({
    configured: false,
    statusResult: {
      configured: false,
      runtimeAvailable: false,
      modelAvailable: false
    }
  });
  const chatgpt = fakeBridge();
  const copilot = fakeBridge();
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  await assert.rejects(
    coordinator.run({
      mode: 'auto',
      allowCloud: true,
      message: 'Audit keamanan kode repository secara menyeluruh.'
    }),
    /tidak ada fallback otomatis ke cloud/
  );
  assert.equal(local.calls.length, 0);
  assert.equal(chatgpt.calls.length, 0);
  assert.equal(copilot.calls.length, 0);
});

test('manual mode uses only the provider explicitly selected by the user', async () => {
  const local = fakeBridge();
  const chatgpt = fakeBridge({ responses: ['Jawaban ChatGPT manual.'] });
  const copilot = fakeBridge();
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const result = await coordinator.run({
    mode: 'manual',
    provider: 'chatgpt',
    message: 'Jawab langsung.'
  });

  assert.equal(result.text, 'Jawaban ChatGPT manual.');
  assert.equal(local.calls.length, 0);
  assert.equal(chatgpt.calls.length, 1);
  assert.equal(copilot.calls.length, 0);
  assert.equal(result.collaboration.cloudShared, true);
});

test('manual cloud providers require explicit consent', async () => {
  const local = fakeBridge();
  const chatgpt = fakeBridge();
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt }
  });

  await assert.rejects(
    coordinator.run({
      mode: 'manual',
      provider: 'chatgpt',
      allowCloud: false,
      message: 'Jawab menggunakan ChatGPT.'
    }),
    /izin cloud untuk pesan ini belum diberikan/
  );
  assert.equal(chatgpt.calls.length, 0);
});

test('busy collaborators are reported unavailable rather than called concurrently', async () => {
  const local = fakeBridge();
  const chatgpt = fakeBridge({ configured: true, busy: true });
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt }
  });

  const result = await coordinator.run({
    mode: 'full-team',
    allowCloud: true,
    message: 'Buat analisis lengkap.'
  });

  assert.equal(chatgpt.calls.length, 0);
  assert.ok(result.collaboration.participants.some(item =>
    item.provider === 'chatgpt'
      && item.status === 'unavailable'
      && /sedang mengerjakan/.test(item.detail)
  ));
});

test('coordinator rejects overlapping conversation runs and releases its lock', async () => {
  let release;
  const local = {
    pending: false,
    async status() { return { configured: true }; },
    async ask() {
      return new Promise(resolve => { release = resolve; });
    }
  };
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local }
  });
  const first = coordinator.run({ mode: 'local-only', message: 'Analisis satu.' });
  await new Promise(resolve => setImmediate(resolve));

  await assert.rejects(
    coordinator.run({ mode: 'local-only', message: 'Analisis dua.' }),
    /Tunggu kolaborasi AleCore AI sebelumnya selesai/
  );

  release({ text: 'Selesai.' });
  const result = await first;
  assert.equal(result.text, 'Selesai.');
  assert.equal(coordinator.pending, false);
});

test('FULL TEAM includes the read-only Specialist Agent Hub through NARA', async () => {
  const local = fakeBridge({ responses: ['Draf lokal.', 'Jawaban final sintesis.'] });
  const chatgpt = fakeBridge({ configured: false });
  const copilot = fakeBridge({ configured: false });
  const calls = [];
  const agentHub = {
    pending: false,
    async projectRootReady() { return true; },
    async availableStructuredExecutors() { return ['codex', 'cursor']; },
    async run() { throw new Error('NARA coordinator should own the specialist run'); }
  };
  const agentCoordinator = {
    async run(value) {
      calls.push(value);
      return {
        text: 'Planner, Worker, dan Reviewer menemukan risiko dependensi.',
        stages: [
          { role: 'planner', agent: 'codex' },
          { role: 'worker', agent: 'cursor' },
          { role: 'reviewer', agent: 'claude' }
        ]
      };
    }
  };
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot },
    agentHub,
    agentCoordinator
  });

  const result = await coordinator.run({
    mode: 'full-team',
    allowCloud: true,
    message: 'Analisis arsitektur aplikasi dan risiko dependensi.',
    history: [{ role: 'user', content: 'KONTEKS RAHASIA JANGAN DITERUSKAN' }],
    memoryContext: null
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'humanale-orchestrator');
  assert.equal(calls[0].mode, 'analyze');
  assert.doesNotMatch(calls[0].prompt, /KONTEKS RAHASIA/);
  assert.equal(local.calls.length, 2);
  assert.ok(result.collaboration.participants.some(item =>
    item.provider === 'specialist-agents'
      && item.status === 'completed'
      && /Planner → Worker → Reviewer/.test(item.detail)
  ));
  assert.equal(result.text, 'Jawaban final sintesis.');
  assert.equal(result.collaboration.cloudShared, true);
});

test('Specialist Agent Hub stays unavailable until a Git checkout is selected', async () => {
  const local = fakeBridge({ responses: ['Draf lokal.'] });
  const agentHub = {
    pending: false,
    async projectRootReady() { return false; },
    async availableStructuredExecutors() { return ['codex']; },
    async run() { throw new Error('must not run without a checkout'); }
  };
  const agentCoordinator = {
    async run() { throw new Error('must not run without a checkout'); }
  };
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local },
    agentHub,
    agentCoordinator
  });

  const result = await coordinator.run({
    mode: 'full-team',
    allowCloud: true,
    message: 'Analisis arsitektur secara menyeluruh.'
  });

  assert.ok(result.collaboration.participants.some(item =>
    item.provider === 'specialist-agents'
      && item.status === 'unavailable'
      && /Pilih checkout Git/.test(item.detail)
  ));
});

test('complexity detection recognizes technical work but not a short greeting', () => {
  assert.equal(isComplexCollaborationRequest('Halo, apa kabar?'), false);
  assert.equal(isComplexCollaborationRequest('Tolong audit keamanan dan review arsitektur repository.'), true);
});


test('desktop UI and IPC are connected to the privacy-gated coordinator', async () => {
  const [main, preload, app, html] = await Promise.all([
    readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  ]);

  assert.match(main, /new AleCoreMultiAICoordinator\(\{bridges,agentHub,agentCoordinator:naraAgentCoordinator\}\)/);
  assert.match(main, /multiAiCoordinator\.run\(\{\.\.\.payload,mode:collaborationMode,allowCloud:value\?\.allowCloud===true\}\)/);
  assert.match(main, /provider!=='alecore-local'&&value\?\.allowCloud!==true/);
  assert.match(app, /collaborationMode==='local-only'\|\|!allowCloudForThisMessage/);
  assert.match(app, /data\.verified===true/);
  assert.match(app, /Tugas Developer Agent Hub/);
  assert.match(preload, /ask:payload=>ipcRenderer\.invoke\('dudidam:ask',payload\)/);
  assert.match(app, /desktop\.ask\(\{provider:aiProvider,collaborationMode,allowCloud:allowCloudForThisMessage/);
  assert.match(app, /if\(desktop&&collaborationMode!=='manual'\)aiProvider='alecore-local'/);
  assert.match(html, /id="collaborationMode"/);
  assert.match(html, /id="allowCloudCollaboration"/);
});


test('AUTO does not call Copilot until its login state is verified', async () => {
  const local = fakeBridge({ responses: ['Draf lokal.'] });
  const chatgpt = fakeBridge({ configured: false });
  const copilot = fakeBridge({ configured: true, verified: false });
  const coordinator = new AleCoreMultiAICoordinator({
    bridges: { 'alecore-local': local, chatgpt, copilot }
  });

  const result = await coordinator.run({
    mode: 'auto',
    allowCloud: true,
    message: 'Perbaiki bug dan review kode repository ini.'
  });

  assert.equal(copilot.calls.length, 0);
  assert.ok(result.collaboration.participants.some(item =>
    item.provider === 'copilot'
      && item.status === 'unavailable'
      && /belum terverifikasi/.test(item.detail)
  ));
});

test('Copilot login success is retained as a verified collaborator state', async () => {
  const bridge = new CopilotBridge({
    findExecutable: async () => 'copilot-test',
    runImpl: async (_executable, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? 'GitHub Copilot CLI test' : 'Login completed',
      stderr: ''
    })
  });

  const login = await bridge.login();
  const status = await bridge.status();
  assert.deepEqual(login, { ok: true });
  assert.equal(status.configured, true);
  assert.equal(status.installed, true);
  assert.equal(status.verified, true);
});
