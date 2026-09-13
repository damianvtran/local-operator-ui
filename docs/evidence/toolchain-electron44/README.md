# Electron 44: the release-shaped mac artifact builds, boots and updates

**Claim.** `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac
--publish never` — what `publish.yml`'s `build-macos` job drives through
`pnpm dist:mac` — exits 0 and produces both per-architecture DMGs, and the app
inside them runs on Electron 44.3.0 with a working renderer→main bridge. A green
unit suite shows neither: the mac build only runs on a release, which is how a
DMG-only blocker reached this branch in the first place.

**Before.** Two failures, both found by running the thing rather than the tests.

1. **No preload, so no app.** `electron-vite`'s bytecode loader requires Node's
   `vm`/`v8` modules and rewrites the cached data's flag-hash header, which
   Electron 44's renderer no longer accepts:

   ```
   [renderer] The vm module of Node.js is unsupported in Electron's renderer process …
   [renderer] Unable to load preload script: …/app.asar/out/preload/index.js
   [renderer] Error: Invalid or incompatible cached data (cachedDataRejected)
   ```

   `window.electron` was `undefined`, every IPC call threw
   `Cannot read properties of undefined (reading 'ipcRenderer')`, and the window
   still rendered at 122 rAF/s. The preload now ships as plain JS
   (`electron.vite.config.js`); main keeps its bytecode, and the same `.jsc`
   loads fine in the main process, which is what identifies the renderer as the
   difference.

2. **No DMGs.** electron-builder 26.16.1 moved DMG licence attachment out of the
   JS `dmg-license` package into the bundled python `dmgbuild`, which encodes
   each language's text in a legacy codepage (`mac_roman` by default, `shift_jis`
   for `ja`, `ksx1001` for `ko` — `dmgbuild/licensing.py`). Every
   `build/license_*.txt` began with a UTF-8 BOM, and the `ja`/`ko` notices
   carried `©`; both raise `UnicodeEncodeError` inside a `try` that only
   tolerates `LookupError`, and the build died at `dmgbuild process failed 1`.

   The licence inputs are now encodable in the codepage dmgbuild uses for each
   language: the BOM is stripped from all eight files and the copyright sign
   becomes `(c)` in `license_ja.txt` and `license_ko.txt` only — those are the
   two languages whose codepage cannot represent `©`, and `mac_roman` can, so the
   other six keep the symbol. Nothing reflows; the only edits are those ten
   characters.

## What the artifact is, and where it came from

Captured from the `--mac` build artifact of the tree this file is committed in —
not from an earlier commit: an earlier revision of this document cited
`bb6904c69`, which is not an ancestor of the current head, so the artifact it
described was not this branch's. That capture is superseded.

| | |
| --- | --- |
| artifact | `dist/mac-arm64/Local Operator.app`, from `electron-builder --mac --publish never` |
| DMGs | `local-operator-ui-0.19.7-arm64.dmg` (163 559 571 B) and `-x64.dmg` (168 020 713 B) |
| `app.asar` sha256 | `e7903fb0bbcffa7d2e1091b1…` (first bytes; full hash in `packaged-headless-metrics.json`) |
| bundled python | staged with `pnpm setup-python` first, because the release job does (`resources/python`, `resources/python_aarch64`) |

Run headless, isolated (own `HOME`, `--user-data-dir` and
`LOCAL_OPERATOR_CONFIG_DIR`), backend manager off, driven over CDP. The shell
renders at `#/chat` with its real navigation; the banner and the retry panel are
the app reporting that no backend runs in this run. Measured in that run
(`packaged-headless-metrics.json`): `electron 44.3.0 / chromium 152.0.7977.78 /
node 24.20.0` (`modules 149`) read through the preload bridge from inside the
renderer, 123 rAF frames in one second, viewport 1380x868, `get-app-version` →
`"0.19.7"`, and zero preload/`vm`/cached-data lines in the log.

`check-for-updates` also answers properly here — `{"isUpdateAvailable": false,
"versionInfo": {"tag": "v0.19.7", …}}` — because a `--mac` artifact carries the
`app-update.yml` electron-builder generates, where a `--dir` one does not.

## The release path, verified as far as a local machine can

```sh
pnpm setup-python                                     # the release job does this
pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false npx -y pnpm@10.29.2 exec electron-builder --mac --publish never
node scripts/verify-macos-artifacts.mjs --dist dist
```

`electron-builder` exits 0 and writes both DMGs plus their zips and block maps.
`verify-macos-artifacts.mjs` then reports **10 of 14 checks failing, all ten
signing-dependent** — `app-codesign`, `app-spctl`, `app-stapler`, `dmg-spctl`
and `dmg-stapler` for each architecture — which only a CI run with the Developer
ID certificate, `CSC_KEYCHAIN` and notarisation can satisfy
(`pnpm dist:mac -c.forceCodeSigning=true`). The two checks that mean something
locally both **PASS** on both architectures: `app-no-bundled-bytecode` (no
`.pyc`/`.pyo` in the bundled trees) and `app-one-bundled-python` (each app ships
exactly the interpreter tree its architecture resolves). The second one only
passes once `pnpm setup-python` has run: without it the DMG contains no python
at all and the verifier is right to say so.

## How to re-derive

```sh
pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false npx -y pnpm@10.29.2 exec electron-builder --mac --publish never   # 10.29.x: see #137

# Launch the artifact headless, isolated, and drive it over CDP.
rm -rf /tmp/lo-run && mkdir -p /tmp/lo-run
HOME=/tmp/lo-run/home LOCAL_OPERATOR_HOME=/tmp/lo-run/home \
LOCAL_OPERATOR_CONFIG_DIR=/tmp/lo-run/config \
LOCAL_OPERATOR_UI_WINDOW_MODE=headless VITE_DISABLE_BACKEND_MANAGER=true \
"dist/mac-arm64/Local Operator.app/Contents/MacOS/Local Operator" \
  --remote-debugging-port=9583 --user-data-dir=/tmp/lo-run/profile --window-size=1380x900
```

Then attach to `http://127.0.0.1:9583/json/list` and evaluate in the page. Two
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

Beyond the generated `app-update.yml` above, the staging path was driven end to
end against a local `generic` feed (a zip of the app plus `latest-mac.yml`):

```
Found version 0.19.8 (url: Local-Operator-0.19.8-arm64-mac.zip)
Downloading update from Local-Operator-0.19.8-arm64-mac.zip
Download progress: … → { percent: 100 }
New version 0.19.8 has been downloaded to …/Caches/local-operator-updater/pending/Local-Operator-0.19.8-arm64-mac.zip
Staged artifact verified: … (146903631 bytes, sha512 matches, 1140359163 bytes required free, 362510038 byte app).
```

`check-for-updates` returned `isUpdateAvailable: true` for `0.19.8` and
`download-update` returned the staged path. Installing it is out of reach
locally: the artifact is unsigned, and macOS refuses the swap.
