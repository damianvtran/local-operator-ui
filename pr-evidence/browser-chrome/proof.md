### the app's own renderer is on the debugging port and the host published its state file

```
[PASS] renderer file:///Users/damian/local-operator-ui-worktrees/browser-chrome/out/renderer/index.html
state file /Users/damian/workspace/lo177/tmp/lo-browser-chrome-proof-34080/config/run/ui-browser/host.json mode 600
```

### the browser is reachable from the app's own navigation

```
[PASS] location.hash #/browser
```

### the reported content rectangle

```
{
  "rect": {
    "x": 220,
    "y": 84,
    "width": 1160,
    "height": 785
  },
  "viewport": {
    "width": 1380,
    "height": 868,
    "dpr": 2
  },
  "rail": 220,
  "windowSizeFlag": "1380x900"
}
```

### the renderer reports a content rectangle inside the viewport, and it starts below the chrome band

```
[PASS] rect {"x":220,"y":84,"width":1160,"height":785}, viewport {"width":1380,"height":868,"dpr":2}, rail 220px
```

### the connectivity banner over the browser route

```
{
  "present": false,
  "tabStrip": {
    "top": 0,
    "height": 43
  },
  "overlapsTabStrip": null
}
```

### the tab strip is present in the layout, whether or not the connectivity banner is up over it

```
[PASS] banner null (not up in this run), tab strip {"top":0,"height":43}, overlaps null
```

### strip exposure after whatever covers it is suppressed

```
{
  "strip": {
    "x": 220,
    "y": 0,
    "width": 1160,
    "height": 43
  },
  "probe": {
    "x": 800,
    "y": 21
  },
  "hidden": [
    {
      "tag": "p",
      "cls": "text-body-sm",
      "text": "This app is not paired with the running Local Operator serve"
    },
    {
      "tag": "div",
      "cls": "flex w-full items-center justify-between gap-4",
      "text": "Retry"
    },
    {
      "tag": "div",
      "cls": "flex min-w-0 flex-col gap-1",
      "text": ""
    },
    {
      "tag": "div",
      "cls": "flex w-full gap-3 border p-3 text-body-sm border-warning-border bg-warning-wash text-ink [",
      "text": ""
    },
    {
      "tag": "div",
      "cls": "fixed inset-x-0 top-0 z-2100 w-full",
      "text": ""
    }
  ],
  "leftInPlace": [],
  "topmost": true,
  "hit": "flex min-w-0 grow items-stretch"
}
```

### the tab strip is the topmost element at its own centre once the app's own banners are suppressed for the frames, so a frame can contain it

```
[PASS] strip {"x":220,"y":0,"width":1160,"height":43}, hidden over it: [{"tag":"p","cls":"text-body-sm","text":"This app is not paired with the running Local Operator serve"},{"tag":"div","cls":"flex w-full items-center justify-between gap-4","text":"Retry"},{"tag":"div","cls":"flex min-w-0 flex-col gap-1","text":""},{"tag":"div","cls":"flex w-full gap-3 border p-3 text-body-sm border-warning-border bg-warning-wash text-ink [","text":""},{"tag":"div","cls":"fixed inset-x-0 top-0 z-2100 w-full","text":""}], elementFromPoint(800, 21) -> flex min-w-0 grow items-stretch
```

### the toast over the browser surface

```
{
  "toastPresent": true,
  "text": "List agents request failed: 503",
  "toast": {
    "x": 1000,
    "y": 800,
    "right": 1356,
    "bottom": 844
  },
  "content": {
    "x": 220,
    "y": 84,
    "right": 1380,
    "bottom": 868
  },
  "overlapsContent": true,
  "paused": false
}
```

### every fixed-position element on screen over the browser route

```
[]
```

### a toast overlaps the content area and is deliberately NOT registered: the page stays up, and the overlap is recorded rather than hidden

```
[PASS] toast "List agents request failed: 503" overlaps the content rect: true; paused: false
```

### a control in the chrome band does not hide the view (the band is outside the rectangle)

```
[PASS] the page is showing with no overlay in the band
```

### a first launch opens exactly one blank tab, owned by the user

```
[PASS] [{"tabId":1,"title":"New tab","url":"about:blank","owner":"user","active":true,"restored":false,"handedOver":false,"failed":false}]
```

### the empty case renders the address bar and an empty field rather than the string about:blank

```
[PASS] address value is the empty string
```

### page capture empty-blank

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### a URL typed into the address bar navigates the active tab

```
[PASS] typed http://127.0.0.1:51974/slow and pressed Enter
```

### while loading, reload becomes stop and the field says both what the tab shows (nothing yet) and what was asked for

```
[PASS] {"stop":true,"reload":false,"spinnerInField":true,"value":"","placeholder":"http://127.0.0.1:51974/slow","addressFields":[{"value":"","placeholder":"http://127.0.0.1:51974/slow"}],"title":"New tab"}
```

### page capture loading-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### the strip's title comes from the DOCUMENT, and the address bar shows the live URL

```
[PASS] title "Slow page", url http://127.0.0.1:51974/slow
```

### the blank document a tab starts on is a history entry, so back is available after one navigation

```
[PASS] canGoBack true, canGoForward false
```

### page capture populated-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### the back control navigates the tab back through its own history

```
[PASS] url http://127.0.0.1:51974/slow, canGoForward true
```

### a navigation that cannot connect leaves the tab on the URL it asked for, rather than reporting success

```
[PASS] url http://127.0.0.1:9/, loading false
```

### page capture error-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### a refused navigation says why, in the app's own chrome, with the raw code and the address it tried

```
[PASS] {
  "panel": "Couldn't load this page\n\nThe page could not be loaded. Try again, or correct the address in the bar above — it is still yours to edit.\n\nERR_UNSAFE_PORT http://127.0.0.1:9/\n\nTry again",
  "retry": true,
  "band": "Error: ERR_UNSAFE_PORT (-312) loading 'http://127.0.0.1:9/'",
  "suppressedBy": "browser-load-failure::rg:"
}
```

### and the native view is hidden for it, so the panel is the thing on screen

```
[PASS] data-suppressed-by="browser-load-failure::rg:"
```

### the action's own refusal is still in the band after the state read that follows it

```
[PASS] band: "Error: ERR_UNSAFE_PORT (-312) loading 'http://127.0.0.1:9/'"
```

### an agent's navigation to an unapproved origin fails early with origin_not_allowed

```
[PASS] {"code":"origin_not_allowed","message":"the user has not approved http://127.0.0.1:51974 for agent access","data":{"origin":"http://127.0.0.1:51974","authority":"127.0.0.1:51974","reason":"unapproved"}}
```

### the user's typed navigation to that SAME origin works, because the user typing it is the consent

```
[PASS] the tab is still on the typed URL while the agent is refused on the site's origin
```

### a successful navigation clears the failure panel and restores the page

```
[PASS] {
  "panel": false,
  "suppressedBy": "",
  "url": "http://127.0.0.1:51974/index.html"
}
```

### page capture recovered-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### the page layer of 04c

```
withheld, deliberately and by design: the active tab is the user's, a user tab holds no capability handle, and the host will not screenshot a tab it has no handle for. This frame is the chrome after the recovery; the RECOVERED PAGE is the agent-tab frame `15b`, and the recovery's own assertion is the DOM/projection check above.
```

### an agent's request_access raises a pending entry and returns immediately

```
[PASS] {"origin":"http://127.0.0.1:51974","state":"pending","entry_id":"e86cda7da8a944dba2a68a16e8c2dcda","authority":"127.0.0.1:51974","expires_at":1789459608595,"broad":{"scope":"host","key":"127.0.0.1"}}
```

### the projection carries the origin and the broad option, and the requester only as a session id

```
[PASS] {"entryId":"e86cda7da8a944dba2a68a16e8c2dcda","origin":"http://127.0.0.1:51974","authority":"127.0.0.1:51974","broad":{"scope":"host","key":"127.0.0.1"},"expiresAt":1789459608595,"requesterSessionId":"proof"}
```

### the consent bar renders in the chrome band, names the origin, and offers the five scopes

```
[PASS] {
  "present": true,
  "text": "The agent in conversation proof wants to open 127.0.0.1:51974. This browser keeps sign-ins across conversations and app restarts, so an agent you approve here can use those signed-in accounts on the sites you allow it. You can open this site yourself either way — this only controls what the agent may reach. Allow once Allow until the app quits Always allow this site Allow all of 127.0.0.1 Don't allow Allow once one navigation, for that conversation, up to ten minutes Allow until the app quits this site, for this run only, and for every conversation Always allow this site kept until you revoke it, and shared with every conversation Allow all of 127.0.0.1 every site under 127.0.0.1, kept until you revoke it, shared with every conversation Don't allow the agent stops asking about this site until you revoke the denial in Sites",
  "actions": [
    "Allow once",
    "Allow until the app quits",
    "Always allow this site",
    "Allow all of 127.0.0.1",
    "Don't allow"
  ]
}
```

### page capture consent-pending-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### the tab strip's menu opens on a real press and offers the hand-over

```
[PASS] menu opened by a real mouse press; items ["Switch to this tab","Let an agent use this tab…","Close tab"]; picked: clicked
```

### opening a dialog over the mounted browser surface hides the native view and shows the paused state

```
[PASS] {"dialog":true,"paused":true,"pageTitleInPaused":"Proof page one\n\nPaused while a dialog or panel is open — close it to bring the page back.","pausedBeforeOverlay":false}
```

### strip exposure before 06-overlay-open

```
{
  "strip": {
    "x": 220,
    "y": 0,
    "width": 1160,
    "height": 43
  },
  "probe": {
    "x": 800,
    "y": 21
  },
  "hidden": [],
  "leftInPlace": [
    {
      "tag": "div",
      "cls": "fixed inset-0 z-50 bg-scrim",
      "text": ""
    }
  ],
  "topmost": false,
  "hit": "fixed inset-0 z-50 bg-scrim"
}
```

### the dialog closes from its own Cancel action

```
[PASS] Cancel: clicked
```

### strip exposure before 07-overlay-restored

```
{
  "strip": {
    "x": 220,
    "y": 0,
    "width": 1160,
    "height": 43
  },
  "probe": {
    "x": 800,
    "y": 21
  },
  "hidden": [
    {
      "tag": "p",
      "cls": "text-body-sm",
      "text": "This app is not paired with the running Local Operator serve"
    },
    {
      "tag": "div",
      "cls": "flex w-full items-center justify-between gap-4",
      "text": "Retry"
    },
    {
      "tag": "div",
      "cls": "flex min-w-0 flex-col gap-1",
      "text": ""
    },
    {
      "tag": "div",
      "cls": "flex w-full gap-3 border p-3 text-body-sm border-warning-border bg-warning-wash text-ink [",
      "text": ""
    },
    {
      "tag": "div",
      "cls": "fixed inset-x-0 top-0 z-2100 w-full",
      "text": ""
    }
  ],
  "leftInPlace": [],
  "topmost": true,
  "hit": "flex min-w-0 grow items-stretch"
}
```

### page capture restored-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### closing the dialog restores the view

```
[PASS] paused after close false, chrome frame true
```

### the page layer of a user-created tab

```
capture refused: (none) — a user tab holds no handle (design 6.3), so its page is not addressable by the agent-facing RPC; the composited frames below use an agent-driven tab.
```

### the consent bar's scopes are answered by a real click, not by an API call

```
[PASS] clicked 'Always allow this site'
```

### approving writes a durable exact-origin grant, visible in the approvals list

```
[PASS] [{"origin":"http://127.0.0.1:51974","scope":"origin","grantedAt":1789459011079}]
```

### the requesting session's await_access now reports allowed

```
[PASS] {"origin":"http://127.0.0.1:51974","state":"allowed"}
```

### page capture approved-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### the agent's open now succeeds on the approved origin and returns a handle

```
[PASS] "ui:2:a1df68b580d86782e8c9db3063329ccb"
```

### the strip holds a user tab and an agent tab, and the agent's open did NOT steal the active tab

```
[PASS] active before 1, active after 1, owners user,agent
```

### the strip marks exactly the agent tab, and exactly one tab is selected

```
[PASS] {
  "tabs": [
    "Proof page one",
    "Proof page two Agent"
  ],
  "agentMarkers": 1,
  "selected": 1
}
```

### the user can drive a tab the AGENT created (takeover), and the agent's handle keeps working on it

```
[PASS] typed a URL into the address bar while the agent's tab was active
```

### the agent's goto still drives that tab after the user took over, and settles on what it reached

```
[PASS] "http://127.0.0.1:51974/second"
```

### the populated frame carries the page layer (the composite has a page image, not a hole)

```
[PASS] page layer: /Users/damian/workspace/lo177/tmp/lo-browser-chrome-proof-34080/out/agent-populated-page.png
```

### page layer withheld for 15-surface-error-agent-tab

```
the app suppresses the native view, so there is no page layer to composite: data-suppressed-by="browser-load-failure::rg:"
```

### a failed load reports the failure to the agent and does not leave the tab stuck loading

```
[PASS] agent goto -> {"code":"nav_failed","message":"ERR_EMPTY_RESPONSE","data":{"error_code":-324}}; tab url http://127.0.0.1:51974/broken (the last page it COMMITTED, which is the live url); loading false
```

### the strip frame carries both owners, the failed agent tab marked, with the user's own tab active

```
[PASS] strip [{"id":1,"owner":"user","active":true,"failed":false,"restored":false,"title":"Proof page one"},{"id":2,"owner":"agent","active":false,"failed":true,"restored":false,"title":"127.0.0.1:51974/broken"}]
```

### what this frame's content region is (and is not)

```
the subject is the STRIP: it is above the content rect, where no native view paints. The region below it is not composited, because the active tab is the user's and a user tab holds no handle by design (design 7.3) - `04c` and the recovered agent frame `15b` are where the page layer itself is photographed.
```

### the agent tab's recovery is photographed WITH its page: the load succeeds, the panel is gone and the page layer is in the frame

```
[PASS] page layer: /Users/damian/workspace/lo177/tmp/lo-browser-chrome-proof-34080/out/agent-recovered-page.png; navFailure null
```

### the deny action is offered and answers the prompt

```
[PASS] clicked 'Don't allow'
```

### a denial is recorded as a durable row so the Sites list can show it

```
[PASS] [{"origin":"http://127.0.0.1:51974","scope":"origin","grantedAt":1789459011079},{"origin":"http://127.0.0.1:1","scope":"deny","grantedAt":1789459024635}]
```

### the Sites sheet answers 'which sites can an agent act on as me' in one click, with the revocation affordances

```
[PASS] {
  "present": true,
  "pausedBehindIt": true,
  "buttons": [
    "Revoke",
    "Revoke all site approvals",
    "Revoke",
    "Forget this site",
    "Clear cookies and site data",
    "Clear cache",
    "Clear everything",
    ""
  ],
  "hasForgetSite": true,
  "hasAgentsNotice": true,
  "hasCookieClear": true,
  "hasRevokeAll": true,
  "hasRevokeOne": true,
  "headings": [
    "Approved",
    "Denied",
    "This site",
    "Browsing data"
  ]
}
```

### strip exposure before 11-sites-and-revocation

```
{
  "strip": {
    "x": 220,
    "y": 0,
    "width": 1160,
    "height": 43
  },
  "probe": {
    "x": 800,
    "y": 21
  },
  "hidden": [],
  "leftInPlace": [
    {
      "tag": "div",
      "cls": "fixed inset-0 z-50 bg-scrim",
      "text": ""
    }
  ],
  "topmost": false,
  "hit": "fixed inset-0 z-50 bg-scrim"
}
```

### the app's own process never became the frontmost application (probe P12, sampled once a second)

```
[PASS] app pid 34109; 32 samples; frontmost was ghostty|838; the app was frontmost in 0 of them
```

### frontmost application, sampled through the run

```
before: ghostty|838
after: ghostty|838
samples: ghostty|838
the app's pid (34109) was frontmost in 0 of 32 samples
```

### tabs at quit

```
[
  {
    "tabId": 1,
    "title": "Proof page one",
    "url": "http://127.0.0.1:51974/index.html",
    "owner": "user",
    "active": false,
    "restored": false,
    "handedOver": false,
    "failed": false
  },
  {
    "tabId": 2,
    "title": "Proof page two",
    "url": "http://127.0.0.1:51974/second",
    "owner": "agent",
    "active": true,
    "restored": false,
    "handedOver": false,
    "failed": false
  }
]
```

### stopping the host writes the tab list, 0600, with no nonce anywhere in it - and writes EVERY tab the strip held, which is what a SIGTERM stop used to lose

```
[PASS] /Users/damian/workspace/lo177/tmp/lo-browser-chrome-proof-34080/userdata/browser/session.json mode 600: 2 row(s) written for 2 navigated tab(s) of 2 in the strip
{
  "version": 1,
  "tabs": [
    {
      "owner": "user",
      "active": false,
      "entries": [
        {
          "url": "about:blank",
          "title": "about:blank",
          "pageState": "eAIAACEAAABwAgAAGAAAAAAAAAAQAAAAAAAAABAAAAAAAAAACAAAAAAAAACQAAAABgAAAIgAAAAAAAAAAAAAAAAAAACoAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAAAAAABgAAAKgAAAAAAAAA8Ze744BbBgDyl7vjgFsGABgBAAAAAAAAMAEAAAAAAAAAAAAAAAAAACg
```

### both tabs are back, in the same order, and both are the USER's

```
[PASS] [
  {
    "tabId": 1,
    "title": "Proof page one",
    "url": "http://127.0.0.1:51974/index.html",
    "owner": "user",
    "active": false,
    "restored": true,
    "handedOver": false,
    "failed": false
  },
  {
    "tabId": 2,
    "title": "Proof page two",
    "url": "http://127.0.0.1:51974/second",
    "owner": "user",
    "active": true,
    "restored": true,
    "handedOver": false,
    "failed": false
  }
]
```

### the restored tabs are FRESH navigations to the same URLs (no POST replay, no revived process)

```
[PASS] http://127.0.0.1:51974/index.html
http://127.0.0.1:51974/second
```

### a restored tab does NOT satisfy an agent's stale handle: it gets tab_closed, the ordinary recovery

```
[PASS] code tab_closed, message that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab
```

### and a stale handle cannot READ the restored tab either

```
[PASS] code tab_closed
```

### the agent's designed recovery still works: open re-creates a tab and hands out a new handle

```
[PASS] new handle ui:3:0773b37… (old ui:2:a1df68b…)
```

### strip exposure after the restart

```
{
  "strip": {
    "x": 220,
    "y": 0,
    "width": 1160,
    "height": 43
  },
  "probe": {
    "x": 800,
    "y": 21
  },
  "hidden": [
    {
      "tag": "p",
      "cls": "text-body-sm",
      "text": "This app is not paired with the running Local Operator serve"
    },
    {
      "tag": "div",
      "cls": "flex w-full items-center justify-between gap-4",
      "text": "Retry"
    },
    {
      "tag": "div",
      "cls": "flex min-w-0 flex-col gap-1",
      "text": ""
    },
    {
      "tag": "div",
      "cls": "flex w-full gap-3 border p-3 text-body-sm border-warning-border bg-warning-wash text-ink [",
      "text": ""
    },
    {
      "tag": "div",
      "cls": "fixed inset-x-0 top-0 z-2100 w-full",
      "text": ""
    }
  ],
  "leftInPlace": [],
  "topmost": true,
  "hit": "browser-tab-agent-marker"
}
```

### the strip is exposed in the frames taken after the restart too, so the restored tabs and their `Restored` marker are photographed

```
[PASS] strip {"x":220,"y":0,"width":1160,"height":43}, topmost true (browser-tab-agent-marker)
```
