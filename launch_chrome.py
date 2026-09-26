"""
launch_chrome.py - Python Launcher to open AUTOTHRASH Web Simulation in Google Chrome.
SIH 2026 Engineering Simulation Prototype.
"""

import os
import sys
import time
import subprocess
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = os.path.join(BASE_DIR, "index.html")

def find_chrome_executable():
    """Locates Google Chrome on Windows in common paths and registry."""
    possible_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
    ]
    for path in possible_paths:
        if os.path.isfile(path):
            return path
    return None

class LocalDirectoryHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)
    
    def log_message(self, format, *args):
        # Suppress noisy HTTP asset logs in console
        pass

def start_server():
    server = HTTPServer(('127.0.0.1', PORT), LocalDirectoryHandler)
    server.serve_forever()

def main():
    print("=" * 70)
    print("   AUTOTHRASH: Autonomous Navigation Simulation (SIH 2026)")
    print("   Starting Local Web Dashboard & Launching in Google Chrome...")
    print("=" * 70)

    if not os.path.exists(INDEX_FILE):
        print(f"[ERROR] Could not find index.html at: {INDEX_FILE}")
        sys.exit(1)

    # 1. Start HTTP Server in background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    time.sleep(0.4)

    url = f"http://localhost:{PORT}/index.html"
    chrome_path = find_chrome_executable()

    print(f"\n[OK] Local Web Server running at: {url}")

    if chrome_path:
        print(f"[OK] Google Chrome located at: {chrome_path}")
        print(f"[OK] Opening {url} in Google Chrome...\n")
        try:
            subprocess.Popen([chrome_path, url])
        except Exception as e:
            print(f"[WARN] Failed to open with subprocess: {e}, falling back to default browser.")
            webbrowser.open(url)
    else:
        print("[INFO] Google Chrome executable not found in default paths. Using default browser handler.")
        webbrowser.open(url)

    print("=" * 70)
    print("Dashboard is now running in Chrome!")
    print("Press CTRL + C in this PowerShell window to stop the server.")
    print("=" * 70)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[INFO] AUTOTHRASH Web Server stopped.")
        sys.exit(0)

if __name__ == "__main__":
    main()
