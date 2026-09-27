# -*- coding: utf-8 -*-
"""开发期冒烟服务：python tools/dev_server.py [port]（前台阻塞，Ctrl+C 停止）。"""
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5020
t = threading.Thread(
    target=lambda: app.app.run(host="127.0.0.1", port=port, debug=False, threaded=True),
    daemon=True,
)
t.start()
time.sleep(1.0)
print(f"READY http://127.0.0.1:{port}", flush=True)
while True:
    time.sleep(3600)
