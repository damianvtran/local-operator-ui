# Gated music serving-session evidence

Nonshipping CI fixtures, ported from independently prepared QA source. They are
not provider adapters, product hooks, or acceptance waivers. The workflow reuses
the existing NPX macOS build and official renderer driver. Ordinary push/PR runs
leave `music_acceptance_mode=off`; they cannot spend the music native lease.

## Ordered manual admission

First, after independent source review, the QA owner may dispatch **Core only**:

```sh
gh workflow run ci.yml -R damianvtran/local-operator-ui --ref feat/async-music \
  -f music_acceptance_mode=preflight
```

Review its actual worker source stamp, held SSE/serving snapshot, registered
music dispatch, localhost HTTP calls, durable jobs, real MP3/files/peaks, costs,
and clean rollback with exit zero. No Electron is started in this mode.

The separate `native` mode repeats that complete preflight, then keeps that SAME
Core/worker/AuthStore/SSE/Session/upstream graph alive while the real App runs.
Only the parent may admit the single attempt after the preflight is reviewed:

```sh
# NOT READY at this revision: source guard described below must be completed.
gh workflow run ci.yml -R damianvtran/local-operator-ui --ref feat/async-music \
  -f music_acceptance_mode=native
```

**Known source blocker:** the consumer refuses BEFORE Electron because the supplied
Files/Canvas/Highlights code opened panels but did not establish linked artifact
identity. `filesFacts` is thumbnail resource counters, not that proof. Complete
actual linked-identity predicates before enabling the source guard; there is no
environment waiver. This revision is useful for hosted Core preflight, NOT a
claim that the sole native acceptance attempt is ready or passed.

The consumer includes real player safety/seek, pending reduced-motion geometry,
actual cancel/late settlement, and fresh partial/failed outcome predicates. Those
are SOURCE only until executed. Missing controls fail, never become a pass.
SFX/shared-player presentation and RTL Jobs presentation may be retained only
with the manager's earlier rendered evidence and exact source/catalogue proof;
no new SFX generation or full-App RTL activation is claimed here.

## Bounds, identity and isolation

- Core source is pinned to reviewed `859729bd322da793575527b264b69de0a2601d02`,
  not stock main; worker bootstrap checks the installed module path inherited
  from that installation. Only the MODEL boundary emits scripted real tool calls.
- Each execution owns HOME/config/cache/log/TMP/userdata/cwd beneath runner temp.
  Setup/install and git identity reads happen before fixture isolation. No real
  provider credentials or external provider calls are used. Actual MP3 is made
  with the runner's existing ffmpeg; missing ffmpeg fails setup, never installs.
- Real hosted `vm_stat` available pages must admit1536MiB+512MiB margin before each execution; no local-fleet registry or global guard change.
- Core rollback preflight: 600 seconds /1536 MiB. Native supervisor: 600 seconds
  /1536 MiB, with the consumer's existing480-second bound. Headless only, official
  driver drain plus own profile verification; no visible/focused window.
- Artifact `music-native-acceptance-<checkout-sha>-<run-id>` uploads even on failure.
  Collector admits receipts/logs/frames only, redacts owned synthetic bearers and
  excludes AuthStore databases, private seeds and Chromium profiles. Artifact
  presence is not proof of a passing execution or certified teardown.
- No local Core, renderer build or native dispatch is required to check syntax
  and `test_contract.py`; the latter checks static admission and sanitization.

The workflow is outside any established shipping-path exemption. Independent
review of all harness/CI bytes remains required; product trees, catalogues,
fixtures, lockfile and package version must remain byte-identical to the reviewed
UI head. No native or supplier-billing success is inferred from source review.
