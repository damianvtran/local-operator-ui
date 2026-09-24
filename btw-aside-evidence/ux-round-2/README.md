# UX review round 2: PR #482 at `0bc4a97bb`

These frames come from three headless passes of the built app at `0bc4a97bb`. The build used `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080` and placeholder OAuth ids. No sign-in flow appears in any frame.

- **Backend:** `local-operator` `origin/main` at `a510ca967`, which contains #1488 (`c2529404e`). It ran in its own worktree and its own uv venv, on an OS-chosen port.
- **Provider:** the design-round-2 stub, plus a `SLOWTURN` marker that slows a thread turn to 2 s per chunk. The source is `rig/stub_provider.py`.
- **Proxy:** a plain unbuffered proxy on 8080, taken under the shared lock. Each pass printed `8080 released before this command returned` and `port8080.lock released`.
- **Driver:** a copy of `scripts/renderer-driver.mjs` with QA round 1's helpers and this round's scenes appended (`rig/patch-driver-ux2.sh`). The copy is untracked, and the app source was not modified. It ran in `--window-mode=headless`, the scene asserted `visible=false`, and frames came from `capturePage()`.
- **Input:** every step is a real `Input.dispatchKeyEvent`, `insertText` or mouse event.

| Pass | Scene | Window | Frames |
| --- | --- | --- | --- |
| wide | `btw-ux2` | 1380x900 (1380x868 CSS, dpr 2) | `ux2-*` |
| narrowB | `btw-ux2b` | 700x900, which the app clamps to 800x868 | `ux2b-*` |
| wideC | `btw-ux2c` | 1380x900 | `ux2c-*` |

`logs/driver-*.log` holds every reading: `document.activeElement`, placeholder, box value, panel text, live region, composer alert line and transcript. `logs/daemon-asides-*.log` holds the daemon's own status line for every `/asides` POST. The loopback test token is redacted. The words `TOOLCALL2`, `SLOW`, `LONGANSWER` and `SLOWTURN` in questions are stub markers, not product copy.

## sha256 (first 16 hex)
- `ux2-01-settled-first-answer.png` `b7b63d89f2739c5f`
- `ux2-02-cap-tooltip.png` `88c9e1c289f7a2cd`
- `ux2-03-after-cmdf-adopt.png` `383f4b0efc8cb2dc`
- `ux2-04-fresh-ask-refused.png` `f70b34975c586a4d`
- `ux2-05-retry-after-fresh-refusal-answered.png` `5b727426dee6abfd`
- `ux2-06-continuation-refused.png` `f394795af102d1a3`
- `ux2-07-retry-after-continuation-refusal.png` `565eeb87b0141737`
- `ux2-08-followup-midstream-held.png` `e7d9d673bff407af`
- `ux2-09-after-settle-busy-line-still.png` `1217343589cd1294`
- `ux2-10-followup-sent-after-settle.png` `95677d2b4d9e0560`
- `ux2-11-slash-door-midstream.png` `73022fdc765b611e`
- `ux2-12-followup-into-view.png` `48750870964f3061`
- `ux2-13-followup-settled.png` `db2c123e0399f075`
- `ux2-14-region-focused.png` `143a6b34510a2c96`
- `ux2-15-after-click-adopt.png` `b18f03fe1fda0a5e`
- `ux2-16-bare-btw-placeholder.png` `ea16a41cc4747e57`
- `ux2-17-thready-message-typed-send-tooltip.png` `9bfda3d06b681d2a`
- `ux2-18-closed-then-refused-slash-door.png` `36e3d6781c741347`
- `ux2-19-closed-then-refused-composer-door.png` `ade4b9a0f2772063`
- `ux2-20-typing-after-composer-refusal.png` `5abeed74a2e1d73c`
- `ux2-21-answer-complete-turn-running.png` `20811d83d42b8022`
- `ux2-22-followup-refused-while-turn-runs.png` `edb5734a48918cfa`
- `ux2-23-after-turn-ended.png` `1dbcd1b00cc082fc`
- `ux2b-01-continuation-refused-landed.png` `ab18d15f04e915d1`
- `ux2b-02-retry-in-place-after-continuation-refusal.png` `6bd6e9b18f621567`
- `ux2b-03-busy-line-after-settle.png` `bc766b1fc383df74`
- `ux2b-04-quote-staged-ask-in-flight.png` `d329693f8703d497`
- `ux2b-05-quote-staged-ask-refused.png` `f57d4939c8b5ba31`
- `ux2b-06-quote-staged-ask-answered.png` `dae035b5b9a1faff`
- `ux2c-01-first-keystroke-after-refusal.png` `f375953e99fe147e`
