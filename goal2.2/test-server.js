// Test server for goal2.2 collision overlay local verification
// Serves test-overlay.html and the local Highland map.bin
// Usage: node test-server.js  →  http://localhost:3457
var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = 3457;
var MAP_FILE = 'E:/DDD/testanki1.github.io/maps/Highland REMASTER Summer Evening/map.bin';
var TEST_DIR = __dirname;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

var server = http.createServer(function(req, res) {
  var url = req.url.split('?')[0];

  if (url === '/map.bin') {
    fs.readFile(MAP_FILE, function(err, data) {
      if (err) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Error reading map.bin: ' + err.message); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  var filePath = path.join(TEST_DIR, url === '/' ? 'test/test-overlay.html' : url);
  if (!filePath.startsWith(TEST_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, function(err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found: ' + url); return; }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, function() {
  console.log('Test server: http://localhost:' + PORT);
  console.log('Map file: ' + MAP_FILE);
});
