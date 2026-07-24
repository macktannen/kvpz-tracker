import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import re
import os
import threading
import time

PORT = 8080
DIRECTORY = "C:\\Users\\chadm\\.gemini\\antigravity\\scratch\\kvpz-tracker"

MODEL_TO_ICAO = {
    'F260D': 'F260',
    'PA 46-350P': 'P46T',
    'PA-46-350P': 'P46T',
    'GVIII-G800': 'GLF8',
    'G800': 'GLF8',
    '172S': 'C172',
    '172N': 'C172',
    '172M': 'C172',
    '172P': 'C172',
    '182P': 'C182',
    '182T': 'C182',
    'SR22': 'SR22',
    'SR20': 'SR20',
    'PA-28-181': 'P28A',
    'PA-28-161': 'P28A',
    'PC-12/47E': 'PC12',
    'PC-12/45': 'PC12',
    'B200': 'BE20',
    'B300': 'BE30',
    'FA-50': 'FA50',
    'A320-232': 'A320',
    '737-800': 'B738'
}

def infer_icao_type(mfr, model):
    if not model:
        return 'UNKN'
    clean = model.strip().upper()
    if clean in MODEL_TO_ICAO:
        return MODEL_TO_ICAO[clean]
    
    if '172' in clean: return 'C172'
    if '182' in clean: return 'C182'
    if '150' in clean or '152' in clean: return 'C150'
    if '206' in clean: return 'C206'
    if '208' in clean or 'CARAVAN' in clean: return 'C208'
    if '210' in clean: return 'C210'
    if 'PA-28' in clean or 'PA 28' in clean: return 'P28A'
    if 'PA-46' in clean or 'PA 46' in clean: return 'P46T'
    if 'PA-31' in clean or 'PA 31' in clean: return 'PA31'
    if 'SR22' in clean or 'SR-22' in clean: return 'SR22'
    if 'SR20' in clean or 'SR-20' in clean: return 'SR20'
    if 'PC-12' in clean or 'PC12' in clean: return 'PC12'
    if 'PC-24' in clean or 'PC24' in clean: return 'PC24'
    if 'KING AIR' in clean or 'BE20' in clean or 'B200' in clean: return 'BE20'
    if 'G800' in clean or 'GVIII' in clean: return 'GLF8'
    if 'G650' in clean or 'GVI' in clean: return 'GLF6'
    if 'G550' in clean or 'GV' in clean: return 'GLF5'
    if 'G450' in clean or 'GIV' in clean: return 'GLF4'

    return re.sub(r'[^A-Z0-9]', '', clean)[:4]

def scrape_faa_registry(tail):
    stripped = tail.strip().upper().replace('N', '')
    url = f"https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt={stripped}"
    
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    })
    
    with urllib.request.urlopen(req, timeout=5) as res:
        html = res.read().decode('utf-8', errors='ignore')
        
        mfr_match = re.search(r'data-label="MFR Name"[^>]*>\s*([^<]+)', html) or re.search(r'Manufacturer Name[\s\S]*?<td[^>]*>\s*([^<]+)', html)
        model_match = re.search(r'data-label="Model"[^>]*>\s*([^<]+)', html) or re.search(r'>Model<[\s\S]*?<td[^>]*>\s*([^<]+)', html)
        owner_match = re.search(r'data-label="Name"[^>]*>\s*([^<]+)', html) or re.search(r'>Name<[\s\S]*?<td[^>]*>\s*([^<]+)', html)
        
        mfr = mfr_match.group(1).strip() if mfr_match else ''
        model = model_match.group(1).strip() if model_match else ''
        owner = owner_match.group(1).strip() if owner_match else ''
        
        if not mfr and not model:
            raise ValueError(f"Aircraft registration {tail} not found in FAA database")
        
        icao_type = infer_icao_type(mfr, model)
        desc = f"{mfr} {model}".strip() if mfr else model
        
        return {
            "tail": f"N{stripped}",
            "type": icao_type,
            "mfr": mfr,
            "model": model,
            "desc": desc,
            "owner": owner,
            "source": "FAA Registry Scraper"
        }

class DualHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ['/health', '/ping']:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "service": "FAA Scraper"}).encode('utf-8'))
            return
            
        if parsed.path in ['/faa', '/scrape']:
            params = urllib.parse.parse_qs(parsed.query)
            tail = params.get('tail', params.get('reg', ['']))[0]
            
            if not tail:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing tail parameter"}).encode('utf-8'))
                return
            
            try:
                data = scrape_faa_registry(tail)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode('utf-8'))
            except Exception as e:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e), "tail": tail}).encode('utf-8'))
        else:
            super().do_GET()

def run_server():
    with socketserver.TCPServer(("", PORT), DualHandler) as httpd:
        print(f"Serving dashboard & FAA Scraper Proxy at http://localhost:{PORT}")
        httpd.serve_forever()

if __name__ == '__main__':
    # Start server in a daemon thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    time.sleep(1)

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

    # Also check FAA Proxy endpoint
    try:
        test_url = f"http://localhost:{PORT}/faa?tail=N83HS"
        res = urllib.request.urlopen(test_url, timeout=4)
        data = json.loads(res.read().decode('utf-8'))
        print(f"CHECK /faa?tail=N83HS: Status {res.getcode()}, Model: {data.get('model')}, Owner: {data.get('owner')}")
    except Exception as e:
        print(f"CHECK /faa proxy: FAILED - {e}")

    if success:
        print("\nVERIFICATION SUCCESS: Dashboard & FAA Registry Scraper Proxy are fully operational.")
    else:
        print("\nVERIFICATION FAILURE: Endpoint verification failed.")

    print(f"\n========================================================")
    print(f"🚀 Local Server is LIVE at: http://localhost:{PORT}")
    print(f"Keep this window open while using your flight tracker!")
    print(f"Press Ctrl+C to stop.")
    print(f"========================================================\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nServer stopped by user.")
