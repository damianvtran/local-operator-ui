import os,json,pathlib,asyncio,threading,http.server
root=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD'])/'final-audio-inputs'
os.environ['HOME']=str(root/'replay-home');os.environ['LOCAL_OPERATOR_CONFIG_DIR']=str(root/'replay-config')
from local_operator.tools import audio_tool
from local_operator.audiogen import rungs
from local_operator.audiogen.models import AudioJobSpec
p=pathlib.Path('/Users/damian/.local-operator/sessions/6c9c8f09af70/scratchpad/audio-live')
receipt=json.loads((p/'cancel-response.json').read_text());submit=json.loads((p/'cancel-submit.json').read_text());settled=json.loads((p/'cancel-status.json').read_text())
class Handler(http.server.BaseHTTPRequestHandler):
 def do_POST(self):
  print('received replay', self.path);assert self.path=='/tools/audio/cancel'
  self.rfile.read(int(self.headers.get('Content-Length','0')));body=json.dumps(receipt).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
async def main():
 handle=rungs.CancelHandle();handle.provider='radient';handle.model=submit['model'];handle.request_id=submit['request_id'];handle.base_url='http://127.0.0.1:'+str(server.server_port);handle.credential=None
 spec=AudioJobSpec(tool='generate_voiceover',direction='voiceover',text=json.loads((p/'cancel-submit-req.json').read_text())['text'],model=submit['model'])
 print('handle',handle.base_url,handle.request_id)
 text,details=await audio_tool._cancel_receipt(spec,handle,None,{'route':'radient'})
 print('replay outcome',text,details)
 assert details['settled'] is None and details['cost_usd'] is None and details['cost']['basis']=='quote'
 (root/'cancel-replay.json').write_text(json.dumps({'submit':submit,'receipt':receipt,'settled':settled,'args':{'text':spec.text,'model':spec.model},'result':{'tool_call_id':'release-cancel','tool_name':'generate_voiceover','is_error':True,'content':[{'type':'text','text':text}],'details':details}},indent=2));print(json.dumps({'text':text,'details':details},indent=2))
asyncio.run(main());server.shutdown();server.server_close()
