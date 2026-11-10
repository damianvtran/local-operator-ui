import json, hashlib, subprocess, unicodedata, re
from pathlib import Path
repo=Path('/Users/damian/local-operator-ui/.worktrees/i18n-s4')
aid='s2a-vi-2cf1ea7b5fd-849774c2de9b'
head='2cf1ea7b5fd95b85d6c8bfaa264f6bd3c4e5c3b9'
base=subprocess.check_output(['git','rev-parse','6031bc9ad71'],cwd=repo,text=True).strip()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()==head
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
empty={k:[] for k in ['blocker','major','minor','nit']}
checks=[]
def check(name, condition, details):
    assert condition, (name,details)
    checks.append(dict(check=name,result='PASS',actual=details))
nsblocks={}
for ns in ['ui.chat.canonical','ui.agents.upload']:
    enp=repo/f'src/i18n/catalogues/en/{ns}.json'; vip=repo/f'src/i18n/catalogues/vi/{ns}.json'; cp=repo/f'src/i18n/catalogues/en/{ns}.context.json'
    en=json.loads(enp.read_text()); vi=json.loads(vip.read_text())
    before=json.loads(subprocess.check_output(['git','show',f'{base}:src/i18n/catalogues/vi/{ns}.json'],cwd=repo,text=True))
    keys=[k for k,v in vi.items() if before.get(k)!=v]
    check(ns+' full key parity',set(en)==set(vi),f'en={len(en)} vi={len(vi)}; missing=[] extra=[]')
    check(ns+' changed key count',len(keys)==(8 if ns=='ui.chat.canonical' else 1),keys)
    for k in keys:
        placeholders=lambda s:sorted(re.findall(r'\{([a-zA-Z_][a-zA-Z_0-9]*)\}',s))
        check(k+' placeholders',placeholders(en[k])==placeholders(vi[k]),dict(en=placeholders(en[k]),vi=placeholders(vi[k])))
        check(k+' NFC',unicodedata.normalize('NFC',vi[k])==vi[k],vi[k])
        bidi=[hex(ord(c)) for c in vi[k] if unicodedata.category(c)=='Cf' or '\u202a'<=c<='\u202e' or '\u2066'<=c<='\u2069']
        check(k+' bidi/format-control',not bidi,bidi)
        check(k+' no unchanged-English fallback',vi[k]!=en[k],vi[k])
    block=dict(namespace=ns,status='passed',result='clean',sha256={'en':sha(enp),'vi':sha(vip),'context':sha(cp)},paths={'en':str(enp.relative_to(repo)),'vi':str(vip.relative_to(repo)),'context':str(cp.relative_to(repo))},reviewed_keys=keys,keys_audited=len(keys),scope_note='Delta-only linguistic audit; entire-namespace hashes bind the changed-key review, not a new full-namespace review.',findings=empty)
    nsblocks[ns]=block
vi=json.loads((repo/'src/i18n/catalogues/vi/ui.chat.canonical.json').read_text()); p='ui.chat.canonical.transcript.'
check('neutral worked pair',vi[p+'worked']=='Đã làm việc' and vi[p+'worked_for']=='Đã làm việc trong {duration}',[vi[p+'worked'],vi[p+'worked_for']])
check('no-answer copula/existential preserved',vi[p+'no_answer_given']=='Chưa có câu trả lời',vi[p+'no_answer_given'])
check('uncertainty and partial scope preserved',vi[p+'answer_may_be_missing']=='Câu trả lời này có thể bị thiếu một phần',vi[p+'answer_may_be_missing'])
check('not-run terminology matches existing key',vi[p+'not_run'].casefold()==vi['ui.chat.canonical.tool_row.outcome.never_ran'].casefold(),[vi[p+'not_run'],vi['ui.chat.canonical.tool_row.outcome.never_ran']])
check('exact middle dot and identifier',vi[p+'job_suffix']=='· Tác vụ {id}' and ord(vi[p+'job_suffix'][0])==0xb7,vi[p+'job_suffix'])
check('illustrative duration/id substitution preserves values',vi[p+'worked_for'].replace('{duration}','2m 4s')=='Đã làm việc trong 2m 4s' and vi[p+'job_suffix'].replace('{id}','audit_job_7')=='· Tác vụ audit_job_7',{'worked_for':'Đã làm việc trong 2m 4s','job_suffix':'· Tác vụ audit_job_7','method':'Direct placeholder substitution only; not a runtime formatter test.'})
report='''# Independent Vietnamese delta audit — s2a-vi

**Verdict: clean.** No blocker, major, minor or nit findings.

Scope: `6031bc9ad71..2cf1ea7b5fd`; branch `i18n/slice-transcript`, frozen head `2cf1ea7b5fd95b85d6c8bfaa264f6bd3c4e5c3b9`. Eight new `ui.chat.canonical` entries and one new `ui.agents.upload` entry. Existing entries were consulted only for terminology. No PR exists; no PR comment or commit was made. Budget class: bounded audit/hotfix, <=30 minutes.

Auditor: independent reviewer, session `849774c2de9b`; actual model **openai/gpt-6.1-sol**, fallback following quota failures (requested anthropic/claude-sonnet-5-5; intermediate anthropic/claude-opus-5-5 notification). All substantive audit work occurred after the final model-switch notification. Auditor did not write these translations.

## Linguistic findings derived from the catalogue and English context

1. `Đã làm việc` and `Đã làm việc trong {duration}` are distinct, neutral past-work receipts. `Đã` marks past/completed activity, not successful completion of the task; neither says `thành công` or `hoàn thành`. `trong` naturally introduces the span over which work occurred after `làm việc`; this is elapsed work time, not a future deadline. The duration-free variant contains no invented time.
2. `Chưa có câu trả lời` retains the necessary existential `có`: “there is not yet an answer.” It is complete rather than the clipped `Chưa câu trả lời`. `Câu trả lời này có thể bị thiếu một phần` retains the full modal `có thể` (“may”) and `một phần` (“part”). The complete modal/passive sequence makes a possible partial omission clear, not a definite missing answer or a claim of inability. Neither phrase garden-paths on linguistic reading.
3. `Bị gián đoạn` naturally labels interruption and remains distinct from `Không chạy`. The latter matches existing `ui.chat.canonical.tool_row.outcome.never_ran` (`không chạy`) apart from appropriate sentence-case capitalization. `câu trả lời` is consistent across the three answer-related additions; `Tác vụ` follows core glossary job → tác vụ and existing canonical task/job labels.
4. Only `{duration}` and `{id}` occur in the added entries; their names and multiplicities exactly match English. `· Tác vụ {id}` begins with U+00B7, retains its following space, and the call site adds the preceding space. The supplied identifier remains opaque and untranslated.
5. Upload fallback `Không thể xuất bản tác nhân. Hãy thử lại.` is idiomatic: a factual inability-to-publish sentence followed by a direct retry instruction. `tác nhân` matches the existing upload-dialog agent terminology. No inappropriate apology, success promise or invented cause.
6. The nine added strings contain no English prose residue. The Latin placeholder identifiers are required, not untranslated prose. Byte checks found NFC text and no bidi/format controls in any added value. Source and target key sets match in both namespaces.

## Evidence and limits

`checks.json` is generated by the retained `checks.py`; it contains exact assertions and actual strings. `record.json` binds source, English context and Vietnamese bytes with SHA-256. Core `i18n/glossary.md` and `i18n/style-guides/vi.md` supplied job terminology, sentence-case, direct-tone and NFC rules (paths and hashes in record). English `.context.json` files supply intended status semantics. The changed transcript call sites confirm duration interpolation, answer fallbacks and the job-suffix preceding space.

This is a delta-only linguistic/source audit, **not** a full-namespace audit, runtime-formatter test or rendered UI-fit test. “Not clipped” above means complete catalogue text, not measured visual width. No browser tool is supplied to this role, so rendered clipping/screenshots are unavailable; no browser stack was installed. No dev server, app or background process was launched. Only own evidence and receipt were written; translation, ledger and other auditors' files were untouched.
'''
identity=dict(agent='reviewer',instance='849774c2de9b',session='849774c2de9b',model='openai/gpt-6.1-sol',independent_from_translator=True,authored_translation=False,requested_model='anthropic/claude-sonnet-5-5',fallback=True,model_source='Explicit session model-switch notices: quota failure; final served model openai/gpt-6.1-sol')
root=dict(locale='vi',branch='i18n/slice-transcript',head=head,base=base,instance='849774c2de9b',agent='reviewer',model=identity['model'],auditor=identity,audit_id=aid,audit_date='2026-11-09',status='passed',result='clean',findings=empty)
style_files=[Path('/Users/damian/local-operator/i18n/glossary.md'),Path('/Users/damian/local-operator/i18n/style-guides/vi.md')]
style=[dict(repository='damianvtran/local-operator',path=str(p.relative_to('/Users/damian/local-operator')),sha256=sha(p)) for p in style_files]
for ns,block in nsblocks.items():
    folder=repo/f'i18n/audits/evidence/vi/{ns}/{aid}'
    folder.mkdir(parents=True,exist_ok=False)
    (folder/'report.md').write_text(report)
    (folder/'checks.json').write_text(json.dumps(dict(checks=checks,summary=f'{len(checks)} PASS; 0 FAIL'),ensure_ascii=False,indent=2)+'\n')
    (folder/'checks.py').write_bytes(Path(__file__).read_bytes())
    artifacts={name:dict(path=str((folder/name).relative_to(repo)),sha256=sha(folder/name)) for name in ['report.md','checks.json','checks.py']}
    record={**root,'namespace':ns,'namespaces':{ns:block},'guidance':style,'artifacts':artifacts,'limitations':['Changed keys only, not full-namespace re-audit.','No rendered/browser validation; catalogue completeness only.','Illustrative substitution is not runtime formatter execution.']}
    (folder/'record.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    block['record_reference']=str((folder/'record.json').relative_to(repo)); block['record_sha256']=sha(folder/'record.json')
    block['report_reference']=str((folder/'report.md').relative_to(repo)); block['report_sha256']=sha(folder/'report.md')
receipt={**root,'namespaces':nsblocks,'scope':['ui.chat.canonical','ui.agents.upload'],'limitations':['Delta-only linguistic/source audit.','No rendered UI-fit evidence.']}
receipt_path=repo/f'i18n/receipts/{aid}.json'
assert not receipt_path.exists()
receipt_path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(verdict='clean',checks=len(checks),receipt=str(receipt_path),evidence=[f'i18n/audits/evidence/vi/{ns}/{aid}' for ns in nsblocks],hashes={ns:b['sha256'] for ns,b in nsblocks.items()}),ensure_ascii=False,indent=2))
