# Browser host end-to-end proof

Scratch: `/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844`
Runs: two (a clean quit, then a restart against the same profile)
Result: 3 check(s) FAILED

### the renderer can report its content rect over the browser IPC namespace

```
[PASS] window.api.browser.setContentRect({x:0,y:0,width:1280,height:800}) -> {"tabs":[{"tabId":1,"title":"New tab","url":"","owner":"user","sessionId":null,"active":true,"restored":false,"handedOver":false,"failed":false,"loading":true}],"activeTabId":1,"transfers":{"active":null,"dir":null,"notes":[],"activeTabId":1,"recent":null},"url":"","title":"","loading":true,"canGoBack":false,"canGoForward":false,"navFailure":null,"pendingConsent":[],"approvals":[]}
```

### the renderer's projection carries tab ids and no surface token

```
[PASS] window.api.browser.state() -> {"tabs":[{"tabId":1,"title":"New tab","url":"","owner":"user","sessionId":null,"active":true,"restored":false,"handedOver":false,"failed":false,"loading":true}],"activeTabId":1,"transfers":{"active":null,"dir":null,"notes":[],"activeTabId":1,"recent":null},"url":"","title":"","loading":true,"canGoBack":false,"canGoForward":false,"navFailure":null,"pendingConsent":[],"approvals":[]}
```

### the state file exists with the permissions the design requires

```
[PASS] /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/config/run/ui-browser/host.json mode 600; directory mode 700; {"pid":14864,"port":56967,"session_key":"YI6tcv5yFvZN_BSCwCyJ2J7mdMQ2ndwDncZCEfHgiKM","proto":1,"host":"ui","app_version":"0.31.18","profile_dir":"/private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser","capabilities":["download","upload"],"tabs":1,"agent_tabs":0,"console":true,"console_surfaces":0,"console_agent_surfaces":0,"heartbeat_at":1790691486.424,"started_at":1790691486.424}
```

### the record names a live ui host with a protocol version

```
[PASS] host=ui proto=1 key length=43 pid=14864
```

### /health identifies this process

```
[PASS] GET /health -> 200 {"host":"ui","proto":1,"pid":14864,"console":true,"capabilities":["download","upload"]}
```

### a request without the key is refused

```
[PASS] -> 401 {"detail":"unauthorized"}
```

### a request with the wrong key is refused

```
[PASS] -> 401 {"detail":"unauthorized"}
```

### an unknown method is refused at the boundary

```
[PASS] -> 422 {"detail":"unknown method 'teleport'"}
```

### a malformed body is refused

```
[PASS] -> 422 {"detail":"malformed request body"}
```

### an unknown envelope field is refused

```
[PASS] -> 422 {"detail":"unknown envelope field 'extra'"}
```

### an unauthorised surface handle is refused with the tool's own code

```
[PASS] -> {"id":"proof-read","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"unknown_handle"}}}
```

### the host publishes the loopback address it bound, naming the state file's port

```
[PASS] 10:18:06.425 › [browser] host on 127.0.0.1:56967 (proto 1), profile /private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
state file port=56967
```

### a connection to this machine's non-loopback address is refused

```
[PASS] net.connect({host: "192.168.0.155", port: 56967}) -> ECONNREFUSED
```

### a valid call answers the envelope the Python client expects

```
[PASS] -> {"id":"proof-status","ok":true,"result":{"proto":1,"host":"ui","app_version":"0.31.18","profile_dir":"/private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser","profile_persistent":true,"tabs":1,"agent_tabs":0,"agent_limit":8,"user_agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/
```

### status

```
{
  "proto": 1,
  "host": "ui",
  "app_version": "0.31.18",
  "profile_dir": "/private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser",
  "profile_persistent": true,
  "tabs": 1,
  "agent_tabs": 0,
  "agent_limit": 8,
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  "domain_scope": true,
  "approvals": {
    "allowed_origins": 0,
    "denied_origins": 0,
    "broad_grants": 0,
    "pending": 0,
    "file_mode": 384
  },
  "ownership": {
    "scopes": 0,
    "retained": 0,
    "terminal": 0
  },
  "surfaces": [
    {
      "tab": "ui:1:no-handle",
      "url": "about:blank",
      "title": "about:blank",
      "owner": "user",
      "active": true,
      "restored": false,
      "handed_to_you": false
    }
  ]
}
```

### an agent open on an unapproved origin fails early, before any prompt

```
[PASS] -> {"id":"proof-open","ok":false,"error":{"code":"origin_not_allowed","message":"the user has not approved http://127.0.0.1:56945 for agent access","data":{"origin":"http://127.0.0.1:56945","authority":"127.0.0.1:56945","reason":"unapproved"}}}
```

### request_access raises a prompt the app's chrome can answer, and await_access sees the decision

```
[PASS] request_access -> {"origin":"http://127.0.0.1:56945","state":"pending","entry_id":"9cc8ddb0008c413f8d0837440e7beebd","authority":"127.0.0.1:56945","expires_at":1790692086556,"broad":{"scope":"host","key":"127.0.0.1"}}
respondToConsent (via window.api.browser) -> {"origin":"http://127.0.0.1:56945","state":"allowed","scope":"origin","tabs":[{"tabId":1,"title":"New tab","url":"about:blank","owner":"user","sessionId":null,"active":true,"restored":false,"handedOver":false,"failed":false,"loading":false}],"activeTabId":1,"transfers":{"active":null,"dir":null,"notes":[],"activeTabId":1,"recent":null},"url":"about:blank","title":"","loading":false,"canGoBack":false,"canGoForward":false,"navFailure":null,"pendingConsent":[],"approvals":[{"origin":"http://127.0.0.1:56945","scope":"origin","grantedAt":1790691486720}]}
await_access -> {"origin":"http://127.0.0.1:56945","state":"allowed"}
```

### read returns the page's text from the isolated world

```
[PASS] read.text starts: "Browser host proof page\nA page for the local-operator browser host evidence run.\nName\n\nGo\nNext page\n\ngeolocation: denied"... url=http://127.0.0.1:56945/
```

### the driven page's own script finds no bridge surface (no preload, sandboxed)

```
[PASS] the page reported back: "isolation: api=undefined require=undefined process=undefined electron=undefined"
```

### snapshot returns a pruned AX tree with refs

```
[PASS] refs=4 epoch=2
- RootWebArea "Browser host proof page" [e1]
  - heading "Browser host proof page"
    - InlineTextBox "Browser"
    - InlineTextBox "host"
    - InlineTextBox "proof"
    - InlineTextBox "page"
  - InlineTextBox "A"
  - InlineTextBox "page"
  - InlineTextBox "for"
  - InlineTextBox "the"
  - InlineTextBox "local-"
  - InlineTextBox "operator"
```

### the snapshot exposes the controls by ref

```
[PASS] name=e2 go=e3
```

### type lands in the field and reads back

```
[PASS] type -> {"value":"Ada Lovelace","via":"insert_text","url":"http://127.0.0.1:56945/","title":"Browser host proof page"}
```

### click fires the page's handler (the click reads back as the page wrote it)

```
[PASS] click -> {"navigated":false,"url":"http://127.0.0.1:56945/","title":"Browser host proof page"}
read after click: "Browser host proof page\nA page for the local-operator browser host evidence run.\nName\n\nGo\nNext page\nclicked with Ada Lovelace\ngeolocation: denied (1)\npopup: blo"
```

### screenshot returns a PNG, written here and magic-checked

```
[PASS] /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/out/proof-page.png: 82373 bytes, magic 89504e470d0a1a0a, url=http://127.0.0.1:56945/, title="Browser host proof page"
```

### scroll moves the page and reports whether more remains

```
[PASS] scroll -> {"scrollX":0,"scrollY":1187,"moreBelow":false,"moreRight":false,"url":"http://127.0.0.1:56945/","title":"Browser host proof page"}
```

### logs carry console output and the uncaught exception

```
[PASS] 6 entries
  log [console] proof: log line
  warning [console] proof: warning line
  error [console] proof: error line
  error [exception] Error: proof: uncaught exception     at http://127.0.0.1:56945/:51:28
  warning [console] %cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold; This ren
  log [console] proof: clicked with [Ada Lovelace]
```

### a permission request is denied by default

```
[PASS] geolocation result on the page: "geolocation: denied (1)"
```

### a popup is blocked and creates no tab

```
[FAIL] popup result on the page: "popup: blocked"; tabs now 2
```

### a goto re-reports the page that arrived, and a pre-navigation ref is refused

```
[PASS] goto -> {"url":"http://127.0.0.1:56945/page2","title":"Proof page two","tab":"ui:2:ac9894824019ac1c79c8c48cbbb6cccd","via":"stored_grant"}
click with the pre-navigation ref -> {"id":"proof-click","ok":false,"error":{"code":"element_not_found","message":"the page navigated since that snapshot; take a new snapshot and retry","data":{}}}
```

### the ref was valid before the navigation

```
[PASS] same ref before the navigation -> {"id":"proof-click","ok":true,"result":{"navigated":false,"url":"http://127.0.0.1:56945/","title":"Browser host proof page"}}
```

### a hung navigation ends as the typed nav_timeout, inside the published budget

```
[PASS] goto http://127.0.0.1:56945/slow -> {"id":"proof-goto","ok":false,"error":{"code":"nav_timeout","message":"navigation timed out","data":{"timeout_ms":30000}}}
elapsed 30024ms against the 30 s budget (the client's deadline is 35 s)
```

### the tab is usable again after a timed-out navigation

```
[PASS] goto http://127.0.0.1:56945/page2 after the timeout -> {"id":"proof-goto","ok":true,"result":{"url":"http://127.0.0.1:56945/page2","title":"Proof page two","tab":"ui:2:ac9894824019ac1c79c8c48cbbb6cccd","via":"stored_grant"}}
```

### the app's own renderer cannot use the agent's RPC

```
[PASS] from the renderer: blocked: TypeError: Failed to fetch
chromium's own reason: Connecting to 'http://127.0.0.1:56967/rpc' violates the following Content Security Policy directive: "connect-src 'self' http://localhost:1111 http://127.0.0.1:1111 http://localhost:8080 http://127.0.0.1:8080 https://api.radienthq.com https://us.i.posthog.com https://login.microsoftonline.com https://accounts.google.com". The action has been blocked. | Fetch API cannot load http://127.0.0.1:56967/rpc. Refused to connect because it violates the document's Content Security Policy.
```

### a no-cors attempt yields nothing readable either

```
[PASS] from the renderer: blocked: TypeError: Failed to fetch
chromium's own reason: Fetch API cannot load http://127.0.0.1:56967/rpc. Refused to connect because it violates the document's Content Security Policy. | Connecting to 'http://127.0.0.1:56967/rpc' violates the following Content Security Policy directive: "connect-src 'self' http://localhost:1111 http://127.0.0.1:1111 http://localhost:8080 http://127.0.0.1:8080 https://api.radienthq.com https://us.i.posthog.com https://login.microsoftonline.com https://accounts.google.com". The action has been blocked. | Fetch API cannot load http://127.0.0.1:56967/rpc. Refused to connect because it violates the document's Content Security Policy.
```

### the host publishes the resolved storage path of the persistent partition

```
[PASS] profile_dir=/private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser (persistent=true, user_agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36)
```

### cookies the jar sent before restart

```
COOKIE_HEADER: session_only=1; persistent=1
```

### the persistent cookie is in Chromium's own store, with the flags to match

```
[FAIL] sqlite3 /private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser/Cookies "select host_key,name,is_persistent,has_expires from cookies order by name"
(no rows)
stderr: (none)
```

### what the cookie store held after a clean quit

```
(no rows: Chromium had not written any cookie to disk, which is itself the measurement)
```

### an approved origin stays approved across a restart (the grant is durable)

```
[PASS] open after restart -> {"tab":"ui:3:815505236b028483954f5b986f0fed7d","url":"http://127.0.0.1:56945/echo"}
```

### cookies the jar sent after restart

```
COOKIE_HEADER: (none)
```

### MEASURED: a persistent cookie survives the restart

```
[FAIL] after restart /echo saw: COOKIE_HEADER: (none)
```

### session-cookie-across-restart (probe P2)

```
before restart: COOKIE_HEADER: session_only=1; persistent=1
after restart:  COOKIE_HEADER: (none)
session cookie survived: false
persistent cookie survived: false
note: this is a clean SIGTERM quit; the design's P2 asks for the SIGKILL case as well.
```

### clearing cookies empties the jar over the app's own IPC

```
[PASS] window.api.browser.clearData("cookies") -> {"cleared":"cookies"}
after clearing, /echo saw: COOKIE_HEADER: (none)
```

### clearing cookies does NOT revoke the agent's approvals (they are policy, not data)

```
[PASS] status.approvals after the clear: {"allowed_origins":1,"denied_origins":0,"broad_grants":0,"pending":0,"file_mode":384}
```

### the host logged its denials and its decisions

```
[PASS] 10:18:53.294 › [browser] session cookies: the previous run did not shut down cleanly, so the stored session cookies were discarded
10:18:53.321 › [browser] denied a media permission request from (unknown origin)
10:18:53.321 › [browser] denied a media permission request from (unknown origin)
10:18:53.321 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.322 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.497 › [browser] denied a media permission request from (unknown origin)
10:18:53.498 › [browser] denied a media permission request from (unknown origin)
10:18:53.498 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.498 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.499 › [browser] denied a media permission request from (unknown origin)
10:18:53.500 › [browser] denied a media permission request from (unknown origin)
10:18:53.500 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.500 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.501 › [browser] restored 2 tab(s) from session.json; every restored tab is user-owned and holds no handle (design 7.3)
10:18:53.507 › [browser] host on 127.0.0.1:57575 (proto 1), profile /private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
10:18:53.548 › [browser] denied a media permission request from (unknown origin)
10:18:53.548 › [browser] denied a media permission request from (unknown origin)
10:18:53.549 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.549 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.685 › [browser] tab 1 navigated to http://127.0.0.1:56945/echo
10:18:53.720 › [browser] tab 3 navigated to about:blank
10:18:53.729 › [browser] denied a media permission request from about:blank
10:18:53.729 › [browser] denied a media permission request from about:blank
10:18:53.732 › [browser] denied a web-app-installation permission request from about:blank
10:18:53.732 › [browser] denied a geolocation permission request from about:blank
10:18:53.751 › [browser] tab 3 navigated to http://127.0.0.1:56945/echo
10:18:53.753 › [browser] tab 2 navigated to http://127.0.0.1:56945/set
10:18:53.788 › [browser] session cookies: discarded the stored session cookies as part of clearing browsing data
10:18:53.810 › [browser] cleared browsing data: cookies
10:18:54.944 › [browser] denied a media permission request from http://127.0.0.1:56945/
10:18:54.944 › [browser] denied a media permission request from http://127.0.0.1:56945/
10:18:54.944 › [browser] denied a web-app-installation permission request from http://127.0.0.1:56945/
10:18:54.944 › [browser] denied a geolocation permission request from http://127.0.0.1:56945/
10:18:54.953 › [browser] tab 3 navigated to http://127.0.0.1:56945/echo
10:18:55.009 › [browser] session cookies: not saving (the macOS login keychain is not at /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/home/Library/Keychains/login.keychain-db, so the stored session cookies cannot be read)
10:18:55.009 › [browser] host stopped
10:18:06.189 › [browser] denied a media permission request from (unknown origin)
10:18:06.189 › [browser] denied a media permission request from (unknown origin)
10:18:06.189 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:06.189 › [browser] denied a geolocation permission request from (unknown origin)
```

### app log lines from the browser host

```
10:18:53.294 › [browser] session cookies: the previous run did not shut down cleanly, so the stored session cookies were discarded
10:18:53.321 › [browser] denied a media permission request from (unknown origin)
10:18:53.321 › [browser] denied a media permission request from (unknown origin)
10:18:53.321 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.322 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.497 › [browser] denied a media permission request from (unknown origin)
10:18:53.498 › [browser] denied a media permission request from (unknown origin)
10:18:53.498 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.498 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.499 › [browser] denied a media permission request from (unknown origin)
10:18:53.500 › [browser] denied a media permission request from (unknown origin)
10:18:53.500 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.500 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.501 › [browser] restored 2 tab(s) from session.json; every restored tab is user-owned and holds no handle (design 7.3)
10:18:53.507 › [browser] host on 127.0.0.1:57575 (proto 1), profile /private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
10:18:53.548 › [browser] denied a media permission request from (unknown origin)
10:18:53.548 › [browser] denied a media permission request from (unknown origin)
10:18:53.549 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:53.549 › [browser] denied a geolocation permission request from (unknown origin)
10:18:53.685 › [browser] tab 1 navigated to http://127.0.0.1:56945/echo
10:18:53.720 › [browser] tab 3 navigated to about:blank
10:18:53.729 › [browser] denied a media permission request from about:blank
10:18:53.729 › [browser] denied a media permission request from about:blank
10:18:53.732 › [browser] denied a web-app-installation permission request from about:blank
10:18:53.732 › [browser] denied a geolocation permission request from about:blank
10:18:53.751 › [browser] tab 3 navigated to http://127.0.0.1:56945/echo
10:18:53.753 › [browser] tab 2 navigated to http://127.0.0.1:56945/set
10:18:53.788 › [browser] session cookies: discarded the stored session cookies as part of clearing browsing data
10:18:53.810 › [browser] cleared browsing data: cookies
10:18:54.944 › [browser] denied a media permission request from http://127.0.0.1:56945/
10:18:54.944 › [browser] denied a media permission request from http://127.0.0.1:56945/
10:18:54.944 › [browser] denied a web-app-installation permission request from http://127.0.0.1:56945/
10:18:54.944 › [browser] denied a geolocation permission request from http://127.0.0.1:56945/
10:18:54.953 › [browser] tab 3 navigated to http://127.0.0.1:56945/echo
10:18:55.009 › [browser] session cookies: not saving (the macOS login keychain is not at /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/home/Library/Keychains/login.keychain-db, so the stored session cookies cannot be read)
10:18:55.009 › [browser] host stopped
10:18:06.189 › [browser] denied a media permission request from (unknown origin)
10:18:06.189 › [browser] denied a media permission request from (unknown origin)
10:18:06.189 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:06.189 › [browser] denied a geolocation permission request from (unknown origin)
10:18:06.401 › [browser] denied a media permission request from (unknown origin)
10:18:06.402 › [browser] denied a media permission request from (unknown origin)
10:18:06.402 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:06.402 › [browser] denied a geolocation permission request from (unknown origin)
10:18:06.425 › [browser] host on 127.0.0.1:56967 (proto 1), profile /private/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-proof-14844/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
10:18:06.524 › [browser] tab 1 navigated to about:blank
10:18:06.557 › [browser] session:proof is asking for access to http://127.0.0.1:56945 (1 pending)
10:18:06.780 › [browser] denied a media permission request from (unknown origin)
10:18:06.780 › [browser] denied a media permission request from (unknown origin)
10:18:06.780 › [browser] denied a web-app-installation permission request from (unknown origin)
10:18:06.780 › [browser] denied a geolocation permission request from (unknown origin)
10:18:06.865 › [browser] tab 2 navigated to about:blank
10:18:06.874 › [browser] denied a media permission request from about:blank
10:18:06.874 › [browser] denied a media permission request from about:blank
10:18:06.874 › [browser] denied a web-app-installation permission request from about:blank
10:18:06.874 › [browser] denied a geolocation permission request from about:blank
10:18:06.894 › [browser] tab 2 navigated to http://127.0.0.1:56945/
10:18:06.897 › [browser] blocked a popup from a driven page: http://127.0.0.1:56945/popup-target (offered to the user rather than opened)
10:18:06.898 › [browser] denied a geolocation permission request from http://127.0.0.1:56945/
10:18:11.801 › [browser] denied a media permission request from http://127.0.0.1:56945/
```
