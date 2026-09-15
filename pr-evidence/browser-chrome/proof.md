### the app's own renderer is on the debugging port and the host published its state file

```
[PASS] renderer file:///Users/damian/local-operator-ui-worktrees/browser-chrome/out/renderer/index.html
state file /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-chrome-proof-76550/config/run/ui-browser/host.json mode 600
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
  "present": true,
  "text": "The server is offline. The interface will not function prope",
  "banner": {
    "top": 0,
    "height": 53
  },
  "tabStrip": {
    "top": 0,
    "height": 43
  },
  "overlapsTabStrip": true
}
```

### the tab strip is present in the layout, and the banner that covers it (by its own z-index comment) was measured before being hidden for the frames

```
[PASS] banner {"top":0,"height":53} (The server is offline. The interface will not function prope), tab strip {"top":0,"height":43}, overlaps true
```

### the toast over the browser surface

```
{
  "toastPresent": false,
  "text": null,
  "toast": null,
  "content": {
    "x": 220,
    "y": 84,
    "right": 1380,
    "bottom": 868
  },
  "overlapsContent": null,
  "paused": false
}
```

### every fixed-position element on screen over the browser route

```
[
 {
  "tag": "div",
  "cls": "fixed inset-x-0 top-0 z-2100 w-full",
  "box": {
   "top": 0,
   "left": 0,
   "w": 1380,
   "h": 53
  },
  "text": "The Local Operator  erver i  not an wering. Provid"
 }
]
```

### a toast overlaps the content area and is deliberately NOT registered: the page stays up, and the overlap is recorded rather than hidden

```
[PASS] no toast was raised within 20s in this run, so the trade is not exercised here; the dialog, sheet and band cases below are
```

### a control in the chrome band does not hide the view (the band is outside the rectangle)

```
[PASS] the page is showing with no overlay in the band
```

### a first launch opens exactly one blank tab, owned by the user

```
[PASS] [{"tabId":1,"title":"about:blank","url":"about:blank","owner":"user","active":true,"restored":false,"handedOver":false,"failed":false}]
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
[PASS] typed http://127.0.0.1:55079/slow and pressed Enter
```

### while loading, reload becomes stop and the field says both what the tab shows (nothing yet) and what was asked for

```
[PASS] {"stop":true,"reload":false,"spinnerInField":true,"value":"","placeholder":"http://127.0.0.1:55079/slow","addressFields":[{"value":"","placeholder":"http://127.0.0.1:55079/slow"}],"title":"about:blank"}
```

### page capture loading-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### the strip's title comes from the DOCUMENT, and the address bar shows the live URL

```
[PASS] title "Slow page", url http://127.0.0.1:55079/slow
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
[PASS] url http://127.0.0.1:55079/slow, canGoForward true
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
[PASS] {"code":"origin_not_allowed","message":"the user has not approved http://127.0.0.1:55079 for agent access","data":{"origin":"http://127.0.0.1:55079","authority":"127.0.0.1:55079","reason":"unapproved"}}
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
  "url": "http://127.0.0.1:55079/index.html"
}
```

### page capture recovered-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### an agent's request_access raises a pending entry and returns immediately

```
[PASS] {"origin":"http://127.0.0.1:55079","state":"pending","entry_id":"16c1ce9ccd3d4a5b863ed5a401585a9d","authority":"127.0.0.1:55079","expires_at":1789446537118,"broad":{"scope":"host","key":"127.0.0.1"}}
```

### the projection carries the origin and the broad option, and the requester only as a session id

```
[PASS] {"entryId":"16c1ce9ccd3d4a5b863ed5a401585a9d","origin":"http://127.0.0.1:55079","authority":"127.0.0.1:55079","broad":{"scope":"host","key":"127.0.0.1"},"expiresAt":1789446537118,"requesterSessionId":"proof"}
```

### the consent bar renders in the chrome band, names the origin, and offers the five scopes

```
[PASS] {
  "present": true,
  "text": "The agent in conversation proof wants to open 127.0.0.1:55079. This browser keeps sign-ins across conversations and app restarts, so an agent you approve here can use those signed-in accounts on the sites you allow it. You can open this site yourself either way — this only controls what the agent may reach. Allow once Allow until the app quits Always allow this site Allow all of 127.0.0.1 Don't allow Allow once one navigation, for that conversation, up to ten minutes Allow until the app quits this site, for this run only, and for every conversation Always allow this site kept until you revoke it, and shared with every conversation Allow all of 127.0.0.1 every site under 127.0.0.1, kept until you revoke it, shared with every conversation Don't allow the agent stops asking about this site until you revoke the denial in Sites",
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
[PASS] menu opened by a dispatched pointerdown on the trigger; items ["Switch to this tab","Let an agent use this tab…","Close tab"]; picked: clicked
```

### opening a dialog over the mounted browser surface hides the native view and shows the paused state

```
[PASS] {"dialog":true,"paused":true,"pageTitleInPaused":"Proof page one\n\nPaused while a dialog or panel is open — close it to bring the page back.","pausedBeforeOverlay":false}
```

### the dialog closes from its own Cancel action

```
[PASS] Cancel: clicked
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
[PASS] [{"origin":"http://127.0.0.1:55079","scope":"origin","grantedAt":1789445940294}]
```

### the requesting session's await_access now reports allowed

```
[PASS] {"origin":"http://127.0.0.1:55079","state":"allowed"}
```

### page capture approved-page

```
FAILED: 200 {"id":"proof-screenshot","ok":false,"error":{"code":"tab_closed","message":"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab","data":{"reason":"malformed_handle"}}}
```

### the agent's open now succeeds on the approved origin and returns a handle

```
[PASS] "ui:2:ce3c1784e647586ec8e3fdf87e973862"
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
[PASS] "http://127.0.0.1:55079/second"
```

### the populated frame carries the page layer (the composite has a page image, not a hole)

```
[PASS] page layer: /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-chrome-proof-76550/out/agent-populated-page.png
```

### a failed load reports the failure to the agent and does not leave the tab stuck loading

```
[PASS] agent goto -> {"code":"nav_failed","message":"ERR_EMPTY_RESPONSE","data":{"error_code":-324}}; tab url http://127.0.0.1:55079/broken (the last page it COMMITTED, which is the live url); loading false
```

### the deny action is offered and answers the prompt

```
[PASS] clicked 'Don't allow'
```

### a denial is recorded as a durable row so the Sites list can show it

```
[PASS] [{"origin":"http://127.0.0.1:55079","scope":"origin","grantedAt":1789445940294},{"origin":"http://127.0.0.1:1","scope":"deny","grantedAt":1789445953503}]
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

### the app's own process never became the frontmost application (probe P12, sampled once a second)

```
[PASS] app pid 76680; 59 samples; frontmost was ghostty|838; the app was frontmost in 0 of them
```

### frontmost application, sampled through the run

```
before: ghostty|838
after: ghostty|838
samples: ghostty|838
the app's pid (76680) was frontmost in 0 of 59 samples
```

### tabs at quit

```
[
  {
    "tabId": 1,
    "title": "Proof page one",
    "url": "http://127.0.0.1:55079/index.html",
    "owner": "user",
    "active": false,
    "restored": false,
    "handedOver": false,
    "failed": false
  },
  {
    "tabId": 2,
    "title": "127.0.0.1:55079/broken",
    "url": "http://127.0.0.1:55079/broken",
    "owner": "agent",
    "active": true,
    "restored": false,
    "handedOver": false,
    "failed": true
  }
]
```

### stopping the host writes the tab list, 0600, with no nonce anywhere in it

```
[PASS] /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-browser-chrome-proof-76550/userdata/browser/session.json mode 600
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
          "pageState": "eAIAACEAAABwAgAAGAAAAAAAAAAQAAAAAAAAABAAAAAAAAAACAAAAAAAAACQAAAABgAAAIgAAAAAAAAAAAAAAAAAAACoAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAAAAAABgAAAKgAAAAAAAAAvH14131bBgC9fXjXfVsGABgBAAAAAAAAMAEAAAAAAAAAAAAAAAAAACg
```

### both tabs are back, in the same order, and both are the USER's

```
[PASS] [
  {
    "tabId": 1,
    "title": "Proof page one",
    "url": "http://127.0.0.1:55079/index.html",
    "owner": "user",
    "active": false,
    "restored": true,
    "handedOver": false,
    "failed": false
  },
  {
    "tabId": 2,
    "title": "127.0.0.1:55079/broken",
    "url": "http://127.0.0.1:55079/broken",
    "owner": "user",
    "active": true,
    "restored": true,
    "handedOver": false,
    "failed": true
  }
]
```

### the restored tabs are FRESH navigations to the same URLs (no POST replay, no revived process)

```
[PASS] http://127.0.0.1:55079/index.html
http://127.0.0.1:55079/broken
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
[PASS] new handle ui:3:975be92… (old ui:2:ce3c178…)
```

### the banner after the restart

```
{"present":true,"height":53,"text":"The server is offline. The interface will not func"}
```
