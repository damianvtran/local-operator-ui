from html.parser import HTMLParser
import html,re
class MetaCsp(HTMLParser):
 def __init__(self,text):super().__init__(convert_charrefs=True);self.text=text;self.lines=text.splitlines(keepends=True);self.rows=[];self.comments=[];self.feed(text)
 def handle_comment(self,s):self.comments.append(s)
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag.lower()!='meta' or a.get('http-equiv','').lower()!='content-security-policy':return
  raw=self.get_starttag_text();m=re.search(r'''\bcontent\s*=\s*(["'])(.*?)\1''',raw,re.I|re.S);assert m,'actual CSP meta missing quoted content';line,col=self.getpos();offset=sum(map(len,self.lines[:line-1]))+col;self.rows.append({'start':offset+m.start(2),'end':offset+m.end(2),'content':a['content']})
def constrain(text):
 before=MetaCsp(text);assert len(before.rows)==1,'one actual CSP meta required';row=before.rows[0];parts=[x.strip()for x in row['content'].split(';')if x.strip()];assert sum(x.split()[0]=='connect-src'for x in parts)==1
 new=[]
 for part in parts:
  tokens=part.split();name=tokens[0]
  if name=='connect-src':part="connect-src 'self' http://127.0.0.1:8127"
  elif name in ['frame-src','media-src','img-src']and'http://127.0.0.1:8127'not in tokens:part+=' http://127.0.0.1:8127'
  new.append(part)
 value=html.escape('; '.join(new)+';',quote=True);out=text[:row['start']]+value+text[row['end']:];after=MetaCsp(out);assert len(after.rows)==1;assert after.comments==before.comments,'comment changed';connect=[p.strip()for p in after.rows[0]['content'].split(';')if p.strip().startswith('connect-src')];assert connect==["connect-src 'self' http://127.0.0.1:8127"]
 return out,{'actualCspMetas':1,'connectDirective':connect[0],'commentCountUnchanged':len(before.comments),'nonContentBytesUnchanged':out[:row['start']]==text[:row['start']]and out[row['start']+len(value):]==text[row['end']:]}
def controls():
 comment='<!-- connect-src https://COMMENT_ONLY.invalid; must stay byte-identical -->';sample=comment+'\n<meta http-equiv="Content-Security-Policy" content="default-src self; connect-src https://OLD.invalid; img-src self;">';out,proof=constrain(sample);assert comment in out and comment==out.split('\n')[0]
 try:constrain(comment)
 except AssertionError:pass
 else:raise AssertionError('comment-only input accepted as a meta')
 return {'commentOnlyNegative':'REFUSED without writing','commentPlusActualMeta':'comment exact, only attribute edited','positive':proof}
