#!/bin/bash
# TM Cloud OAuth helper — called by backend via pkexec
# Args: $1=kind, $2=client_id, $3=client_secret, $4=token_out, $5=status_out
#
# rclone authorize in ra dạng:
#   2026/09/21 12:29:00 NOTICE: ...
#   2026/09/21 12:29:00 NOTICE: Got code
#   Paste the following into your remote machine --->
#   {"access_token":"...","refresh_token":"..."}
#   <---End paste
#
# Helper này: gọi rclone authorize, parse output để lấy JSON token (bỏ dòng prompt), lưu vào $TOKEN_OUT.
set -e
KIND="$1"
CLIENT_ID="$2"
CLIENT_SECRET="$3"
TOKEN_OUT="$4"
STATUS_OUT="$5"

# Map kind → rclone backend name
# (App dùng "gdrive" để user dễ hiểu, nhưng rclone backend thật là "drive")
case "$KIND" in
  onedrive) RCLONE_FS="onedrive" ;;
  gdrive)   RCLONE_FS="drive"   ;;
  *)        RCLONE_FS="$KIND"   ;;
esac

log() { echo "$(date +%H:%M:%S) $*" >> "$STATUS_OUT".log; }
update() {
  python3 -c "
import json,sys
try:
    d = json.load(open('$STATUS_OUT'))
except: d = {}
d.update({'state': sys.argv[1], 'message': sys.argv[2], 'updated_at': '$(date +%H:%M:%S)'})
if len(sys.argv) > 3: d['provider_id'] = int(sys.argv[3])
json.dump(d, open('$STATUS_OUT','w'))
" "$@" 2>/dev/null || true
}

log "=== oauth-helper start ==="
update "awaiting_sudo" "Yêu cầu mật khẩu sudo (nếu có)"
log "kind=$KIND rclone_fs=$RCLONE_FS client_id=${CLIENT_ID:0:20}..."

# rclone check
if ! command -v rclone >/dev/null 2>&1; then
  log "rclone not found"
  update "error" "rclone không có trên PATH"
  exit 2
fi

update "awaiting_browser" "Đang mở trình duyệt — đợi bạn login"

# Chạy rclone authorize, capture stdout
RCLONE_OUT="$TOKEN_OUT.raw"
log "running: rclone authorize $RCLONE_FS ..."
if [ -n "$CLIENT_ID" ]; then
  rclone authorize "$RCLONE_FS" "$CLIENT_ID" "$CLIENT_SECRET" > "$RCLONE_OUT" 2>>"$STATUS_OUT".log || {
    update "error" "rclone authorize thoát với lỗi (xem $STATUS_OUT.log)"
    exit 3
  }
else
  # public client (OneDrive only)
  rclone authorize "$RCLONE_FS" > "$RCLONE_OUT" 2>>"$STATUS_OUT".log || {
    update "error" "rclone authorize thoát với lỗi"
    exit 3
  }
fi

log "rclone done, parsing output..."

# Parse output: tìm JSON object bắt đầu bằng '{' và kết thúc bằng '}' cuối cùng trên 1 dòng
python3 <<PYEOF
import re, sys, json
raw = open("$RCLONE_OUT").read()
# Tìm JSON object trong output (có thể bị wrap bởi "Paste the following..." và "<---End paste")
# Ưu tiên: line chỉ chứa JSON (bắt đầu bằng {)
json_lines = [ln.strip() for ln in raw.splitlines() if ln.strip().startswith('{')]
if not json_lines:
    # Fallback: regex tìm {...}
    m = re.search(r'\{[^{}]*"access_token"[^{}]*\}', raw, re.DOTALL)
    if m:
        json_text = m.group(0)
    else:
        open("$STATUS_OUT".log, 'a').write("\nNO JSON FOUND IN RCLONE OUTPUT:\n" + raw)
        sys.exit(4)
else:
    json_text = json_lines[-1]  # line JSON cuối cùng

# Validate parse
import json as _json
try:
    data = _json.loads(json_text)
except Exception as e:
    open("$STATUS_OUT".log, 'a').write(f"\nJSON PARSE FAIL: {e}\nTEXT: {json_text[:500]}\n")
    sys.exit(5)

# Phải có access_token + refresh_token
if 'access_token' not in data or 'refresh_token' not in data:
    open("$STATUS_OUT".log, 'a').write(f"\nMISSING FIELDS: {list(data.keys())}\n")
    sys.exit(6)

_json.dump(data, open("$TOKEN_OUT", "w"))
PYEOF

if [ $? -ne 0 ]; then
  update "error" "Không parse được JSON token từ rclone"
  exit 7
fi

log "token saved to $TOKEN_OUT"
update "done" "OAuth hoàn tất"
log "=== oauth-helper done ==="
