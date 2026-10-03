import {writeFile, mkdir, appendFile, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function assertLoadedPage(state) {
  if (state.origin !== 'https://localhost' || state.platform !== 'android') throw new Error('Expected the APK native Android page at https://localhost');
  if (state.ready !== 'complete' || !state.avatar || !state.prompt || !state.chat || state.ownerGate || !state.sendEnabled) throw new Error(`HumanALE did not reach a usable page: ${JSON.stringify(state)}`);
}

export function assertNativeEvidence({process, foreground, crash}) {
  if (!/^[1-9][0-9]*(?:\s+[1-9][0-9]*)*$/.test(process.trim())) throw new Error('HumanALE native process is not alive');
  if (!/topResumedActivity=.*id\.my\.aleprinting\.humanale\/|mResumedActivity:.*id\.my\.aleprinting\.humanale\//.test(foreground)) throw new Error('HumanALE is not the foreground Android activity');
  if (/>>> id\.my\.aleprinting\.humanale <<<|Fatal signal.*\((inting\.humanale|CrRendererMain)\)|FATAL EXCEPTION/.test(crash)) throw new Error('Android application or WebView renderer crashed');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(read, accepts, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP connection timed out')); }, 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, {once: true});
  });
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  });
  ws.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('WebView CDP disconnected')); }
    pending.clear();
  });
  return {
    onEvent(listener) { listeners.push(listener); },
    close() { ws.close(); },
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP ${method} timed out`)); }, 10000);
        pending.set(requestId, {resolve, reject, timer});
        ws.send(JSON.stringify({id: requestId, method, params}));
      });
    }
  };
}

export async function runAndroidRuntimeSmoke(base, directory) {
  await mkdir(directory, {recursive: true});
  const report = {schema: 'humanale-android-ci-runtime/1', startedAt: new Date().toISOString(), checks: [], uncaughtErrors: [], localResourceErrors: [], physicalDeviceAcceptance: false};
  let cdp;
  const check = async (name, run) => {
    try { await run(); report.checks.push({name, status: 'passed'}); console.log(`PASS: ${name}`); }
    catch (error) { report.checks.push({name, status: 'failed', error: error.message}); throw error; }
  };
  try {
    const pages = await waitFor(async () => {
      try { const response = await fetch(`${base}/json`, {signal: AbortSignal.timeout(3000)}); return response.ok ? await response.json() : []; }
      catch { return []; }
    }, value => value.some(page => page.type === 'page' && page.url?.startsWith('https://localhost/') && page.webSocketDebuggerUrl), 'APK WebView CDP target');
    const page = pages.find(value => value.type === 'page' && value.url?.startsWith('https://localhost/') && value.webSocketDebuggerUrl);
    cdp = await connect(page.webSocketDebuggerUrl);
    const requests = new Map();
    cdp.onEvent(({method, params}) => {
      if (method === 'Runtime.exceptionThrown') report.uncaughtErrors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
      if (method === 'Network.requestWillBeSent') requests.set(params.requestId, params.request.url);
      if (method === 'Network.responseReceived' && params.response.url.startsWith('https://localhost/') && params.response.status >= 400) report.localResourceErrors.push({url: params.response.url, status: params.response.status});
      if (method === 'Network.loadingFailed' && requests.get(params.requestId)?.startsWith('https://localhost/') && !params.canceled) report.localResourceErrors.push({url: requests.get(params.requestId), error: params.errorText});
    });
    const evaluate = async expression => {
      const result = await cdp.call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const screenshot = async name => {
      const result = await cdp.call('Page.captureScreenshot', {format: 'png'});
      await writeFile(`${directory}/${name}.png`, Buffer.from(result.data, 'base64'));
    };
    const click = async selector => {
      const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing interaction target'); const r=e.getBoundingClientRect(); if(!r.width||!r.height)throw Error('Invisible interaction target'); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await cdp.call('Input.dispatchMouseEvent', {type: 'mousePressed', ...point, button: 'left', clickCount: 1});
      await cdp.call('Input.dispatchMouseEvent', {type: 'mouseReleased', ...point, button: 'left', clickCount: 1});
    };
    await cdp.call('Runtime.enable'); await cdp.call('Page.enable'); await cdp.call('Network.enable');
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', {source: `window.__androidRuntimeErrors=[]; window.addEventListener('error',e=>window.__androidRuntimeErrors.push(e.message)); window.addEventListener('unhandledrejection',e=>window.__androidRuntimeErrors.push(String(e.reason)));`});
    await cdp.call('Page.reload', {ignoreCache: true});
    const pageState = `(() => { const visible=e=>!!e && !e.hidden && !!e.getClientRects().length; const a=document.querySelector('#avatar'); return {origin:location.origin,platform:window.Capacitor?.getPlatform?.(),ready:document.readyState,avatar:!!a&&a.width>0&&a.height>0,prompt:visible(document.querySelector('#prompt')),chat:document.querySelector('#chatDialog')?.open===true,ownerGate:visible(document.querySelector('#ownerGate')),sendEnabled:document.querySelector('#send')?.disabled===false}; })()`;
    await check('APK native page, avatar canvas and conversation loaded', async () => {
      report.page = await waitFor(async () => {
        try { return await evaluate(pageState); }
        catch (error) {
          if (/Execution context was destroyed|Cannot find context with specified id/i.test(error.message)) return null;
          throw error;
        }
      }, state => {
        try { assertLoadedPage(state); return true; } catch { return false; }
      }, 'usable HumanALE page');
      await screenshot('loaded');
    });
    await check('Settings opens and closes through browser input', async () => {
      await click('#conversationSettings');
      await waitFor(() => evaluate(`document.querySelector('#controls')?.open`), value => value === true, 'settings dialog');
      await screenshot('settings');
      await click('#controls [data-close]');
      await waitFor(() => evaluate(`document.querySelector('#controls')?.open`), value => value === false, 'closed settings');
    });
    await check('Local command produces an actual assistant response', async () => {
      await click('#prompt'); await cdp.call('Input.insertText', {text: 'bantuan'}); await click('#send');
      report.response = await waitFor(() => evaluate(`({user:document.querySelector('#messages .user p')?.textContent,assistant:document.querySelector('#messages .assistant p')?.textContent,prompt:document.querySelector('#prompt')?.value,sendEnabled:document.querySelector('#send')?.disabled===false})`), value => value.user === 'bantuan' && value.assistant?.includes('berkedip') && value.prompt === '' && value.sendEnabled, 'local command response');
      await screenshot('interaction');
    });
    await check('No uncaught JavaScript errors or failed local resources', async () => {
      report.windowErrors = await evaluate('window.__androidRuntimeErrors || []');
      if (report.uncaughtErrors.length || report.windowErrors.length || report.localResourceErrors.length) throw new Error('WebView errors: ' + JSON.stringify({uncaught: report.uncaughtErrors, window: report.windowErrors, resources: report.localResourceErrors}));
    });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    console.error(`FAIL: Android WebView runtime: ${error.message}`);
  } finally {
    cdp?.close(); report.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/webview-report.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\nAndroid WebView runtime: **${report.status}** (KVM emulator; physical-device acceptance pending).\n\n${report.checks.map(value => `- ${value.status}: ${value.name}`).join('\n')}\n${report.error ? `\nFailure: ${report.error.replaceAll('\n', ' ')}\n` : ''}`);
  }
  if (report.status !== 'passed') throw new Error(report.error);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: runtime-smoke.mjs CDP_BASE_URL EVIDENCE_DIRECTORY');
  if (process.argv[2] === '--native') {
    const directory = process.argv[3];
    const [processText, foreground, crash] = await Promise.all(['process.txt', 'foreground.txt', 'crash.txt'].map(name => readFile(`${directory}/${name}`, 'utf8')));
    assertNativeEvidence({process: processText, foreground, crash});
    console.log('PASS: native HumanALE process alive in foreground without app or renderer crashes');
  } else await runAndroidRuntimeSmoke(process.argv[2], process.argv[3]);
}
