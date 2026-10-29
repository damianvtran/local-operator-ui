### the opener is stubbed in main (no real browser can launch)

```
[PASS] typeof shell.openExternal = function
```

### the platform authenticator is OFF in this tree (the shipped state)

```
[PASS] 13:12:16.493 › [webauthn] Touch ID passkeys are off: unpackaged — an unpackaged run has no signature to carry the entitlement, so there is no group to configure
```

### the fixture is a secure context with WebAuthn exposed

```
[PASS] {"secure":true,"pkc":"function","uvpaa":null}
```

### the page's create() returned a Promise to the page (pass-through)

```
[PASS] typeof promise.then = function
```

### no notice before the request has been pending for a few seconds

```
[PASS] null
```

### the notice names the REQUESTING frame's origin, read by main

```
[PASS] {"tabId":2,"origin":"http://rp.test:61601","embedded":false,"kind":"create","at":1793207540519,"ownerKind":"user","suppressed":0}
```

### the notice says the tab is the user's

```
[PASS] ownerKind=user
```

### the notice is painted in the renderer, with its copy and both controls

```
[PASS] {"text":"rp.test:61601 asked for a passkey and may be waiting. Passkeys are not available in this browser yet. Touch ID passkeys are planned. For now, use the system browser.Open in system browser","x":260,"y":106,"width":1120,"height":52,"scrollWidth":1120,"clientWidth":1120,"buttons":[{"label":"Open in system browser","w":157,"h":28},{"label":"Dismiss passkey notice","w":28,"h":28}]}
```

### the page's call is STILL PENDING after the notice (never rejected, resolved or faked)

```
[PASS] [{"kind":"create","state":"pending","args":null}]
```

### and still pending 5 s later

```
[PASS] [{"kind":"create","state":"pending","args":null}]
```

### two more requests from the same tab inside the window raise no new notice

```
[PASS] at 1793207540519 -> 1793207540519
```

### the log records exactly one raise for that tab

```
[PASS] 13:12:20.519 › [browser] tab 2 has a passkey create pending from http://rp.test:61601; notice raised
```

### a stale notice identity is refused and nothing is opened

```
[PASS] {"ok":false,"reason":"that notice is no longer current"} opened=[]
```

### a notice for a tab that does not exist is refused

```
[PASS] {"ok":false,"reason":"that notice is no longer current"}
```

### pressing Open in system browser hands the tab's own URL to the opener, once

```
[PASS] pressed=true opened=["http://rp.test:61601/page"]
```

### the renderer supplied no URL (the bridge takes a tab id and the notice identity only)

```
[PASS] openPasskeyNotice(tabId, at) in src/preload/index.ts
```

### a cross-origin iframe's request is attributed to the FRAME's origin and marked embedded

```
[PASS] {"tabId":3,"origin":"http://rp.test:61602","embedded":true,"kind":"create","at":1793207555603,"ownerKind":"user","suppressed":0}
```

### the embedded notice says a frame asked

```
[PASS] A frame from rp.test:61602 on this page asked for a passkey and may be waiting. Passkeys are not available in this browser yet. Touch ID passkeys are planned. For now, use the system browser.Open in system browser
```

### a new document clears the notice

```
[PASS] notice null after navigation
```

### a loopback page is refused by the app's vetted door and never reaches the opener

```
[PASS] {"ok":false,"reason":"URL names a loopback or private-network host"} opened=["http://rp.test:61601/page"]
```

### a dismissal with a stale identity changes nothing

```
[PASS] dismiss(stale)=false
```

### the dismiss control clears the notice

```
[PASS] notice null after click
```

### the gate's entry for http://rp.test:61601

```
request_access -> {"id":"rig-request_access","ok":true,"result":{"origin":"http://rp.test:61601","state":"pending","entry_id":"33a9fc93932449c999d067833ef10155","authority":"rp.test:61601","expires_at":1793208158946,"broad":{"scope":"domain","key":"rp.test"}}}
respondToConsent -> "ok"
await_access -> {"id":"rig-await_access","ok":true,"result":{"origin":"http://rp.test:61601","state":"allowed"}}
```

### open http://rp.test:61601/page

```
200 {"id":"rig-open","ok":true,"result":{"tab":"ui:5:0821fd28f868ece531c9b048e49ba082","url":"http://rp.test:61601/page","title":"Passkey fixture","owner":"agent","restored":false,"limit":8}}
13:12:35.860 › [browser] denied a media permission request from about:blank
13:12:35.861 › [browser] denied a media permission request from about:blank
13:12:35.861 › [browser] denied a web-app-installation permission request from about:blank
13:12:35.861 › [browser] denied a geolocation permission request from about:blank
13:12:35.862 › [browser] address overlay hidden: navigation
13:12:35.867 › [browser] tab 4 navigated to http://localhost:61601/page
```

### an agent tab was opened through the real consent path

```
[PASS] token=true
```

### the agent's tab exists and is NOT the active tab

```
[PASS] {"active":4,"tabs":[{"id":1,"owner":"user","url":"about:blank"},{"id":2,"owner":"user","url":"http://rp.test:61601/page"},{"id":3,"owner":"user","url":"http://rp.test:61601/page"},{"id":4,"owner":"user","url":"http://localhost:61601/page"},{"id":5,"owner":"agent","url":"http://rp.test:61601/page"}]}
```

### the agent's page was found among the fixture targets

```
[PASS] 3 candidate targets
```

### a request from the BACKGROUND agent tab does not narrate itself onto the user's page

```
[PASS] null
```

### the host log says the AGENT-driven tab asked

```
[PASS] 13:12:42.163 › [browser] agent-driven tab 5 has a passkey create pending from http://rp.test:61601; notice raised
```

### on activation the notice is shown, and it says the tab is agent-driven

```
[PASS] {"notice":{"tabId":5,"origin":"http://rp.test:61601","embedded":false,"kind":"create","at":1793207562163,"ownerKind":"agent","suppressed":0},"text":"rp.test:61601, in an agent-driven tab, asked for a passkey and may be waiting. Passkeys are not available in this browser yet. Touch ID passkeys are planned. For now, use the system browser.Open in system browser"}
```

### at 800 px wide the notice fits its box in both ramps (no horizontal overflow)

```
[PASS] dark={"text":"rp.test:61601, in an agent-driven tab, asked for a passkey and may be waiting. Passkeys are not available in this browser yet. Touch ID passkeys are planned. For now, use the system browser.Open in system browser","x":260,"y":106,"width":540,"height":111,"scrollWidth":540,"clientWidth":540,"buttons":[{"label":"Open in system browser","w":157,"h":28},{"label":"Dismiss passkey notice","w":28,"h":28}]} light={"text":"rp.test:61601 asked for a passkey and may be waiting. Passkeys are not available in this browser yet. Touch ID passkeys are planned. For now, use the system browser.Open in system browser","x":260,"y":106,"width":540,"height":91,"scrollWidth":540,"clientWidth":540,"buttons":[{"label":"Open in system browser","w":157,"h":28},{"label":"Dismiss passkey notice","w":28,"h":28}]}
```
