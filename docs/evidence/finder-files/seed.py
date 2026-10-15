import asyncio,io,json,os
from pathlib import Path
from PIL import Image
from local_operator.paths import config_dir
from local_operator.harness.types import Message,ToolResult,TextContent,ToolCall
from local_operator.session.transcript import Transcript
from local_operator.session.attachments import cache_media
root=config_dir(); sid='b1f1de000001';sd=root/'sessions'/sid;sd.mkdir(parents=True,exist_ok=True)
scratch=sd/'scratchpad';scratch.mkdir(exist_ok=True)
async def go():
 t=Transcript(sd)
 await t.append_message(Message.user('Browse the files produced by this isolated test conversation.'))
 messages=[]
 for i in range(5000):
  ext=['png','mp4','md','csv'][i%4]; path=scratch/f'file-{i:04d}.{ext}'
  if ext=='png':
   buf=io.BytesIO();Image.new('RGB',(192,144),(i%256,90,(i//256)%256)).save(buf,'PNG');path.write_bytes(buf.getvalue())
  elif ext=='mp4':
   os.link(Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD'])/'rig/teaser.mp4',path)
  else:path.write_text('col,value\nrow,42\n' if ext=='csv' else '# Working file\nSynthetic content.\n')
  call=f'write-{i}'
  messages += [Message.assistant('',tool_calls=[ToolCall(id=call,name='write',arguments={'path':str(path),'content':'synthetic fixture'})]),Message.tool_result(ToolResult(tool_call_id=call,tool_name='write',content=[TextContent(text='Wrote file')],details={'path':str(path)}))]
  if len(messages)>=400: await t.append_messages(messages);messages=[]
 if messages:await t.append_messages(messages)
 # A genuine generated-media shape, in addition to path-backed scale files.
 buf=io.BytesIO();Image.new('RGB',(512,512),(20,130,180)).save(buf,'PNG');block=cache_media(buf.getvalue(),'image/png',name='generated-sky.png',width=512,height=512)
 await t.append_messages([Message.assistant('',tool_calls=[ToolCall(id='gen',name='generate_image',arguments={'prompt':'a synthetic blue sky'})]),Message.tool_result(ToolResult(tool_call_id='gen',tool_name='generate_image',content=[TextContent(text=f'Generated image — digest {block.attachment}'),block],details={'artifacts':[{'digest':block.attachment,'kind':'image','name':'generated-sky.png','content_type':'image/png','width':512,'height':512}]}))])
 await t.append_message(Message.assistant('The working files and generated sky are ready.'))
 (sd/'frontend.json').write_text(json.dumps({'cwd':str(scratch),'conversation_name':'Finder scale','conversation_name_source':'user','updated_at':1791996500,'working_directory':str(scratch)}))
 print('seeded',sid,'5000 path files + 1 generated artifact')
asyncio.run(go())

# The larger first chart is an explicit downscaling control; all paths belong to
# the isolated config root supplied by the caller, never the operator's sessions.
Image.new("RGB", (2000, 1200), (0, 90, 0)).save(scratch / "file-0000.png", "PNG")
asyncio.run(Transcript(sd).append_custom("supplement_v1", {
    "anchor": "evidence-highlights", "job": "fixture-highlights", "version": 1,
    "state": "done", "at": 1792001000, "components": [], "files": [
        {"path": str(scratch / "file-0000.png"), "name": "file-0000.png", "kind": "image", "size_bytes": (scratch / "file-0000.png").stat().st_size, "mtime": 1792001000, "why": "A large chart promoted as the main deliverable."},
        {"path": str(scratch / "file-0002.md"), "name": "file-0002.md", "kind": "markdown", "size_bytes": 32, "mtime": 1792001000, "why": "Summary delivered alongside the chart."}
    ]
}))
child = root / "sessions" / "b1f1de000003"
child.mkdir(exist_ok=True)
(child / "origin.json").write_text(json.dumps({"origin": "subagent"}))
(child / "desktop.json").write_text(json.dumps({"version": 1, "cwd": str(child / "scratchpad")}))
buf = io.BytesIO(); Image.new("RGB", (80, 120), (220, 40, 110)).save(buf, "PNG")
a = cache_media(buf.getvalue(), "image/png", name="child-portrait.png", width=80, height=120)
async def child_rows():
    await Transcript(child).append_messages([
        Message.assistant("", tool_calls=[ToolCall(id="child-gen", name="generate_image", arguments={"prompt": "synthetic child portrait"})]),
        Message.tool_result(ToolResult(tool_call_id="child-gen", tool_name="generate_image", content=[TextContent(text=f"Generated child portrait — digest {a.attachment}"), a], details={"artifacts": [{"digest": a.attachment, "kind": "image", "name": "child-portrait.png", "content_type": "image/png", "width": 80, "height": 120}]}))
    ])
asyncio.run(child_rows())
(sd / "subagent-roster.v1.json").write_text(json.dumps({"version": 1, "generation": 1, "jobs": [], "accounting": {}, "records": [{"job_id": "j-child-fixture", "label": "scout", "agent_role": "scout", "depth": 1, "session_dir": str(child)}]}))
empty = root / "sessions" / "b1f1de000002"; empty.mkdir(exist_ok=True)
asyncio.run(Transcript(empty).append_message(Message.user("This isolated session has no files yet.")))
(empty / "frontend.json").write_text(json.dumps({"cwd": str(empty / "scratchpad"), "conversation_name": "Empty Files"}))
