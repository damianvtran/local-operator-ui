import json,os,sys
def row(label,n):
    p=f"out/{label}-{n}.json"
    if not os.path.exists(p): return f"{label} {n} MISSING"
    d=json.load(open(p)); h=d.get("historyOnOpen") or []
    lim=[x["limit"] for x in h]; rows=sum(x["rows"] for x in h if isinstance(x.get("rows"),int))
    pr=[(x["id"][-8:], (x.get("summary") or "")[:22] if x.get("mounted") else "not-mounted") for x in d.get("probe") or []]
    st=d.get("settled") or {}
    return f"{label:4} {n:26} reads={d.get('readsAtSettle')} {'+'.join(map(str,lim))}={rows} settled rows={st.get('rows')} standIns={st.get('standIns')} blank={st.get('blank')} probe={pr} err={(d.get('error') or '')[:80]}"
for label in sys.argv[1].split(","):
    for n in sys.argv[2:]: print(row(label,n))
