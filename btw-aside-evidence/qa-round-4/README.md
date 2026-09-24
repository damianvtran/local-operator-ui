# QA round 4 frames: PR #482 at 8ea341d36

Independent QA pass (`qa-482-r4`, model `anthropic/claude-opus-5-5`) on the delta since QA round 3
(`0bc4a97bb`): the batched round-5 remediation `f096cf17c`, U11 `e1a58b8ff`, U16 `a4cbdae38`, and the two
folds `5575cd518` / `8ea341d36`.

- **App**: built renderer at `8ea341d36`, `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`, headless via a
  COPY of `scripts/renderer-driver.mjs` with the scenes appended (`rig/patch-driver-r4.sh`). App source unmodified.
- **Backend**: REAL daemon from local-operator `origin/main` `c53839500` (#1488 `c2529404e` is an ancestor), own worktree + uv venv.
- **Provider**: round 3's scripted stub + `PARAGRID<k>` (first paragraph of k sentences, then two more) for the D12 sweep.
- **Proxy**: round 3's + logs every DELETE / `…/adopt` on one aside (`asideOps`), so "no adopt left" is a wire reading.
- Scenes: `btw-r4` (new, wide + narrow), `btw-r4-clip` (Q33 repro), `btw-r3r4` (round 3's scene with the two
  deliberately re-worded constants), `btw-r2`, `btw-r2-compat` (422 emulation).
