"""Mutation probes for the asks open-by-default policy: does each rule have a test that dies without it?

WHY THIS IS COMMITTED. A green suite says the code does what the tests expect; it does not
say the tests would notice if the code stopped doing it. Each mutant below is ONE exact-text
replacement in shipped source, asserted to match EXACTLY ONCE (so a drifted source fails
loudly instead of mutating nothing and "passing"), then the two suites are run and the
failing test titles are read off the runner's own output. A mutant that the suites do not
kill is a rule with no test. The first run of the refined rules left two survivors (M17, M19);
each was a test that could not fail for the thing it was named after, and each now has a case.

HOW IT STAYS SAFE. Every mutated file is restored with `git checkout -- <path>` in a
`finally`, then compared byte-for-byte with what was read, and the working tree is verified
clean at the end. Run it on a COMMITTED tree: a restore from git would otherwise discard
uncommitted work in a mutated file. It writes `mutation-results.json` beside this file.

    node_modules/.bin/... is not needed: only `node --test` and `git`.
    python3 docs/evidence/ask-open-default/harness/mutate.py [M8 M17 ...]   # no args = all

M0 is the OLD TREE in one line (the hook returns before doing anything), so its failing list
is the set of tests the previous code fails: the fail-on-old reading, per state.
"""
import json, os, re, subprocess, sys

# Derived from this file's own location (docs/evidence/ask-open-default/harness/), so a clone
# anywhere runs it, and so does a worktree.
WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
POLICY = "src/renderer/src/features/chat/ask-open-policy.ts"
HOOK = "src/renderer/src/features/chat/use-ask-open-policy.ts"
SUITES = ["scripts/ask-open-policy.test.mjs", "scripts/ask-open-render.test.mjs"]

MUTANTS = [
    ("M0", "OLD TREE: the hook does nothing (no auto-open, no dismissal watch)", HOOK,
     "}): void => {", "}): void => {\n\treturn;"),
    ("M1", "over-eager: open over a queue with nothing pending (breaks states 1 and 3)", POLICY,
     "if (input.pendingRows <= 0) {", "if (false) {"),
    ("M2", "dismissal never recorded (breaks state 4)", POLICY,
     "dismissals.record(frame.conversationId, reading);", "/* mutant: dismissal not recorded */"),
    ("M3", "an ask that ARRIVES after the view began counts as pending-on-open (rule 4's second half)", POLICY,
     "if (Number.isFinite(createdAt) && createdAt > cutoff) arrivedRows += 1;",
     "if (false) arrivedRows += 1;"),
    ("M4", "acts on a frame that has not answered (rule 5, unresolved/unpublished)", POLICY,
     'if (!input.resolved) return wait("unresolved");', "/* mutant */"),
    ("M5", "ignores a composer that holds text (rule 5, no focus theft)", POLICY,
     'if (input.composerHasText) return leave("composer-has-text");', "/* mutant */"),
    ("M6", "opens while the keyboard is on a door (rule 6, an auto-open is not a press)", POLICY,
     'if (input.keyboardOnDoor) return leave("door-focused");', "/* mutant */"),
    ("M7", "never closes the policy's own drawer carried onto a dismissed conversation (rule 4 across the window-wide flag)", HOOK,
     'live.setAskDrawerOpen(false, "session");', "/* mutant */"),
    # ---- the shared contract's U10 refinement: the dismissal names the asks it waved off ----
    ("M8", "ids ignored: a dismissal is forgotten by ANY resolved frame (the old 'bare flag' behaviour on a partial resolve)", POLICY,
     "if (existing.ids.has(id)) return;", "if (false) return;"),
    ("M9", "a record is never forgotten by a frame: refilled-while-away never re-opens (E2/E3)", POLICY,
     "\t\t\theld.delete(conversationId);\n\t\t},\n\t\tclear:", "\t\t},\n\t\tclear:"),
    ("M10", "a bounded prefix / tally-only frame is read as COMPLETE (the tally is ignored; clause b: unknown must hold)", POLICY,
     "listComplete: view.published && view.open <= outstandingIds.length,",
     "listComplete: view.published,"),
    ("M11", "THE FIRST CUT: the sticky asks_truncated flag is read again, so a record over a dropped row can never clear", POLICY,
     "listComplete: view.published && view.open <= outstandingIds.length,",
     "listComplete: view.published && !view.truncated && view.open <= outstandingIds.length,"),
    ("M12", "a second close REPLACES the record instead of unioning (clause c)", POLICY,
     "for (const id of reading.outstandingIds) existing.ids.add(id);",
     "existing.ids.clear();\n\t\t\tfor (const id of reading.outstandingIds) existing.ids.add(id);"),
    ("M13", "the record is as complete as the LAST close, not the least complete (clause c)", POLICY,
     "existing.complete = existing.complete && reading.listComplete;",
     "existing.complete = reading.listComplete;"),
    ("M14", "an incomplete record is cleared by ANY complete frame, not only an empty one (clause b)", POLICY,
     "if (reading.outstandingIds.length === 0) held.delete(conversationId);",
     "held.delete(conversationId);"),
    ("M15", "a frame that cannot name every ask settles the record anyway (clause b, the other direction)", POLICY,
     "if (!reading.listComplete) return;", "/* mutant */"),
    ("M16", "the record is not settled against the frame before the decision reads it (E3)", POLICY,
     "dismissals.reconcile(frame.conversationId, reading);", "/* mutant */"),
    ("M17", "the mounting frame does not settle the record before the carried-drawer check (E2 through the real mount)", HOOK,
     "askDismissals.reconcile(sessionId, askOutstandingReading(view));", "/* mutant */"),
    ("M18", "the passive effect reads the drawer flags from the render, so the policy's own close reads as the user's", HOOK,
     "drawerOpen: liveDrawerOpen,\n\t\t\tsessionDrawerOpen: liveSessionDrawerOpen,",
     "drawerOpen,\n\t\t\tsessionDrawerOpen,"),
    ("M19", "a close over a complete EMPTY reading records a dismissal (the drawer's own auto-close read as a refusal)", POLICY,
     "if (reading.outstandingIds.length === 0 && reading.listComplete) return;", "/* mutant */"),
]

def run_suites():
    p = subprocess.run(["node", "--test", "--test-reporter=spec", *SUITES], cwd=WT,
                       capture_output=True, text=True, timeout=300)
    out = p.stdout + p.stderr
    head = out.split("failing tests:")[0]
    fails = []
    for line in head.splitlines():
        m = re.match(r"^\s*✖ (.+?) \(\d+(?:\.\d+)?ms\)\s*$", line)
        if m and m.group(1) not in fails:
            fails.append(m.group(1))
    tally = {k: int(v) for k, v in re.findall(r"^ℹ (tests|pass|fail) (\d+)$", out, re.M)}
    return p.returncode, tally, fails

def git(*a):
    return subprocess.run(["git", *a], cwd=WT, capture_output=True, text=True)

results = []
only = sys.argv[1:]
rc, tally, fails = run_suites()
print(f"CONTROL (shipped code)   rc={rc} {tally} failing={len(fails)}", flush=True)
results.append({"id": "C", "title": "shipped code", "rc": rc, "tally": tally, "fails": fails})

for mid, title, path, old, new in MUTANTS:
    if only and mid not in only:
        continue
    full = os.path.join(WT, path)
    src = open(full).read()
    assert src.count(old) == 1, f"{mid}: expected exactly one match in {path}, found {src.count(old)}"
    try:
        open(full, "w").write(src.replace(old, new))
        rc, tally, fails = run_suites()
    finally:
        git("checkout", "--", path)
    assert open(full).read() == src, f"{mid}: file not restored byte-identically"
    print(f"\n{mid}  {title}\n   rc={rc} {tally}", flush=True)
    for f in fails:
        print(f"   x {f}", flush=True)
    results.append({"id": mid, "title": title, "rc": rc, "tally": tally, "fails": fails})

dirty = git("status", "--short", "--", "src", "scripts", "package.json").stdout.strip()
print("\ntree after the probes (src/scripts/package.json):", "CLEAN" if not dirty else f"DIRTY\n{dirty}")
HEAD_SHA = git("rev-parse", "HEAD").stdout.strip()
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mutation-results.json"), "w") as out:
    json.dump({"head": HEAD_SHA, "treeClean": not dirty, "results": results}, out, indent=1)
    out.write("\n")
# Exit non-zero if the control is red or a mutant SURVIVED, so a green exit means "every rule is guarded".
survivors = [r["id"] for r in results if r["id"] != "C" and r["rc"] == 0]
control_red = results[0]["rc"] != 0
if survivors or control_red or dirty:
    print(f"\nNOT GUARDED: survivors={survivors} control_red={control_red} dirty={bool(dirty)}")
    sys.exit(1)
print(f"\nALL {len(results) - 1} MUTANTS KILLED on {HEAD_SHA[:10]}")
