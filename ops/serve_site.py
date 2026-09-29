"""Serve a published Yukti release folder over HTTP with Range (resume) support.

Use it to test the one-click install locally, or to host the download page on an intranet server:
    python ops/serve_site.py E:/yukti-build/publish --port 9000
"""
import argparse
import http.server
import os
import re
from functools import partial


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):  # noqa: D401 - add single-range support to the stdlib handler
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or os.path.isdir(path) or not os.path.exists(path):
            return super().send_head()
        m = re.match(r"bytes=(\d+)-(\d*)$", rng.strip())
        size = os.path.getsize(path)
        if not m or int(m.group(1)) >= size:
            self.send_error(416, "Requested Range Not Satisfiable")
            return None
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(1 << 20, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self._remaining = None

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--port", type=int, default=9000)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    http.server.ThreadingHTTPServer((a.host, a.port), partial(RangeHandler, directory=a.folder)).serve_forever()
