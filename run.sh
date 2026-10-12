#!/usr/bin/env bash
# Chạy TM Cloud app — mount OneDrive + mở UI quản lý
# Usage:
#   ./run.sh          # chạy bình thường, login thủ công
#   ./run.sh --token  # auto-login bằng token (paste token từ API login)
#
# Yêu cầu: backend tm-cloud đã chạy ở 127.0.0.1:18686, rclone đã cài ở ~/.local/bin/

set -e
cd "$(dirname "$0")"

# Tự động tìm python venv
VENV_PY="$(pwd)/backend/.venv/bin/python"
[ ! -x "$VENV_PY" ] && { echo "❌ Backend chưa cài. Chạy: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"; exit 1; }

# 1. Khởi động backend (nếu chưa chạy)
if ! curl -s -m 2 http://127.0.0.1:18686/api/health > /dev/null 2>&1; then
  echo "▶ Khởi động backend FastAPI..."
  (cd backend && nohup $VENV_PY app.py >/tmp/tmcloud-backend.log 2>&1 &)
  for i in {1..15}; do
    if curl -s -m 2 http://127.0.0.1:18686/api/health > /dev/null 2>&1; then
      echo "✓ Backend running at 127.0.0.1:18686"
      break
    fi
    sleep 1
  done
fi

# 2. Auto-mount tất cả provider đang enabled
echo "▶ Mount các cloud provider..."
TOK=$(curl -s -X POST http://127.0.0.1:18686/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tam","password":"tamcloud123"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
if [ -z "$TOK" ]; then
  echo "❌ Không login được. User/pass mặc định: tam/tamcloud123. Đổi pass trong app Settings."
  exit 1
fi
for pid in $(curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:18686/api/providers | python3 -c "import sys,json;[print(p['id']) for p in json.load(sys.stdin) if p.get('enabled')]"); do
  echo "  • mount provider $pid"
  curl -s -X POST -H "Authorization: Bearer $TOK" http://127.0.0.1:18686/api/providers/$pid/mount > /dev/null
done
echo "✓ Mount status:"
mountpoint /home/vokhactam/CloudDrive/OneDrive 2>/dev/null || echo "(OneDrive chưa mount)"
ls /home/vokhactam/CloudDrive/ 2>&1

# 3. Mở Electron app (auto-login nếu có token từ flag)
echo
echo "▶ Mở TM Cloud UI..."
export PATH="$HOME/.local/bin:$PATH"
cd frontend
if [ "$1" = "--token" ]; then
  export TMC_AUTO_TOKEN="$TOK"
  echo "  (auto-login as 'tam')"
fi
./node_modules/electron/dist/electron . "$@"
