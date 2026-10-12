const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// log to file for debugging
const LOG_PATH = '/tmp/tmcloud-electron.log';
function log(...args) { fs.appendFileSync(LOG_PATH, '[' + new Date().toISOString() + '] ' + args.join(' ') + '\n'); }
process.on('uncaughtException', e => log('UNCAUGHT', e.stack || e.message));
log('=== electron start ===');

// auto-login (chỉ cho dev/test) — truyền token qua query
const AUTO_TOKEN = process.env.TMC_AUTO_TOKEN || '';
if (AUTO_TOKEN) log('AUTO_TOKEN set, len=' + AUTO_TOKEN.length);

let win = null;
let backend = null;
const BACKEND_PORT = 18686;

function probe(port) {
  return new Promise((res) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, r => { res(r.statusCode === 200); r.resume(); }).on('error', () => res(false));
    req.setTimeout(800, () => { req.destroy(); res(false); });
  });
}

async function startBackend() {
  if (await probe(BACKEND_PORT)) return;
  const script = app.isPackaged
    ? path.join(process.resourcesPath, '_backend', 'app.py')
    : path.join(__dirname, '..', '_backend', 'app.py');
  backend = spawn(path.join(__dirname, '..', '..', 'backend', '.venv', 'bin', 'python'),
                  [script], { stdio: 'inherit' });
  for (let i = 0; i < 30; i++) {
    if (await probe(BACKEND_PORT)) return;
    await new Promise(r => setTimeout(r, 300));
  }
}

let viteProc = null;
let VITE_URL = 'http://localhost:5180/';
function probeUrl(url) {
  return new Promise(r => {
    const req = http.get(url, res => { r(res.statusCode === 200); res.resume(); }).on('error', () => r(false));
    req.setTimeout(400, () => { req.destroy(); r(false); });
  });
}
async function pickFreePort(start) {
  for (let p = start; p < start + 20; p++) {
    if (!(await probeUrl(`http://127.0.0.1:${p}/api/health`))) return p;
  }
  return start;
}

// Serve frontend qua HTTP (để fetch cross-origin work).
// Trong packaged app, không có node_modules nên dùng Python HTTP server
// (python đã bundled tại resources/python-linux/).
async function startFrontendServer() {
  const cwd = path.join(__dirname, '..');
  // tìm dist/ - trong dev là cwd/dist, trong packaged là resources/frontend (extraResources)
  let distPath;
  if (app.isPackaged) {
    distPath = path.join(process.resourcesPath, 'frontend');
  } else {
    distPath = path.join(cwd, 'dist');
  }
  log('frontend dist:', distPath, 'exists:', fs.existsSync(distPath));
  let port;
  try { port = await pickFreePort(5180); } catch { port = 5180; }
  VITE_URL = `http://localhost:${port}/`;
  log('frontend serve on port', port, '(python http.server)');
  // python interpreter path
  let pythonBin;
  if (app.isPackaged) {
    pythonBin = path.join(process.resourcesPath, 'python-linux', 'bin', 'python3.11');
  } else {
    pythonBin = path.join(cwd, '..', 'backend', '.venv', 'bin', 'python');
  }
  log('python:', pythonBin, 'exists:', fs.existsSync(pythonBin));
  // chạy scripts/frontend-server.py: serve dist/ + proxy /api → backend (Python stdlib)
  const serverScript = app.isPackaged
    ? path.join(process.resourcesPath, '_backend', 'scripts', 'frontend-server.py')
    : path.join(__dirname, '..', '..', 'scripts', 'frontend-server.py');
  const args = [serverScript, distPath, String(port)];
  return new Promise((resolve) => {
    viteProc = spawn(pythonBin, args, { stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TMC_BACKEND: 'http://127.0.0.1:18686' } });
    let started = false;
    viteProc.stdout.on('data', d => {
      const s = String(d);
      log('frontend-server:', s.trim().substring(0, 200));
      if (!started && s.includes('serving')) { started = true; setTimeout(resolve, 300); }
    });
    viteProc.stderr.on('data', d => log('frontend-server err:', String(d).substring(0, 300)));
    viteProc.on('error', e => { log('frontend-server error', e.message); resolve(); });
    setTimeout(() => { if (!started) { log('frontend-server timeout, proceeding'); resolve(); } }, 4000);
  });
}

app.whenReady().then(async () => {
  log('app ready');
  await startBackend();
  log('backend started');

  // đảm bảo DB schema đã init (chờ 1s cho lần đầu)
  await new Promise(r => setTimeout(r, 500));

  // luôn start Vite trong packaged app để serve qua http:// (file:// không fetch được backend)
  await startFrontendServer();
  log('frontend server started');

  win = new BrowserWindow({ width: 1400, height: 900, titleBarStyle: 'hidden',
    backgroundColor: '#0c0e12', title: 'TM Cloud',
    webPreferences: { nodeIntegration: false, contextIsolation: true } });
  // cả dev và packaged đều load qua http://localhost:PORT/ để fetch API cross-origin work
  const indexPath = VITE_URL;
  log('Loading', indexPath);
  win.loadURL(indexPath);
  if (AUTO_TOKEN) {
    let injected = false;
    win.webContents.on('did-finish-load', () => {
      if (injected) return;
      injected = true;
      log('injecting token (once)');
      win.webContents.executeJavaScript(
        `localStorage.setItem('tmc_token', '${AUTO_TOKEN}');
         localStorage.setItem('tmc_user', 'tam');`
      ).then(() => {
        setTimeout(() => win.webContents.reload(), 200);
      });
    });
  }
});

app.on('window-all-closed', () => {
  if (backend) backend.kill();
  if (viteProc) viteProc.kill();
  if (process.platform !== 'darwin') app.quit();
});