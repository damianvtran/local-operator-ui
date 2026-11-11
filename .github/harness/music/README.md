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
# Only after independent R5 review, observed preflight exit0, and parent admission.
gh workflow run ci.yml -R damianvtran/local-operator-ui --ref feat/async-music \
  -f music_acceptance_mode=native
```

The native source now requires actual Core inventory IDs/digests, a visible indexed
Files row, its real name/onOpen action, the selected Canvas tab/associated panel,
and actual digest-owned playback from both Canvas and the producing turn's
Highlights. Content identity (`artifact:<digest>`) is intentionally distinct from
logical service-row/track identities. No discovery or document state is injected.
These are candidate predicates, NOT observed acceptance. Independent combined
R5 review and an actually clean hosted Core preflight are still required before
the parent admits the sole native attempt. Missing predicates fail, never pass.

SFX/shared-player presentation may retain the parent-verified R2 frames and
unchanged shared-player blob; no new SFX generation is claimed. RTL retains only
the parent-verified JobsCancelRtl/Urdu confirmation presentation with source and
catalogue compatibility, not full-App locale activation or the old blank canonical
RTL frame. Independent QA/design must judge those retained dimensions separately.

## Bounds, identity and isolation

- Core source is pinned to `5558d4c032748c238ac8ee4aac838df0ddecba62` (Core PR #3780 head, music tracks in
  turn highlights; repinned to its merge SHA before #1800 merges),
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
