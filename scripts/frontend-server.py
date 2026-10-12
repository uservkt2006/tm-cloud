#!/usr/bin/env python3
"""Frontend static server + /api proxy đến backend.
- Static files từ dist/ (production build)
- /api/* proxy đến http://127.0.0.1:18686/* (backend FastAPI)

Dùng stdlib Python không cần pip install.
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
import sys
import os
import threading

DIST_DIR = sys.argv[1] if len(sys.argv) > 1 else '.'
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 5180
BACKEND = os.environ.get('TMC_BACKEND', 'http://127.0.0.1:18686')
THREADS = 16

class Handler(http.server.BaseHTTPRequestHandler):
    # tắt log mỗi request
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        self._route('GET')

    def do_POST(self):
        self._route('POST')

    def do_PUT(self):
        self._route('PUT')

    def do_DELETE(self):
        self._route('DELETE')

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def _route(self, method):
        if self.path.startswith('/api/'):
            self._proxy(method)
        else:
            self._serve_static()

    def _proxy(self, method):
        # đọc body nếu có
        body = None
        if 'Content-Length' in self.headers:
            try:
                length = int(self.headers['Content-Length'])
                body = self.rfile.read(length)
            except Exception:
                pass
        url = BACKEND + self.path
        req = urllib.request.Request(url, data=body, method=method, headers={
            k: v for k, v in self.headers.items() if k.lower() not in ('host',)
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() in ('transfer-encoding', 'connection'):
                        continue
                    self.send_header(k, v)
                # CORS để frontend gọi cross-origin
                self.send_header('Access-Control-Allow-Origin', '*')
                data = resp.read()
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for k, v in e.headers.items():
                if k.lower() in ('transfer-encoding', 'connection'):
                    continue
                self.send_header(k, v)
            self.send_header('Access-Control-Allow-Origin', '*')
            data = e.read()
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.send_header('Access-Control-Allow-Origin', '*')
            msg = str(e).encode()
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def _serve_static(self):
        path = self.path.split('?')[0].split('#')[0]
        if path == '/' or path == '':
            path = '/index.html'
        # bảo mật: chặn ../
        if '..' in path:
            self.send_error(403)
            return
        full = os.path.normpath(DIST_DIR + path)
        if not full.startswith(os.path.abspath(DIST_DIR)):
            self.send_error(403)
            return
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        if not os.path.exists(full):
            # SPA fallback: trả index.html cho mọi route không phải /api
            full = os.path.join(DIST_DIR, 'index.html')
        if not os.path.exists(full):
            self.send_error(404)
            return
        try:
            with open(full, 'rb') as f:
                data = f.read()
            # MIME cơ bản
            ext = os.path.splitext(full)[1].lower()
            mime = {
                '.html': 'text/html', '.js': 'application/javascript',
                '.css': 'text/css', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.png': 'image/png',
                '.ico': 'image/x-icon', '.woff2': 'font/woff2',
            }.get(ext, 'application/octet-stream')
            self.send_response(200)
            self.send_header('Content-Type', mime + '; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            # cache cho static files
            if ext in ('.js', '.css', '.png', '.jpg', '.svg', '.woff2'):
                self.send_header('Cache-Control', 'public, max-age=3600')
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error(500, str(e))


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    os.chdir(DIST_DIR)
    print(f'frontend-server: serving {DIST_DIR} on port {PORT}, backend={BACKEND}', flush=True)
    with ThreadedHTTPServer(('127.0.0.1', PORT), Handler) as srv:
        srv.serve_forever()


if __name__ == '__main__':
    main()
