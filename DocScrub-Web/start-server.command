#!/bin/bash
# start-server.command
#
# One-off helper for Phase 10.1 real-browser validation. Double-click this
# file in Finder to build the thin UI and serve it over http on port 8000
# so it can be opened in an actual browser (file:// does not work for ES
# module imports -- see index.html's own top comment).
#
# Safe to delete after browser validation is complete; it is not part of
# the application itself.
cd "$(dirname "$0")"
{
  echo "=== build started: $(date) ==="
  npm run build
  BUILD_EXIT=$?
  echo "=== build finished, exit code: $BUILD_EXIT ==="
  if [ "$BUILD_EXIT" -ne 0 ]; then
    echo "=== build failed, not starting server ==="
    exit 1
  fi
  echo "=== starting static server on :8000 ==="
  npm run serve
} > server.log 2>&1
