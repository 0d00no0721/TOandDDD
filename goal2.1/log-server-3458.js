// log-server.js — Tanki Map Simplifier 日志/上传服务器
// 端口 3458。零依赖（仅 Node 内置 http/fs/path）。
// 日志目录与上传目录相对 __dirname 解析，可随目录整体迁移。
//
// API（与 HANDOFF.md 第 5 节一致）：
//   POST /log     JSON {session, level, message, time, data?}      -> 追加一行日志
//   POST /upload  二进制：4字节大端uint32(metaLen) + meta JSON + 文件体 -> 存 uploads/
//   GET  /status  -> {status:"alive", time}
//   OPTIONS *     -> CORS 预检

'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = 3458;
var LOG_DIR = path.join(__dirname, 'logs');
var UPLOAD_DIR = path.join(LOG_DIR, 'uploads');

// 按启动时间戳命名日志文件：map-simplifier-YYYYMMDD-HHMMSS.log
function pad(n) { return n < 10 ? '0' + n : '' + n; }
var now = new Date();
var ts = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
         pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
var LOG_FILE = path.join(LOG_DIR, 'map-simplifier-' + ts + '.log');

(function ensureDirs() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
})();

var logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function serverLog(msg) {
  var line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Length');
}

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    var total = 0;
    var aborted = false;
    req.on('data', function(c) {
      if (aborted) return;
      total += c.length;
      if (total > limitBytes) { aborted = true; reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function() { if (!aborted) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

var server = http.createServer(async function(req, res) {
  corsHeaders(res);
  var url = req.url || '/';
  var method = req.method || 'GET';

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url === '/status' && method === 'GET') {
    sendJson(res, 200, { status: 'alive', time: Date.now() });
    return;
  }

  if (url === '/log' && method === 'POST') {
    try {
      var buf = await readBody(req, 2 * 1024 * 1024);
      var text = buf.toString('utf8');
      var obj;
      try { obj = JSON.parse(text); } catch (e) { sendJson(res, 400, { error: 'invalid json' }); return; }
      var ts2 = new Date((obj.time && !isNaN(Number(obj.time))) ? Number(obj.time) : Date.now()).toISOString();
      var line = '[' + ts2 + '] [' + (obj.session || '-') + '] [' + (obj.level || 'INFO') + '] ' + (obj.message || '') +
                 (obj.data !== undefined ? ' ' + safeStringify(obj.data) : '') + '\n';
      logStream.write(line);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (url === '/upload' && method === 'POST') {
    try {
      var raw = await readBody(req, 256 * 1024 * 1024);
      if (raw.length < 4) { sendJson(res, 400, { error: 'body too short' }); return; }
      var metaLen = raw.readUInt32BE(0);
      if (metaLen > raw.length - 4) { sendJson(res, 400, { error: 'meta length exceeds body' }); return; }
      var metaJson;
      try { metaJson = JSON.parse(raw.slice(4, 4 + metaLen).toString('utf8')); } catch (e) { metaJson = {}; }
      var fileBuf = raw.slice(4 + metaLen);
      var baseName = (metaJson.name || 'upload') + '';
      baseName = baseName.replace(/[^A-Za-z0-9._-]/g, '_');
      if (!baseName) baseName = 'upload';
      var fname = Date.now() + '-' + baseName;
      var fpath = path.join(UPLOAD_DIR, fname);
      fs.writeFileSync(fpath, fileBuf);
      serverLog('Uploaded: ' + fname + ' (' + fileBuf.length + ' bytes) meta=' + safeStringify(metaJson));
      sendJson(res, 200, { ok: true, file: fname, bytes: fileBuf.length });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found', path: url });
});

function safeStringify(v) {
  try {
    if (v instanceof Uint8Array || v instanceof ArrayBuffer || Buffer.isBuffer(v)) return '<' + (v.byteLength || v.length) + ' bytes>';
    return JSON.stringify(v);
  } catch (e) { return String(v); }
}

server.listen(PORT, function() {
  serverLog('Log server listening on http://localhost:' + PORT);
  serverLog('Log file: ' + LOG_FILE);
  serverLog('Upload dir: ' + UPLOAD_DIR);
});

process.on('SIGINT', function() { logStream.end(); serverLog('Shutting down.'); process.exit(0); });
