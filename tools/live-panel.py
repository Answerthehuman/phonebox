#!/usr/bin/env python3
"""
Live panel in a desktop browser, with YOUR computer's real data, using the panel files from this folder.

    python tools/live-panel.py [port]        # then open http://127.0.0.1:8791/panel/

It serves android/app/src/main/assets/www straight from disk (edit a file, reload the page) and forwards the panel's
/agent/api/* calls to the PhoneBox agent that is already running on this computer (127.0.0.1:8765). The agent that
ships with PhoneBox embeds its own, older copy of the panel at :8765/panel/, so this is how you see the new design
with live data without rebuilding the agent.

Safety: it listens on 127.0.0.1 only, answers only its own Host name, refuses any request that carries a foreign
Origin and requires the panel's X-PhoneBox-Panel header on API calls, so a web page you happen to have open cannot
use it to talk to the agent. Only the Python standard library is used.
"""
import http.client, mimetypes, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

WWW = Path(__file__).resolve().parent.parent / 'android' / 'app' / 'src' / 'main' / 'assets' / 'www'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
AGENT = ('127.0.0.1', 8765)
HOSTS = {f'127.0.0.1:{PORT}', f'localhost:{PORT}'}
mimetypes.add_type('text/javascript', '.js'); mimetypes.add_type('font/ttf', '.ttf')


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'PhoneBoxLive'

    def log_message(self, *a): pass

    def deny(self, code=403, msg='forbidden'):
        body = msg.encode()
        self.send_response(code); self.send_header('Content-Length', str(len(body))); self.send_header('Connection', 'close'); self.end_headers(); self.wfile.write(body)
        self.close_connection = True

    def guard(self):
        if self.headers.get('Host', '') not in HOSTS: return self.deny()
        origin = self.headers.get('Origin')
        if origin and urlparse(origin).netloc not in HOSTS: return self.deny()
        return True

    def do_GET(self): self.route()
    def do_POST(self): self.route()
    def do_PUT(self): self.route()
    def do_DELETE(self): self.route()

    def route(self):
        if not self.guard(): return
        path = urlparse(self.path).path
        if path.startswith('/agent/'):
            if self.headers.get('X-PhoneBox-Panel') != '1': return self.deny()
            return self.forward()
        if self.command != 'GET': return self.deny(405, 'method not allowed')
        if path in ('/', '/panel'):
            self.send_response(302); self.send_header('Location', '/panel/'); self.send_header('Content-Length', '0'); self.end_headers(); return
        if path.startswith('/panel/'):
            rel = path[len('/panel/'):] or 'index.html'
            f = (WWW / rel).resolve()
            if WWW.resolve() not in f.parents or not f.is_file(): return self.deny(404, 'not found')
            data = f.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', (mimetypes.guess_type(f.name)[0] or 'application/octet-stream') + ('; charset=utf-8' if f.suffix in ('.html', '.js', '.css') else ''))
            self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(data); return
        self.deny(404, 'not found')

    def forward(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else None
        headers = {k: v for k, v in self.headers.items() if k.lower() in ('content-type', 'accept', 'x-phonebox-panel', 'x-config-version', 'authorization')}
        headers['Host'] = f'{AGENT[0]}:{AGENT[1]}'
        try:
            c = http.client.HTTPConnection(*AGENT, timeout=60)
            c.request(self.command, self.path, body=body, headers=headers)
            r = c.getresponse()
        except OSError as e:
            return self.deny(502, f'PhoneBox agent not reachable on {AGENT[0]}:{AGENT[1]}: {e}')
        stream = 'text/event-stream' in (r.getheader('Content-Type') or '')
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() in ('content-type', 'cache-control', 'etag', 'x-config-version'): self.send_header(k, v)
        if stream:
            self.send_header('Connection', 'close'); self.end_headers(); self.close_connection = True
            try:
                while True:
                    chunk = r.read1(4096)
                    if not chunk: break
                    self.wfile.write(chunk); self.wfile.flush()
            except OSError: pass
            finally: c.close()
            return
        data = r.read(); c.close()
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)


if __name__ == '__main__':
    print(f'Live panel: http://127.0.0.1:{PORT}/panel/   (agent: {AGENT[0]}:{AGENT[1]})  Ctrl+C to stop')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
