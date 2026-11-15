# Extension native messaging — evidence

Branch `feat/extension-native-messaging`. Everything here is a measurement on this
machine on 2026-11-14 (Electron 45.1.0, Chromium 156.0.8078.49).

## Details page (Storybook, `Browser/Extensions page`)

- `details-desktop-app-allowed.png` — story `DetailsDesktopAppAllowed`: the new
  **Desktop app connections** row with one granted host and its **Revoke** button;
  the permission list now carries Chrome's "Communicate with cooperating desktop
  apps" and "Display notifications" rows (previously a "Blocked in this browser"
  section).
- `details-desktop-app-none.png` — story `Details`: an extension that declares
  `nativeMessaging` with nothing allowed yet.

Captured from `storybook dev` in the harness browser tab (background tab, no
window raised). The native consent dialog is an OS message box shown as a sheet on
the focused app window; it is not captured here — capturing it needs a visible,
focused window, which the rig rules forbid for an agent run.

## Real-path probe: patched library in real Electron

A probe app (hidden `BrowserWindow`, dock hidden, `--use-mock-keychain`,
`env -i` with a scratch `HOME`, launched with an absolute app path, reaped by exact
process group) constructs `ElectronChromeExtensions` from this branch's patched
`node_modules/electron-chrome-extensions` with an `authorizeNativeMessaging`
predicate backed by an in-memory grant set, loads a synthetic MV3 extension (page
+ service worker) and installs a synthetic stdio echo host (a ~15-line Node
program) into the scratch `userData/NativeMessagingHosts`, `allowed_origins` = the
synthetic extension only. Steps: 1 = no grant, 2 = grant added, 3 = grant removed +
`disconnectNativeHosts`, 4 = notifications permission level. Output (`$HOME`
shortened to `~`):

```
PROBE host-manifest {"dir":"~/.local-operator/sessions/9c7169f74f82/scratchpad/ext-nm/probe/userData/NativeMessagingHosts","id":"bkhpkijeoebdakfdocepmmpmoenaghgb"}
PROBE 1-frame-connect-before-consent {"disconnect":"Access to the specified native messaging host is forbidden."}
PROBE 1-frame-oneshot-before-consent {"reply":null,"lastError":"Access to the specified native messaging host is forbidden."}
PROBE 1-worker-connect-before-consent {"disconnect":"Access to the specified native messaging host is forbidden."}
PROBE 1-predicate-asked [{"application":"com.local_operator.probe_echo","senderUrl":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/page.html","host":{"name":"com.local_operator.probe_echo","description":"Probe Echo Host","path":"~/.local-operator/sessions/9c7169f74f82/scratchpad/ext-nm/probe/echo-host.js"}},{"application":"com.local_operator.probe_echo","senderUrl":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/page.html","host":{"name":"com.local_operator.probe_echo","description":"Probe Echo Host","path":"~/.local-operator/sessions/9c7169f74f82/scratchpad/ext-nm/probe/echo-host.js"}},{"application":"com.local_operator.probe_echo","senderUrl":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/","host":{"name":"com.local_operator.probe_echo","description":"Probe Echo Host","path":"~/.local-operator/sessions/9c7169f74f82/scratchpad/ext-nm/probe/echo-host.js"}}]
PROBE 2-frame-connect-after-allow {"ok":{"echo":{"hello":"wörld"},"origin":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/","pid":4827}}
PROBE 2-frame-port-log [{"disconnect":"Access to the specified native messaging host is forbidden."},{"message":{"echo":{"hello":"wörld"},"origin":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/","pid":4827}}]
PROBE 2-frame-oneshot-after-allow {"reply":{"echo":{"ping":1},"origin":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/","pid":4833},"lastError":null}
PROBE 2-worker-connect-after-allow {"ok":{"echo":{"from":"worker"},"origin":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/","pid":4844}}
PROBE 2-worker-oneshot-after-allow {"reply":{"echo":{"from":"worker-oneshot"},"origin":"chrome-extension://bkhpkijeoebdakfdocepmmpmoenaghgb/","pid":4857}}
PROBE 3-host-alive-before-revoke {"pid":4827,"alive":true}
PROBE 3-disconnectNativeHosts 2
PROBE 3-host-alive-after-revoke {"pid":4827,"alive":false}
PROBE 3-frame-port-log-after-revoke [{"disconnect":"Access to the specified native messaging host is forbidden."}]
PROBE 3-frame-connect-after-revoke {"disconnect":"Access to the specified native messaging host is forbidden."}
PROBE 4-notifications-permission-level "granted"
```

`pgrep -f probe/echo-host.js` after the run: no processes.
