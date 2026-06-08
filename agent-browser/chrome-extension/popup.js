async function loadStatus() {
  const title = document.getElementById('title');
  const detail = document.getElementById('detail');
  const nextStep = document.getElementById('next-step');
  const bridgeUrl = document.getElementById('bridge-url');
  const tabCount = document.getElementById('tab-count');
  const tabsWrap = document.getElementById('tabs');
  const dot = document.getElementById('dot');

  try {
    const resp = await chrome.runtime.sendMessage({ cmd: 'bridge', method: 'status' });
    if (!resp?.ok) throw new Error(resp?.error || 'Unknown bridge status error');
    const status = resp.data || {};

    title.textContent = status.title || 'Pi Agent Browser Bridge';
    detail.textContent = status.detail || 'No detail available.';
    nextStep.textContent = status.nextStep || 'No next step available.';
    bridgeUrl.textContent = status.wsUrl || 'ws://127.0.0.1:18765';

    const tabs = Array.isArray(status.tabs) ? status.tabs : [];
    tabCount.textContent = String(tabs.length);

    dot.className = 'dot';
    if (status.code === 'connected') dot.classList.add('connected');
    else if (status.code === 'connecting') dot.classList.add('connecting');
    else if (status.code === 'no-tabs' || status.code === 'bridge-up-ws-down') dot.classList.add('warning');
    else dot.classList.add('error');

    if (tabs.length > 0) {
      tabsWrap.hidden = false;
      tabsWrap.innerHTML = tabs.map((tab) => {
        const title = escapeHtml(tab.title || '(untitled tab)');
        const url = escapeHtml(tab.url || '');
        return `
          <div class="tab">
            <div class="tab-title">${title}${tab.active ? ' · active' : ''}</div>
            <div class="tab-url">${url}</div>
          </div>
        `;
      }).join('');
    } else {
      tabsWrap.hidden = true;
      tabsWrap.innerHTML = '';
    }
  } catch (error) {
    title.textContent = 'Pi Agent Browser Bridge';
    detail.textContent = error instanceof Error ? error.message : String(error);
    nextStep.textContent = 'Reload the extension or run /browser-doctor in Pi.';
    bridgeUrl.textContent = 'ws://127.0.0.1:18765';
    tabCount.textContent = '0';
    tabsWrap.hidden = true;
    tabsWrap.innerHTML = '';
    dot.className = 'dot error';
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

void loadStatus();
