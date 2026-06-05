#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const host = String(args.host || '127.0.0.1');
const port = Number(args.port || 0);
const workspaceRoot = path.resolve(String(args['workspace-root'] || process.cwd()));
const sessionId = String(args['session-id'] || `debug-${Date.now()}`);
const baseDir = path.resolve(String(args.dir || path.join(workspaceRoot, '.pi-debug')));
const logFile = path.resolve(String(args['log-file'] || path.join(baseDir, `${sessionId}.ndjson`)));
const readyFile = path.resolve(String(args['ready-file'] || path.join(baseDir, `${sessionId}.ready.json`)));

fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.mkdirSync(path.dirname(readyFile), { recursive: true });
fs.writeFileSync(logFile, '', { flag: 'a' });

let logCount = 0;
let shuttingDown = false;

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function writeReadyPayload(serverPort) {
  const payload = {
    sessionId,
    host,
    port: serverPort,
    endpoint: `http://${host}:${serverPort}/log`,
    healthUrl: `http://${host}:${serverPort}/health`,
    clearUrl: `http://${host}:${serverPort}/clear`,
    shutdownUrl: `http://${host}:${serverPort}/shutdown`,
    logFile,
    readyFile,
    workspaceRoot,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(readyFile, JSON.stringify(payload, null, 2));
  return payload;
}

function appendEntry(rawBody) {
  let parsed;
  const text = rawBody.toString('utf8').trim();
  if (!text) {
    parsed = {};
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  const entry = {
    ts: new Date().toISOString(),
    sessionId,
    ...parsed,
  };
  fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  logCount += 1;
  return entry;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true, sessionId, logFile, logCount, shuttingDown });
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const entry = appendEntry(Buffer.concat(chunks));
        json(res, 200, { ok: true, logFile, logCount, entry });
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/clear') {
    fs.writeFileSync(logFile, '');
    logCount = 0;
    json(res, 200, { ok: true, cleared: true, logFile, logCount });
    return;
  }

  if (req.method === 'POST' && req.url === '/shutdown') {
    shuttingDown = true;
    json(res, 200, { ok: true, shuttingDown: true });
    setTimeout(() => {
      server.close(() => process.exit(0));
    }, 10);
    return;
  }

  json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const payload = writeReadyPayload(actualPort);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
});

function shutdownFromSignal(signalName) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 250).unref();
}

process.on('SIGINT', shutdownFromSignal);
process.on('SIGTERM', shutdownFromSignal);
