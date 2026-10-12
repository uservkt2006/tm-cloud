"""TM Cloud v0.1.0 — unified OneDrive + Google Drive manager for Ubuntu.

Stack: FastAPI + SQLite + rclone (mount + bisync) + Microsoft Graph + Google Drive API.
Auth: X-Auth-Token, PBKDF2, multi-user.

Core idea: one virtual folder `~/CloudDrive/` containing files from every
connected provider. Backend exposes:
  - /api/auth          setup wizard + token
  - /api/providers     connect OneDrive / GDrive (OAuth) and rclone remotes
  - /api/mounts        start / stop / status of FUSE mounts
  - /api/files         list / upload / download / delete / move (works through rclone
                       when mounted, falls back to direct Graph/Drive API otherwise)
  - /api/sync          trigger bisync, show queue, conflicts
"""
from fastapi import FastAPI, HTTPException, Header, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import json as _json
from typing import Optional, List
import os, json, sqlite3, hashlib, secrets, subprocess, threading, time, shutil, base64, uuid, re
from datetime import datetime
from contextlib import contextmanager
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tmcloud")

APP_VERSION = "0.1.0"
app = FastAPI(title="TM Cloud", version=APP_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Paths ─────────────────────────────────────────────────────────────
HOME = os.path.expanduser("~")
APP_DIR = os.path.join(HOME, ".tmcloud")
DB_PATH = os.environ.get("TMC_DB_PATH") or os.path.join(APP_DIR, "tmcloud.db")
RCLONE_CONF = os.path.join(APP_DIR, "rclone.conf")
MOUNT_ROOT = os.path.join(HOME, "CloudDrive")
os.makedirs(APP_DIR, exist_ok=True)
os.makedirs(MOUNT_ROOT, exist_ok=True)

SCHEMA_VERSION = 1
PBKDF2_ITERS = 200_000

# ── DB ────────────────────────────────────────────────────────────────
def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA busy_timeout=30000")
    return c


def init_schema():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            pw_hash TEXT NOT NULL,
            pw_salt TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL,             -- 'onedrive' | 'gdrive'
            label TEXT NOT NULL,
            rclone_remote TEXT NOT NULL,   -- e.g. 'tmc_od_<uuid>'
            mount_subdir TEXT NOT NULL,    -- e.g. 'OneDrive' under MOUNT_ROOT
            oauth_json TEXT,               -- encrypted blob of {client_id, client_secret, refresh_token, ...}
            account_email TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS mounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL UNIQUE,
            pid INTEGER,                   -- rclone mount process pid when running
            started_at TEXT,
            last_error TEXT,
            FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS sync_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL,
            kind TEXT NOT NULL,            -- 'bisync' | 'copy_up' | 'copy_down'
            status TEXT NOT NULL,          -- 'queued'|'running'|'ok'|'error'
            started_at TEXT,
            finished_at TEXT,
            log TEXT,
            FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS file_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL,
            remote_path TEXT NOT NULL,
            size INTEGER,
            modified TEXT,
            hash TEXT,
            indexed_at TEXT NOT NULL,
            UNIQUE(provider_id, remote_path),
            FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS oauth_sessions (
            id TEXT PRIMARY KEY,                -- uuid
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL,                  -- 'onedrive' | 'gdrive'
            client_id TEXT,
            client_secret TEXT,
            label TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'pending',  -- pending|awaiting_sudo|awaiting_browser|done|error
            message TEXT,
            token_path TEXT,                     -- file chứa JSON token từ rclone authorize
            provider_id INTEGER,                 -- set khi state=done
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        """)
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('schema_version', ?)", (str(SCHEMA_VERSION),))


init_schema()

# ── crypto / auth ─────────────────────────────────────────────────────
def pbkdf2(pw: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, PBKDF2_ITERS)


def hash_password(pw: str) -> tuple[str, str]:
    salt = secrets.token_bytes(16)
    h = pbkdf2(pw, salt)
    return base64.b64encode(h).decode(), base64.b64encode(salt).decode()


def verify_password(pw: str, h_b64: str, salt_b64: str) -> bool:
    h = pbkdf2(pw, base64.b64decode(salt_b64))
    return secrets.compare_digest(base64.b64encode(h).decode(), h_b64)


def encrypt(plain: str) -> str:
    from cryptography.fernet import Fernet
    key_path = os.path.join(APP_DIR, "key")
    if os.path.exists(key_path):
        k = open(key_path, "rb").read()
    else:
        k = Fernet.generate_key()
        open(key_path, "wb").write(k)
    return Fernet(k).encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    from cryptography.fernet import Fernet
    k = open(os.path.join(APP_DIR, "key"), "rb").read()
    return Fernet(k).decrypt(token.encode()).decode()


def current_user(authorization: Optional[str] = Header(None)) -> int:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing token")
    tok = authorization[7:]
    with db() as c:
        row = c.execute("SELECT user_id FROM sessions WHERE token=?", (tok,)).fetchone()
    if not row:
        raise HTTPException(401, "invalid token")
    return row["user_id"]


# ── rclone helpers ────────────────────────────────────────────────────
def write_rclone_conf(provider_id: int, kind: str, oauth: dict):
    """Append/replace a [remote] section in rclone.conf for this provider.
    For OneDrive, if drive_id is missing, query Microsoft Graph to discover
    the default personal drive (one with name='OneDrive' or the user's first
    drive). Without drive_id, rclone onedrive backend refuses to start.
    """
    os.makedirs(os.path.dirname(RCLONE_CONF), exist_ok=True)
    name = f"tmc_{kind}_{provider_id}"
    sections = {}
    if os.path.exists(RCLONE_CONF):
        with open(RCLONE_CONF) as f:
            sections = parse_rclone_conf(f.read())
    if kind == "onedrive":
        drive_id = oauth.get("drive_id", "")
        drive_type = oauth.get("drive_type", "")
        if not drive_id:
            drive_id, drive_type = _discover_onedrive_drive(oauth)
        sections[name] = {
            "type": "onedrive",
            "client_id": oauth["client_id"],
            "client_secret": oauth["client_secret"],
            "drive_id": drive_id,
            "drive_type": drive_type or "personal",
            "token": json.dumps(oauth["token"]),
        }
    elif kind == "gdrive":
        sections[name] = {
            "type": "drive",
            "client_id": oauth["client_id"],
            "client_secret": oauth["client_secret"],
            "token": json.dumps(oauth["token"]),
        }
    out = []
    for n, kv in sections.items():
        out.append(f"[{n}]")
        for k, v in kv.items():
            out.append(f"{k} = {v}")
        out.append("")
    with open(RCLONE_CONF, "w") as f:
        f.write("\n".join(out))
    return name


def _discover_onedrive_drive(oauth: dict) -> tuple[str, str]:
    """Call Microsoft Graph /me/drives; prefer name='OneDrive', fallback first."""
    import urllib.request, urllib.error
    tok = oauth["token"].get("access_token", "")
    if not tok:
        return "", "personal"
    try:
        req = urllib.request.Request(
            "https://graph.microsoft.com/v1.0/me/drives",
            headers={"Authorization": f"Bearer {tok}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            drives = json.loads(r.read()).get("value", [])
    except Exception as e:
        log.warning("drive discovery failed: %s", e)
        return "", "personal"
    for d in drives:
        if d.get("name", "").lower() == "onedrive":
            return d["id"], d.get("driveType", "personal")
    if drives:
        return drives[0]["id"], drives[0].get("driveType", "personal")
    return "", "personal"


def parse_rclone_conf(text: str) -> dict:
    sections = {}
    cur = None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            cur = line[1:-1]
            sections[cur] = {}
        elif cur and "=" in line:
            k, v = line.split("=", 1)
            sections[cur][k.strip()] = v.strip()
    return sections


def provider_mount_path(p: sqlite3.Row) -> str:
    return os.path.join(MOUNT_ROOT, p["mount_subdir"])


# ── mount manager ─────────────────────────────────────────────────────
_mount_locks = {}


def _refresh_onedrive_token(p: dict) -> dict:
    """Refresh OneDrive access_token nếu expired.
    Rclone's built-in client_id (b15665d9-eda6-4092-8539-0eec376afd59) + refresh_token → access_token mới.
    Save vào rclone.conf + oauth_json."""
    if p["kind"] != "onedrive":
        return json.loads(decrypt(p["oauth_json"]))
    # Rclone's public client_id + client_secret cho OneDrive (hardcode trong rclone source)
    RCLONE_ONEDRIVE_CLIENT_ID = "b15665d9-eda6-4092-8539-0eec376afd59"
    RCLONE_ONEDRIVE_CLIENT_SECRET = "qtyfaBBYA403=unZUP40~_#"
    import urllib.request, urllib.parse, urllib.error
    try:
        oauth = json.loads(decrypt(p["oauth_json"]))
        tok = oauth.get("token", {})
        expiry_str = tok.get("expiry", "")
        if expiry_str:
            try:
                from datetime import datetime as _dt
                expiry_dt = _dt.fromisoformat(expiry_str.replace("Z", "+00:00"))
                if expiry_dt.tzinfo is None:
                    expiry_dt = expiry_dt.replace(tzinfo=_dt.timezone.utc)
                import datetime as _dtt
                now = _dtt.datetime.now(_dtt.timezone.utc)
                if expiry_dt > now:
                    return oauth
            except Exception:
                pass
        rt = tok.get("refresh_token", "")
        if not rt:
            log.warning("no refresh_token for provider %s", p["id"])
            return oauth
        data = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": rt,
            "client_id": RCLONE_ONEDRIVE_CLIENT_ID,
            "client_secret": RCLONE_ONEDRIVE_CLIENT_SECRET,
            "scope": "offline_access Files.ReadWrite.All",
        }).encode()
        req = urllib.request.Request(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            data=data, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=15) as r:
            new_tok = json.loads(r.read())
        if "access_token" not in new_tok:
            log.warning("refresh failed: %s", new_tok)
            return oauth
        new_oauth = dict(oauth)
        new_tok_full = dict(tok)
        new_tok_full["access_token"] = new_tok["access_token"]
        if "refresh_token" in new_tok:
            new_tok_full["refresh_token"] = new_tok["refresh_token"]
        new_tok_full["expiry"] = _dtt.datetime.now(_dtt.timezone.utc).isoformat()
        new_oauth["token"] = new_tok_full
        # Lưu lại DB
        c2 = db()
        try:
            c2.execute("UPDATE providers SET oauth_json=? WHERE id=?",
                       (encrypt(json.dumps(new_oauth)), p["id"]))
            c2.commit()
        finally:
            c2.close()
        # Rewrite rclone.conf với token mới
        write_rclone_conf(p["id"], p["kind"], new_oauth)
        log.info("refreshed onedrive token for provider %s", p["id"])
        return new_oauth
    except urllib.error.HTTPError as e:
        log.warning("refresh_onedrive_token HTTPError: %s, body=%s", e, e.read().decode()[:300])
        return json.loads(decrypt(p["oauth_json"]))


def mount_provider(provider_id: int):
    """Spawn rclone mount in background, persist pid.
    Refresh access_token trước khi mount nếu expired."""
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND enabled=1", (provider_id,)).fetchone()
    if not p:
        raise HTTPException(404, "provider not found")
    # Refresh token nếu cần (OneDrive)
    if p["kind"] == "onedrive":
        oauth = _refresh_onedrive_token(p)
        # discover drive_id nếu chưa có trong config (dùng token mới)
        try:
            sections = parse_rclone_conf(open(RCLONE_CONF).read())
            section = sections.get(f"tmc_{p['kind']}_{p['id']}", {})
            if not section.get("drive_id"):
                drive_id, drive_type = _discover_onedrive_drive(oauth)
                if drive_id:
                    oauth["drive_id"] = drive_id
                    oauth["drive_type"] = drive_type
                    write_rclone_conf(p["id"], p["kind"], oauth)
                    c2 = db()
                    try:
                        c2.execute("UPDATE providers SET oauth_json=? WHERE id=?",
                                   (encrypt(json.dumps(oauth)), p["id"]))
                        c2.commit()
                    finally:
                        c2.close()
        except Exception as e:
            log.warning("drive_id discovery: %s", e)
    mp = provider_mount_path(p)
    # Nếu mount_path là regular directory (không phải FUSE) từ lần trước fail → xóa
    if os.path.isdir(mp) and not os.path.ismount(mp):
        try:
            # kiểm tra có file gì không; nếu rỗng thì rmdir
            entries = os.listdir(mp)
            if not entries:
                os.rmdir(mp)
            else:
                log.warning("mount_path %s not empty, keeping", mp)
        except Exception as e:
            log.warning("cleanup mount_path %s: %s", mp, e)
    os.makedirs(mp, exist_ok=True)
    cmd = [
        "rclone", "mount",
        f"--config={RCLONE_CONF}",
        f"{p['rclone_remote']}:", mp,
        "--vfs-cache-mode=full",
        "--vfs-cache-max-age=24h",
        "--vfs-read-ahead=128M",
        "--dir-cache-time=10m",
        "--poll-interval=30s",
        "--no-modtime",
        "--no-seek",
        "--daemon",
    ]
    log.info("mount: %s", " ".join(cmd))
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if out.returncode != 0:
            raise RuntimeError(out.stderr or out.stdout)
    except Exception as e:
        with db() as c:
            c.execute("UPDATE mounts SET last_error=? WHERE provider_id=?", (str(e), provider_id))
        raise HTTPException(500, f"mount failed: {e}")
    time.sleep(0.8)
    pid = find_mount_pid(mp)
    with db() as c:
        c.execute("""INSERT INTO mounts(provider_id,pid,started_at,last_error)
                     VALUES(?,?,?,NULL)
                     ON CONFLICT(provider_id) DO UPDATE SET pid=excluded.pid,
                       started_at=excluded.started_at, last_error=NULL""",
                  (provider_id, pid, datetime.utcnow().isoformat()))


def find_mount_pid(mount_path: str) -> Optional[int]:
    out = subprocess.run(["pgrep", "-f", f"rclone mount .*{mount_path}"], capture_output=True, text=True)
    for line in out.stdout.splitlines():
        if line.strip().isdigit():
            return int(line.strip())
    return None


def unmount_provider(provider_id: int):
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
    if not p:
        return
    mp = provider_mount_path(p)
    subprocess.run(["fusermount", "-u", mp], capture_output=True)
    time.sleep(0.5)
    with db() as c:
        c.execute("UPDATE mounts SET pid=NULL, last_error='unmounted' WHERE provider_id=?", (provider_id,))


def mount_status(provider_id: int) -> dict:
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
        m = c.execute("SELECT * FROM mounts WHERE provider_id=?", (provider_id,)).fetchone()
    mp = provider_mount_path(p) if p else None
    mounted = bool(mp and os.path.ismount(mp))
    return {"provider_id": provider_id, "mounted": mounted,
            "pid": m["pid"] if m else None,
            "mount_path": mp, "last_error": m["last_error"] if m else None}


# ── schemas ───────────────────────────────────────────────────────────
class SetupReq(BaseModel):
    username: str
    password: str


class LoginReq(BaseModel):
    username: str
    password: str


class ProviderReq(BaseModel):
    kind: str            # 'onedrive' | 'gdrive'
    label: str
    oauth: dict          # full oauth payload returned by frontend OAuth dance


# ── routes ────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION, "mount_root": MOUNT_ROOT}


@app.get("/api/auth/status")
def auth_status():
    with db() as c:
        n = c.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    return {"setup_required": n == 0, "users": n}


@app.post("/api/auth/auto")
def auto_login():
    """Bỏ qua login: nếu đã có user, cấp session. Nếu DB rỗng, tự tạo admin ngầm
    (random password lưu trong settings table) rồi cấp session luôn.
    Frontend không bao giờ thấy form đăng nhập — mở app là vào thẳng main UI."""
    import secrets as _secrets
    with db() as c:
        u = c.execute("SELECT id, username FROM users LIMIT 1").fetchone()
        if not u:
            # chưa có admin — tự tạo ngầm với random password
            random_pw = _secrets.token_urlsafe(16)
            h, s = hash_password(random_pw)
            c.execute("INSERT INTO users(username, pw_hash, pw_salt, created_at) VALUES(?,?,?,?)",
                      ("admin", h, s, datetime.utcnow().isoformat()))
            # lưu password vào settings (chỉ user có quyền đọc)
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('admin_initial_password',?)",
                      (random_pw,))
            log.info("auto-created admin user (password in settings)")
            u = c.execute("SELECT id, username FROM users WHERE username='admin'").fetchone()
    tok = _secrets.token_urlsafe(32)
    with db() as c:
        c.execute("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)",
                  (tok, u["id"], datetime.utcnow().isoformat()))
    return {"token": tok, "username": u["username"], "auto": True}


@app.post("/api/auth/setup")
def setup(req: SetupReq):
    h, s = hash_password(req.password)
    with db() as c:
        existing = c.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        if existing:
            raise HTTPException(400, "already set up")
        c.execute("INSERT INTO users(username, pw_hash, pw_salt, created_at) VALUES(?,?,?,?)",
                  (req.username, h, s, datetime.utcnow().isoformat()))
    tok = secrets.token_urlsafe(32)
    with db() as c:
        uid = c.execute("SELECT id FROM users WHERE username=?", (req.username,)).fetchone()["id"]
        c.execute("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)",
                  (tok, uid, datetime.utcnow().isoformat()))
    return {"token": tok, "username": req.username}


@app.post("/api/auth/login")
def login(req: LoginReq):
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE username=?", (req.username,)).fetchone()
    if not u or not verify_password(req.password, u["pw_hash"], u["pw_salt"]):
        raise HTTPException(401, "invalid credentials")
    tok = secrets.token_urlsafe(32)
    with db() as c:
        c.execute("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)",
                  (tok, u["id"], datetime.utcnow().isoformat()))
    return {"token": tok, "username": u["username"]}


@app.get("/api/providers")
def list_providers(uid: int = Depends(current_user)):
    with db() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT id,kind,label,mount_subdir,account_email,enabled,created_at,rclone_remote "
            "FROM providers WHERE user_id=? ORDER BY id", (uid,)).fetchall()]
    for r in rows:
        r["status"] = mount_status(r["id"])
        r["enabled"] = bool(r["enabled"])
    return rows


@app.post("/api/providers")
def add_provider(req: ProviderReq, uid: int = Depends(current_user)):
    if req.kind not in ("onedrive", "gdrive"):
        raise HTTPException(400, "kind must be onedrive or gdrive")
    sub = "OneDrive" if req.kind == "onedrive" else "GoogleDrive"
    with db() as c:
        c.execute("""INSERT INTO providers(user_id,kind,label,rclone_remote,mount_subdir,
                       oauth_json,account_email,enabled,created_at)
                     VALUES(?,?,?,?,?,?,?,1,?)""",
                  (uid, req.kind, req.label, "", sub,
                   encrypt(json.dumps(req.oauth)), req.oauth.get("account_email"),
                   datetime.utcnow().isoformat()))
        pid = c.execute("SELECT last_insert_rowid() AS i").fetchone()["i"]
        remote = write_rclone_conf(pid, req.kind, req.oauth)
        c.execute("UPDATE providers SET rclone_remote=? WHERE id=?", (remote, pid))
    # auto-mount
    try:
        mount_provider(pid)
    except HTTPException as e:
        log.warning("auto-mount failed: %s", e.detail)
    return {"id": pid, "rclone_remote": remote, "status": mount_status(pid)}


@app.delete("/api/providers/{pid}")
def delete_provider(pid: int, uid: int = Depends(current_user)):
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
        if not p:
            raise HTTPException(404, "not found")
        unmount_provider(pid)
        mp = provider_mount_path(p)
        if os.path.ismount(mp):
            subprocess.run(["fusermount", "-u", mp], capture_output=True)
        try: shutil.rmtree(mp, ignore_errors=True)
        except Exception: pass
        c.execute("DELETE FROM providers WHERE id=?", (pid,))
    return {"deleted": pid}


class ProviderUpdateReq(BaseModel):
    label: Optional[str] = None
    mount_subdir: Optional[str] = None
    enabled: Optional[bool] = None

@app.put("/api/providers/{pid}")
def update_provider(pid: int, req: ProviderUpdateReq, uid: int = Depends(current_user)):
    """Đổi tên, mount_subdir, enable/disable."""
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
        if not p:
            raise HTTPException(404, "not found")
        if req.label is not None:
            c.execute("UPDATE providers SET label=? WHERE id=?", (req.label, pid))
        if req.mount_subdir is not None:
            # Nếu đang mounted → không cho đổi (cần unmount trước)
            mp = provider_mount_path(p)
            if os.path.ismount(mp):
                raise HTTPException(400, "Đổi mount_subdir cần unmount trước")
            # Nếu mount_subdir khác → cũng move mount_path nếu đã tồn tại
            new_mp = os.path.join(MOUNT_ROOT, req.mount_subdir)
            old_mp = provider_mount_path(p)
            if old_mp != new_mp and os.path.exists(old_mp):
                try:
                    os.rename(old_mp, new_mp)
                except Exception as e:
                    log.warning("rename mount_path: %s", e)
            c.execute("UPDATE providers SET mount_subdir=? WHERE id=?", (req.mount_subdir, pid))
        if req.enabled is not None:
            c.execute("UPDATE providers SET enabled=? WHERE id=?", (1 if req.enabled else 0, pid))
        # Trả về provider mới
        p = c.execute("SELECT id,kind,label,rclone_remote,mount_subdir,account_email,enabled,created_at FROM providers WHERE id=?", (pid,)).fetchone()
        p = dict(p)
        p["enabled"] = bool(p["enabled"])
        p["status"] = mount_status(pid)
    return p


@app.post("/api/providers/{pid}/test")
def test_provider_connection(pid: int, uid: int = Depends(current_user)):
    """Test kết nối tới remote — gọi rclone lsd (list directory)."""
    import urllib.request
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not p:
        raise HTTPException(404, "not found")
    # Refresh token trước (OneDrive)
    if p["kind"] == "onedrive":
        try:
            oauth = _refresh_onedrive_token(p)
            # discover drive_id nếu thiếu
            sections = parse_rclone_conf(open(RCLONE_CONF).read())
            section = sections.get(f"tmc_{p['kind']}_{p['id']}", {})
            if not section.get("drive_id"):
                drive_id, drive_type = _discover_onedrive_drive(oauth)
                if drive_id:
                    oauth["drive_id"] = drive_id
                    oauth["drive_type"] = drive_type
                    write_rclone_conf(p["id"], p["kind"], oauth)
                    c2 = db()
                    try:
                        c2.execute("UPDATE providers SET oauth_json=? WHERE id=?",
                                   (encrypt(json.dumps(oauth)), p["id"]))
                        c2.commit()
                    finally:
                        c2.close()
        except Exception as e:
            return {"ok": False, "error": f"refresh token fail: {e}"}
    cmd = ["rclone", "lsd", f"--config={RCLONE_CONF}", f"{p['rclone_remote']}:", "--max-depth=1"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if out.returncode != 0:
            return {"ok": False, "error": out.stderr.strip() or out.stdout.strip(), "stdout": out.stdout[:500]}
        # Đếm số entries
        entries = [l for l in out.stdout.splitlines() if l.strip()]
        return {"ok": True, "entries": len(entries), "sample": entries[:10]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout (20s)"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/providers/{pid}/refresh-quota")
def refresh_provider_quota(pid: int, uid: int = Depends(current_user)):
    """Force refresh quota ngay lập tức (thay vì chờ quota fetch tự động)."""
    import urllib.request, urllib.error
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not p:
        raise HTTPException(404, "not found")
    if p["kind"] != "onedrive":
        return {"kind": p["kind"], "msg": "chỉ OneDrive có quota API"}
    try:
        oauth = _refresh_onedrive_token(p)
        tok = oauth["token"]["access_token"]
        req = urllib.request.Request(
            "https://graph.microsoft.com/v1.0/me/drive?$select=quota",
            headers={"Authorization": f"Bearer {tok}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            q = json.loads(r.read()).get("quota", {})
        return {"kind": "onedrive", "used": q.get("used"), "total": q.get("total"),
                "remaining": q.get("remaining"), "deleted": q.get("deleted"),
                "ts": datetime.utcnow().isoformat()}
    except urllib.error.HTTPError as e:
        return {"kind": "onedrive", "error": f"HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"kind": "onedrive", "error": str(e)}


@app.post("/api/providers/cleanup-mounts")
def cleanup_stale_mounts(uid: int = Depends(current_user)):
    """Cleanup stale FUSE mount points không còn owner process nào.
    Quét /CloudDrive/* — xóa những dir không phải mountpoint nhưng từng thuộc provider đã xoá."""
    cleaned = []
    if not os.path.isdir(MOUNT_ROOT):
        return {"cleaned": []}
    for entry in os.listdir(MOUNT_ROOT):
        p = os.path.join(MOUNT_ROOT, entry)
        if os.path.isdir(p) and not os.path.ismount(p):
            # Check rỗng không
            try:
                if not os.listdir(p):
                    os.rmdir(p)
                    cleaned.append(p)
            except Exception:
                pass
    return {"cleaned": cleaned}


@app.get("/api/providers/{pid}/details")
def provider_details(pid: int, uid: int = Depends(current_user)):
    """Thông tin chi tiết: rclone config, mount path, sync jobs count, mounts history."""
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
        if not p:
            raise HTTPException(404, "not found")
        # Mount info
        m = c.execute("SELECT * FROM mounts WHERE provider_id=?", (pid,)).fetchone()
        mp = provider_mount_path(p)
        is_mount = os.path.ismount(mp)
        # Sync jobs count
        n_jobs = c.execute("SELECT COUNT(*) AS n FROM sync_jobs WHERE provider_id=?", (pid,)).fetchone()["n"]
        last_jobs = [dict(r) for r in c.execute(
            "SELECT id, kind, status, started_at, finished_at FROM sync_jobs "
            "WHERE provider_id=? ORDER BY id DESC LIMIT 5", (pid,)).fetchall()]
        # Drive info
        try:
            sections = parse_rclone_conf(open(RCLONE_CONF).read())
            rclone_section = sections.get(f"tmc_{p['kind']}_{p['id']}", {})
            # Ẩn token
            rclone_section = {k: ("***" if k == "token" else v) for k, v in rclone_section.items()}
        except Exception:
            rclone_section = {}
    return {
        "id": p["id"], "kind": p["kind"], "label": p["label"],
        "rclone_remote": p["rclone_remote"], "mount_subdir": p["mount_subdir"],
        "account_email": p["account_email"], "enabled": bool(p["enabled"]),
        "created_at": p["created_at"],
        "mount": {
            "path": mp, "is_mounted": is_mount,
            "pid": m["pid"] if m else None,
            "started_at": m["started_at"] if m else None,
            "last_error": m["last_error"] if m else None,
        },
        "rclone_config": rclone_section,
        "sync": {"jobs_count": n_jobs, "recent": last_jobs},
    }


@app.post("/api/providers/{pid}/mount")
def api_mount(pid: int, uid: int = Depends(current_user)):
    with db() as c:
        ok = c.execute("SELECT 1 FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not ok:
        raise HTTPException(404, "not found")
    mount_provider(pid)
    return mount_status(pid)


@app.post("/api/providers/{pid}/unmount")
def api_unmount(pid: int, uid: int = Depends(current_user)):
    with db() as c:
        ok = c.execute("SELECT 1 FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not ok:
        raise HTTPException(404, "not found")
    unmount_provider(pid)
    return mount_status(pid)


# ── sync progress (in-memory, broadcast qua WebSocket) ──────────────────
SYNC_PROGRESS: dict[int, dict] = {}  # provider_id → {state, files_done, files_total, bytes_up, bytes_down, current, eta_sec, started_at, finished_at, error}
_ws_clients: dict[int, set] = {}      # provider_id → set[WebSocket]


def _progress_update(provider_id: int, **kwargs):
    """Merge progress state, broadcast to all WS clients."""
    cur = SYNC_PROGRESS.setdefault(provider_id, {
        "state": "idle", "files_done": 0, "files_total": 0,
        "bytes_up": 0, "bytes_down": 0, "current": "",
        "eta_sec": None, "started_at": None, "finished_at": None,
        "error": None,
    })
    cur.update(kwargs)
    # broadcast (non-blocking)
    clients = list(_ws_clients.get(provider_id, set()))
    payload = _json.dumps(cur)
    for ws in clients:
        try:
            asyncio.run_coroutine_threadsafe(ws.send_text(payload), _BROADCAST_LOOP)
        except Exception:
            pass


_BROADCAST_LOOP = None  # set on startup event


@app.on_event("startup")
async def _init_loop():
    global _BROADCAST_LOOP
    _BROADCAST_LOOP = asyncio.get_running_loop()


@app.websocket("/ws/sync/{pid}")
async def ws_sync(ws: WebSocket, pid: int):
    """WebSocket: stream progress của sync provider pid."""
    await ws.accept()
    token = ws.query_params.get("token")
    if not token:
        await ws.close(code=4001); return
    with db() as c:
        row = c.execute("SELECT user_id FROM sessions WHERE token=?", (token,)).fetchone()
    if not row:
        await ws.close(code=4001); return
    # verify provider belongs to user
    with db() as c:
        ok = c.execute("SELECT 1 FROM providers WHERE id=? AND user_id=?", (pid, row["user_id"])).fetchone()
    if not ok:
        await ws.close(code=4003); return
    _ws_clients.setdefault(pid, set()).add(ws)
    try:
        cur = SYNC_PROGRESS.get(pid) or {"state": "idle"}
        await ws.send_text(_json.dumps(cur))
        while True:
            await ws.receive_text()  # block until client disconnects
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.get(pid, set()).discard(ws)


# ── quota (gọi Graph API cho OneDrive) ────────────────────────────────
@app.get("/api/providers/{pid}/quota")
def provider_quota(pid: int, uid: int = Depends(current_user)):
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not p:
        raise HTTPException(404, "not found")
    if p["kind"] != "onedrive":
        return {"kind": p["kind"], "used": None, "total": None,
                "msg": f"quota cho {p['kind']} chưa hỗ trợ (đang làm)"}
    try:
        oauth = json.loads(decrypt(p["oauth_json"]))
        tok = oauth["token"]["access_token"]
        import urllib.request
        req = urllib.request.Request(
            "https://graph.microsoft.com/v1.0/me/drive?$select=quota",
            headers={"Authorization": f"Bearer {tok}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            q = json.loads(r.read()).get("quota", {})
        return {"kind": "onedrive",
                "used": q.get("used"), "total": q.get("total"),
                "remaining": q.get("remaining"), "deleted": q.get("deleted")}
    except Exception as e:
        return {"kind": "onedrive", "used": None, "total": None, "error": str(e)}


@app.post("/api/providers/{pid}/sync")
def api_sync(pid: int, uid: int = Depends(current_user)):
    with db() as c:
        p = c.execute("SELECT * FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not p:
        raise HTTPException(404, "not found")
    mp = provider_mount_path(p)
    if not os.path.ismount(mp):
        mount_provider(pid)
    with db() as c:
        c.execute("INSERT INTO sync_jobs(provider_id,kind,status,started_at) VALUES(?,?,?,?)",
                  (pid, "bisync", "queued", datetime.utcnow().isoformat()))
        job_id = c.execute("SELECT last_insert_rowid() AS i").fetchone()["i"]
    threading.Thread(target=_run_sync_job, args=(job_id, pid), daemon=True).start()
    return {"job_id": job_id, "status": "queued", "state": SYNC_PROGRESS.get(pid, {}).get("state", "idle")}


@app.get("/api/sync/progress/{pid}")
def api_sync_progress(pid: int, uid: int = Depends(current_user)):
    with db() as c:
        ok = c.execute("SELECT 1 FROM providers WHERE id=? AND user_id=?", (pid, uid)).fetchone()
    if not ok:
        raise HTTPException(404, "not found")
    return SYNC_PROGRESS.get(pid, {"state": "idle"})


def _parse_rclone_progress(line: str, state: dict) -> dict:
    """Parse 1 dòng stdout từ `rclone ... --progress --stats-one-line`.
    Thực tế 1 dòng có thể chứa NHIỀU progress liên tiếp (no CRLF between updates):
      '0 B / 915.843 KiB, 0%, ... (xfr#0/10)256 KiB / 64.564 GiB, 0%, ... (xfr#30/10042)'
    → lấy segment cuối cùng (mới nhất).
    """
    import re
    out = dict(state)
    # Split theo dấu ')' rồi nối lại để mỗi segment là 1 entry
    segments = re.findall(r'[^)]*\([^)]*\)', line) if ')' in line else [line]
    if not segments:
        segments = [line]
    last = segments[-1]
    # file count: (xfr#30/10042)
    m = re.search(r'\(xfr#(\d+)/(\d+)\)', last)
    if m:
        out["files_done"] = int(m.group(1)); out["files_total"] = int(m.group(2))
    # bytes + %
    m = re.search(r'([\d.]+\s*\w+)\s*/\s*([\d.]+\s*\w+),\s*(\d+)%(?:,\s*([\d.]+\s*\w+/s))?', last)
    if m:
        out["bytes_done"] = m.group(1); out["bytes_total"] = m.group(2)
        out["pct"] = int(m.group(3))
        if m.group(4): out["speed"] = m.group(4)
    # ETA
    m = re.search(r'ETA\s+([^\s(]+)', last)
    if m and m.group(1) != '-': out["eta_sec"] = m.group(1)
    return out


def _run_sync_job(job_id: int, provider_id: int):
    """bisync thật + progress. Cần local mirror vì bisync yêu cầu local path."""
    _progress_update(provider_id, state="running", started_at=datetime.utcnow().isoformat(),
                     files_done=0, files_total=0, error=None)
    with db() as c:
        c.execute("UPDATE sync_jobs SET status='running' WHERE id=?", (job_id,))
        p = c.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
    # bisync cần local mirror ở ngoài FUSE
    local_mirror = os.path.join(APP_DIR, "mirrors", p["mount_subdir"])
    os.makedirs(local_mirror, exist_ok=True)
    # thử bisync, fail fallback copy_down
    use_bisync = os.path.exists(os.path.join(local_mirror, ".last-sync"))
    cmd = ["rclone", "bisync" if use_bisync else "copy",
           f"--config={RCLONE_CONF}",
           "--progress",
           "--stats=2s",
           "--stats-one-line",
           "--transfers=4",
           "--ignore-errors",  # continue past individual file errors
           "--exclude", "Kho lưu trữ cá nhân/**",  # user's OneDrive folder with broken ID
           f"{p['rclone_remote']}:", local_mirror] if not use_bisync else \
          ["rclone", "bisync", f"--config={RCLONE_CONF}",
           "--progress", "--stats=2s", "--stats-one-line",
           "--ignore-errors",
           "--exclude", "Kho lưu trữ cá nhân/**",
           "--resync",  # first run = full resync
           f"{p['rclone_remote']}:", local_mirror]
    log_path = os.path.join(APP_DIR, f"sync_{job_id}.log")
    try:
        # PYTHONUNBUFFERED + line-buffered pipe
        env = os.environ.copy(); env["PYTHONUNBUFFERED"] = "1"
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1, env=env)
        current_file = ""
        state = {"files_done": 0, "files_total": 0}
        with open(log_path, "w", buffering=1) as lf:  # line-buffered file
            while True:
                line = proc.stdout.readline()
                if not line:
                    if proc.poll() is not None: break
                    continue
                lf.write(line); lf.flush()
                # lấy tên file đang transfer (rclone in "filename.ext\n" trước stats)
                if line.strip() and not line.startswith(("Trans", "Checks", "Errors", "ETA",
                                                          "Speed", " *", "  ")):
                    fname = line.strip()
                    if len(fname) < 200 and "/" in fname or "\\" in fname or "." in fname:
                        if not re.match(r'^\d', fname) and "B/s" not in fname:
                            current_file = os.path.basename(fname)
                state = _parse_rclone_progress(line, state)
                _progress_update(provider_id, current=current_file, **state)
        proc.wait()
        if proc.returncode == 0:
            open(os.path.join(local_mirror, ".last-sync"), "w").close()
            _progress_update(provider_id, state="ok",
                             finished_at=datetime.utcnow().isoformat())
            with db() as c:
                c.execute("UPDATE sync_jobs SET status='ok', finished_at=?, log=? WHERE id=?",
                          (datetime.utcnow().isoformat(), log_path, job_id))
        else:
            _progress_update(provider_id, state="error",
                             finished_at=datetime.utcnow().isoformat(),
                             error=f"exit code {proc.returncode}")
            with db() as c:
                c.execute("UPDATE sync_jobs SET status='error', finished_at=?, log=? WHERE id=?",
                          (datetime.utcnow().isoformat(), log_path, job_id))
    except Exception as e:
        _progress_update(provider_id, state="error", finished_at=datetime.utcnow().isoformat(),
                         error=str(e))
        with db() as c:
            c.execute("UPDATE sync_jobs SET status='error', finished_at=?, log=? WHERE id=?",
                      (datetime.utcnow().isoformat(), f"ERROR: {e}", job_id))


@app.get("/api/sync/jobs")
def list_sync_jobs(uid: int = Depends(current_user)):
    with db() as c:
        return [dict(r) for r in c.execute(
            """SELECT j.*, p.label FROM sync_jobs j JOIN providers p ON p.id=j.provider_id
               WHERE p.user_id=? ORDER BY j.id DESC LIMIT 50""", (uid,)).fetchall()]


@app.get("/api/sync/jobs")
def list_sync_jobs(uid: int = Depends(current_user)):
    with db() as c:
        return [dict(r) for r in c.execute(
            """SELECT j.*, p.label FROM sync_jobs j JOIN providers p ON p.id=j.provider_id
               WHERE p.user_id=? ORDER BY j.id DESC LIMIT 50""", (uid,)).fetchall()]


@app.get("/api/settings")
def get_settings(uid: int = Depends(current_user)):
    with db() as c:
        rows = c.execute("SELECT key, value FROM settings").fetchall()
    kv = {r["key"]: r["value"] for r in rows}
    # defaults
    return {
        "auto_mount_on_startup": kv.get("auto_mount", "true") == "true",
        "sync_interval_seconds": int(kv.get("sync_interval", "300")),
        "start_minimized": kv.get("start_minimized", "false") == "true",
        "theme": kv.get("theme", "dark"),
        "default_view": kv.get("default_view", "list"),
    }


class SettingsUpdate(BaseModel):
    auto_mount_on_startup: Optional[bool] = None
    sync_interval_seconds: Optional[int] = None
    start_minimized: Optional[bool] = None
    theme: Optional[str] = None
    default_view: Optional[str] = None


@app.put("/api/settings")
def update_settings(req: SettingsUpdate, uid: int = Depends(current_user)):
    with db() as c:
        if req.auto_mount_on_startup is not None:
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('auto_mount',?)",
                      ("true" if req.auto_mount_on_startup else "false",))
        if req.sync_interval_seconds is not None:
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('sync_interval',?)",
                      (str(req.sync_interval_seconds),))
        if req.start_minimized is not None:
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('start_minimized',?)",
                      ("true" if req.start_minimized else "false",))
        if req.theme is not None:
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('theme',?)", (req.theme,))
        if req.default_view is not None:
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('default_view',?)", (req.default_view,))
    return get_settings(uid)


@app.post("/api/auth/change-password")
def change_password(req: dict, uid: int = Depends(current_user)):
    """Đổi mật khẩu. Vì auth auto-bypass, 'old_password' optional."""
    new_pw = req.get("new_password", "")
    if len(new_pw) < 6:
        raise HTTPException(400, "mật khẩu mới tối thiểu 6 ký tự")
    old_pw = req.get("old_password", "")
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not u:
            raise HTTPException(404, "user không tồn tại")
        if old_pw and not verify_password(old_pw, u["pw_hash"], u["pw_salt"]):
            raise HTTPException(401, "mật khẩu cũ sai")
        h, s = hash_password(new_pw)
        c.execute("UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?", (h, s, uid))
        # cập nhật settings luôn (lưu password mới)
        c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('admin_initial_password',?)",
                  (new_pw,))
    return {"changed": True}


@app.get("/api/auth/current-password")
def get_current_password(uid: int = Depends(current_user)):
    """Trả password admin hiện tại (lưu plain trong settings)."""
    with db() as c:
        pw = c.execute("SELECT value FROM settings WHERE key='admin_initial_password'").fetchone()
    return {"password": pw["value"] if pw else None}


# ── OAuth flow: 1-click với pkexec + script ─────────────────────────
import uuid as _uuid

OAUTH_HELPER = os.environ.get("TMC_OAUTH_HELPER") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),  # tamvk/tm-cloud/
    "scripts", "oauth-helper.sh"
)


class OAuthStartReq(BaseModel):
    kind: str                       # 'onedrive' | 'gdrive'
    label: str
    client_id: Optional[str] = None
    client_secret: Optional[str] = None


@app.post("/api/oauth/start")
def oauth_start(req: OAuthStartReq, uid: int = Depends(current_user)):
    """Bắt đầu OAuth flow 1-click: spawn helper script, update status liên tục, frontend subscribe SSE."""
    if req.kind not in ("onedrive", "gdrive"):
        raise HTTPException(400, "kind phải là onedrive hoặc gdrive")
    sid = _uuid.uuid4().hex
    work_dir = os.path.join(APP_DIR, "oauth", sid)
    os.makedirs(work_dir, exist_ok=True)
    token_out = os.path.join(work_dir, "token.json")
    status_out = os.path.join(work_dir, "status.json")
    # write initial status
    with open(status_out, "w") as f:
        json.dump({"state": "pending", "message": "Đang khởi động", "updated_at": datetime.utcnow().isoformat()}, f)
    pid_path = os.path.join(work_dir, "helper.pid")
    now = datetime.utcnow().isoformat()
    with db() as c:
        c.execute("""INSERT INTO oauth_sessions(id,user_id,kind,client_id,client_secret,label,
                                              state,message,token_path,created_at,updated_at)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                  (sid, uid, req.kind, req.client_id, req.client_secret, req.label,
                   "pending", "Đang khởi động", token_out, now, now))
    # spawn helper via pkexec (nếu script cần sudo thì prompt; nếu user cancel → exit)
    helper_cmd = f"bash {OAUTH_HELPER} {req.kind} '{req.client_id or ''}' '{req.client_secret or ''}' {token_out} {status_out}"
    # pkexec yêu cầu GUI (no GUI = fail). Fallback: chạy thẳng, sẽ tự thất bại nếu cần quyền
    # Dùng setsid để helper chạy độc lập với request
    if os.path.exists("/usr/bin/pkexec") and os.environ.get("DISPLAY"):
        spawn_cmd = f"pkexec bash -c '{helper_cmd}'"
    else:
        spawn_cmd = helper_cmd
    subprocess.Popen(spawn_cmd, shell=True, stdout=open(os.path.join(work_dir, "wrapper.log"), "w"),
                     stderr=subprocess.STDOUT, start_new_session=True)
    return {"session_id": sid, "state": "pending"}


@app.get("/api/oauth/status/{sid}")
def oauth_status(sid: str, uid: int = Depends(current_user)):
    """Trả state hiện tại của OAuth session — frontend poll 1s/lần.
    Đồng thời sync state từ status.json → DB để /complete check ổn định."""
    with db() as c:
        row = c.execute("SELECT * FROM oauth_sessions WHERE id=? AND user_id=?", (sid, uid)).fetchone()
    if not row:
        raise HTTPException(404, "session not found")
    out = dict(row)
    # upgrade state từ helper file (nếu có)
    status_path = row["token_path"].replace("token.json", "status.json")
    if os.path.exists(status_path):
        try:
            st = json.load(open(status_path))
            out["state"] = st.get("state", out["state"])
            out["message"] = st.get("message", out["message"])
            # Đồng bộ DB để /complete có thể check state từ row["state"]
            if st.get("state") and st["state"] != row["state"]:
                c2 = db()
                try:
                    c2.execute("UPDATE oauth_sessions SET state=?, message=?, updated_at=? WHERE id=?",
                               (st["state"], st.get("message", out["message"]),
                                datetime.utcnow().isoformat(), sid))
                    c2.commit()
                finally:
                    c2.close()
        except Exception:
            pass
    return out


@app.delete("/api/oauth/cancel/{sid}")
def oauth_cancel(sid: str, uid: int = Depends(current_user)):
    """Cancel OAuth session — kill helper subprocess nếu còn chạy."""
    with db() as c:
        row = c.execute("SELECT * FROM oauth_sessions WHERE id=? AND user_id=?", (sid, uid)).fetchone()
    if not row:
        raise HTTPException(404, "session not found")
    work_dir = os.path.dirname(row["token_path"])
    pid_file = os.path.join(work_dir, "helper.pid")
    if os.path.exists(pid_file):
        try:
            pid = int(open(pid_file).read().strip())
            os.kill(pid, 15)
        except Exception:
            pass
    with db() as c:
        c.execute("UPDATE oauth_sessions SET state='cancelled', updated_at=? WHERE id=?",
                  (datetime.utcnow().isoformat(), sid))
    return {"cancelled": sid}


@app.post("/api/oauth/{sid}/complete")
def oauth_complete(sid: str, uid: int = Depends(current_user)):
    """Helper xong → đọc token.json, tạo provider + mount."""
    with db() as c:
        row = c.execute("SELECT * FROM oauth_sessions WHERE id=? AND user_id=?", (sid, uid)).fetchone()
    if not row:
        raise HTTPException(404, "session not found")
    if row["state"] not in ("done",):
        raise HTTPException(400, f"oauth chưa xong (state={row['state']})")
    if not os.path.exists(row["token_path"]):
        raise HTTPException(400, "token file không tồn tại")
    try:
        token = json.load(open(row["token_path"]))
    except Exception as e:
        raise HTTPException(400, f"token JSON không hợp lệ: {e}")
    oauth = {
        "token": token,
        "client_id": row["client_id"] or "",
        "client_secret": row["client_secret"] or "",
        "account_email": token.get("email") or token.get("user") or "",
    }
    # gọi lại add provider logic
    sub = "OneDrive" if row["kind"] == "onedrive" else "GoogleDrive"
    with db() as c:
        c.execute("""INSERT INTO providers(user_id,kind,label,rclone_remote,mount_subdir,
                       oauth_json,account_email,enabled,created_at)
                     VALUES(?,?,?,?,?,?,?,1,?)""",
                  (uid, row["kind"], row["label"], "", sub,
                   encrypt(json.dumps(oauth)), oauth["account_email"],
                   datetime.utcnow().isoformat()))
        pid = c.execute("SELECT last_insert_rowid() AS i").fetchone()["i"]
        remote = write_rclone_conf(pid, row["kind"], oauth)
        c.execute("UPDATE providers SET rclone_remote=? WHERE id=?", (remote, pid))
        c.execute("UPDATE oauth_sessions SET provider_id=?, updated_at=? WHERE id=?",
                  (pid, datetime.utcnow().isoformat(), sid))
    # auto-mount
    try:
        mount_provider(pid)
    except Exception as e:
        log.warning("auto-mount failed: %s", e)
    return {"provider_id": pid, "rclone_remote": remote, "label": row["label"]}


# ── OAuth config (client_id hints) ──────────────────────────────────────
@app.get("/api/oauth/onedrive/config")
def onedrive_config():
    return {
        "auth_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "scope": "offline_access Files.ReadWrite Files.ReadWrite.all User.Read",
        "instructions": "Mở terminal chạy: rclone authorize onedrive "
                        "(sẽ mở browser Microsoft, login, accept, copy JSON in ra). "
                        "Paste JSON vào dialog bên dưới.",
    }


@app.get("/api/oauth/gdrive/config")
def gdrive_config():
    return {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "scope": "https://www.googleapis.com/auth/drive.file",
        # Backend name là 'drive', không phải 'gdrive' — lỗi phổ biến
        "instructions": "Tạo OAuth Web Client tại https://console.cloud.google.com/apis/credentials "
                        "(Application type: Desktop app). Copy client_id + client_secret. "
                        "Sau đó mở terminal chạy: rclone authorize drive '<client_id>' '<client_secret>' "
                        "(KHÔNG phải 'gdrive' — backend name là 'drive'). "
                        "Browser Google mở → login → cho phép → copy JSON.",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=18686, log_level="info")