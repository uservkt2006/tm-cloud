# Phase 1 + 2 Execution Log

## Phase 1 — Tách file ops khỏi UI
- [ ] Xoá 9 endpoint file ops khỏi backend/app.py
- [ ] Viết lại frontend App.jsx = CRM dashboard (Phase 3 đan xen vì UI = dashboard luôn)
- [ ] Sidebar 6 tabs: Dashboard / Accounts / Activities / Conflicts / Logs / Settings
- [ ] Provider cards grid ở Dashboard
- [ ] Provider detail panel bên phải (thay file table)
- [ ] Nút "Mở trong Files" → `xdg-open ~/CloudDrive/<Provider>/`

## Phase 2 — OAuth 1-click với sudo
- [ ] Backend: `oauth_sessions` table + `/api/oauth/start`, `/api/oauth/status/{id}`, SSE stream
- [ ] `scripts/oauth-helper.sh`: pkexec rclone authorize + write token ra file
- [ ] Frontend AddProviderDialog → progress modal với các bước (sudo prompt / browser open / waiting login / done)
- [ ] Quota sidebar bar cho từng provider (gọi Microsoft Graph + Google Drive API)
- [ ] Reconnect flow khi token hết hạn (giữ nguyên client_id)

## Verify sau mỗi phase
- [ ] Build OK (CSS > 15KB, JS bundle, Tailwind nguyên)
- [ ] Backend `/api/health` 200
- [ ] App Electron launch + auto-login
- [ ] Dashboard render đúng
- [ ] Provider card OneDrive + GoogleDrive hiện với quota bar
