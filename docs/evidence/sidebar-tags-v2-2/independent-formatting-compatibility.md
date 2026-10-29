# Independent formatting compatibility verification

Date: 2026-10-19  
Reviewer: reviewer / openai/gpt-6.1-sol  
Model provenance: session began as anthropic/claude-sonnet-5-5; quota exhaustion switched it to openai/gpt-6.1-sol before the mechanical verification. No role/default model pins or tools were changed.  
Scope: `532a4173c96b90edffa58c5d5b67c2ab56318c7e..aecf1b2b9fd3a2a5716f91c0838d3fbbc1ed32ba` (the eight frozen i18n files and unchanged Urdu target only).

## Result

**Formatting compatibility: PASS. Integration/provenance gate: FAIL at the frozen NEW head.** This is a mechanical compatibility addendum, not a fresh linguistic audit, not a UI/component review, and not merge approval.

All eight freeze-file old/new SHA-256 pairs independently match Git blob bytes. Strict duplicate-key-rejecting JSON parsing proves complete deep equality: all 73 keys per file, every message string, every ICU arm/placeholder, and every complete nested English context value are unchanged. An additional byte scanner removes only JSON whitespace outside quoted strings; the resulting byte streams are identical for every pair. Thus no string escape or string-internal whitespace changed either. Object key order also did **not** move. Each working-copy file matched the pinned NEW blob during the check.

**The existing ES/FR/HI/RU/VI/ZH-CN/UR linguistic audits remain valid because no linguistic, ICU, or context value changed.** This preserves their substantive conclusions, not their stale byte-hash freshness: the ledger and receipt references still need a compatibility-linked provenance refresh.

## Independently computed hashes

| File | OLD SHA-256 | NEW SHA-256 | Verification |
|---|---|---|---|
| `src/i18n/catalogues/en/ui.chat.tags.json` | `2ceb3d8a5e4592916fce55ab7eeee5f4654f2d2394cbdb74be89aff2e73ab1be` | `de81b6bb40960f965c5f59fdacf3ea91c3a81279caf3842494c983034ea34762` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/es/ui.chat.tags.json` | `38cb3bfafe458380b4d22cef2155e1545421b108626c05e890414436a904381c` | `f15c50c19097b9a3d843c2d4a5e891f7e0fc184305774946302bf6e7441e4612` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/fr/ui.chat.tags.json` | `6b731c9d4f552a5f78aa149ba41027ffa38c35c625f6323eb81c4c42eb86e686` | `c27507c55ae119a6a5842ba44a9a96fd9fda9c93080916a56e9680bfa9226ddd` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/hi/ui.chat.tags.json` | `c0748d717e603b0ed083768dcf50a17cbd322f075d4e653651b7ed6b3535ba20` | `2a8e189535f490bf209a5056bc4802fc1d71060788e6baa08b957cfd7dd9c040` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/ru/ui.chat.tags.json` | `5738510a615aac72a780de2a704c577fcb3f03d5ee19a72cd4c1cc41fa0552de` | `ea34bca9e39a884f993045a5720315f775487185ec5aa93e41bcad1deb1b21f3` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/vi/ui.chat.tags.json` | `4de3cdde2b12b0ff5bd1bf9b7c04c13edf9aacbbfd4bd259fc0b55513cb21b23` | `75ef8f684e2928aab17dd47b2e78f75d728b1859dc0fdd6b3d607e008c6e6306` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/zh-CN/ui.chat.tags.json` | `9ef8a855eb33c1d8cc4a85598f1ccc5343d48079a2498f92414959ba599f3e42` | `0d1fc170c2ec2a20a029bd22240212d612de93cf1a6c87d6f91a8a83c900b735` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/en/ui.chat.tags.context.json` | `ce20c5a796056d03f7dd17f55974982fd62fe2895ec8d7250679c07bee93f852` | `2b8ed8ec021011e48af093d29d60bffb06b1bfcd97f35bf833d67c0df39a59bf` | PASS: hashes, deep equality, whitespace-only, same key order; 73 keys |
| `src/i18n/catalogues/ur/ui.chat.tags.json` | `1ebc41a63a56910daa408deebd50e875828ab7b88bb22b6d36a666dac37d4a5b` | `1ebc41a63a56910daa408deebd50e875828ab7b88bb22b6d36a666dac37d4a5b` | PASS: byte-identical; 73 keys |

## Ledger and Urdu reference verification

`i18n/ledger.json` has **392 entries**, including seven `ui.chat.tags` locale rows. Its OLD and NEW Git blobs are byte-identical; the missing hash refresh is present in the committed NEW head, not a dirty-working-copy artifact.

| Locale | Current source reference? | Current target reference? |
|---|---|---|
| `ru` | FAIL: still OLD EN | FAIL: still OLD target |
| `es` | FAIL: still OLD EN | FAIL: still OLD target |
| `fr` | FAIL: still OLD EN | FAIL: still OLD target |
| `zh-CN` | FAIL: still OLD EN | FAIL: still OLD target |
| `hi` | FAIL: still OLD EN | FAIL: still OLD target |
| `vi` | FAIL: still OLD EN | FAIL: still OLD target |
| `ur` | FAIL: still OLD EN | PASS |

Urdu target bytes and the row’s target hash are correct and unchanged. The Urdu source reference is **not** current. The row’s receipt file hash still matches its recorded receipt hash, but its embedded source/context references are stale:

- Receipt: `i18n/receipts/f0a1b2c3d4e5.json`.
- Receipt `en`: `2ceb3d8a5e4592916fce55ab7eeee5f4654f2d2394cbdb74be89aff2e73ab1be` (OLD); current EN is `de81b6bb40960f965c5f59fdacf3ea91c3a81279caf3842494c983034ea34762`.
- Receipt `context`: `ce20c5a796056d03f7dd17f55974982fd62fe2895ec8d7250679c07bee93f852` (OLD); current context is `2b8ed8ec021011e48af093d29d60bffb06b1bfcd97f35bf833d67c0df39a59bf`.
- Receipt `ur`: `1ebc41a63a56910daa408deebd50e875828ab7b88bb22b6d36a666dac37d4a5b` (correct and unchanged).

### FMT-M1 — MAJOR: committed ledger/receipt hashes were not refreshed

Evidence: seven stale source hashes, six stale target hashes, and seven receipts naming old English bytes yield 20 ledger-check failures. Correct semantic compatibility alone does not pass the byte-pinned provenance gate. Refresh all seven rows and their receipt references through the supported compatibility/provenance mechanism, retaining the independent linguistic conclusions above; do not change catalogue values or weaken validation.

## Commands and actual results

Executed from the PR worktree; no installation, full suite, browser, application launch, catalogue edit, ledger edit, or rule suppression. All checks were read-only against repository inputs; only this requested evidence addendum and scratch verification artifacts were written.

| Command | Actual result | Status |
|---|---|---|
| `git diff --stat OLD..NEW` and `git diff OLD..NEW -- docs/evidence/sidebar-tags-v2-2/remediation-r1-format-hashes.json` | Inspected remediation/freeze diff first; full remediation also touches two TSX components, expressly outside this compatibility addendum. | PASS |
| Independent Python verification below | Eight files: frozen hashes match; full deep equality; duplicate keys rejected; only outside-string whitespace differs; key order unchanged. UR byte-identical. 392 rows. | PASS (compatibility), FAIL (stale ledger references) |
| `git diff OLD..NEW -- i18n/ledger.json` plus `git show OLD:i18n/ledger.json` / `git show NEW:i18n/ledger.json` | No ledger diff; both revisions retain old hashes. | FAIL freshness |
| `pnpm check-i18n` | Exit 1. Generator freshness passes; scanner passes (1262 files, 762 literals at/below baseline, 16 report-only advisories); ledger fails: `FAILED — 20 finding(s) across 392 ledger entr(ies)`. Chained context check is not reached. | FAIL |
| `node scripts/i18n/context-parity.mjs` | Exit 0: every English key covered apart from 196 allowed gaps in 6 namespaces; 8 now-covered allowance keys are a non-failing update note. | PASS |

The generator actually executed as the first stage of `pnpm check-i18n`: `src/i18n/keys.gen.ts is byte-identical to a fresh generation.` No generated file was written.

### Reproducible independent proof command

Run from the repository root. This script reads Git blobs and working-copy files; it writes nothing. Replace neither OLD nor NEW when reproducing this frozen result.

```sh
python3 - <<'PY'
import hashlib, json, pathlib, subprocess
ROOT=pathlib.Path.cwd()
OLD='532a4173c96b90edffa58c5d5b67c2ab56318c7e'
NEW='aecf1b2b9fd3a2a5716f91c0838d3fbbc1ed32ba'
def blob(rev,path): return subprocess.check_output(['git','show',f'{rev}:{path}'],cwd=ROOT)
def sha(b): return hashlib.sha256(b).hexdigest()
def unique(pairs):
    d={}
    for k,v in pairs:
        if k in d: raise ValueError(f'duplicate JSON key: {k}')
        d[k]=v
    return d
def parse(b): return json.loads(b,object_pairs_hook=unique)
def unspace(b):
    out=bytearray(); quoted=False; escaped=False
    for c in b:
        if quoted:
            out.append(c)
            if escaped: escaped=False
            elif c==92: escaped=True
            elif c==34: quoted=False
        elif c==34: quoted=True; out.append(c)
        elif c not in b' \t\r\n': out.append(c)
    assert not quoted and not escaped
    return bytes(out)
frozen=parse(blob(NEW,'docs/evidence/sidebar-tags-v2-2/remediation-r1-format-hashes.json'))
assert frozen['base']==OLD and len(frozen['files'])==8
files=[]
for f in frozen['files']:
    p=f['path']; a,b=blob(OLD,p),blob(NEW,p); x,y=parse(a),parse(b)
    r={'path':p,'old_sha256':sha(a),'new_sha256':sha(b),'hashes_match_freeze':sha(a)==f['old_sha256'] and sha(b)==f['new_sha256'],'deep_equal':x==y,'whitespace_only':unspace(a)==unspace(b),'key_order_unchanged':list(x)==list(y),'top_level_keys':len(x),'working_copy_matches_new':(ROOT/p).read_bytes()==b}
    assert all(r[k] for k in ['hashes_match_freeze','deep_equal','whitespace_only','key_order_unchanged','working_copy_matches_new']),r
    files.append(r)
ur='src/i18n/catalogues/ur/ui.chat.tags.json'; a,b=blob(OLD,ur),blob(NEW,ur)
assert a==b and (ROOT/ur).read_bytes()==b
ledger=parse(blob(NEW,'i18n/ledger.json')); rows=[r for r in ledger['entries'] if r['namespace']=='ui.chat.tags']; assert len(ledger['entries'])==392 and len(rows)==7
by_path={f['path']:f for f in files}; en=by_path['src/i18n/catalogues/en/ui.chat.tags.json']; ctx=by_path['src/i18n/catalogues/en/ui.chat.tags.context.json']
checks=[]
for r in rows:
    locale=r['locale']; path=f'src/i18n/catalogues/{locale}/ui.chat.tags.json'; target=sha(blob(NEW,path))
    z={'locale':locale,'source_recorded':r['source_sha256'],'source_expected':en['new_sha256'],'source_current':r['source_sha256']==en['new_sha256'],'target_recorded':r['target_sha256'],'target_expected':target,'target_current':r['target_sha256']==target,'auditors':[]}
    for audit in r['auditors']:
        receipt_bytes=blob(NEW,audit['receipt']); receipt=parse(receipt_bytes)
        ns=receipt.get('namespaces',{}).get('ui.chat.tags',{})
        hashes=ns.get('sha256',receipt.get('sha256',{}))
        z['auditors'].append({'receipt':audit['receipt'],'receipt_sha256_current':sha(receipt_bytes)==audit['receipt_sha256'],'namespace_sha256':hashes,'en_reference_current':hashes.get('en')==en['new_sha256'],'context_reference_current':hashes.get('context')==ctx['new_sha256'],'target_reference_current':hashes.get(locale)==target})
    checks.append(z)
result={'old':OLD,'new':NEW,'files':files,'ur':{'path':ur,'old_sha256':sha(a),'new_sha256':sha(b),'byte_identical':a==b,'top_level_keys':len(parse(b))},'ledger_rows':len(ledger['entries']),'ledger_byte_unchanged':blob(OLD,'i18n/ledger.json')==blob(NEW,'i18n/ledger.json'),'ledger_checks':checks}
print(json.dumps(result,indent=2))
PY
```

## Verdict

**Not clean at the frozen head: FMT-M1 (MAJOR) remains.** The substantive linguistic compatibility proof is complete and reusable. A narrow ledger/receipt remediation and targeted `pnpm check-i18n` rerun are required; no repeated linguistic or full-suite audit is justified by this whitespace-only delta. No merge was performed.
