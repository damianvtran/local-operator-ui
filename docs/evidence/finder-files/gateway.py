"""Evidence-only loopback proxy: real backend responses, explicit UI-state stimuli.
Not an index implementation. Only /files GET is varied; every other route is the
owned real daemon. No credentials are logged. Mode file is owned by this rig.
"""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from pathlib import Path
import json,time
class H(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):self.run_request()
 def do_POST(self):self.run_request()
 def run_request(self):
  index='/files' in self.path and self.command=='GET'
  mode=Path(__file__).with_name('index-mode').read_text().strip() if index else 'ready'
  if mode=='loading':time.sleep(8)
  if mode=='error':
   status=503;body=json.dumps({'detail':'Controlled index failure for UI evidence'}).encode();content='application/json'
  else:
   data=self.rfile.read(int(self.headers.get('Content-Length','0'))) or None
   req=Request('http://127.0.0.1:18735'+self.path,data=data,method=self.command,headers={k:v for k,v in self.headers.items() if k.lower() not in ['host','content-length','connection','accept-encoding']})
   try:
    with urlopen(req,timeout=60) as r:
     status=r.status;content=r.headers.get('Content-Type','application/json')
     if content.startswith('text/event-stream'):
      # Session hydration is a streaming authority snapshot, not a finite JSON
      # document. Buffering to EOF made the fixture's chat wait forever.
      self.send_response(status);self.send_header('Content-Type',content);self.send_header('Cache-Control','no-cache');self.end_headers()
      while True:
       line=r.readline()
       if not line:break
       try:self.wfile.write(line);self.wfile.flush()
       except (BrokenPipeError,ConnectionResetError):break
      return
     body=r.read()
   except HTTPError as e:status=e.code;body=e.read();content='application/json'
   if index and mode=='building' and status==200:
    payload=json.loads(body);r=payload['result'];r['state']='building';r['rows']=r['rows'][:3];r['next_cursor']=None;r['scan']['covered_bytes']=100;r['scan']['total_bytes']=10000;body=json.dumps(payload).encode()
  try:self.send_response(status);self.send_header('Content-Type',content);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  except BrokenPipeError:pass
ThreadingHTTPServer(('127.0.0.1',18736),H).serve_forever()
