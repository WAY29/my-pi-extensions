chrome.runtime.onInstalled.addListener(() => {
  console.log('Pi Agent Browser Bridge installed');
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [9999],
    addRules: [{
      id: 9999,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'content-security-policy-report-only', operation: 'remove' }
        ]
      },
      condition: { urlFilter: '*', resourceTypes: ['main_frame', 'sub_frame'] }
    }]
  });
});

const isScriptable = (url) => url && /^https?:/i.test(url);
let ws = null;
const WS_URL = typeof PI_AGENT_BROWSER_WS_URL === 'string' ? PI_AGENT_BROWSER_WS_URL : 'ws://127.0.0.1:18765';
let lastProbeOk = false;
let lastStatus = {
  code: 'disconnected',
  shortText: 'x',
  color: '#b71c1c',
  title: 'Pi Agent Browser Bridge: bridge not started',
  detail: 'Bridge not started',
  nextStep: 'Run /browser-on or /browser-doctor in Pi, then reload a normal http/https page if needed.',
  tabs: 0,
};

function setLastStatus(status) {
  lastStatus = status;
}

function buildStatus({ probeOk, wsState, tabs }) {
  const tabCount = Array.isArray(tabs) ? tabs.length : 0;
  if (probeOk && wsState === WebSocket.OPEN && tabCount > 0) {
    return {
      code: 'connected',
      shortText: '√',
      color: '#2e7d32',
      title: `Pi Agent Browser Bridge: connected (${tabCount} tab${tabCount === 1 ? '' : 's'})`,
      detail: `Connected to Pi bridge with ${tabCount} normal tab${tabCount === 1 ? '' : 's'}.`,
      nextStep: 'Browser tools should be ready in Pi.',
      tabs: tabCount,
    };
  }
  if (probeOk && (wsState === WebSocket.CONNECTING)) {
    return {
      code: 'connecting',
      shortText: '…',
      color: '#1565c0',
      title: 'Pi Agent Browser Bridge: bridge detected, connecting WebSocket',
      detail: 'Pi bridge is up; WebSocket is connecting.',
      nextStep: 'Wait a moment. If this stays stuck, reload the extension or run /browser-doctor in Pi.',
      tabs: tabCount,
    };
  }
  if (probeOk && wsState === WebSocket.OPEN) {
    return {
      code: 'no-tabs',
      shortText: '!',
      color: '#f9a825',
      title: 'Pi Agent Browser Bridge: connected, but no normal http/https page is open',
      detail: 'Bridge is connected, but no scriptable http/https tab is available.',
      nextStep: 'Open or refresh a normal http/https page in Chrome.',
      tabs: tabCount,
    };
  }
  if (probeOk) {
    return {
      code: 'bridge-up-ws-down',
      shortText: '!',
      color: '#ef6c00',
      title: 'Pi Agent Browser Bridge: bridge is up, but WebSocket is not connected',
      detail: 'Pi bridge responded, but the extension is not connected over WebSocket yet.',
      nextStep: 'Wait for auto-reconnect, or reload the extension and run /browser-doctor in Pi.',
      tabs: tabCount,
    };
  }
  return {
    code: 'bridge-offline',
    shortText: 'x',
    color: '#b71c1c',
    title: 'Pi Agent Browser Bridge: bridge not started',
    detail: 'Pi bridge is not reachable on localhost.',
    nextStep: 'Run /browser-on or /browser-doctor in Pi to start the local bridge.',
    tabs: tabCount,
  };
}

async function updateBadge() {
  try {
    const tabs = await listTabs();
    const wsState = ws ? ws.readyState : WebSocket.CLOSED;
    const status = buildStatus({ probeOk: lastProbeOk, wsState, tabs });
    setLastStatus(status);
    await chrome.action.setBadgeText({ text: status.shortText });
    await chrome.action.setBadgeBackgroundColor({ color: status.color });
    await chrome.action.setTitle({ title: status.title });
  } catch (_) {
    const status = buildStatus({ probeOk: false, wsState: WebSocket.CLOSED, tabs: [] });
    setLastStatus(status);
    try {
      await chrome.action.setBadgeText({ text: status.shortText });
      await chrome.action.setBadgeBackgroundColor({ color: status.color });
      await chrome.action.setTitle({ title: status.title });
    } catch (_) {}
  }
}

async function listTabs() {
  const tabs = (await chrome.tabs.query({})).filter(t => isScriptable(t.url));
  return tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId }));
}

async function handleCookies(msg, sender) {
  try {
    let url = msg.url || sender.tab?.url;
    if (!url && msg.tabId) {
      const tab = await chrome.tabs.get(msg.tabId);
      url = tab.url;
    }
    if (!url) return { ok: false, error: 'no url' };
    const origin = url.match(/^https?:\/\/[^\/]+/)[0];
    const all = await chrome.cookies.getAll({ url });
    const part = await chrome.cookies.getAll({ url, partitionKey: { topLevelSite: origin } }).catch(() => []);
    const merged = [...all];
    for (const c of part) {
      if (!merged.some(x => x.name === c.name && x.domain === c.domain)) merged.push(c);
    }
    return { ok: true, data: merged };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleCDP(msg, sender) {
  const tabId = msg.tabId || sender.tab?.id;
  if (!tabId) return { ok: false, error: 'no tabId' };
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    const result = await chrome.debugger.sendCommand({ tabId }, msg.method, msg.params || {});
    await chrome.debugger.detach({ tabId });
    return { ok: true, data: result };
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    return { ok: false, error: e.message };
  }
}

async function handleBatch(msg, sender) {
  const R = [];
  let attached = null;
  try {
    for (const c of msg.commands || []) {
      if (c.tabId === undefined && msg.tabId !== undefined) c.tabId = msg.tabId;
      if (c.cmd === 'cookies') {
        R.push(await handleCookies(c, sender));
      } else if (c.cmd === 'tabs') {
        R.push({ ok: true, data: await listTabs() });
      } else if (c.cmd === 'cdp') {
        const tabId = c.tabId || msg.tabId || sender.tab?.id;
        if (!tabId) throw new Error('no tabId');
        if (attached !== tabId) {
          if (attached) { await chrome.debugger.detach({ tabId: attached }); attached = null; }
          await chrome.debugger.attach({ tabId }, '1.3');
          attached = tabId;
        }
        R.push(await chrome.debugger.sendCommand({ tabId }, c.method, c.params || {}));
      } else {
        R.push({ ok: false, error: 'unknown cmd: ' + c.cmd });
      }
    }
    if (attached) await chrome.debugger.detach({ tabId: attached });
    return { ok: true, results: R };
  } catch (e) {
    if (attached) try { await chrome.debugger.detach({ tabId: attached }); } catch (_) {}
    return { ok: false, error: e.message, results: R };
  }
}

async function handleExtMessage(msg, sender) {
  if (msg.cmd === 'cookies') return await handleCookies(msg, sender);
  if (msg.cmd === 'cdp') return await handleCDP(msg, sender);
  if (msg.cmd === 'batch') return await handleBatch(msg, sender);
  if (msg.cmd === 'tabs') {
    try {
      if (msg.method === 'switch') {
        const tab = await chrome.tabs.update(msg.tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return { ok: true };
      }
      return { ok: true, data: await listTabs() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  if (msg.cmd === 'management') {
    try {
      if (msg.method === 'list') {
        const all = await chrome.management.getAll();
        return { ok: true, data: all.map(e => ({ id: e.id, name: e.name, enabled: e.enabled, type: e.type, version: e.version })) };
      }
      return { ok: false, error: 'unknown management method: ' + msg.method };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  if (msg.cmd === 'bridge' && msg.method === 'status') {
    try {
      const tabs = await listTabs();
      const wsState = ws ? ws.readyState : WebSocket.CLOSED;
      const status = buildStatus({ probeOk: lastProbeOk, wsState, tabs });
      setLastStatus(status);
      return {
        ok: true,
        data: {
          ...status,
          wsUrl: WS_URL,
          wsState,
          probeOk: lastProbeOk,
          tabs,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'unknown cmd: ' + msg.cmd };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleExtMessage(msg, sender).then(sendResponse);
  return true;
});

updateBadge();

function scheduleProbe() {
  chrome.alarms.create('pi-agent-browser-probe', { delayInMinutes: 0.083 });
}

function scheduleKeepalive() {
  chrome.alarms.create('pi-agent-browser-keepalive', { delayInMinutes: 0.4 });
}

async function isServerAlive() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 2000);
    const response = await fetch('http://127.0.0.1:18766/status', { signal: ctrl.signal });
    if (!response.ok) {
      lastProbeOk = false;
      return false;
    }
    const payload = await response.json();
    lastProbeOk = payload?.ok === true && payload?.bridge === 'pi-agent-browser';
    return lastProbeOk;
  } catch (e) {
    lastProbeOk = false;
    return false;
  }
}

async function sendTabsUpdate() {
  await updateBadge();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'tabs_update', tabs: await listTabs() }));
}

function buildExecScript(code, errorHandler) {
  return `(async () => {
    function smartProcessResult(result) {
      if (result === null || result === undefined || typeof result !== 'object') return result;
      try { if (result.window === result && result.document) return '[Window: ' + (result.location?.href || 'about:blank') + ']'; } catch(_){ }
      if (typeof jQuery !== 'undefined' && result instanceof jQuery) {
        const elements = []; for (let i = 0; i < result.length; i++) { if (result[i] && result[i].nodeType === 1) elements.push(result[i].outerHTML); } return elements;
      }
      if (result instanceof NodeList || result instanceof HTMLCollection) {
        const elements = []; for (let i = 0; i < result.length; i++) { if (result[i] && result[i].nodeType === 1) elements.push(result[i].outerHTML); } return elements;
      }
      if (result.nodeType === 1) return result.outerHTML;
      if (!Array.isArray(result) && typeof result === 'object' && 'length' in result && typeof result.length === 'number') {
        const firstElement = result[0];
        if (firstElement && firstElement.nodeType === 1) {
          const elements = []; const length = Math.min(result.length, 100);
          for (let i = 0; i < length; i++) { const elem = result[i]; if (elem && elem.nodeType === 1) elements.push(elem.outerHTML); } return elements;
        }
      }
      try { return JSON.parse(JSON.stringify(result, function(key, value) { if (typeof value === 'object' && value !== null) { if (value.nodeType === 1) return value.outerHTML; if (value === window || value === document) return '[Object]'; try { if (value.window === value && value.document) return '[Window]'; } catch(_){} } return value; })); } catch (e) { return '[无法序列化: ' + e.message + ']'; }
    }
    try {
      const jsCode = ${JSON.stringify(code)}.trim();
      const lines = jsCode.split(/\\r?\\n/).filter(l => l.trim());
      const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      let r;
      function _air(c) { const ls = c.split(/\\r?\\n/); let i = ls.length - 1; while (i >= 0 && !ls[i].trim()) i--; if (i < 0) return c; const t = ls[i].trim(); if (/^(return |return;|return$|let |const |var |if |if\\(|for |for\\(|while |while\\(|switch|try |throw |class |function |async |import |export |\\/\\/|})/.test(t)) return c; ls[i] = ls[i].match(/^(\\s*)/)[1] + 'return ' + t; return ls.join('\\n'); }
      if (lastLine.startsWith('return')) {
        r = await (new AsyncFunction(jsCode))();
      } else {
        try { r = eval(jsCode); if (r instanceof Promise) r = await r; } catch (e) {
          if (e instanceof SyntaxError && (/return/i.test(e.message) || /await/i.test(e.message))) { r = await (new AsyncFunction(_air(jsCode)))(); } else throw e;
        }
      }
      return { ok: true, data: smartProcessResult(r) };
    } catch (e) {
      ${errorHandler}
    }
  })()`;
}

function buildPageScript(code) {
  return buildExecScript(code, `
      const errMsg = e.message || String(e);
      return { ok: false, error: { name: e.name || 'Error', message: errMsg, stack: e.stack || '' },
        csp: errMsg.includes('Refused to evaluate') || errMsg.includes('unsafe-eval') || errMsg.includes('Content Security Policy') };
  `);
}

function buildCdpScript(code) {
  return buildExecScript(code, `
      return { ok: false, error: { name: e.name || 'Error', message: e.message || String(e), stack: e.stack || '' } };
  `);
}

async function handleWsExec(data) {
  const tabId = data.tabId;
  ws.send(JSON.stringify({ type: 'ack', id: data.id }));
  if (!tabId) {
    ws.send(JSON.stringify({ type: 'error', id: data.id, error: 'No tabId provided' }));
    return;
  }
  try {
    let res;
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (s) => await eval(s),
        args: [buildPageScript(String(data.code || ''))]
      });
      res = result?.[0]?.result;
      if (res === null || res === undefined) {
        res = { ok: false, error: { name: 'Error', message: 'executeScript returned null (possible CSP or context issue)', stack: '' }, csp: true };
      }
    } catch (e) {
      res = { ok: false, error: { name: e.name || 'Error', message: e.message || String(e), stack: e.stack || '' }, csp: true };
    }
    if (res && !res.ok && res.csp) {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
        const cdpRes = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: buildCdpScript(String(data.code || '')),
          awaitPromise: true,
          returnByValue: true,
        });
        await chrome.debugger.detach({ tabId });
        if (cdpRes.exceptionDetails) {
          const desc = cdpRes.exceptionDetails.exception?.description || 'CDP Error';
          res = { ok: false, error: { name: 'Error', message: desc, stack: desc } };
        } else {
          res = cdpRes.result.value;
        }
      } catch (cdpErr) {
        try { await chrome.debugger.detach({ tabId }); } catch (_) {}
        res = { ok: false, error: { name: 'Error', message: 'CDP fallback failed: ' + cdpErr.message, stack: '' } };
      }
    }
    if (res?.ok) {
      ws.send(JSON.stringify({ type: 'result', id: data.id, result: res.data }));
    } else {
      ws.send(JSON.stringify({ type: 'error', id: data.id, error: res?.error || 'Unknown error' }));
    }
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', id: data.id, error: { name: e.name || 'Error', message: e.message || String(e), stack: e.stack || '' } }));
  }
}

function connectWS() {
  if (ws && ws.readyState <= 1) return;
  ws = null;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleProbe();
    return;
  }
  ws.onopen = async () => {
    lastProbeOk = true;
    scheduleKeepalive();
    await updateBadge();
    ws.send(JSON.stringify({ type: 'ext_ready', tabs: await listTabs() }));
  };
  ws.onerror = () => {
    // Avoid noisy cascading failures in the extension worker. We still rely on
    // onclose + probe retries for recovery.
  };
  ws.onmessage = async (event) => {
    try {
      await updateBadge();
      const data = JSON.parse(event.data);
      if (!(data && data.id)) return;
      let code = data.code;
      if (typeof code === 'string') {
        try { const p = JSON.parse(code); if (p && typeof p === 'object') code = p; } catch (_) {}
      }
      if (typeof code === 'object' && code !== null && code.cmd) {
        if (code.tabId === undefined && data.tabId !== undefined) code.tabId = data.tabId;
        const res = await handleExtMessage(code, {});
        ws.send(JSON.stringify({ type: res.ok ? 'result' : 'error', id: data.id, result: res.data ?? res.results ?? res, error: res.error }));
        return;
      }
      await handleWsExec(data);
    } catch (e) {
      console.error('[Pi Agent Browser] ws message error', e);
    }
  };
  ws.onclose = () => {
    ws = null;
    void updateBadge();
    scheduleProbe();
  };
}

async function bootstrapConnection() {
  await updateBadge();
  if (ws && ws.readyState <= 1) return;
  if (await isServerAlive()) connectWS();
  else scheduleProbe();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'pi-agent-browser-keepalive') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send('{"type":"ping"}'); } catch (_) {}
      updateBadge();
      scheduleKeepalive();
    } else {
      ws = null;
      updateBadge();
      scheduleProbe();
    }
    return;
  }
  if (alarm.name === 'pi-agent-browser-probe') {
    if (ws && ws.readyState <= 1) return;
    if (await isServerAlive()) connectWS();
    else scheduleProbe();
  }
});

void bootstrapConnection();
chrome.runtime.onStartup.addListener(() => { void bootstrapConnection(); });
chrome.runtime.onInstalled.addListener(() => { void bootstrapConnection(); });
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.status === 'complete') sendTabsUpdate(); });
chrome.tabs.onRemoved.addListener(() => sendTabsUpdate());
chrome.tabs.onCreated.addListener(() => sendTabsUpdate());
