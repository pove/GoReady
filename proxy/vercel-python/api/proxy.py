"""
Minimal reverse proxy that lets the GoReady front-end reach the intervals.icu
API without running into browser CORS restrictions.

It holds no credentials of its own: it simply forwards the Authorization
header and body it receives, as-is, to https://intervals.icu/api/v1/<path>.

Deploy: create a Vercel project with this folder (proxy/vercel-python) as its
Root Directory - Vercel auto-detects api/proxy.py as a Python serverless
function (the `handler` class below is its required convention), no build
step or requirements.txt needed since this uses only the standard library.
Point the app's "Proxy URL" setting at
https://<your-project>.vercel.app/api/proxy
"""

import json
import re
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

INTERVALS_API_BASE = 'https://intervals.icu/api/v1/'
# Restrict this to your own domain in production, e.g. 'https://your-site.example'.
ALLOWED_ORIGIN = '*'


def is_valid_api_path(path):
    """
    Rejects anything that isn't a plain relative path (optionally with a query
    string) under the intervals.icu API base, so this proxy can't be turned
    into an open relay to arbitrary hosts (SSRF).
    """
    if not path:
        return False
    if '..' in path:
        return False
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', path):
        return False  # absolute URL, e.g. "https://evil.example/..."
    if path.startswith('/'):
        return False  # protocol-relative ("//host/...") or absolute ("/...") path
    return True


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._respond_raw(204, b'', None)

    def do_GET(self):
        self._proxy('GET')

    def do_PUT(self):
        self._proxy('PUT')

    def do_POST(self):
        self._respond_json(405, {'error': 'Method not allowed'})

    def do_DELETE(self):
        self._respond_json(405, {'error': 'Method not allowed'})

    def do_PATCH(self):
        self._respond_json(405, {'error': 'Method not allowed'})

    def _proxy(self, method):
        path = parse_qs(urlparse(self.path).query).get('path', [''])[0]
        if not is_valid_api_path(path):
            self._respond_json(400, {'error': 'Invalid path'})
            return

        authorization = self.headers.get('Authorization', '')
        if not authorization:
            self._respond_json(401, {'error': 'Missing Authorization header'})
            return

        body = None
        if method == 'PUT':
            length = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(length) if length > 0 else b''

        headers = {'Accept': 'application/json', 'Authorization': authorization}
        if body is not None:
            headers['Content-Type'] = 'application/json'

        request = Request(INTERVALS_API_BASE + path, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=20) as upstream:
                self._respond_raw(upstream.status, upstream.read(), upstream.headers.get('Content-Type'))
        except HTTPError as error:
            # A non-2xx from intervals.icu - forward its status and body as-is.
            content_type = error.headers.get('Content-Type') if error.headers else None
            self._respond_raw(error.code, error.read(), content_type)
        except URLError as error:
            self._respond_json(502, {'error': str(error.reason)})

    def _respond_json(self, status, payload):
        self._respond_raw(status, json.dumps(payload).encode('utf-8'), 'application/json')

    def _respond_raw(self, status, body, content_type):
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        if content_type:
            self.send_header('Content-Type', content_type)
        self.end_headers()
        self.wfile.write(body)
