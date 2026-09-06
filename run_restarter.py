# run_restarter.py
import subprocess
import time
import sys

while True:
    try:
        print("[Restarter] Starting fastapi_app.py...")
        # Start uvicorn server
        p = subprocess.Popen([sys.executable, "fastapi_app.py"])
        p.wait()
    except KeyboardInterrupt:
        print("[Restarter] Stopped by user request.")
        break
    except Exception as e:
        print(f"[Restarter] Error: {e}")
    print("[Restarter] Server exited. Restarting in 2 seconds...")
    time.sleep(2)
