# Browser host end-to-end proof

Scratch: `<scratch>`
Runs: two (a clean quit, then a restart against the same profile)
Result: 2 check(s) FAILED

### the renderer can report its content rect over the browser IPC namespace

```
[PASS] window.api.browser.setContentRect({x:0,y:0,width:1280,height:800}) -> {"tabs":[{"tabId":1,"title":"New tab","url":"about:blank","owner":"user","sessionId":null,"active":true,"restored":false,"handedOver":false,"failed":false,"loading":false}],"activeTabId":1,"transfers":{"active":null,"dir":null,"notes":[],"activeTabId":1,"recent":null},"url":"about:blank","title":"","loading":false,"canGoBack":false,"canGoForward":false,"navFailure":null,"pendingConsent":[],"approvals":[]}
```

### the renderer's projection carries tab ids and no surface token

```
[PASS] window.api.browser.state() -> {"tabs":[{"tabId":1,"title":"New tab","url":"about:blank","owner":"user","sessionId":null,"active":true,"restored":false,"handedOver":false,"failed":false,"loading":false}],"activeTabId":1,"transfers":{"active":null,"dir":null,"notes":[],"activeTabId":1,"recent":null},"url":"about:blank","title":"","loading":false,"canGoBack":false,"canGoForward":false,"navFailure":null,"pendingConsent":[],"approvals":[]}
```

### the state file exists with the permissions the design requires

```
[PASS] <scratch>/config/run/ui-browser/host.json mode 600; directory mode 700; {"pid":42131,"port":51960,"session_key":"OTcBXW035SUrpZuL9gSSeUatpgBMYjPZCTlbnbhMGSo","proto":1,"host":"ui","app_version":"0.32.13","profile_dir":"<scratch>/userdata/Partitions/local-operator-browser","capabilities":["styles","hit_test","ancestors","download","upload"],"tabs":1,"agent_tabs":0,"console":true,"console_surfaces":0,"console_agent_surfaces":0,"heartbeat_at":1791423877.751,"started_at":1791423877.729}
```

### the record names a live ui host with a protocol version

```
[PASS] host=ui proto=1 key length=43 pid=42131
```

### /health identifies this process

```
[PASS] GET /health -> 200 {"host":"ui","proto":1,"pid":42131,"console":true,"capabilities":["styles","hit_test","ancestors","download","upload"]}
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
[PASS] 21:44:37.730 › [browser] host on 127.0.0.1:51960 (proto 1), profile <scratch>/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
state file port=51960
```

### a connection to this machine's non-loopback address is refused

```
[PASS] net.connect({host: "192.168.0.155", port: 51960}) -> ECONNREFUSED
```

### a valid call answers the envelope the Python client expects

```
[PASS] -> {"id":"proof-status","ok":true,"result":{"proto":1,"host":"ui","app_version":"0.32.13","profile_dir":"<scratch>/userdata/Partitions/local-operator-browser","profile_persistent":true,"tabs":1,"agent_tabs":0,"agent_limit":8,"user_agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/
```

### status

```
{
  "proto": 1,
  "host": "ui",
  "app_version": "0.32.13",
  "profile_dir": "<scratch>/userdata/Partitions/local-operator-browser",
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
[PASS] -> {"id":"proof-open","ok":false,"error":{"code":"origin_not_allowed","message":"the user has not approved http://127.0.0.1:51945 for agent access","data":{"origin":"http://127.0.0.1:51945","authority":"127.0.0.1:51945","reason":"unapproved"}}}
```

### request_access raises a prompt the app's chrome can answer, and await_access sees the decision

```
[PASS] request_access -> {"origin":"http://127.0.0.1:51945","state":"pending","entry_id":"8ae9e4992a9c4fff849c6560c51a46e6","authority":"127.0.0.1:51945","expires_at":1791424478134,"broad":{"scope":"host","key":"127.0.0.1"}}
respondToConsent (via window.api.browser) -> {"origin":"http://127.0.0.1:51945","state":"allowed","scope":"origin","tabs":[{"tabId":1,"title":"New tab","url":"about:blank","owner":"user","sessionId":null,"active":true,"restored":false,"handedOver":false,"failed":false,"loading":false}],"activeTabId":1,"transfers":{"active":null,"dir":null,"notes":[],"activeTabId":1,"recent":null},"url":"about:blank","title":"","loading":false,"canGoBack":false,"canGoForward":false,"navFailure":null,"pendingConsent":[],"approvals":[{"origin":"http://127.0.0.1:51945","scope":"origin","grantedAt":1791423878157}]}
await_access -> {"origin":"http://127.0.0.1:51945","state":"allowed"}
```

### read returns the page's text from the isolated world

```
[PASS] read.text starts: "Browser host proof page\nA page for the local-operator browser host evidence run.\nName\n\nGo\nNext page\nPopup dance\nHold a p"... url=http://127.0.0.1:51945/
```

### the driven page's own script finds no bridge surface (no preload, sandboxed)

```
[PASS] the page reported back: "isolation: api=undefined require=undefined process=undefined electron=undefined"
```

### snapshot returns a pruned AX tree with refs

```
[PASS] refs=10 epoch=2
- RootWebArea "Browser host proof page" [e1]
  - heading "Browser host proof page"
    - InlineTextBox "Browser host proof page"
  - InlineTextBox "A page for the local-operator browser host evidence run."
  - InlineTextBox "Name"
  - textbox "Name" [e2]
  - button "Go" [e3]
    - InlineTextBox "Go"
  - button "Next page" [e4]
    - InlineTextBox "Next page"
  - button "Popup dance" [e5]
    - InlineTextBox "Popup dance"
```

### the snapshot exposes the controls by ref

```
[PASS] name=e2 go=e3
```

### type lands in the field and reads back

```
[PASS] type -> {"value":"Ada Lovelace","via":"insert_text","url":"http://127.0.0.1:51945/","title":"Browser host proof page"}
```

### click fires the page's handler (the click reads back as the page wrote it)

```
[PASS] click -> {"navigated":false,"url":"http://127.0.0.1:51945/","title":"Browser host proof page"}
read after click: "Browser host proof page\nA page for the local-operator browser host evidence run.\nName\n\nGo\nNext page\nPopup dance\nHold a popup\nBlank-first popup\nDenied scheme\nFil"
```

### screenshot returns a PNG, written here and magic-checked

```
[PASS] <scratch>/out/proof-page.png: 92122 bytes, magic 89504e470d0a1a0a, url=http://127.0.0.1:51945/, title="Browser host proof page"
```

### scroll moves the page and reports whether more remains

```
[PASS] scroll -> {"scrollX":0,"scrollY":1187,"moreBelow":false,"moreRight":false,"url":"http://127.0.0.1:51945/","title":"Browser host proof page"}
```

### logs carry console output and the uncaught exception

```
[PASS] 6 entries
  log [console] proof: log line
  warning [console] proof: warning line
  error [console] proof: error line
  error [exception] Error: proof: uncaught exception     at http://127.0.0.1:51945/:117:28
  warning [console] %cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold; This ren
  log [console] proof: clicked with [Ada Lovelace]
```

### a permission request is denied by default

```
[PASS] geolocation result on the page: "geolocation: denied (1)"
```

### page targets before the popup section

```
http://127.0.0.1:51945/
about:blank
about:blank
file://<worktree>/out/renderer/index.html#/chat
```

### the popup dance ran end to end: opened, opener=yes, cookies shared both ways, grandchild denied, closed=yes

```
[PASS] popup result on the page: "popup: opened / opener=yes / selfCookie=yes / sharedJar=yes / grandchild=denied / ack=sent / opener-at=/ / closed=yes"
```

### a popup is a window, not a tab: the tab list did not move

```
[PASS] tabs before 2, after the popups 2
```

### an about:blank-first popup opens, navigates, and keeps its opener and the shared jar

```
[PASS] opener record: "popup: opened / opener=yes / selfCookie=yes / sharedJar=yes / grandchild=denied / ack=sent / opener-at=/ / closed=yes / blank=opened"
popup status: "popup: opener=present cookies=shared held"
```

### a denied scheme (mailto:) is refused with nothing created

```
[PASS] opener record: "popup: opened / opener=yes / selfCookie=yes / sharedJar=yes / grandchild=denied / ack=sent / opener-at=/ / closed=yes / blank=opened / mailto=refused"
targets: ["http://127.0.0.1:51945/popup-target?hold=1&which=blank","http://127.0.0.1:51945/","about:blank","about:blank","file://<worktree>/out/renderer/index.html#/chat"]
```

### the cap admits the 4th live child and refuses the 5th

```
[PASS] opener record: "popup: opened / opener=yes / selfCookie=yes / sharedJar=yes / grandchild=denied / ack=sent / opener-at=/ / closed=yes / blank=opened / mailto=refused / hold=opened / cap=0:opened,1:opened,2:refused"
targets: ["http://127.0.0.1:51945/popup-target?hold=1&which=cap1","http://127.0.0.1:51945/popup-target?hold=1&which=cap0","http://127.0.0.1:51945/popup-target?hold=1&which=direct","http://127.0.0.1:51945/popup-target?hold=1&which=blank","http://127.0.0.1:51945/","about:blank","about:blank","file://<worktree>/out/renderer/index.html#/chat"]
```

### each popup captures as a full frame while the run is headless

```
[PASS] popup-headless.png 23876 bytes (http://127.0.0.1:51945/popup-target?hold=1&which=direct)
popup-blank-headless.png 23876 bytes (http://127.0.0.1:51945/popup-target?hold=1&which=blank)
```

### closing the tab takes its popup with it, and only its popup

```
[PASS] targets after the close: ["http://127.0.0.1:51945/popup-target?hold=1&which=cap1","http://127.0.0.1:51945/popup-target?hold=1&which=cap0","http://127.0.0.1:51945/popup-target?hold=1&which=direct","http://127.0.0.1:51945/popup-target?hold=1&which=blank","http://127.0.0.1:51945/","about:blank","about:blank","file://<worktree>/out/renderer/index.html#/chat"]
tabs: 2
```

### styles answers the popper question in one call: rect, computed position/transform/width, inline --* props

```
[PASS] count=1 rect={"x":310,"y":140,"top":140,"right":550,"bottom":231.5,"width":240,"height":91.5}
styles.position=fixed styles.transform=matrix(1, 0, 0, 1, 10, 20) styles.left=300px styles.top=120px styles.width=240px styles[border-top-width]=1px
inline={"--radix-popper-available-width":"640px","--radix-popper-transform-origin":"20px 30px"}
```

### styles('#radix-popover') (raw)

```
{
  "count": 1,
  "matches": [
    {
      "tag": "div",
      "id": "radix-popover",
      "role": "",
      "className": "",
      "rect": {
        "x": 310,
        "y": 140,
        "top": 140,
        "right": 550,
        "bottom": 231.5,
        "width": 240,
        "height": 91.5
      },
      "styles": {
        "display": "block",
        "position": "fixed",
        "visibility": "visible",
        "opacity": "1",
        "z-index": "50",
        "transform": "matrix(1, 0, 0, 1, 10, 20)",
        "transform-origin": "120px 45.75px",
        "top": "120px",
        "right": "740px",
        "bottom": "508.5px",
        "left": "300px",
        "width": "240px",
        "height": "91.5px",
        "contain": "none",
        "filter": "none",
        "will-change": "auto",
        "overflow": "visible",
        "overflow-x": "visible",
        "overflow-y": "visible",
        "pointer-events": "auto",
        "border-top-width": "1px"
      },
      "inline": {
        "--radix-popper-available-width": "640px",
        "--radix-popper-transform-origin": "20px 30px"
      }
    }
  ],
  "truncated": false,
  "url": "http://127.0.0.1:51945/geometry",
  "title": "Geometry proof page"
}
```

### styles caps its matches at five, so a broad selector cannot flood the wire

```
[PASS] div matches: count=5 truncated=true first=["minerva-app-root","radix-popover","radix-listbox","option-a","option-b"]
```

### hit_test answers the element stack under a point, topmost first

```
[PASS] point=(430, 185.75) stack=["option-b","radix-listbox","radix-popover","minerva-app-root","body","html"]
```

### hit_test at #option-b (raw)

```
{
  "count": 6,
  "elements": [
    {
      "tag": "div",
      "id": "option-b",
      "role": "option",
      "className": "",
      "rect": {
        "x": 319,
        "y": 173.5,
        "top": 173.5,
        "right": 541,
        "bottom": 198,
        "width": 222,
        "height": 24.5
      },
      "styles": {
        "display": "block",
        "position": "relative",
        "visibility": "visible",
        "opacity": "1",
        "z-index": "auto",
        "pointer-events": "auto"
      }
    },
    {
      "tag": "div",
      "id": "radix-listbox",
      "role": "listbox",
      "className": "",
      "rect": {
        "x": 319,
        "y": 149,
        "top": 149,
        "right": 541,
        "bottom": 222.5,
        "width": 222,
        "height": 73.5
      },
      "styles": {
        "display": "block",
        "position": "relative",
        "visibility": "visible",
        "opacity": "1",
        "z-index": "auto",
        "pointer-events": "auto"
      }
    },
    {
      "tag": "div",
      "id": "radix-popover",
      "role": "",
      "className": "",
      "rect": {
        "x": 310,
        "y": 140,
        "top": 140,
        "right": 550,
        "bottom": 231.5,
        "width": 240,
        "height": 91.5
      },
      "styles": {
        "display": "block",
        "position": "fixed",
        "visibility": "visible",
        "opacity": "1",
        "z-index": "50",
        "pointer-events": "auto"
      }
    },
    {
      "tag": "div",
      "id": "minerva-app-root",
      "role": "",
      "className": "",
      "rect": {
        "x": 24,
        "y": 42.76,
        "top": 42.76,
        "right": 924,
        "bottom": 234.52,
        "width": 900,
        "height": 191.76
      },
      "styles": {
        "display": "block",
        "position": "relative",
        "visibility": "visible",
        "opacity": "1",
        "z-index": "auto",
        "pointer-events": "auto"
      }
    },
    {
      "tag": "body",
      "id": "",
      "role": "",
      "className": "",
      "rect": {
        "x": 0,
        "y": 0,
        "top": 0,
        "right": 1280,
        "bottom": 258.52,
        "width": 1280,
        "height": 258.52
      },
      "styles": {
        "display": "block",
        "position": "static",
        "visibility": "visible",
        "opacity": "1",
        "z-index": "auto",
        "pointer-events": "auto"
      }
    },
    {
      "tag": "html",
      "id": "",
      "role": "",
      "className": "",
      "rect": {
        "x": 0,
        "y": 0,
        "top": 0,
        "right": 1280,
        "bottom": 258.52,
        "width": 1280,
        "height": 258.52
      },
      "styles": {
        "display": "block",
        "position": "static",
        "visibility": "visible",
        "opacity": "1",
        "z-index": "auto",
        "pointer-events": "auto"
      }
    }
  ],
  "url": "http://127.0.0.1:51945/geometry",
  "title": "Geometry proof page"
}
```

### hit_test caps its stack at eight, still topmost first

```
[PASS] count=8 first=stack-20 stack=["stack-20","stack-19","stack-18","stack-17","stack-16","stack-15","stack-14","stack-13"]
```

### ancestors walks from the element up to the document element, each with its own rect and styles

```
[PASS] chain=option-b > radix-listbox > radix-popover > minerva-app-root > body > html count=6
popover entry styles.position=fixed styles.z-index=50 styles.top=120px
```

### ancestors('#option-b') ids (raw)

```
["option-b","radix-listbox","radix-popover","minerva-app-root","body","html"]
```

### ancestors bounds the walk at twelve steps by default

```
[PASS] count=12 head=stack-20 tail=div
```

### ancestors hard-caps the walk at sixteen even when asked for more

```
[PASS] depth=99 -> count=16
```

### a selector that matches nothing is the existing element_not_found refusal

```
[PASS] {"id":"proof-styles","ok":false,"error":{"code":"element_not_found","message":"selector #ghost matched nothing","data":{}}}
```

### an invalid selector is refused the same way `read` refuses it

```
[PASS] read -> {"id":"proof-read","ok":false,"error":{"code":"internal","message":"Script failed to execute, this normally means an error was thrown. Check the renderer console for the error.","data":{}}}
styles -> {"id":"proof-styles","ok":false,"error":{"code":"internal","message":"Script failed to execute, this normally means an error was thrown. Check the renderer console for the error.","data":{}}}
```

### a missing selector is the extension's own `selector is required` refusal

```
[PASS] {"id":"proof-styles","ok":false,"error":{"code":"element_not_found","message":"selector is required","data":{}}}
```

### a point with no element on it is `no element at point`, not an empty success

```
[PASS] {"id":"proof-hit_test","ok":false,"error":{"code":"element_not_found","message":"no element at point (5000, 5000)","data":{}}}
```

### the card field's frame loaded cross-site, in its own frame target

```
[PASS] iframe target http://localhost:51944/card-frame (page http://127.0.0.1:51945/iframe-type)
```

### type aimed at the iframe ELEMENT lands in its one field, read back from the frame's own target

```
[PASS] type {selector: "#card", text: "4000056655665556"} -> {"id":"proof-type","ok":true,"result":{"value":"4000056655665556","via":"insert_text","frame_origin":"http://localhost:51944","url":"http://127.0.0.1:51945/iframe-type","title":"Iframe type proof page"}}
frame target #number (read over devtools) -> {"origin":"http://localhost:51944","number":"4000056655665556"}
```

### nothing was planted on the iframe element itself

```
[PASS] top document #card -> {"hasOwnValue":false,"value":"undefined"}
```

### an explicit hop `iframe#card >>> #number` lands

```
[PASS] type {selector: "iframe#card >>> #number", text: "5555555555554444"} -> {"id":"proof-type","ok":true,"result":{"value":"5555555555554444","via":"insert_text","frame_origin":"http://localhost:51944","url":"http://127.0.0.1:51945/iframe-type","title":"Iframe type proof page"}}
frame target #number (read over devtools) -> {"origin":"http://localhost:51944","number":"5555555555554444"}
```

### a selector the page misses (`#number`) is found in the one frame that has it, and lands

```
[PASS] type {selector: "#number", text: "378282246310005"} -> {"id":"proof-type","ok":true,"result":{"value":"378282246310005","via":"insert_text","frame_origin":"http://localhost:51944","url":"http://127.0.0.1:51945/iframe-type","title":"Iframe type proof page"}}
frame target #number (read over devtools) -> {"origin":"http://localhost:51944","number":"378282246310005"}
```

### snapshot shows the frame's own tree, with a ref for its textbox

```
[PASS] snapshot ->
- RootWebArea "Iframe type proof page" [e1]
  - heading "Iframe type proof page"
    - InlineTextBox "Iframe type proof page"
  - InlineTextBox "Cardholder"
  - textbox "Cardholder" [e2]
  - InlineTextBox "Card number (inside a cross-site frame):"
  - Iframe "Card number"
- frame iframe#card (http://localhost:51944):
  - RootWebArea "Card frame" [e3]
    - textbox "1234 1234 1234 1234" [e4]
      - InlineTextBox "378282246310005"
    - link "leave" [e5]
      - InlineTextBox "leave"
```

### type by that ref lands in the frame

```
[PASS] type {ref: "e4", text: "4242424242424242"} -> {"id":"proof-type","ok":true,"result":{"value":"4242424242424242","via":"insert_text","frame_origin":"http://localhost:51944","url":"http://127.0.0.1:51945/iframe-type","title":"Iframe type proof page"}}
frame target #number -> {"origin":"http://localhost:51944","number":"4242424242424242"}
```

### the control: type on the same page's top-level field lands exactly as before, with no frame_origin

```
[PASS] type {selector: "#holder"} -> {"id":"proof-type","ok":true,"result":{"value":"Ada Lovelace","via":"insert_text","url":"http://127.0.0.1:51945/iframe-type","title":"Iframe type proof page"}}
```

### precondition: the card frame has user activation, so a _top hop reaches the host's gate rather than Chromium's own block

```
[PASS] frame target navigator.userActivation -> {"hasBeenActive":true,"isActive":true}
```

### a _top link clicked inside the frame is refused by the host's origin gate, and the tab stays put

```
[PASS] click {selector: "iframe#card >>> #escape"} -> {"id":"proof-click","ok":false,"error":{"code":"origin_not_allowed","message":"the user has not approved http://localhost:51944 for agent access","data":{"origin":"http://localhost:51944","blocked":["http://localhost:51944"]}}}
page targets at /escaped: 0
```

### type at a frame holding several fields refuses, lists each as a >>> path, and types nothing

```
[PASS] type {selector: "#multi"} -> {"id":"proof-type","ok":false,"error":{"code":"element_not_found","message":"#multi is an iframe holding 3 editable fields, so nothing was typed; name one: iframe#multi >>> #number, iframe#multi >>> #expiry, iframe#multi >>> input[name=\"cvc\"]","data":{"candidates":["iframe#multi >>> #number","iframe#multi >>> #expiry","iframe#multi >>> input[name=\"cvc\"]"]}}}
frame target inputs -> ["","",""]
```

### type at a frame with no editable field is still #851's refusal, and writes nothing

```
[PASS] type {selector: "#blank"} -> {"id":"proof-type","ok":false,"error":{"code":"element_not_found","message":"#blank is not an editable field (no value setter, not contenteditable), so nothing was typed; it is an iframe and its document holds no editable field either","data":{}}}
frame target text -> "Nothing to type into here."
```

### a same-site frame (in the page's process, no target of its own) is reached through its document, and lands

```
[PASS] type {selector: "iframe#samesite >>> #postcode"} -> {"id":"proof-type","ok":true,"result":{"value":"SW1A 1AA","via":"insert_text","frame_origin":"http://127.0.0.1:51944","url":"http://127.0.0.1:51945/iframe-more","title":"Iframe refusal proof page"}}
frame document #postcode (page target, isolated world in that frame) -> {"value":"SW1A 1AA","url":"http://127.0.0.1:51944/samesite-frame"}
```

### type at a non-editable top-level element keeps #851's sentence, with the >>> hint appended

```
[PASS] type {selector: "h1"} -> {"id":"proof-type","ok":false,"error":{"code":"element_not_found","message":"h1 is not an editable field (no value setter, not contenteditable), so nothing was typed; if the field lives inside an iframe, it cannot be targeted from the top document; address it as <iframe-selector> >>> <selector>","data":{}}}
```

### the reverting field's frame loaded cross-site, in its own frame target

```
[PASS] iframe target http://localhost:51944/revert-frame (page http://127.0.0.1:51945/revert-type)
```

### precondition: the fixture field takes a setter write and reverts it a tick later

```
[PASS] top-revert, set + input event, read at once and 50 ms later -> {"instant":"x","later":""}
```

### type at a top-document field that reverts the write is REFUSED, and the field reads back empty

```
[PASS] type {selector: "#top-revert"} -> {"id":"proof-type","ok":false,"error":{"code":"element_not_found","message":"#top-revert took the value-setter write but does not hold the text (read back ''), so nothing was reported typed","data":{}}}
top document #top-revert (read over devtools) -> ""
```

### type at a cross-site frame field that reverts the write is REFUSED, and the field reads back empty from the frame's own target

```
[PASS] type {selector: "iframe#rv >>> #frame-revert"} -> {"id":"proof-type","ok":false,"error":{"code":"element_not_found","message":"iframe#rv >>> #frame-revert took the value-setter write but does not hold the text (read back ''), so nothing was reported typed","data":{}}}
frame target #frame-revert (read over devtools) -> ""
```

### type aimed at the multi-field iframe ELEMENT types nothing, and the reverting field stays empty

```
[PASS] type {selector: "#rv"} -> {"id":"proof-type","ok":false,"error":{"code":"element_not_found","message":"#rv is an iframe holding 3 editable fields, so nothing was typed; name one: iframe#rv >>> #frame-revert, iframe#rv >>> #frame-setter-only, iframe#rv >>> #frame-keep","data":{"candidates":["iframe#rv >>> #frame-revert","iframe#rv >>> #frame-setter-only","iframe#rv >>> #frame-keep"]}}}
```

### the control: a top-document field that refuses insertText but keeps a setter write lands via value_setter

```
[PASS] type {selector: "#top-setter-only"} -> {"id":"proof-type","ok":true,"result":{"value":"4000056655665556","via":"value_setter","insert_text_readback":"","url":"http://127.0.0.1:51945/revert-type","title":"Reverting field proof page"}}
top document #top-setter-only (read over devtools) -> "4000056655665556"
```

### the control: a cross-site frame field that keeps a setter write lands via value_setter, read back from the frame's own target

```
[PASS] type {selector: "iframe#rv >>> #frame-setter-only"} -> {"id":"proof-type","ok":true,"result":{"value":"4000056655665556","via":"value_setter","insert_text_readback":"","frame_origin":"http://localhost:51944","url":"http://127.0.0.1:51945/revert-type","title":"Reverting field proof page"}}
frame target #frame-setter-only (read over devtools) -> "4000056655665556"
```

### the control: an ordinary field on the same page still lands via insert_text

```
[PASS] type {selector: "#top-keep"} -> {"id":"proof-type","ok":true,"result":{"value":"4000056655665556","via":"insert_text","url":"http://127.0.0.1:51945/revert-type","title":"Reverting field proof page"}}
```

### precondition: the frame origin is DENIED through the consent path

```
[PASS] request_access -> pending; await_access -> {"origin":"http://localhost:51944","state":"denied"}
```

### a frame from a DENIED origin is refused on every route, absent from snapshot, and its field stays empty

```
[PASS] hop -> {"id":"proof-type","ok":false,"error":{"code":"origin_not_allowed","message":"the user denied http://localhost:51944 for agent access, and that element is inside a frame from it","data":{"origin":"http://localhost:51944","reason":"denied"}}}
element -> {"id":"proof-type","ok":false,"error":{"code":"origin_not_allowed","message":"the user denied http://localhost:51944 for agent access, and that element is inside a frame from it","data":{"origin":"http://localhost:51944","reason":"denied"}}}
auto -> {"id":"proof-type","ok":false,"error":{"code":"element_not_found","message":"selector #number matched nothing in the page itself or the frames searched (1 frame(s) from an origin the user denied were not searched); address the frame explicitly as <iframe-selector> >>> <selector>","data":{}}}
snapshot ->
- RootWebArea "Iframe type proof page" [e1]
  - heading "Iframe type proof page"
    - InlineTextBox "Iframe type proof page"
  - InlineTextBox "Cardholder"
  - textbox "Cardholder" [e2]
  - InlineTextBox "Card number (inside a cross-site frame):"
  - Iframe "Card number"
frame target #number (read over devtools) -> ""
```

### an unpresented tab reports a non-zero page viewport

```
[PASS] metrics: innerWidth=1280 innerHeight=720 docEl=1280x720 vv=1280x720 dpr=2 resize=0 lastResizeSize=none open=false
```

### the viewport survives a navigation while the tab stays hidden

```
[PASS] metrics: innerWidth=1280 innerHeight=720 docEl=1280x720 vv=1280x720 dpr=2 resize=0 lastResizeSize=none open=false
```

### page targets on the app's debugging port (raw)

```
http://127.0.0.1:51945/hidden-viewport
http://127.0.0.1:51945/popup-target?hold=1&which=cap1
http://127.0.0.1:51945/popup-target?hold=1&which=cap0
http://127.0.0.1:51945/popup-target?hold=1&which=direct
http://127.0.0.1:51945/popup-target?hold=1&which=blank
http://127.0.0.1:51945/
about:blank
about:blank
file://<worktree>/out/renderer/index.html#/chat
```

### a capture does not resize the page

```
[PASS] resize 0 -> 0, size 1280x720, lastResizeSize=none
before: metrics: innerWidth=1280 innerHeight=720 docEl=1280x720 vv=1280x720 dpr=2 resize=0 lastResizeSize=none open=false
after:  metrics: innerWidth=1280 innerHeight=720 docEl=1280x720 vv=1280x720 dpr=2 resize=0 lastResizeSize=none open=false
frame: <scratch>/out/hidden-view-capture.png
```

### the popper's content has height on a driven tab

```
[PASS] open=true content rect={"x":120,"y":160,"top":160,"right":362,"bottom":313.5,"width":242,"height":153.5}
metrics: innerWidth=1280 innerHeight=720 docEl=1280x720 vv=1280x720 dpr=2 resize=0 lastResizeSize=none open=true
```

### an open popup is still open after a capture

```
[PASS] open before=true after=true
before: metrics: innerWidth=1280 innerHeight=720 docEl=1280x720 vv=1280x720 dpr=2 resize=0 lastResizeSize=none open=true
after:  metrics: innerWidth=1280 innerHeight=720 docEl=1280x720 vv=1280x720 dpr=2 resize=0 lastResizeSize=none open=true
frame: <scratch>/out/hidden-view-popup.png
```

### the popup's own pixels are in the capture

```
[PASS] frame <scratch>/out/hidden-view-popup.png: {"width":2560,"height":1440,"magenta":19156} — expected the 1280x720 view at dpr 2 = 2560x1440 (the fixture's #sentinel is 120x40 css)
```

### a goto re-reports the page that arrived, and a pre-navigation ref is refused

```
[PASS] goto -> {"url":"http://127.0.0.1:51945/page2","title":"Proof page two","tab":"ui:2:e0a5ea94ac99ec035491c41cea885044","via":"stored_grant"}
click with the pre-navigation ref -> {"id":"proof-click","ok":false,"error":{"code":"element_not_found","message":"the page navigated since that snapshot; take a new snapshot and retry","data":{}}}
```

### the ref was valid before the navigation

```
[PASS] same ref before the navigation -> {"id":"proof-click","ok":true,"result":{"navigated":false,"url":"http://127.0.0.1:51945/","title":"Browser host proof page"}}
```

### a hung navigation ends as the typed nav_timeout, inside the published budget

```
[PASS] goto http://127.0.0.1:51945/slow -> {"id":"proof-goto","ok":false,"error":{"code":"nav_timeout","message":"navigation timed out","data":{"timeout_ms":30000}}}
elapsed 30012ms against the 30 s budget (the client's deadline is 35 s)
```

### the tab is usable again after a timed-out navigation

```
[PASS] goto http://127.0.0.1:51945/page2 after the timeout -> {"id":"proof-goto","ok":true,"result":{"url":"http://127.0.0.1:51945/page2","title":"Proof page two","tab":"ui:2:e0a5ea94ac99ec035491c41cea885044","via":"stored_grant"}}
```

### the app's own renderer cannot use the agent's RPC

```
[PASS] from the renderer: blocked: TypeError: Failed to fetch
chromium's own reason: Connecting to 'http://127.0.0.1:51960/rpc' violates the following Content Security Policy directive: "connect-src 'self' http://localhost:1111 http://127.0.0.1:1111 http://localhost:8080 http://127.0.0.1:8080 https://api.radienthq.com https://us.i.posthog.com https://login.microsoftonline.com https://accounts.google.com". The action has been blocked. | Fetch API cannot load http://127.0.0.1:51960/rpc. Refused to connect because it violates the document's Content Security Policy.
```

### a no-cors attempt yields nothing readable either

```
[PASS] from the renderer: blocked: TypeError: Failed to fetch
chromium's own reason: Fetch API cannot load http://127.0.0.1:51960/rpc. Refused to connect because it violates the document's Content Security Policy. | Connecting to 'http://127.0.0.1:51960/rpc' violates the following Content Security Policy directive: "connect-src 'self' http://localhost:1111 http://127.0.0.1:1111 http://localhost:8080 http://127.0.0.1:8080 https://api.radienthq.com https://us.i.posthog.com https://login.microsoftonline.com https://accounts.google.com". The action has been blocked. | Fetch API cannot load http://127.0.0.1:51960/rpc. Refused to connect because it violates the document's Content Security Policy.
```

### the host publishes the resolved storage path of the persistent partition

```
[PASS] profile_dir=<scratch>/userdata/Partitions/local-operator-browser (persistent=true, user_agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36)
```

### cookies the jar sent before restart

```
COOKIE_HEADER: proof_popup=shared; session_only=1; persistent=1
```

### the persistent cookie is in Chromium's own store, with the flags to match

```
[FAIL] sqlite3 <scratch>/userdata/Partitions/local-operator-browser/Cookies "select host_key,name,is_persistent,has_expires from cookies order by name"
(no rows)
stderr: (none)
```

### what the cookie store held after a clean quit

```
(no rows: Chromium had not written any cookie to disk, which is itself the measurement)
```

### an approved origin stays approved across a restart (the grant is durable)

```
[PASS] open after restart -> {"tab":"ui:2:9ec5fb300c6e8fe552c35633f61235dd","url":"http://127.0.0.1:51945/echo"}
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
before restart: COOKIE_HEADER: proof_popup=shared; session_only=1; persistent=1
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
[PASS] status.approvals after the clear: {"allowed_origins":1,"denied_origins":1,"broad_grants":0,"pending":0,"file_mode":384}
```

### the host logged its denials and its decisions

```
[PASS] 21:45:47.576 › [browser] session cookies: the previous run did not shut down cleanly, so the stored session cookies were discarded
21:45:47.601 › [browser] denied a media permission request from (unknown origin)
21:45:47.601 › [browser] denied a media permission request from (unknown origin)
21:45:47.601 › [browser] denied a web-app-installation permission request from (unknown origin)
21:45:47.601 › [browser] denied a geolocation permission request from (unknown origin)
21:45:47.725 › [browser] 2 recorded tab(s) were opened by an agent and were not active at the quit; not restored
21:45:47.727 › [browser] denied a media permission request from (unknown origin)
21:45:47.727 › [browser] denied a media permission request from (unknown origin)
21:45:47.727 › [browser] denied a web-app-installation permission request from (unknown origin)
21:45:47.727 › [browser] denied a geolocation permission request from (unknown origin)
21:45:47.736 › [browser] host on 127.0.0.1:52381 (proto 1), profile <scratch>/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
21:45:47.874 › [browser] tab 1 navigated to about:blank
21:45:47.936 › [browser] denied a media permission request from (unknown origin)
21:45:47.936 › [browser] denied a media permission request from (unknown origin)
21:45:47.936 › [browser] denied a web-app-installation permission request from (unknown origin)
21:45:47.936 › [browser] denied a geolocation permission request from (unknown origin)
21:45:48.118 › [browser] tab 2 navigated to about:blank
21:45:48.127 › [browser] denied a media permission request from about:blank
21:45:48.127 › [browser] denied a media permission request from about:blank
21:45:48.127 › [browser] denied a web-app-installation permission request from about:blank
21:45:48.127 › [browser] denied a geolocation permission request from about:blank
21:45:48.142 › [browser] tab 2 navigated to http://127.0.0.1:51945/echo
21:45:48.184 › [browser] session cookies: discarded the stored session cookies as part of clearing browsing data
21:45:48.204 › [browser] cleared browsing data: cookies
21:45:49.209 › [browser] denied a media permission request from http://127.0.0.1:51945/
21:45:49.210 › [browser] denied a media permission request from http://127.0.0.1:51945/
21:45:49.212 › [browser] denied a web-app-installation permission request from http://127.0.0.1:51945/
21:45:49.212 › [browser] denied a geolocation permission request from http://127.0.0.1:51945/
21:45:49.236 › [browser] tab 2 navigated to http://127.0.0.1:51945/echo
21:45:49.289 › [browser] 1 recorded tab(s) were opened by an agent and were not active at the quit; not restored
21:45:49.294 › [browser] session cookies: not saving (the macOS login keychain is not at <scratch>/home/Library/Keychains/login.keychain-db, so the stored session cookies cannot be read)
21:45:49.294 › [browser] host stopped
21:44:37.446 › [browser] denied a media permission request from (unknown origin)
21:44:37.447 › [browser] denied a media permission request from (unknown origin)
21:44:37.447 › [browser] denied a web-app-installation permission request from (unknown origin)
21:44:37.447 › [browser] denied a geolocation permission request from (unknown origin)
21:44:37.597 › [browser] denied a media permission request from (unknown origin)
21:44:37.598 › [browser] denied a media permission request from (unknown origin)
21:44:37.599 › [browser] denied a web-app-installation permission request from (unknown origin)
21:44:37.600 › [browser] denied a geolocation permission request from (unknown origin)
```

### the log carries every popup call: opened lines with presentation=never, the blank case, the scheme refusal, the grandchild refusal and the cap refusal

```
[PASS] 21:44:40.536 › [browser] tab 2 opened a popup: http://127.0.0.1:51945/popup-target (disposition=foreground-tab, presentation=never)
21:44:40.568 › [browser] refused a popup from a popup: http://127.0.0.1:51945/popup-target?which=grandchild
21:44:42.034 › [browser] tab 2 opened a popup: about:blank (disposition=foreground-tab, presentation=never)
21:44:43.277 › [browser] refused a popup from a driven page: mailto:proof@example.com (scheme)
21:44:45.493 › [browser] tab 2 opened a popup: http://127.0.0.1:51945/popup-target?hold=1&which=direct (disposition=foreground-tab, presentation=never)
21:44:46.737 › [browser] tab 2 opened a popup: http://127.0.0.1:51945/popup-target?hold=1&which=cap0 (disposition=foreground-tab, presentation=never)
21:44:46.761 › [browser] tab 2 opened a popup: http://127.0.0.1:51945/popup-target?hold=1&which=cap1 (disposition=foreground-tab, presentation=never)
21:44:46.788 › [browser] refused a popup from a driven page: http://127.0.0.1:51945/popup-target?hold=1&which=cap2 (cap)
21:44:49.788 › [browser] tab 3 opened a popup: http://127.0.0.1:51945/popup-target?hold=1&which=cleanup (disposition=foreground-tab, presentation=never)
```

### no presentation fallback fired: no popup under the never plan ever read visible

```
[PASS] 21:45:46.777 › Deprecated: no serve records found. Falling back to the fixed-port probe at http://127.0.0.1:1111/health for a daemon predating the record format. This fallback is scheduled for removal (design §8).
21:45:47.472 › Adopted a pre-record daemon at http://127.0.0.1:1111 (v0.68.5) through the deprecated fallback.
21:44:36.996 › Deprecated: no serve records found. Falling back to the fixed-port probe at http://127.0.0.1:1111/health for a daemon predating the record format. This fallback is scheduled for removal (design §8).
21:44:37.317 › Adopted a pre-record daemon at http://127.0.0.1:1111 (v0.68.5) through the deprecated fallback.
```

### the app was never frontmost (sampled from outside, by pid)

```
[PASS] 48 sample(s), app frontmost in 0: ["Local Operator|90507","Local Operator|90507","Local Operator|90507","Local Operator|90507","Local Operator|90507","Local Operator|90507"]
```

### app log lines from the browser host

```
21:45:47.576 › [browser] session cookies: the previous run did not shut down cleanly, so the stored session cookies were discarded
21:45:47.601 › [browser] denied a media permission request from (unknown origin)
21:45:47.601 › [browser] denied a media permission request from (unknown origin)
21:45:47.601 › [browser] denied a web-app-installation permission request from (unknown origin)
21:45:47.601 › [browser] denied a geolocation permission request from (unknown origin)
21:45:47.725 › [browser] 2 recorded tab(s) were opened by an agent and were not active at the quit; not restored
21:45:47.727 › [browser] denied a media permission request from (unknown origin)
21:45:47.727 › [browser] denied a media permission request from (unknown origin)
21:45:47.727 › [browser] denied a web-app-installation permission request from (unknown origin)
21:45:47.727 › [browser] denied a geolocation permission request from (unknown origin)
21:45:47.736 › [browser] host on 127.0.0.1:52381 (proto 1), profile <scratch>/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
21:45:47.874 › [browser] tab 1 navigated to about:blank
21:45:47.936 › [browser] denied a media permission request from (unknown origin)
21:45:47.936 › [browser] denied a media permission request from (unknown origin)
21:45:47.936 › [browser] denied a web-app-installation permission request from (unknown origin)
21:45:47.936 › [browser] denied a geolocation permission request from (unknown origin)
21:45:48.118 › [browser] tab 2 navigated to about:blank
21:45:48.127 › [browser] denied a media permission request from about:blank
21:45:48.127 › [browser] denied a media permission request from about:blank
21:45:48.127 › [browser] denied a web-app-installation permission request from about:blank
21:45:48.127 › [browser] denied a geolocation permission request from about:blank
21:45:48.142 › [browser] tab 2 navigated to http://127.0.0.1:51945/echo
21:45:48.184 › [browser] session cookies: discarded the stored session cookies as part of clearing browsing data
21:45:48.204 › [browser] cleared browsing data: cookies
21:45:49.209 › [browser] denied a media permission request from http://127.0.0.1:51945/
21:45:49.210 › [browser] denied a media permission request from http://127.0.0.1:51945/
21:45:49.212 › [browser] denied a web-app-installation permission request from http://127.0.0.1:51945/
21:45:49.212 › [browser] denied a geolocation permission request from http://127.0.0.1:51945/
21:45:49.236 › [browser] tab 2 navigated to http://127.0.0.1:51945/echo
21:45:49.289 › [browser] 1 recorded tab(s) were opened by an agent and were not active at the quit; not restored
21:45:49.294 › [browser] session cookies: not saving (the macOS login keychain is not at <scratch>/home/Library/Keychains/login.keychain-db, so the stored session cookies cannot be read)
21:45:49.294 › [browser] host stopped
21:44:37.446 › [browser] denied a media permission request from (unknown origin)
21:44:37.447 › [browser] denied a media permission request from (unknown origin)
21:44:37.447 › [browser] denied a web-app-installation permission request from (unknown origin)
21:44:37.447 › [browser] denied a geolocation permission request from (unknown origin)
21:44:37.597 › [browser] denied a media permission request from (unknown origin)
21:44:37.598 › [browser] denied a media permission request from (unknown origin)
21:44:37.599 › [browser] denied a web-app-installation permission request from (unknown origin)
21:44:37.600 › [browser] denied a geolocation permission request from (unknown origin)
21:44:37.730 › [browser] host on 127.0.0.1:51960 (proto 1), profile <scratch>/userdata/Partitions/local-operator-browser, agent tabs 0/8, console on (0 surface(s))
21:44:37.742 › [browser] tab 1 navigated to about:blank
21:44:38.135 › [browser] session:proof is asking for access to http://127.0.0.1:51945 (1 pending)
21:44:38.177 › [browser] denied a media permission request from (unknown origin)
21:44:38.177 › [browser] denied a media permission request from (unknown origin)
21:44:38.178 › [browser] denied a web-app-installation permission request from (unknown origin)
21:44:38.178 › [browser] denied a geolocation permission request from (unknown origin)
21:44:38.319 › [browser] tab 2 navigated to about:blank
21:44:38.328 › [browser] denied a media permission request from about:blank
21:44:38.328 › [browser] denied a media permission request from about:blank
21:44:38.329 › [browser] denied a web-app-installation permission request from about:blank
21:44:38.329 › [browser] denied a geolocation permission request from about:blank
21:44:38.349 › [browser] tab 2 navigated to http://127.0.0.1:51945/
21:44:38.355 › [browser] denied a geolocation permission request from http://127.0.0.1:51945/
21:44:40.536 › [browser] tab 2 opened a popup: http://127.0.0.1:51945/popup-target (disposition=foreground-tab, presentation=never)
21:44:40.560 › [browser] denied a media permission request from http://127.0.0.1:51945/
21:44:40.561 › [browser] denied a media permission request from http://127.0.0.1:51945/
21:44:40.561 › [browser] denied a web-app-installation permission request from http://127.0.0.1:51945/
21:44:40.561 › [browser] denied a geolocation permission request from http://127.0.0.1:51945/
21:44:40.568 › [browser] refused a popup from a popup: http://127.0.0.1:51945/popup-target?which=grandchild
```
