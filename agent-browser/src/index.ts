import { execFile as execFileCb } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import WebSocket, { WebSocketServer } from 'ws';
import type { ExtensionAPI, ExtensionContext, ToolExecutionMode } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Text } from '@earendil-works/pi-tui';
import { applyCutList, buildFindMainListScript, buildOptHtmlScript, normalizeTextOnlyOutput, postProcessScannedHtml } from './simphtml.js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const chromeExtensionDir = join(packageDir, 'chrome-extension');
const skillDir = join(packageDir, 'skills', 'agent-browser');
const skillFile = join(skillDir, 'SKILL.md');
const WS_PORT = Number(process.env.PI_AGENT_BROWSER_PORT || 18765);
const HTTP_PORT = WS_PORT + 1;
const execFile = promisify(execFileCb);

const TOOL_NAMES = [
  'browser_status',
  'browser_list_tabs',
  'browser_switch_tab',
  'browser_open_url',
  'browser_open_new_tab',
  'browser_scan_page',
  'browser_execute_js',
  'browser_cdp_command',
  'browser_cdp_batch',
  'browser_get_cookies',
  'browser_capture_page_screenshot',
] as const;

interface TabInfo {
  id: string;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
  connected_at?: number;
  type?: 'ext_ws';
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface BrowserState {
  armed: boolean;
}

interface BrowserTreeMeta {
  groupId: number;
  isFirst: boolean;
  isLast: boolean;
  invalidate?: () => void;
}

interface PortOccupant {
  port: number;
  pid?: number;
  name?: string;
  command?: string;
  source: 'lsof' | 'netstat' | 'unknown';
}

class BrowserBridge {
  private readonly tabs = new Map<string, TabInfo>();
  private readonly socketsByTab = new Map<string, any>();
  private readonly pending = new Map<string, PendingRequest>();
  private wsServer?: any;
  private httpServer?: ReturnType<typeof createServer>;
  private startPromise?: Promise<void>;
  private remoteMode = false;

  async ensureStarted() {
    if (this.wsServer || this.httpServer || this.remoteMode) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.ensureStartedInner().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async ensureStartedInner() {
    if (await this.probeRemoteBridge()) {
      this.remoteMode = true;
      return;
    }

    const occupied = await this.getNonBridgeOccupiedPorts([WS_PORT, HTTP_PORT]);
    if (occupied.length > 0) {
      throw new Error(this.formatPortOccupationError(occupied));
    }

    this.startWs();
    this.startHttp();
    this.remoteMode = false;
  }

  extensionPath() {
    return chromeExtensionDir;
  }

  stop() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('bridge stopped'));
    }
    this.pending.clear();
    this.socketsByTab.clear();
    this.tabs.clear();
    this.wsServer?.close();
    this.httpServer?.close();
    this.wsServer = undefined;
    this.httpServer = undefined;
  }

  async getStatus() {
    await this.ensureStarted();
    if (this.remoteMode) {
      const status = await this.remoteRpc('get_status', {}) as any;
      return { ...status, bridge_mode: 'shared' as const };
    }
    return { ...this.getLocalStatus(), bridge_mode: 'local' as const };
  }

  private getLocalStatus() {
    const tabs = this.getLocalTabs();
    return {
      extension_name: 'Pi Agent Browser Bridge',
      extension_path: this.extensionPath(),
      ws_port: WS_PORT,
      http_port: HTTP_PORT,
      connected_tabs: tabs.length,
      tabs,
      notes: [
        'Load the unpacked extension from extension_path in chrome://extensions with Developer Mode enabled.',
        'Keep a normal http/https page open in Chrome; about:blank is not enough.',
        'Run /browser-on in the session before asking the model to use browser tools.'
      ]
    };
  }

  async getTabs() {
    await this.ensureStarted();
    if (this.remoteMode) {
      const remote = await this.remoteRpc('list_tabs', {}) as any;
      return Array.isArray(remote?.tabs) ? remote.tabs : [];
    }
    return this.getLocalTabs();
  }

  private getLocalTabs() {
    return Array.from(this.tabs.values()).sort((a, b) => Number(b.connected_at || 0) - Number(a.connected_at || 0));
  }

  hasTab(tabId?: string | null) {
    if (!tabId) return false;
    return this.tabs.has(String(tabId));
  }

  private defaultLocalTabId() {
    const tabs = this.getLocalTabs();
    const active = tabs.find((tab) => tab.active);
    return active?.id ?? tabs[0]?.id;
  }

  private resolveLocalTabId(sessionId?: string, tabId?: number) {
    if (sessionId) return String(sessionId);
    if (tabId !== undefined) return String(tabId);
    const current = this.defaultLocalTabId();
    if (!current) throw new Error('No connected browser tabs. Load the Chrome extension and open a normal page.');
    return current;
  }

  private findLocalTabByPattern(pattern?: string) {
    if (!pattern) return undefined;
    return this.getLocalTabs().find((tab) => (tab.url || '').includes(pattern) || (tab.title || '').includes(pattern));
  }

  async sendRaw(tabId: string, code: string | Record<string, unknown>, timeoutMs = 15_000): Promise<any> {
    const socket = this.socketsByTab.get(tabId);
    if (!socket || socket.readyState !== socket.OPEN) {
      throw new Error(`Tab ${tabId} is not connected`);
    }
    const id = randomUUID();
    const payload = typeof code === 'string'
      ? { id, tabId: Number(tabId), code }
      : { id, tabId: Number(tabId), code: JSON.stringify(code) };

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for browser response (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify(payload), (error?: Error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private async executeJsLocal(args: { session_id?: string; script: string; timeout_ms?: number }) {
    const tabId = this.resolveLocalTabId(args.session_id);
    const result = await this.sendRaw(tabId, args.script, args.timeout_ms ?? 15_000);
    return { active_session_id: tabId, ...normalizeWsResult(result) };
  }

  async executeJs(args: { session_id?: string; script: string; timeout_ms?: number }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('execute_js', args);
    return await this.executeJsLocal(args);
  }

  private async cdpCommandLocal(args: { method: string; params_json?: string; session_id?: string; tab_id?: number }) {
    const tabId = this.resolveLocalTabId(args.session_id, args.tab_id);
    const params = JSON.parse(args.params_json || '{}');
    const result = await this.sendRaw(tabId, { cmd: 'cdp', method: args.method, params, tabId: Number(tabId) }, 20_000);
    return { active_session_id: tabId, data: result };
  }

  async cdpCommand(args: { method: string; params_json?: string; session_id?: string; tab_id?: number }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('cdp_command', args);
    return await this.cdpCommandLocal(args);
  }

  private async cdpBatchLocal(args: { batch_json: string; session_id?: string }) {
    const payload = JSON.parse(args.batch_json || '{}');
    if (payload.cmd !== 'batch') throw new Error("batch_json must be a JSON object with cmd='batch'");
    const tabId = this.resolveLocalTabId(args.session_id, payload.tabId);
    const result = await this.sendRaw(tabId, { ...payload, tabId: payload.tabId ?? Number(tabId) }, 30_000);
    return { active_session_id: tabId, data: result };
  }

  async cdpBatch(args: { batch_json: string; session_id?: string }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('cdp_batch', args);
    return await this.cdpBatchLocal(args);
  }

  private async getCookiesLocal(args: { session_id?: string; tab_id?: number }) {
    const tabId = this.resolveLocalTabId(args.session_id, args.tab_id);
    const result = await this.sendRaw(tabId, { cmd: 'cookies', tabId: Number(tabId) }, 15_000);
    return { active_session_id: tabId, cookies: result };
  }

  async getCookies(args: { session_id?: string; tab_id?: number }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('get_cookies', args);
    return await this.getCookiesLocal(args);
  }

  private async listExtensionsLocal(args: { session_id?: string }) {
    const tabId = this.resolveLocalTabId(args.session_id);
    const result = await this.sendRaw(tabId, { cmd: 'management', method: 'list', tabId: Number(tabId) }, 20_000);
    return { active_session_id: tabId, extensions: result };
  }

  async listExtensions(args: { session_id?: string }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('list_extensions', args);
    return await this.listExtensionsLocal(args);
  }

  private async switchTabLocal(args: { session_id?: string; url_pattern?: string }) {
    let tab = args.session_id ? this.tabs.get(String(args.session_id)) : undefined;
    if (!tab && args.url_pattern) tab = this.findLocalTabByPattern(args.url_pattern);
    if (!tab) throw new Error('Target tab not found');
    await this.sendRaw(String(tab.id), { cmd: 'tabs', method: 'switch', tabId: Number(tab.id) }, 10_000);
    return { active_session_id: String(tab.id), tabs: this.getLocalTabs() };
  }

  async switchTab(args: { session_id?: string; url_pattern?: string }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('switch_tab', args);
    return await this.switchTabLocal(args);
  }

  private async openUrlLocal(args: { url: string; session_id?: string; timeout_ms?: number }) {
    const tabId = this.resolveLocalTabId(args.session_id);
    const code = `window.location.href = ${JSON.stringify(args.url)};`;
    await this.sendRaw(tabId, code, args.timeout_ms ?? 15_000).catch(() => undefined);
    return { status: 'ok', active_session_id: tabId, url: args.url };
  }

  async openUrl(args: { url: string; session_id?: string; timeout_ms?: number }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('open_url', args);
    return await this.openUrlLocal(args);
  }

  private async openNewTabLocal(args: { url: string }) {
    const code = `window.open(${JSON.stringify(args.url)}, '_blank'); true;`;
    const tabId = this.defaultLocalTabId();
    if (!tabId) throw new Error('No connected browser tabs. Load the Chrome extension and open a normal page.');
    await this.sendRaw(tabId, code, 10_000).catch(() => undefined);
    return { status: 'ok', url: args.url, tabs: this.getLocalTabs() };
  }

  async openNewTab(args: { url: string }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('open_new_tab', args);
    return await this.openNewTabLocal(args);
  }

  private async capturePageScreenshotLocal(args: { session_id?: string; tab_id?: number; format?: string; save_path?: string }) {
    const tabId = this.resolveLocalTabId(args.session_id, args.tab_id);
    const result = await this.sendRaw(tabId, {
      cmd: 'cdp',
      method: 'Page.captureScreenshot',
      params: { format: args.format || 'png' },
      tabId: Number(tabId),
    }, 20_000);
    return { active_session_id: tabId, format: args.format || 'png', data: result, save_path: args.save_path || '' };
  }

  async capturePageScreenshot(args: { session_id?: string; tab_id?: number; format?: string; save_path?: string }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('capture_page_screenshot', args);
    return await this.capturePageScreenshotLocal(args);
  }

  private async scanPageLocal(args: { session_id?: string; text_only?: boolean; cutlist?: boolean; maxchars?: number; instruction?: string; extra_js?: string }) {
    const tabId = this.resolveLocalTabId(args.session_id);
    const maxchars = args.maxchars ?? 35000;
    let lists: unknown[] = [];
    if (!args.text_only && args.cutlist !== false) {
      try {
        const listResult = await this.sendRaw(tabId, buildFindMainListScript(), 20_000);
        lists = Array.isArray(listResult) ? listResult : [];
      } catch {
        lists = [];
      }
    }
    const raw = await this.sendRaw(tabId, buildOptHtmlScript({ textOnly: Boolean(args.text_only), extraJs: args.extra_js }), 25_000);
    if (typeof raw !== 'string') {
      return { status: 'success', active_session_id: tabId, tabs: this.getLocalTabs(), content: JSON.stringify(raw) };
    }
    if (args.text_only) {
      return { status: 'success', active_session_id: tabId, tabs: this.getLocalTabs(), content: normalizeTextOnlyOutput(raw) };
    }
    let content = postProcessScannedHtml(raw, {
      textOnly: false,
      cutlist: args.cutlist !== false,
      maxchars,
      instruction: args.instruction,
      extraJs: args.extra_js,
    });
    if (args.cutlist !== false) {
      content = applyCutList(content, lists, args.instruction, maxchars);
    }
    return { status: 'success', active_session_id: tabId, tabs: this.getLocalTabs(), content };
  }

  async scanPage(args: { session_id?: string; text_only?: boolean; cutlist?: boolean; maxchars?: number; instruction?: string; extra_js?: string }) {
    await this.ensureStarted();
    if (this.remoteMode) return await this.remoteRpc('scan_page', args);
    return await this.scanPageLocal(args);
  }

  private async isPortOpen(port: number): Promise<boolean> {
    return await new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const done = (open: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(open);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(800, () => done(false));
    });
  }

  private async getNonBridgeOccupiedPorts(ports: number[]): Promise<PortOccupant[]> {
    const occupied: PortOccupant[] = [];
    for (const port of ports) {
      if (!(await this.isPortOpen(port))) continue;
      const occupant = await this.detectPortOccupant(port);
      occupied.push(occupant ?? { port, source: 'unknown' });
    }
    return occupied;
  }

  private async detectPortOccupant(port: number): Promise<PortOccupant | null> {
    const lsof = await this.detectWithLsof(port);
    if (lsof) return lsof;
    return null;
  }

  private async detectWithLsof(port: number): Promise<PortOccupant | null> {
    try {
      const { stdout } = await execFile('/usr/sbin/lsof', ['-nP', '-iTCP:' + String(port), '-sTCP:LISTEN', '-Fpct']);
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      let pid: number | undefined;
      let name: string | undefined;
      let command: string | undefined;
      for (const line of lines) {
        const prefix = line[0];
        const value = line.slice(1);
        if (prefix === 'p' && !pid) pid = Number(value) || undefined;
        if (prefix === 'c' && !name) name = value || undefined;
        if (prefix === 't' && !command) command = value || undefined;
      }
      return { port, pid, name, command, source: 'lsof' };
    } catch {
      return null;
    }
  }

  private formatPortOccupationError(occupied: PortOccupant[]): string {
    const lines = ['Browser bridge ports are already in use by a non-compatible process:'];
    for (const item of occupied) {
      const pid = item.pid ? `pid=${item.pid}` : 'pid=unknown';
      const name = item.name ? ` name=${item.name}` : '';
      lines.push(`- port ${item.port}: ${pid}${name}`);
    }
    lines.push('Close the conflicting process or change the browser bridge port.');
    return lines.join('\n');
  }

  private async probeRemoteBridge(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/status`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) return false;
      const payload = await response.json() as { ok?: boolean; bridge?: string };
      return payload.ok === true && payload.bridge === 'pi-agent-browser';
    } catch {
      return false;
    }
  }

  private async remoteRpc(method: string, params: Record<string, unknown>) {
    const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/rpc/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json() as { ok: boolean; result?: unknown; error?: string };
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || `Remote bridge RPC failed: ${method}`);
    }
    return payload.result;
  }

  private startWs() {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });
    wss.on('connection', (socket: any) => {
      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => this.onWsMessage(socket, raw.toString()));
      socket.on('close', () => this.onWsClose(socket));
    });
    this.wsServer = wss;
  }

  private startHttp() {
    this.httpServer = createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    this.httpServer.listen(HTTP_PORT, '127.0.0.1');
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = req.url || '/';
    if (req.method === 'GET' && url === '/status') {
      const body = JSON.stringify({ ok: true, bridge: 'pi-agent-browser', connected_tabs: this.getLocalTabs().length });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && url.startsWith('/rpc/')) {
      const method = url.slice('/rpc/'.length);
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const params = raw ? JSON.parse(raw) : {};
      try {
        const result = await this.dispatchLocalRpc(method, params);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }

  private async dispatchLocalRpc(method: string, params: any) {
    switch (method) {
      case 'get_status':
        return this.getLocalStatus();
      case 'list_tabs':
        return { tabs: this.getLocalTabs() };
      case 'execute_js':
        return await this.executeJsLocal(params);
      case 'cdp_command':
        return await this.cdpCommandLocal(params);
      case 'cdp_batch':
        return await this.cdpBatchLocal(params);
      case 'get_cookies':
        return await this.getCookiesLocal(params);
      case 'list_extensions':
        return await this.listExtensionsLocal(params);
      case 'switch_tab':
        return await this.switchTabLocal(params);
      case 'open_url':
        return await this.openUrlLocal(params);
      case 'open_new_tab':
        return await this.openNewTabLocal(params);
      case 'capture_page_screenshot':
        return await this.capturePageScreenshotLocal(params);
      case 'scan_page':
        return await this.scanPageLocal(params);
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  private onWsMessage(socket: any, raw: string) {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data?.type === 'ext_ready' || data?.type === 'tabs_update') {
      const tabs = Array.isArray(data.tabs) ? data.tabs : [];
      const current = new Set<string>();
      for (const tab of tabs) {
        const id = String(tab.id);
        current.add(id);
        this.tabs.set(id, { ...tab, id, connected_at: Date.now(), type: 'ext_ws' });
        this.socketsByTab.set(id, socket);
      }
      for (const [id, existingSocket] of this.socketsByTab.entries()) {
        if (existingSocket === socket && !current.has(id)) {
          this.socketsByTab.delete(id);
          this.tabs.delete(id);
        }
      }
      return;
    }

    if (data?.type === 'result' || data?.type === 'error') {
      const pending = this.pending.get(String(data.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(data.id));
      if (data.type === 'error') {
        pending.reject(new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error)));
      } else {
        pending.resolve(data.result);
      }
      return;
    }
  }

  private onWsClose(socket: any) {
    for (const [id, existing] of this.socketsByTab.entries()) {
      if (existing === socket) {
        this.socketsByTab.delete(id);
        this.tabs.delete(id);
      }
    }
  }
}

function normalizeWsResult(result: unknown) {
  if (result && typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
    return result as Record<string, unknown>;
  }
  return { data: result };
}

function serializeText(value: unknown) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function summarizeText(value: string, max = 80): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 3)}...` : oneLine;
}

function hostFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function titleFromTab(tab?: { title?: string; url?: string; id?: string }): string {
  if (!tab) return 'unknown';
  return tab.title || hostFromUrl(tab.url) || tab.id || 'unknown';
}

function firstTextContent(result: { content?: Array<{ type: string; text?: string }> }): string | undefined {
  const textPart = result.content?.find((item) => item.type === 'text' && typeof item.text === 'string');
  return textPart?.text;
}

let browserTreeGroupSeq = 0;
let browserTreeCurrentTail: string | null = null;
let browserTreeActive = false;
const browserTreeMeta = new Map<string, BrowserTreeMeta>();

function isBrowserToolName(name: string | undefined): boolean {
  return typeof name === 'string' && name.startsWith('browser_');
}

function resetBrowserTree() {
  browserTreeGroupSeq = 0;
  browserTreeCurrentTail = null;
  browserTreeActive = false;
  browserTreeMeta.clear();
}

function finalizeBrowserTreeRun() {
  browserTreeActive = false;
  browserTreeCurrentTail = null;
}

function noteBrowserToolStart(toolCallId: string, toolName: string) {
  if (!isBrowserToolName(toolName)) {
    finalizeBrowserTreeRun();
    return;
  }

  if (!browserTreeActive) {
    browserTreeGroupSeq += 1;
    browserTreeActive = true;
    browserTreeMeta.set(toolCallId, {
      groupId: browserTreeGroupSeq,
      isFirst: true,
      isLast: true,
    });
    browserTreeCurrentTail = toolCallId;
    return;
  }

  if (browserTreeCurrentTail) {
    const prev = browserTreeMeta.get(browserTreeCurrentTail);
    if (prev) {
      prev.isLast = false;
      prev.invalidate?.();
    }
  }

  browserTreeMeta.set(toolCallId, {
    groupId: browserTreeGroupSeq,
    isFirst: false,
    isLast: true,
  });
  browserTreeCurrentTail = toolCallId;
}

function attachBrowserTreeRow(toolCallId: string, invalidate?: () => void) {
  if (!toolCallId) return;
  const meta = browserTreeMeta.get(toolCallId);
  if (!meta) return;
  meta.invalidate = invalidate;
}

function browserBranchPrefix(meta?: BrowserTreeMeta): string {
  if (!meta) return '• ';
  return meta.isLast ? '└─ ' : '├─ ';
}

function browserResultPrefix(meta?: BrowserTreeMeta): string {
  if (!meta) return '  ';
  return meta.isLast ? '   ' : '│  ';
}

function renderBrowserCall(label: string, summary: string, theme: any, toolCallId?: string, invalidate?: () => void) {
  if (toolCallId) attachBrowserTreeRow(toolCallId, invalidate);
  const meta = toolCallId ? browserTreeMeta.get(toolCallId) : undefined;
  const branch = browserBranchPrefix(meta);
  let text = '';
  if (meta?.isFirst) {
    text += `${theme.fg('toolTitle', theme.bold('Browser'))}\n`;
  }
  text += theme.fg('toolTitle', branch);
  text += theme.fg('accent', label);
  if (summary) text += theme.fg('dim', ` · ${summary}`);
  return new Text(text, 0, 0);
}

function renderBrowserResult(result: any, summary: string, theme: any, isPartial?: boolean, expanded?: boolean, toolCallId?: string, invalidate?: () => void) {
  if (toolCallId) attachBrowserTreeRow(toolCallId, invalidate);
  const meta = toolCallId ? browserTreeMeta.get(toolCallId) : undefined;
  const indent = browserResultPrefix(meta);
  if (isPartial) return new Text(theme.fg('warning', `${indent}Working...`), 0, 0);
  const raw = firstTextContent(result);
  const details = result?.details as any;
  if (details?.error) {
    return new Text(theme.fg('error', raw || `Error: ${details.error}`), 0, 0);
  }
  let text = theme.fg('dim', indent) + theme.fg('success', summary || 'ok');
  if (expanded && raw) {
    const lines = raw.split('\n');
    for (const line of lines) {
      text += `\n${theme.fg('dim', indent + line)}`;
    }
  }
  return new Text(text, 0, 0);
}

function summarizeBrowserStatus(status: any): string {
  const count = Number(status?.connected_tabs || 0);
  return count > 0 ? `ready · ${count} tab${count === 1 ? '' : 's'}` : 'not ready';
}

function summarizeBrowserTabs(details: any): string {
  const tabs = Array.isArray(details?.tabs) ? details.tabs : [];
  return `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
}

function summarizeBrowserSwitch(details: any): string {
  const id = details?.active_session_id ? `#${details.active_session_id}` : 'unknown';
  const tabs = Array.isArray(details?.tabs) ? details.tabs : [];
  const active = tabs.find((tab: any) => String(tab.id) === String(details?.active_session_id));
  return `${id} · ${titleFromTab(active)}`;
}

function summarizeBrowserOpenUrl(details: any): string {
  return hostFromUrl(details?.url) || summarizeText(String(details?.url || 'opened'));
}

function summarizeBrowserScan(details: any): string {
  const content = typeof details?.content === 'string' ? details.content : '';
  const mode = content.trim().startsWith('<') ? 'html' : 'text';
  const size = `${Math.round(content.length / 100) / 10}k chars`;
  return `${mode} · ${size}`;
}

function summarizeBrowserExecuteJs(details: any, args: any): string {
  const data = details?.data;
  if (typeof data === 'string') return `js · ${summarizeText(data, 50)}`;
  if (data && typeof data === 'object') return `js · ${Object.keys(data).length} fields`;
  return `js · ${summarizeText(String(args?.script || 'done'), 36)}`;
}

function summarizeBrowserCdpCommand(details: any, args: any): string {
  return `${args?.method || 'cdp'} · ok`;
}

function summarizeBrowserCdpBatch(details: any): string {
  const data = details?.data;
  const count = Array.isArray(data?.results) ? data.results.length : 0;
  return `batch · ${count} command${count === 1 ? '' : 's'}`;
}

function summarizeBrowserCookies(details: any): string {
  const cookies = Array.isArray(details?.cookies) ? details.cookies : Array.isArray(details?.cookies?.data) ? details.cookies.data : [];
  return `${cookies.length} cookie${cookies.length === 1 ? '' : 's'}`;
}

function summarizeBrowserScreenshot(details: any): string {
  return `${details?.format || 'png'} screenshot`;
}

function browserErrorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const formatted = formatPortConflictForTool(message);
  return {
    content: [{ type: 'text' as const, text: formatted }],
    details: { error: formatted },
  };
}

function parsePortConflictLines(message: string): string[] {
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- port '))
    .map((line) => {
      const m = line.match(/- port (\d+): pid=([^\s]+)(?: name=(.+))?/);
      if (!m) return line;
      const [, port, pid, name] = m;
      return `- ${port} → pid ${pid}${name ? ` (${name})` : ''}`;
    });
}

function formatPortConflictForDoctor(message: string): string {
  const conflicts = parsePortConflictLines(message);
  const out = [
    'Agent Browser doctor: NOT READY',
    'Port conflict detected:',
    ...conflicts,
    '',
    'Close the conflicting process or change the browser bridge port.',
  ];

  if (conflicts.length === 0) {
    out.splice(1, 1, message);
  }

  return out.join('\n');
}

function formatPortConflictForTool(message: string): string {
  const conflicts = parsePortConflictLines(message);
  if (conflicts.length === 0) return `Error: ${message}`;
  return ['Error: browser bridge port conflict', ...conflicts].join('\n');
}

function formatPortConflictForInstall(message: string): string {
  const conflicts = parsePortConflictLines(message);
  if (conflicts.length === 0) return '';
  return ['Note: port conflict detected', ...conflicts, ''].join('\n');
}

function formatDoctorPortConflict(message: string): string {
  return formatPortConflictForDoctor(message);
}

async function openChromeExtensionsPageMac() {
  try {
    await execFile('/usr/bin/open', ['-a', 'Google Chrome', 'chrome://extensions']);
    return true;
  } catch {
    try {
      await execFile('/usr/bin/osascript', ['-e', 'tell application id "com.google.Chrome" to open location "chrome://extensions"']);
      return true;
    } catch {
      return false;
    }
  }
}

async function openBrowserInstallTargetsMac(extensionPath: string) {
  const openChromePromise = openChromeExtensionsPageMac();
  const tasks = [
    openChromePromise,
    execFile('/usr/bin/open', ['-R', extensionPath]),
    execFile('/usr/bin/osascript', ['-e', 'on run argv\nset the clipboard to item 1 of argv\nend run', extensionPath]),
  ] as const;
  const results = await Promise.allSettled(tasks);
  return {
    openedChrome: results[0].status === 'fulfilled' && results[0].value === true,
    revealedInFinder: results[1].status === 'fulfilled',
    copiedToClipboard: results[2].status === 'fulfilled',
  };
}

function readState(ctx: ExtensionContext): BrowserState {
  let armed = false;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === 'custom' && entry.customType === 'agent-browser-state') {
      const data = entry.data as Partial<BrowserState> | undefined;
      armed = Boolean(data?.armed);
    }
  }
  return { armed };
}

function setArmed(pi: ExtensionAPI, armed: boolean, activeTools: string[]) {
  pi.appendEntry<BrowserState>('agent-browser-state', { armed });
  if (armed) {
    pi.setActiveTools(Array.from(new Set([...activeTools, ...TOOL_NAMES])));
  } else {
    pi.setActiveTools(activeTools.filter((name) => !TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number])));
  }
}

function browserGuard(pi: ExtensionAPI, ctx: ExtensionContext) {
  const state = readState(ctx);
  if (!state.armed) {
    const current = pi.getActiveTools().filter((name) => !TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number]));
    pi.setActiveTools(current);
  }
}

export default function agentBrowser(pi: ExtensionAPI) {
  const bridge = new BrowserBridge();
  const registerBrowserTool = (tool: any) => pi.registerTool(tool);

  pi.on('resources_discover', () => ({
    skillPaths: [skillFile],
  }));

  pi.on('tool_execution_start', async (event) => {
    noteBrowserToolStart(event.toolCallId, event.toolName);
  });

  pi.on('turn_end', async () => {
    finalizeBrowserTreeRun();
  });

  pi.on('session_start', async (_event, ctx) => {
    resetBrowserTree();
    browserGuard(pi, ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    resetBrowserTree();
    browserGuard(pi, ctx);
  });

  pi.on('input', async (event) => {
    if (event.text.startsWith('/skill:agent-browser')) {
      await bridge.ensureStarted();
      setArmed(pi, true, pi.getActiveTools());
    }
    return { action: 'continue' as const };
  });

  pi.on('session_shutdown', async () => {
    resetBrowserTree();
    bridge.stop();
  });

  pi.registerCommand('browser-install', {
    description: 'Open Chrome extension setup helpers and show install steps for agent-browser',
    handler: async (_args, ctx) => {
      let startupError = '';
      try {
        await bridge.ensureStarted();
      } catch (error) {
        startupError = error instanceof Error ? error.message : String(error);
      }
      const status = await bridge.getStatus().catch(() => ({
        extension_path: bridge.extensionPath(),
        ws_port: WS_PORT,
        http_port: HTTP_PORT,
      })) as any;
      const conflictNote = startupError.startsWith('Browser bridge ports are already in use by a non-compatible process:')
        ? formatPortConflictForInstall(startupError)
        : '';

      let macActionsNote = '';
      if (process.platform === 'darwin') {
        const actions = await openBrowserInstallTargetsMac(status.extension_path);
        const actionLines = [
          'macOS helper actions:',
          `- Opened chrome://extensions: ${actions.openedChrome ? 'yes' : 'no'}`,
          `- Revealed chrome-extension/ in Finder: ${actions.revealedInFinder ? 'yes' : 'no'}`,
          `- Copied extension path to clipboard: ${actions.copiedToClipboard ? 'yes' : 'no'}`,
          '',
        ];
        macActionsNote = actionLines.join('\n');
        const notice = actions.openedChrome && actions.revealedInFinder && actions.copiedToClipboard
          ? 'Opened Chrome extensions, revealed chrome-extension, and copied path'
          : `Extension path: ${status.extension_path}`;
        ctx.ui.notify(notice, 'info');
      } else {
        ctx.ui.notify(`Extension path: ${status.extension_path}`, 'info');
      }

      const lines = [
        'Agent Browser install',
        ...(conflictNote ? [conflictNote] : []),
        ...(macActionsNote ? [macActionsNote] : []),
        `Extension path: ${status.extension_path}`,
        `WS port: ${status.ws_port}`,
        `HTTP port: ${status.http_port}`,
        '',
        'Steps:',
        '1. Open chrome://extensions',
        '2. Enable Developer Mode',
        '3. Load unpacked extension from the chrome-extension/ folder above',
        '4. Open a normal http/https page',
        '5. Run /browser-doctor',
      ];
      pi.sendMessage({ customType: 'agent-browser-install', content: lines.join('\n'), display: true });
    },
  });

  pi.registerCommand('browser-doctor', {
    description: 'Check whether agent-browser setup looks healthy',
    handler: async (_args, ctx) => {
      try {
        await bridge.ensureStarted();
        const status = await bridge.getStatus() as any;
        const ok = status.connected_tabs > 0;
        const modeLine = status.bridge_mode === 'shared' ? 'Bridge mode: shared bridge' : 'Bridge mode: local bridge';
        const lines = ok
          ? [
              'Agent Browser doctor: OK',
              modeLine,
              `Connected tabs: ${status.connected_tabs}`,
              'No obvious setup issue detected.',
            ]
          : [
              'Agent Browser doctor: NOT READY',
              modeLine,
              'No connected Chrome tabs detected.',
              '',
              'Try this:',
              '1. Open chrome://extensions',
              '2. Reload the Pi Agent Browser Bridge extension',
              '3. Open or refresh a normal http/https page',
              '4. Run /browser-doctor again',
              '',
              'If needed, run /browser-install for the extension path.',
            ];
        ctx.ui.notify(ok ? `Browser OK (${status.connected_tabs} tab${status.connected_tabs === 1 ? '' : 's'})` : 'Browser not ready', ok ? 'info' : 'warning');
        pi.sendMessage({ customType: 'agent-browser-doctor', content: lines.join('\n'), display: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const formatted = message.startsWith('Browser bridge ports are already in use by a non-compatible process:')
          ? formatPortConflictForDoctor(message)
          : `Agent Browser doctor: NOT READY\n${message}`;
        ctx.ui.notify('Browser not ready', 'warning');
        pi.sendMessage({ customType: 'agent-browser-doctor', content: formatted, display: true });
      }
    },
  });

  pi.registerCommand('browser-on', {
    description: 'Arm real-browser tools for this session',
    handler: async (_args, ctx) => {
      await bridge.ensureStarted();
      setArmed(pi, true, pi.getActiveTools());
      ctx.ui.notify('Agent Browser armed for this session', 'info');
    },
  });

  pi.registerCommand('browser-off', {
    description: 'Disable real-browser tools for this session',
    handler: async (_args, ctx) => {
      setArmed(pi, false, pi.getActiveTools());
      ctx.ui.notify('Agent Browser disabled for this session', 'info');
    },
  });

  registerBrowserTool({
    name: 'browser_status',
    label: 'Browser Status',
    description: 'Return extension path, bridge ports, and connected real Chrome tabs for setup and diagnostics.',
    parameters: Type.Object({}),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute() {
      try {
        await bridge.ensureStarted();
        const status = await bridge.getStatus() as any;
        return {
          content: [{ type: 'text', text: serializeText(status) }],
          details: status,
        };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(_args: any, theme: any, context: any) {
      return renderBrowserCall('status', '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserStatus(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_list_tabs',
    label: 'Browser List Tabs',
    description: 'List currently connected browser tabs from the real Chrome bridge.',
    parameters: Type.Object({}),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute() {
      try {
        const tabs = await bridge.getTabs();
        return {
          content: [{ type: 'text', text: serializeText({ tabs }) }],
          details: { tabs },
        };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(_args: any, theme: any, context: any) {
      return renderBrowserCall('list tabs', '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserTabs(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_switch_tab',
    label: 'Browser Switch Tab',
    description: 'Switch the active real Chrome tab by session id or URL substring.',
    parameters: Type.Object({
      session_id: Type.Optional(Type.String({ description: 'Exact tab/session id to activate' })),
      url_pattern: Type.Optional(Type.String({ description: 'Substring to match against current tabs' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.switchTab(params) as any;
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('switch tab', args.session_id || args.url_pattern || '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserSwitch(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_open_url',
    label: 'Browser Open URL',
    description: 'Navigate the current real Chrome tab to a URL.',
    parameters: Type.Object({
      url: Type.String({ description: 'The URL to open in the active tab' }),
      session_id: Type.Optional(Type.String({ description: 'Optional target tab/session id' })),
      timeout_ms: Type.Optional(Type.Number({ description: 'Optional timeout in milliseconds' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.openUrl(params);
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('open url', hostFromUrl(args.url) || '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserOpenUrl(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_open_new_tab',
    label: 'Browser Open New Tab',
    description: 'Open a new real Chrome tab with the given URL.',
    parameters: Type.Object({
      url: Type.String({ description: 'The URL to open in a new tab' }),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.openNewTab(params);
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('new tab', hostFromUrl(args.url) || '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserOpenUrl(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_scan_page',
    label: 'Browser Scan Page',
    description: 'Read the current page from the real Chrome session as simplified HTML or plain text.',
    parameters: Type.Object({
      session_id: Type.Optional(Type.String({ description: 'Optional target tab/session id' })),
      text_only: Type.Optional(Type.Boolean({ description: 'Return plain text instead of HTML' })),
      cutlist: Type.Optional(Type.Boolean({ description: 'Detect repeated list containers and collapse them with fake-element hints' })),
      maxchars: Type.Optional(Type.Number({ description: 'Maximum returned characters' })),
      instruction: Type.Optional(Type.String({ description: 'Optional hint text used when preserving matching list items' })),
      extra_js: Type.Optional(Type.String({ description: 'Extra JavaScript to run before extraction' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.scanPage(params) as any;
        return { content: [{ type: 'text', text: serializeText(result.content) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(args: any, theme: any, context: any) {
      const mode = args.text_only ? 'text' : 'html';
      return renderBrowserCall('scan page', mode, theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserScan(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_execute_js',
    label: 'Browser Execute JS',
    description: 'Execute arbitrary JavaScript in the current page context of the real Chrome session.',
    parameters: Type.Object({
      script: Type.String({ description: 'JavaScript source code to execute in the page' }),
      session_id: Type.Optional(Type.String({ description: 'Optional target tab/session id' })),
      timeout_ms: Type.Optional(Type.Number({ description: 'Optional timeout in milliseconds' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.executeJs(params);
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('execute js', summarizeText(args.script, 40), theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserExecuteJs(details, context.args);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_cdp_command',
    label: 'Browser CDP Command',
    description: 'Call a single Chrome DevTools Protocol command on the current or specified tab.',
    parameters: Type.Object({
      method: Type.String({ description: 'CDP method name, such as Page.captureScreenshot' }),
      params_json: Type.Optional(Type.String({ description: 'JSON object encoded as a string' })),
      session_id: Type.Optional(Type.String({ description: 'Optional target tab/session id' })),
      tab_id: Type.Optional(Type.Number({ description: 'Optional explicit Chrome tab id' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.cdpCommand(params);
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('cdp', args.method || '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserCdpCommand(details, context.args);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_cdp_batch',
    label: 'Browser CDP Batch',
    description: 'Run a CDP bridge batch command encoded as a JSON object string.',
    parameters: Type.Object({
      batch_json: Type.String({ description: "Full JSON object string with cmd='batch'" }),
      session_id: Type.Optional(Type.String({ description: 'Optional target tab/session id' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.cdpBatch(params);
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(_args: any, theme: any, context: any) {
      return renderBrowserCall('cdp batch', '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserCdpBatch(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_get_cookies',
    label: 'Browser Get Cookies',
    description: 'Get cookies for the current page or specified tab from the real Chrome session.',
    parameters: Type.Object({
      session_id: Type.Optional(Type.String({ description: 'Optional target tab/session id' })),
      tab_id: Type.Optional(Type.Number({ description: 'Optional explicit Chrome tab id' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.getCookies(params);
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(_args: any, theme: any, context: any) {
      return renderBrowserCall('cookies', '', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserCookies(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });

  registerBrowserTool({
    name: 'browser_capture_page_screenshot',
    label: 'Browser Capture Screenshot',
    description: 'Capture a screenshot of the current page/tab via CDP.',
    parameters: Type.Object({
      session_id: Type.Optional(Type.String({ description: 'Optional target tab/session id' })),
      tab_id: Type.Optional(Type.Number({ description: 'Optional explicit Chrome tab id' })),
      format: Type.Optional(Type.String({ description: 'Screenshot format, usually png or jpeg' })),
      save_path: Type.Optional(Type.String({ description: 'Reserved for future save-to-file support' })),
    }),
    executionMode: 'sequential' as ToolExecutionMode,
    async execute(_id: any, params: any) {
      try {
        const result = await bridge.capturePageScreenshot(params);
        return { content: [{ type: 'text', text: serializeText(result) }], details: result };
      } catch (error) {
        return browserErrorResult(error);
      }
    },
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('screenshot', args.format || 'png', theme, context.toolCallId, context.invalidate);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      const details = result.details as any;
      const summary = details?.error ? `Error: ${details.error}` : summarizeBrowserScreenshot(details);
      return renderBrowserResult(result, summary, theme, isPartial, expanded, context.toolCallId, context.invalidate);
    },
  });
}
