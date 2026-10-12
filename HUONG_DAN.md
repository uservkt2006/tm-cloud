# TM Cloud — Hướng dẫn chạy

## Một lệnh duy nhất

```bash
cd ~/tamvk/tm-cloud && ./run.sh
```

Script tự động:
1. Khởi động backend FastAPI ở `127.0.0.1:18686` (nếu chưa chạy)
2. Mount tất cả cloud provider đang kết nối (OneDrive, Google Drive, ...)
3. Mở UI Electron — đăng nhập thủ công bằng `tam` / `tamcloud123`

## Auto-login (bỏ qua form đăng nhập)

```bash
./run.sh --token
```

App tự inject token vào localStorage và vào thẳng main UI.

## Cấu trúc dòng lệnh

```
~/tamvk/tm-cloud/
├── run.sh                  ← chạy tất cả
├── run-public.sh           ← + cloudflared tunnel (chia sẻ qua internet)
├── backend/
│   ├── app.py              FastAPI + WebSocket + rclone mount manager
│   ├── requirements.txt
│   └── .venv/              Python venv (đã cài sẵn)
├── frontend/
│   ├── src/App.jsx         React UI (OneDrive-style)
│   ├── electron/main.cjs    Electron main process
│   ├── node_modules/
│   ├── dist/               Build output
│   └── _backend/           Bundle cho electron-builder (production)
└── README.md
```

## Ổ đĩa cloud

Sau khi mount, file OneDrive/GDrive của anh nằm ở:

```
~/CloudDrive/
├── OneDrive/         ← Microsoft OneDrive (đã kết nối, 154GB / 1TB)
│   ├── Ảnh Cưới/
│   ├── Cá Nhân/
│   ├── Documents/
│   ├── Presentation.pptx
│   └── ... 28 items
└── GoogleDrive/      ← (chưa kết nối, sẽ xuất hiện sau khi thêm)
```

Mở file manager Ubuntu: gõ `~/CloudDrive` vào thanh địa chỉ hoặc `nautilus ~/CloudDrive`.

## Quản lý qua UI

Trong app:

- **Sidebar trái** → click "OneDrive" để vào provider
- **Toolbar** → `↑ Tải lên` upload file (drag-drop toàn app cũng được)
- **☁ nút Đồng bộ** → sync incremental với cloud (rclone bisync)
- **⚙ Settings** (góc phải trên) → 5 tabs:
  - **Tài khoản**: đổi mật khẩu admin, đăng xuất
  - **Dịch vụ cloud**: xem/xoá OneDrive + Google Drive đã kết nối
  - **Đồng bộ**: bật/tắt auto-mount khi mở app, chọn interval (1ph/5ph/15ph/1h), folder loại trừ
  - **Giao diện**: theme tối/sáng, view mặc định (list/grid)
  - **Giới thiệu**: thông tin phiên bản, mount root, backend port

## Khắc phục sự cố

**Backend không lên (`127.0.0.1:18686` không phản hồi):**
```bash
cat /tmp/tmcloud-backend.log
# Hoặc:
cd ~/tamvk/tm-cloud/backend && .venv/bin/python app.py
```

**OneDrive mount fail:**
```bash
export PATH=$HOME/.local/bin:$PATH
rclone lsjson --config ~/.tmcloud/rclone.conf tmc_onedrive_1: --max-depth 1
```

**Đổi tài khoản admin:**
- Mở app → Settings → Tài khoản → Đổi mật khẩu
- Hoặc reset DB: `rm -rf ~/.tmcloud && ./run.sh` (mất hết provider đã kết nối)

**Sync chậm / fail 1 folder:**
- Đã loại trừ "Kho lưu trữ cá nhân/**" (folder OneDrive bị lỗi ID ở tài khoản của anh)
- Folder lớn `Cá Nhân` 74GB + `win` 22GB sẽ mất ~30 phút lần đầu, các lần sau incremental nhanh

## So sánh với Windows OneDrive client

| Tính năng | OneDrive.exe (Windows) | TM Cloud (Ubuntu) |
|---|---|---|
| Sync file thật vào disk | ✅ `%USERPROFILE%\OneDrive` | ✅ `~/CloudDrive/OneDrive` (FUSE) |
| Auto sync | ✅ daemon | ✅ rclone + watch |
| UI quản lý | ✅ System tray | ✅ Electron app full window |
| Storage quota bar | ✅ | ✅ sidebar |
| Multi-account | ✅ | ✅ (multi-provider) |
| Office preview | ✅ | ⚠ cần `apt install libreoffice` |
| Selective sync | ✅ | ⏳ (đang làm) |
