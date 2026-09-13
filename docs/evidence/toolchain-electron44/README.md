# Electron 44: the packaged app boots, and its updater still stages

**Claim.** The electron-builder `--dir` artifact of this branch runs on Electron
44.3.0 with a working renderer→main bridge, and its updater resolves a feed,
downloads the artifact, verifies it and stages it — the two things a green unit
suite cannot show.

**Before.** The first packaged run of this branch was broken, and the frame here
is from after the fix. `electron-vite`'s bytecode loader requires Node's `vm` and
`v8` modules and rewrites the cached data's flag-hash header; Electron 44's
renderer no longer accepts that, so the log showed

```
[renderer] The vm module of Node.js is unsupported in Electron's renderer process …
[renderer] Unable to load preload script: …/app.asar/out/preload/index.js
[renderer] Error: Invalid or incompatible cached data (cachedDataRejected)
```

and `window.electron` was `undefined`, so every IPC call threw
`Cannot read properties of undefined (reading 'ipcRenderer')` while the window
rendered at 122 rAF/s. The preload now ships as plain JS
(`electron.vite.config.js`); main keeps its bytecode.

**What this frame is.** The packaged app, headless, isolated (own `HOME`,
`--user-data-dir` and `LOCAL_OPERATOR_CONFIG_DIR`), backend manager off, driven
over CDP. The shell renders at `#/chat` with its real navigation; the banner and
the retry panel are the app correctly reporting that no backend is running in
this run. `packaged-headless-metrics.json` is the same run's measurements: the
bridge reports `electron 44.3.0 / chromium 152.0.7977.78 / node 24.20.0`
(`modules 149`), 122 rAF frames in one second, viewport 1380x868, and
`get-app-version` round-tripping to `"0.19.7"`.

Captured at `bb6904c69` (the branch head after its rebase onto `fb9c0942e`), and
the artifact here is 357 MB: #137 moved build tooling and renderer-only packages
out of `app.asar` in that same base.

## How to re-derive

```sh
pnpm build
npx -y pnpm@10.29.2 exec electron-builder --dir --arm64   # 10.29.x: see #137
# Signing off, as on a machine without a Developer ID:
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir --arm64

# Launch the artifact headless, isolated, and drive it over CDP.
rm -rf /tmp/lo-run && mkdir -p /tmp/lo-run
HOME=/tmp/lo-run/home LOCAL_OPERATOR_HOME=/tmp/lo-run/home \
LOCAL_OPERATOR_CONFIG_DIR=/tmp/lo-run/config \
LOCAL_OPERATOR_UI_WINDOW_MODE=headless VITE_DISABLE_BACKEND_MANAGER=true \
"dist/mac-arm64/Local Operator.app/Contents/MacOS/Local Operator" \
  --remote-debugging-port=9574 --user-data-dir=/tmp/lo-run/profile --window-size=1380x900
```

Then attach to `http://127.0.0.1:9574/json/list` and evaluate in the page. Two
notes that cost time to learn:

- **Clear `CMUX_*` before launching anything headless.** An inherited
  `CMUX_WORKSPACE_ID` once let a headless test rename the operator's real cmux
  workspaces.
- **Isolation is partial, and knowingly so.** `HOME`, `LOCAL_OPERATOR_CONFIG_DIR`
  and `LOCAL_OPERATOR_HOME` redirect the config, the cache and the updater cache,
  but `src/main/backend/logger.ts` resolves its log directory from
  `app.getPath("home")` on macOS, which ignores `HOME`. Every headless run
  therefore appends to the operator's real
  `~/Library/Application Support/Local Operator/logs`.

## The updater, against a local feed

`app-update.yml` is not written into a `--dir` artifact (electron-builder writes
it for a publish target), so this run wrote one into the artifact's `Resources`
and served `latest-mac.yml` plus a zip of the app from a local `generic` feed:

```
provider: generic
url: http://127.0.0.1:8765/
updaterCacheDirName: local-operator-updater
```

With the app running, `window.electron.ipcRenderer.invoke("check-for-updates")`
returned `isUpdateAvailable: true` for `0.19.8` and `invoke("download-update")`
changed the app's own log to:

```
Found version 0.19.8 (url: Local-Operator-0.19.8-arm64-mac.zip)
Downloading update from Local-Operator-0.19.8-arm64-mac.zip
Download progress: … → { percent: 100 }
New version 0.19.8 has been downloaded to …/Caches/local-operator-updater/pending/Local-Operator-0.19.8-arm64-mac.zip
Staged artifact verified: … (146903631 bytes, sha512 matches, 1140359163 bytes required free, 362510038 byte app).
```

and returned the staged path. Installing it is out of reach locally: the artifact
is unsigned, and macOS refuses the swap.
