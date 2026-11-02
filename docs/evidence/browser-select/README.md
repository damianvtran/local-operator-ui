# Browser `select`: host contract and implementer evidence

Stacked on UI #1602 head `366f0e5b9f`; no version bump. This is implementer
verification, not independent review/QA. Do not publish until #1602 merges.
Harness counterpart: `feat/browser-select` (`f346c238c93` at implementation time).

## Wire contract

`select {tab, selector, options: Array<string | integer>}` (25 s). Selector is
CSS, snapshot ref, or an AX locator via the same resolver as click. Host also
accepts the wire's `ref` spelling. Capability `select` follows `hover`.

- String: trimmed exact option label, then case-insensitive label, then exact
  option value. Integer: zero-based index. No boolean/fractional/negative index.
- Native single select requires exactly one option (empty and >1 refuse without mutation); multiple replaces exactly the given
  set (including empty). Disabled target/option/optgroup refuses before mutation.
- Prototype `value`, `selectedIndex` and option `selected` setters bypass instance
  tracking; bubbling input AND change notify frameworks. A fresh resolution and
  read after 100 ms handles frameworks replacing the node. No OS popup or Input.*.
- ARIA single-select combobox/listbox or aria-haspopup=listbox trigger: the SAME
  fixed click function as click opens it and clicks the matched role=option.
  Scoped to aria-controls/owns or one visible listbox, not an arbitrary global
  option. Verification requires aria-selected=true on the chosen option, or exact trigger value/text
  if the popup was removed. Inconclusive success is verified:false. ARIA multi
  and clearing are explicitly refused in this first implementation.
- Result: `{selected:[{index,value,label}],kind:'native'|'aria',verified,url,title}`.
  For inconclusive ARIA, selected describes the clicked match, NOT proof it stuck.
- No match: element_not_found, data `{reason:'option_not_found',available:[...]}`,
  at most 50 options, each label/value capped at 120 characters. Disabled,
  wrong-target and single-select refusals also use element_not_found with reason.
  Invalid arguments use internal + data.reason invalid_arguments; no new ErrorCode.
- Tab lane, ownership, document authorization. In NAVIGATING_ACTIONS, NOT
  NAVIGATION_ACTIONS: page-owned change/click handlers can navigate, and both
  returning and throwing paths restore an unapproved landing. No extra Fetch gate.

## Re-run

Use an existing dependency tree with matching pnpm-lock (no installs).
Build once with the CI fixture env block in `.github/workflows/ci.yml`:
`VITE_GOOGLE_CLIENT_ID=qa-not-configured`, corresponding non-secret Google/Microsoft
fixture values, `VITE_DISABLE_BACKEND_MANAGER=true`, notifications/telemetry off,
`LOCAL_OPERATOR_UI_NO_BYTECODE=true`; `node_modules/.bin/electron-vite build`.

```
NODE_OPTIONS=--max-old-space-size=256 node scripts/run-desktop-tests.mjs \
  --test-concurrency=1 scripts/browser-select.test.mjs scripts/browser-host.test.mjs
SELECT_HARNESS_REPO=<existing-harness-select-worktree> \
  node scripts/browser-hover-press-proof.mjs --select --out <evidence-directory>
```

The existing isolated app proof drives the real product host: scratch HOME,
config/log/profile, no CMUX_/LOP_, mock keychain, headless window, no installs,
exact process-group reap. `browser-select-harness-proof.py` uses that harness
worktree's venv, imports its actual `builtin._bridge_action`, and goes through
UiHostClient to the running app (no synthetic transport/result). It never submits.
The harness source is pinned by PYTHONPATH and cwd. Third-party failure is
explicitly BLOCKED, not passed; this run reached the real site successfully.

## Actual execution

- Guarded serial host + select suites: **309 PASS / 0 FAIL**. Select page program
  executes in jsdom, while host test pins capability/ownership and a change-handler
  navigation that throws: forbidden origin named, approved entry restored, no Fetch.
- Select + test inventory rerun after type-only lint edits: **8 PASS / 0 FAIL**.
  Main TypeScript passes. Source biome: no errors (one self-contained-regex warning).
  Script ratchet: six JS files clean; Python has no Biome handler, no JS lint claim.
- Native proof: **18 PASS / 0 FAIL**, exit 0. Native Beta result:
  `{"selected":[{"index":1,"label":"Beta","value":"b"}],"kind":"native","verified":true}`.
  Multi request `['Beta','c']` gives indexes 1/2 and values b/c; `[]` clears.
- Controlled negative control: `.value='b'` then framework render reverts to a.
  Actual select emits input/change, commits held state b, replaces the select,
  then fresh read reports value b, verified:true.
- Disabled select/option and single-select empty/>1 refuse; missing option returns all
  three fixture options with index/label/value. No forged success.
- ARIA Blue: index 1/value b, verified:true; state-less custom option:
  verified:false (handler gave no usable selection evidence).
- Public third-party form (network successful):
  `https://www.selenium.dev/selenium/web/web-form.html`.
  Recon `read select[name="my-select"]` returned `Open this select menu / One /
  Two / Three`. Actual harness selection text:
  `Selected 'Two' in select[name="my-select"]. Page: Web form — .../web-form.html`.
  Actual result: `selected:[{index:2,label:'Two',value:'2'}],kind:'native',verified:true`.
  Host independently re-resolves/reads selectedOptions after dispatch. Screenshot
  shows Two in the closed dropdown and form unsubmitted. No credentials entered,
  no Submit click or external write; only ephemeral form control state changed.
- Frames `select-before.png`, `select-after.png`, `select-third-party.png` viewed.
  Fixture controls stay below the fold until evidence scroll; native DOM selection
  itself works without scrolling or activation. Agent tab remains active:false.
- One build completed successfully; the enclosing command exceeded its memory
  ceiling after build completion, before any native proof launched. Read build log,
  stopped dispatch, confirmed no leftover process, then ran proof separately.
  No second build. Type-only lint casts erase byte-identically (esbuild transform
  old/new comparison true), so final runtime source is the one measured.
- No leaked proof process; disk stayed above the 15 GiB floor.

## Limits / not claimed

ARIA multi/clearing, virtualized options not present in the DOM, arbitrary option
portals without aria-controls or a unique listbox are refused rather than guessed.
Native hidden controls need no layout; ARIA targeting uses existing page-click
semantics, not trusted native OS input. Frame selectors inherit resolver rules.
The controlled wrapper is framework-like (no React dependency installed), not a
claim to have exercised every React select library. No full-suite local rerun;
CI and independent review/QA still required after the stacked PR is opened.

## Review round 1 remediation

R1-1: single native select requires exactly one choice; an empty request refuses
with element_not_found/data.reason single_select, no mutation or input/change.
Multiple controls still allow [] to clear. R1-2: aria-activedescendant denotes
focus only, never verification. Beta focused while aria-selected=false and
trigger Alpha is unverified; selected Beta or trigger Beta is committed evidence.
New discriminating tests both failed before the fix.

Remediation execution: targeted host/select suites **310 PASS / 0 FAIL**;
page-program regression controls before fix **6 PASS / 2 FAIL**, after **8 PASS**.
Native proof **20 PASS / 0 FAIL**, including empty-single refusal/no events and
focused Beta with selected/trigger Alpha returning verified:false. Public Selenium
form still selects Two successfully without submission. Main TypeScript passes.
One bounded rebuild attempted: main and preload compiled successfully; unchanged
renderer rebuild then hit the 768 MiB Node heap ceiling. No second rebuild. Proof
used the newly compiled main/preload and the retained renderer artifact (no
renderer/preload source delta), rather than claiming a full fresh build. Compiled
main explicitly checked for requested.length !== 1 and selectedMatch/triggerMatch.
