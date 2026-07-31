const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const LOG_DIR = path.join(__dirname, 'logs');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const pad = (n, l) => String(n).padStart(l || 2, '0');
function ts() {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
}
function fileStamp() {
  const d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

const START_STAMP = fileStamp();
const LOG_FILE = path.join(LOG_DIR, 'collision-overlay-' + START_STAMP + '.log');
let logCount = 0;
let uploadCount = 0;
const startTime = Date.now();

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
logStream.write('=== Collision Overlay Log Server started ' + new Date().toISOString() + ' ===\n');
logStream.write('=== Log file: ' + LOG_FILE + ' ===\n\n');

function appendLog(level, session, message, data) {
  logCount++;
  let line = '[' + ts() + '] [' + level + '] [' + session + '] ' + message;
  if (data !== undefined) {
    try {
      let dataStr = JSON.stringify(data);
      if (dataStr.length > 2000) dataStr = dataStr.slice(0, 2000) + '...(' + dataStr.length + ' chars)';
      line += '  ' + dataStr;
    } catch (e) {
      line += '  [unserializable data]';
    }
  }
  logStream.write(line + '\n');
}

function sendCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  sendCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      port: PORT,
      logFile: path.basename(LOG_FILE),
      logCount: logCount,
      uploadCount: uploadCount,
      uptime: Math.floor((Date.now() - startTime) / 1000)
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        res.writeHead(413);
        res.end('Payload too large');
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);
        appendLog(
          obj.level || 'INFO',
          obj.session || 'unknown',
          obj.message || '',
          obj.data
        );
      } catch (e) {
        appendLog('ERROR', 'server', 'Failed to parse log: ' + e.message, body.slice(0, 200));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/upload') {
    uploadCount++;
    const uploadPath = path.join(LOG_DIR, 'upload-' + fileStamp() + '-' + uploadCount + '.bin');
    const ws = fs.createWriteStream(uploadPath);
    req.pipe(ws);
    ws.on('finish', () => {
      appendLog('INFO', 'server', 'File uploaded: ' + path.basename(uploadPath), { size: fs.statSync(uploadPath).size });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, file: path.basename(uploadPath) }));
    });
    ws.on('error', (e) => {
      appendLog('ERROR', 'server', 'Upload failed: ' + e.message);
      res.writeHead(500);
      res.end('Upload failed');
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found. Endpoints: POST /log, POST /upload, GET /status');
});

server.listen(PORT, () => {
  console.log('Collision Overlay Log Server');
  console.log('  Port:     ' + PORT);
  console.log('  Log file: ' + LOG_FILE);
  console.log('  Endpoints: POST /log, POST /upload, GET /status');
  console.log('  CORS:     enabled (all origins)');
  console.log('');
});

process.on('SIGINT', () => {
  logStream.write('\n=== Server stopped ' + new Date().toISOString() + ' ===\n');
  logStream.end();
  process.exit(0);
});
