# TM Cloud v0.2.0 — Dashboard CRM Plan

**Vấn đề hiện tại:**
- UI đang mix giữa "quản lý file" và "quản lý cloud account" → phải tách ra
- File manager native (Nautilus) đã làm phần file rất tốt, app không nên cạnh tranh
- OAuth flow hiện tại yêu cầu user chạy `rclone authorize` thủ công + copy JSON → UX kém
- Sidebar/list view đơn giản, chưa phải dashboard

**Mục tiêu v0.2.0:**
App = CRM dashboard quản lý cloud account. Native file manager lo phần file. App focus vào:
1. OAuth flow 1-click (tự mở terminal + browser, parse token, lưu)
2. Multi-provider CRUD (OneDrive, GDrive, Dropbox, S3, WebDAV…)
3. Sync engine với progress real-time
4. Notifications, audit log, settings

---

## Phase 1 — Tách file ops khỏi UI (1 ngày)

### Backend (`backend/app.py`)
- **Xoá các endpoint file ops** không còn dùng trong UI:
  - `GET /api/files`, `POST /api/upload`, `POST /api/mkdir`, `DELETE /api/files`, `POST /api/rename`, `GET /api/view`, `POST /api/convert`, `GET /api/raw`
- **Giữ** các endpoint cần cho dashboard:
  - `/api/auth/*` (status, setup, login, auto, change-password)
  - `/api/providers/*` (list, add, delete, mount, unmount, sync, quota, progress)
  - `/api/settings` (GET/PUT)
  - `/api/sync/progress/{pid}`, `/ws/sync/{pid}`
  - `/api/oauth/{onedrive,gdrive}/config`

### Frontend (`frontend/src/App.jsx`)
- **Xoá** `UploadButton`, `RowActions`, `UploadDialog`, `ViewerModal`, `FileIcon`
- **Sidebar trái** đổi từ "Cloud của tôi" thành 2 tab:
  - **☁ Cloud accounts** — danh sách provider dạng card (OneDrive, GoogleDrive…)
  - **⚡ Activities** — log sync + mount/unmount + OAuth events
- **Main pane** đổi từ file table/grid thành **provider detail view**:
  - Header: provider icon + name + email + status pill + quota bar
  - Body: settings (mount on startup, sync interval), actions (sync now, unmount, delete)
  - "Mở trong Files" button → mở Files manager tại `~/CloudDrive/<Provider>/` bằng `xdg-open`

### Trên disk (`~/CloudDrive/`)
- Mount thật vẫn chạy qua FUSE (anh vẫn dùng được trong Files manager)
- Nhưng UI app không hiển thị file list nữa

---

## Phase 2 — OAuth 1-click với sudo + terminal helper (1.5 ngày)

### Vấn đề
- `rclone authorize <provider>` cần OAuth client_id/client_secret (riêng cho mỗi cloud)
- Hiện tại: user chạy CLI → copy JSON → paste vào dialog

### Giải pháp: OAuth helper daemon

#### Backend: OAuth flow mới
- **`POST /api/oauth/start`** nhận `{kind: 'onedrive'|'gdrive', client_id?, client_secret?}`
  - Tạo row `oauth_sessions(id, kind, status='pending', token_path, created_at)`
  - Spawn script: `scripts/oauth-helper.sh <kind> <client_id> <client_secret> <token_out_path>`
    - Script gọi `pkexec rclone authorize <kind> <client_id> <client_secret>` (sudo prompt)
    - rclone in JSON ra stdout → script ghi vào `<token_out_path>`
    - Trả status: `pending` → `awaiting_sudo` → `awaiting_browser` → `done` | `error`
- **`GET /api/oauth/status/{session_id}`** trả state hiện tại
- **SSE stream** `/api/oauth/stream/{session_id}` bắn event mỗi state change

#### `scripts/oauth-helper.sh`
```bash
#!/bin/bash
set -e
KIND=$1
CLIENT_ID=$2
CLIENT_SECRET=$3
OUT=$4

# 1. sudo prompt (nếu cần) để cài rclone/system deps
pkexec bash -c "command -v rclone || (apt-get update && apt-get install -y rclone)"

# 2. mở browser OAuth (rclone tự mở)
rclone authorize "$KIND" "$CLIENT_ID" "$CLIENT_SECRET" > "$OUT" 2>&1
```

#### Frontend: AddProviderDialog mới
- Form có 2 mode:
  - **Quick** (mặc định, recommended): dùng `rclone public client_id` cho OneDrive / chỉ cần nhập email
  - **Custom**: nhập client_id + client_secret riêng (anh dev có app riêng)
- Sau submit:
  1. `POST /api/oauth/start` → nhận `session_id`
  2. Frontend subscribe SSE → show progress:
     - "Yêu cầu mật khẩu sudo..." (pkexec dialog)
     - "Đang mở trình duyệt..." (browser launch)
     - "Đợi bạn login trên trang Microsoft/Google..."
     - "✓ Hoàn tất — mount thành công"
  3. User đăng nhập xong trên browser → backend tự parse token → POST `/api/providers` → mount tự động

#### Edge cases
- User cancel sudo dialog → status=`error`, message="Yêu cầu quyền bị từ chối"
- User close browser sớm → status=`timeout`, retry button
- Token hết hạn → "Provider này cần reconnect" button → OAuth flow chạy lại

---

## Phase 3 — Dashboard CRM (2 ngày)

### Layout mới (full window, 1440x900)

```
┌────────────────────────────────────────────────────────────────────────┐
│  ☁ TM Cloud              [🔍 search accounts]            [🔔 3] [⚙] [T]  │ <- top bar
├──────────┬─────────────────────────────────────────────────────────────┤
│          │                                                             │
│  NAV     │  DASHBOARD                                                   │
│          │                                                             │
│  📊 Dash │  ┌─ Stats row ─────────────────────────────────────────┐    │
│  ☁ Acc.  │  │ 4 providers  │ 2 mounted │ 3.4 TB used │ 12 sync/h  │    │
│  ⚡ Act.  │  └────────────────────────────────────────────────────┘    │
│  ⚠ Conf. │                                                             │
│  📜 Log  │  ┌─ Provider cards (grid 3 col) ──────────────────────┐    │
│  ⚙ Sett. │  │ ┌──────────┐  ┌──────────┐  ┌──────────┐             │    │
│          │  │ │ OneDrive │  │ GDrive   │  │ + Add    │             │    │
│          │  │ │ ● mounted│  │ ○ unmtd  │  │          │             │    │
│          │  │ │ 154/1024 │  │  --/15G  │  │          │             │    │
│          │  │ │ [Sync]   │  │ [Mount]  │  │          │             │    │
│          │  │ └──────────┘  └──────────┘  └──────────┘             │    │
│          │  └────────────────────────────────────────────────────┘    │
│          │                                                             │
│          │  ┌─ Recent activity ──────────────────────────────────┐    │
│          │  │ 12:34  ✓ Mounted OneDrive (98 GB used)              │    │
│          │  │ 12:31  ⚠ Sync OneDrive: 1 folder error (Kho lưu trữ) │    │
│          │  │ 11:00  + Added Google Drive (15 GB)                  │    │
│          │  └────────────────────────────────────────────────────┘    │
└──────────┴─────────────────────────────────────────────────────────────┘
```

### Components

#### Sidebar (200px wide)
- **Logo TM Cloud** + version
- 6 nav items:
  - 📊 **Dashboard** — overview stats + provider grid + activity feed
  - ☁ **Accounts** — danh sách provider + add/edit/delete
  - ⚡ **Activities** — full activity log với filter
  - ⚠ **Conflicts** — file sync conflicts (nếu có)
  - 📜 **Logs** — rclone job logs (`~/.tmcloud/sync_*.log`) viewer
  - ⚙ **Settings** — 5 tabs (Account/Providers/Sync/Preferences/About)

#### Dashboard tab
- **Stats row** (4 cards): tổng providers / mounted / used storage / sync jobs trong 24h
- **Provider grid**: card mỗi provider với
  - Logo + tên + email
  - Status pill (mounted/unmounted/syncing/error)
  - Quota bar (used/total)
  - Action buttons: Sync / Mount/Unmount / ⋯ menu (Delete, Reconnect, Open in Files)
- **Activity feed** (20 entries mới nhất, link tới full log)

#### Accounts tab
- Table view đầy đủ (sort, filter)
- Columns: Provider / Email / Kind / Status / Quota / Last Sync / Actions
- "+ Add" button mở AddProviderDialog (OAuth flow Phase 2)
- Click row → panel chi tiết bên phải

#### Activities tab
- Timeline view (group by day)
- Filter: type (mount/sync/error/oauth), provider, time range
- Click event → JSON detail

#### Conflicts tab (Phase 3.5)
- Sync conflict khi cùng 1 file sửa cả 2 phía local + cloud
- UI: side-by-side diff, choice "keep local / keep remote / keep both"

#### Logs tab
- List `~/.tmcloud/sync_*.log` (1 per sync job)
- Click → open in monospace viewer với syntax highlight (error đỏ, OK xanh)

#### Settings
- Giữ nguyên 5 tabs từ v0.1, polish:
  - **Account**: avatar + change password + auto-login toggle
  - **Providers**: từng provider với reconnect/disable/delete buttons
  - **Sync**: auto-mount, interval, exclude patterns, conflict resolution strategy
  - **Preferences**: theme dark/light, density (compact/comfortable), language vi/en
  - **About**: version, links, license

### State management
- React Context cho providers list + sync states (refresh mỗi 5s)
- WebSocket cho sync progress realtime
- LocalStorage cho user prefs (theme, density)

---

## Phase 4 — Multi-language + polish (1 ngày)

### i18n
- Tách strings ra `frontend/src/i18n/{vi,en}.json`
- Hook `useT(key)` → trả text theo language

### Theming
- Dark (default) + Light
- Persist qua Settings → localStorage

### Notifications
- Bell icon + badge count unread
- Click → popover list (10 mới nhất)
- "Mark all read" / "View all →" link tới Activities tab

### Keyboard shortcuts
- `Ctrl+K` — search
- `Ctrl+N` — new provider
- `Ctrl+R` — refresh providers
- `Ctrl+,` — settings
- `Ctrl+Q` — quit
- `?` — show shortcuts

---

## Phase 5 — Build & release (0.5 ngày)

### Build pipeline (copy từ mail-manager-app)
- `package.json` build config (đã có sẵn)
- `electron-builder.yml` (chưa có) — bundle python + frontend
- GitHub Actions workflow `release.yml` (đã có trong mail-app)
- Build artifacts: `.deb`, `.AppImage`, `.exe`

### Auto-update
- `/api/update/check` endpoint (đã có trong mail-app)
- Modal dialog trong app khi có version mới

---

## Effort estimate

| Phase | Mô tả | Effort |
|-------|--------|--------|
| 1 | Tách file ops khỏi UI | 1 ngày |
| 2 | OAuth 1-click + sudo + terminal | 1.5 ngày |
| 3 | Dashboard CRM đầy đủ | 2 ngày |
| 4 | i18n + theming + shortcuts | 1 ngày |
| 5 | Build pipeline + auto-update | 0.5 ngày |
| **Total** | | **~6 ngày** |

---

## Risks

| Risk | Mitigation |
|------|-----------|
| `pkexec` không có sẵn trên Ubuntu 24 | Có sẵn trong `policykit-1` package; test trước |
| Browser không auto-open (server env) | Fallback: hiện URL + button "Copy URL" cho user tự mở |
| rclone config corruption | Backup `~/.tmcloud/rclone.conf.bak` mỗi lần add provider mới |
| FUSE mount race condition khi restart | Backend có timeout + retry 3 lần với exponential backoff |
| Token expire trong khi user đang dùng | Rclone tự refresh; nếu refresh_token cũng hết → show "Reconnect" prompt |

---

## Deliverables

1. **App**:
   - `~/tamvk/tm-cloud/` repo clean
   - `./run.sh` 1 lệnh chạy tất cả
   - Dashboard CRM đầy đủ 6 tabs
   - OAuth 1-click không cần paste JSON

2. **Build**:
   - `.deb` cài được bằng `sudo dpkg -i`
   - `.AppImage` chạy trực tiếp
   - `.exe` cho Windows

3. **Docs**:
   - `README.md` tiếng Anh (general)
   - `HUONG_DAN.md` tiếng Việt (step-by-step)
   - `CHANGELOG.md` theo semver

---

Em đề xuất bắt đầu **Phase 1 + Phase 2 song song** (tách UI + OAuth helper) vì độc lập. Phase 3 cần Phase 1 xong. Anh duyệt plan thì em triển khai.
