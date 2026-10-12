# Changelog

## 0.2.0 (2026-09-20) — CRM Dashboard

### Added
- **CRM Dashboard layout** mới: sidebar 6 tabs (Dashboard / Accounts / Activities / Conflicts / Logs / Settings) + stats row + provider cards grid + activity feed
- **Provider detail panel** trượt từ phải: quota bar, sync state, action buttons (Sync/Mount/Unmount/Open in Files/Delete)
- **OAuth 1-click flow**: `pkexec` xin sudo → mở browser Microsoft/Google → parse token → tạo provider + mount tự động
- Backend endpoints mới: `/api/oauth/{start,status,cancel,complete}/`
- Backend table mới: `oauth_sessions` (track từng OAuth session + state)
- Helper script: `scripts/oauth-helper.sh` (status file JSON cho FE poll)
- **i18n** vi/en với hook `useT()` + toggle ở top bar
- **Theme** dark/light, persisted trong localStorage
- **Keyboard shortcuts**: Ctrl+K (search) / Ctrl+N (add cloud) / Ctrl+, (settings) / Esc (close modal) / ? (help)
- **Notifications panel** với bell icon + badge count
- **Logs viewer** — chọn sync job, xem log rclone

### Removed
- File ops endpoints (UI không còn làm file manager): `GET /api/files`, `POST /api/upload`, `POST /api/mkdir`, `DELETE /api/files`, `POST /api/rename`, `GET /api/view`, `POST /api/convert`, `GET /api/raw`
- Native file ops components: UploadButton, UploadDialog, ViewerModal, FileIcon, RowActions

### Changed
- Login flow: auto-bypass qua `/api/auth/auto` nếu đã có admin, wizard chỉ hiện lần đầu
- App không còn hỏi username/password mỗi lần mở
- File manager Ubuntu (Nautilus) đảm nhận phần xem/sửa file

### Fixed
- `rclone authorize gdrive` error message → corrected to `rclone authorize drive`
- Auto-discovery drive_id cho OneDrive khi user paste token (graph.microsoft.com API)
- Sync exclude folder "Kho lưu trữ cá nhân/**" (folder OneDrive bị invalid ID)

## 0.1.0 (2026-09-19) — Initial

- FUSE mount OneDrive/GDrive qua rclone
- OneDrive API + Google Drive API OAuth
- Real-time sync progress qua WebSocket
- File table view + drag-drop upload
- Basic Settings modal
- Login thủ công
