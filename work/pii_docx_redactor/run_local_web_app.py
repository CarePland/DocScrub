#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
APP_SCRIPT = PROJECT_DIR / "local_web_app.py"
RESTART_EXIT_CODE = 75


def main() -> None:
    open_browser = True
    while True:
        env = os.environ.copy()
        env["DOCSCRUB_OPEN_BROWSER"] = "1" if open_browser else "0"
        result = subprocess.run(
            [sys.executable, str(APP_SCRIPT)],
            cwd=PROJECT_DIR,
            env=env,
            check=False,
        )
        open_browser = False

        if result.returncode == RESTART_EXIT_CODE:
            print("Restart requested. Relaunching local web app...")
            continue

        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
