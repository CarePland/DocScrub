#!/usr/bin/env python3
"""serve.py -- DocScrub's static dev server (2026-08-01).

Replaces the bare `python3 -m http.server`, which sends NO Cache-Control
header. Without one, Chrome applies HEURISTIC freshness (roughly 10% of a
file's age since Last-Modified) to every dist/ module -- so after a
rebuild, the first refresh could assemble a MIXED-VERSION module graph
(some modules stale from cache, some fresh), the import graph throws
during evaluation, and the page renders blank until a second reload
repairs the cache. That was the long-standing "first refresh is blank,
reload fixes it" bug, and also why picking up a new build required
Cmd-Shift-R.

`Cache-Control: no-cache` does NOT mean "don't cache" -- it means
"revalidate before use": the browser sends If-Modified-Since and the
server answers 304 for unchanged files, so reloads stay fast while every
load is version-consistent. Plain reloads now always serve the current
build.

Usage: python3 serve.py [port]   (started by start-server.command /
`npm run serve`; keep all three in sync).
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Serving with Cache-Control: no-cache on :{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
