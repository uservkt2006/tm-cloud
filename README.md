# TM Cloud v0.2.0 — CRM dashboard cho cloud accounts

**Build verified:**
- `.deb` 253 MB tại `frontend/dist/tm-cloud_0.1.0_amd64.deb` — cài được qua `sudo dpkg -i`
- `.AppImage` 283 MB tại `frontend/dist/tm-cloud-0.1.0.AppImage` — chạy trực tiếp

## Tính năng v0.2.0

- **Dashboard CRM**: 4 stat cards (Providers / Storage / Syncing / Sync 24h) + provider cards grid + activity feed
- **Sidebar 6 tabs**: Dashboard / Accounts / Activities / Conflicts / Logs / Settings
- **Provider detail panel**: trượt từ phải, hiện quota bar + action buttons (Sync / Mount / Unmount / Open in Files / Delete)
- **OAuth 1-click**: `pkexec` xin sudo → mở browser Microsoft/Google → parse token → tạo provider + mount tự động
- **Mount qua FUSE**: file thật vào disk tại `~/CloudDrive/<Provider>/`, anh dùng Files manager Ubuntu để xem
- **Sync engine**: `rclone bisync` với realtime progress qua WebSocket
- **Multi-language**: vi/en (toggle trên top bar)
- **Theme**: dark (default) + light, persisted trong localStorage
- **Keyboard shortcuts**: Ctrl+K (search) / Ctrl+N (add) / Ctrl+, (settings) / ? (help)

## Cài đặt nhanh

### Từ .deb (Ubuntu 24.04+)
```bash
sudo dpkg -i tm-cloud_0.1.0_amd64.deb
sudo apt-get install -f   # fix dependencies nếu thiếu
tm-cloud                   # chạy
```

### Từ .AppImage
```bash
chmod +x tm-cloud-0.1.0.AppImage
./tm-cloud-0.1.0.AppImage
```

### Dev mode (từ source)
```bash
cd ~/tamvk/tm-cloud
./run.sh
```

## Build từ source

```bash
cd frontend
npm run package:linux       # .deb + .AppImage
npm run package:win         # .exe (cần cross-compile hoặc Windows)
npm run package:all         # tất cả
```

Build output ở `frontend/dist/`.

## Kiến trúc

```
Frontend (React + Vite)     →  ./dist/index.html
Electron shell               →  electron/main.cjs (spawn backend + vite dev)
Backend (FastAPI + SQLite)  →  backend/app.py (port 18686)
OAuth helper                →  scripts/oauth-helper.sh (pkexec + rclone authorize)
Mount manager (FUSE)         →  rclone mount qua ~/CloudDrive/<Provider>/
Settings DB                  →  ~/.tmcloud/tmcloud.db
Config (rclone)              →  ~/.tmcloud/rclone.conf
Encryption key               →  ~/.tmcloud/key (Fernet)
```

## Sơ đồ luồng OAuth 1-click

```
User click "Thêm cloud"
  ↓
POST /api/oauth/start {kind, label, client_id?, client_secret?}
  ↓
Backend spawn scripts/oauth-helper.sh via pkexec
  ↓
Helper update status: pending → awaiting_sudo → awaiting_browser → done
  ↓ (frontend poll /api/oauth/status/{sid} mỗi 1.5s)
User login trên browser Microsoft/Google
  ↓
Helper ghi token ra oauth/<sid>/token.json
  ↓
Frontend gọi POST /api/oauth/{sid}/complete
  ↓
Backend tạo provider + mount FUSE tự động
  ↓
Provider card xuất hiện trong sidebar với quota bar
```

## Files quan trọng

| File | Vai trò |
|------|---------|
| `backend/app.py` | FastAPI server (936 dòng) |
| `scripts/oauth-helper.sh` | OAuth flow helper (pkexec + rclone) |
| `frontend/src/App.jsx` | React UI CRM dashboard (47 KB) |
| `frontend/src/i18n.js` | Multi-language vi/en |
| `frontend/src/shortcuts.js` | Keyboard shortcuts |
| `frontend/electron/main.cjs` | Electron shell (spawn backend + vite) |
| `frontend/package.json` | Build config + electron-builder |
| `scripts/bundle-backend.sh` | Bundle backend cho electron-builder |
| `scripts/bundle-python.py` | Tải python-build-standalone |
| `build/icon.png` + `build/icons/*.png` | App icons |
| `build/python-linux-x64/` | Python 3.11 + deps cho production |

## Pitfalls (ghi nhớ)

- **`python-multipart` missing** → upload fails at import time (đã fix bằng cách add vào requirements.txt)
- **`rclone authorize <backend>`** — Google backend name là `drive` KHÔNG phải `gdrive`
- **OAuth `pkexec` cần DISPLAY** — server/CI env không có GUI sẽ fail (helper có fallback)
- **Mount `device busy`** — fusermount -uz để force unmount
- **Tailwind CSS bị strip** khi build từ cwd khác — chạy `vite build` từ chính `frontend/` dir
- **electron-builder `productName` không có space** — `/opt/tm cloud/` sẽ break execvp
- **FUSE `directory already mounted`** — kill old rclone + rerun

## Settings mặc định

- Backend port: 18686
- Mount root: `~/CloudDrive/`
- Vite dev port: 5180 (auto-find free port)
- Electron log: `/tmp/tmcloud-electron.log`
- Server log: `/tmp/tmcloud-backend.log`
- Rclone config: `~/.tmcloud/rclone.conf`
- DB: `~/.tmcloud/tmcloud.db`

## Phase tiếp theo (v0.3.0 backlog)

- **Conflicts tab** (placeholder) — UI cho sync conflicts khi file đổi cả 2 phía
- **Reconnect OAuth flow** — nút "Reconnect" khi refresh_token hết hạn
- **Sync schedule** — cron-like "sync mỗi N phút" thực sự chạy nền
- **Multi-user** — Postgres thay SQLite cho team dùng chung
- **Tray icon** — minimize to tray với menu Mount/Unmount/Sync
- **Auto-update** — GitHub Releases + dialog khi có version mới
