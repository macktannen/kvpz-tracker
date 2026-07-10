import http.server
import socketserver
import threading
import urllib.request
import time
import os

PORT = 8080
DIRECTORY = "C:\\Users\\chadm\\.gemini\\antigravity\\scratch\\kvpz-tracker"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run_server():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()

# Start server in a daemon thread
server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()

# Wait for server to start
time.sleep(1)

# Verify endpoints
files_to_check = ["index.html", "style.css", "app.js"]
success = True

for f in files_to_check:
    url = f"http://localhost:{PORT}/{f}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        res = urllib.request.urlopen(req, timeout=2)
        code = res.getcode()
        content_len = len(res.read())
        print(f"CHECK {f}: Status {code}, Size {content_len} bytes")
        if code != 200 or content_len == 0:
            success = False
    except Exception as e:
        print(f"CHECK {f}: FAILED - {e}")
        success = False

if success:
    print("VERIFICATION SUCCESS: All dashboard files are successfully served and valid.")
else:
    print("VERIFICATION FAILURE: One or more files failed to be served correctly.")
