# Console host end-to-end proof

Scratch: `/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826`
Result: 2 of 71 check(s) FAILED
Reaped stray spawn-helper processes: 0


## PASS — --pair supplied a daemon and a conversation for the pane cells

```
{
  "port": 47391,
  "session": "3aedd02be7f7",
  "record": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/config/run/serve/54878.json"
}
```

## PASS — the discovery record carries the console capability

```
{
  "console": true,
  "console_surfaces": 0,
  "console_agent_surfaces": 0,
  "pid": 54989,
  "proto": 1
}
```

## PASS — /health reports the console capability

```
{
  "host": "ui",
  "proto": 1,
  "pid": 54989,
  "console": true,
  "capabilities": [
    "styles",
    "hit_test",
    "ancestors",
    "download",
    "upload"
  ]
}
```

## PASS — a request with no key is a 401 with no detail

```
{
  "status": 401,
  "body": "{\"detail\":\"unauthorized\"}"
}
```

## PASS — a wrong key is a 401 with no detail

```
{
  "status": 401,
  "body": "{\"detail\":\"unauthorized\"}"
}
```

## PASS — an unknown console method is a typed version-skew refusal, not a 422

```
{
  "status": 200,
  "body": {
    "id": "proof-console_frobnicate",
    "ok": false,
    "error": {
      "code": "unsupported_method",
      "message": "this app version has no console method \"console_frobnicate\"; update Local Operator",
      "data": {
        "method": "console_frobnicate"
      }
    }
  }
}
```

## console_create

```
{
  "surface": "con:1:2CPPMz9R2U6dvH_azY0mkA",
  "cols": 120,
  "rows": 40,
  "pid": 55709,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — a surface is born at the grid it was asked for, in the user's home

```
{
  "surface": "con:1:2CPPMz9R2U6dvH_azY0mkA",
  "cols": 120,
  "rows": 40,
  "pid": 55709,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — the handle names its host

```
con:1:2CPPMz9R2U6dvH_azY0mkA
```

## PASS — the runtime restored the helper's exec bit (trap 1)

```
{
  "helper": "/Users/damian/local-operator-ui/.worktrees/console-close-754/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "modeBefore": "0644 (the published tarball's own mode)",
  "modeAfter": "0755",
  "logged": true
}
```

## PASS — console_read answers from the record, with no view present (R7)

```
{
  "text": "sh-3.2$ printf 'marker-424242\\n'\nmarker-424242\nsh-3.2$ \n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n",
  "cols": 120,
  "rows": 40,
  "cursor": {
    "x": 8,
    "y": 2
  }
}
```

## PASS — a resize reaches the pty (one SIGWINCH, and stty agrees)

```
{
  "resize": {
    "cols": 100,
    "rows": 30
  },
  "viewport": "sh-3.2$ printf 'marker-424242\\n'\nmarker-424242\nsh-3.2$ stty size\n30 100\nsh-3.2$ \n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n"
}
```

## PASS — non-ASCII output reaches the record intact

```
{
  "text": "日本\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n"
}
```

## PASS — a character split across two pty reads is still one character

```
{
  "tail": "日\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n"
}
```

## PASS — a non-ASCII payload reaches the program byte for byte, on both paths

```
{
  "expected": "e697a5e69cace697a50a",
  "got": "e697a5e69cace697a50a",
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/input-roundtrip.bin"
}
```

## PASS — named keys are encoded and accepted, and `encoded` is the SEQUENCES

```
{
  "accepted": true,
  "encoded": [
    "\u001b[A",
    "\u0003"
  ]
}
```

## PASS — an input payload past the bound is refused, naming what it accepted

```
{
  "code": "input_queue_full",
  "message": "that payload is 400000 bytes and this surface accepts 262144 at a time",
  "data": {
    "accepted": 0,
    "limit": 262144
  }
}
```

## PASS — paste is bracketed because the record's live mode says so

```
{
  "modes": {
    "bracketedPaste": true,
    "applicationCursorKeys": false,
    "mouseTracking": "none"
  },
  "bytes": 18
}
```

## PASS — a headless launch's window never holds key focus (the mode it named)

```
{"visibility":"visible","focused":false}
```

## PASS — the console trigger is on screen in a conversation's header (Q-5, Q-10)

```
{
  "x": 1296,
  "y": 52,
  "box": {
    "x": 1280,
    "y": 36,
    "width": 32,
    "height": 32
  }
}
```

## what is under the pointer at the trigger's centre

```
{
  "under": {
    "tag": "BUTTON",
    "tag_": "console-pane-trigger",
    "closest": true
  },
  "triggerAt": {
    "x": 1296,
    "y": 52,
    "box": {
      "x": 1280,
      "y": 36,
      "width": 32,
      "height": 32
    }
  }
}
```

## how the pane was opened

```
{
  "pressTook": true
}
```

## PASS — the pane is mounted on a conversation and its terminal is on screen (Q-5)

```
{
  "pane": {
    "x": 740,
    "y": 32,
    "width": 640,
    "height": 868
  },
  "mirror": {
    "x": 748,
    "y": 109,
    "width": 624,
    "height": 791
  }
}
```

## PASS — the app is wearing a named theme (the capture view is fed its name)

```
localOperatorDark
```

## capture geometry

```
{
  "rendered": "displayed",
  "cols": 80,
  "rows": 46,
  "theme": "localOperatorDark",
  "live": true,
  "bytes": 47690,
  "frame": {
    "width": 1248,
    "height": 1582
  },
  "pane": {
    "x": 740,
    "y": 32,
    "width": 640,
    "height": 868
  },
  "mirror": {
    "x": 748,
    "y": 109,
    "width": 624,
    "height": 791
  },
  "dpr": 2,
  "sha256": "877422b5c9e5afd4c592669fcdeff99c0e341341b89f3cdaa7245364e6811618",
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/console-con_1_2CPPMz9R2U6dvH_azY0mkA.png"
}
```

## PASS — a screenshot is the app's own window, cropped to the PANE's rect (design 13.2, Q-5)

```
{
  "rendered": "displayed",
  "cols": 80,
  "rows": 46,
  "frame": {
    "width": 1248,
    "height": 1582
  },
  "mirror": {
    "x": 748,
    "y": 109,
    "width": 624,
    "height": 791
  },
  "dpr": 2,
  "bytes": 47690
}
```

## PASS — pressing a tab selects it (#754 leaves select-on-click alone)

```
{
  "runningSurface": "con:5:HPrmfYrneP4qlCcM3WaRWw",
  "selected": "con:5:HPrmfYrneP4qlCcM3WaRWw"
}
```

## PASS — the pane's own Close console still closes the PANE, not the surface (design 6.4)

```
{
  "paneGone": true,
  "running": true
}
```

## PASS — the strip's close control is on the row, named for its terminal (#754)

```
{
  "runningSurface": "con:5:HPrmfYrneP4qlCcM3WaRWw",
  "reading": [
    {
      "surface": "con:5:HPrmfYrneP4qlCcM3WaRWw",
      "label": "Close zsh",
      "opacity": "1",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:1:2CPPMz9R2U6dvH_azY0mkA",
      "label": "Close sh",
      "opacity": "0",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:3:r8p2oHG5DICXbcFNiJ8XnA",
      "label": "Dismiss sh",
      "opacity": "0",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:2:FLAKYXxdiuCtagifz-1GJg",
      "label": "Dismiss sh",
      "opacity": "0",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    }
  ]
}
```

## PASS — the control is a real button, so a keyboard reaches it (tab order; Enter activates)

```
{
  "surface": "con:5:HPrmfYrneP4qlCcM3WaRWw",
  "label": "Close zsh",
  "opacity": "1",
  "width": 28,
  "height": 28,
  "tag": "button",
  "tabIndex": 0
}
```

## PASS — the active row's control is revealed; an inactive row's waits for hover or focus

```
[
  {
    "surface": "con:5:HPrmfYrneP4qlCcM3WaRWw",
    "label": "Close zsh",
    "opacity": "1",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:1:2CPPMz9R2U6dvH_azY0mkA",
    "label": "Close sh",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:3:r8p2oHG5DICXbcFNiJ8XnA",
    "label": "Dismiss sh",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:2:FLAKYXxdiuCtagifz-1GJg",
    "label": "Dismiss sh",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  }
]
```

## frame close-affordance.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-affordance.png",
  "bytes": 369168,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "1a36eab6561261437e577a7ada0cfbd6ecb3ab0843d36a6ed5bf6e7934009ee4"
}
```

## PASS — a running surface's close asks first, in the shared dialog's own copy (#754)

```
{
  "text": "Close this terminal?This ends the program running here and removes its tab.CancelClose terminal",
  "cancel": true,
  "confirm": true
}
```

## PASS — the question signals nothing: the surface still runs, and the other row stays selected

```
{
  "running": true,
  "live": true,
  "selected": "con:1:2CPPMz9R2U6dvH_azY0mkA"
}
```

## frame close-question.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-question.png",
  "bytes": 368934,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "ebf4610e265b824e1ec742507b6c83426e12ca10900119dd0f5ddfe03214b813"
}
```

## PASS — the question's Cancel changes nothing: no dialog, still running, still listed

```
{
  "afterCancel": null
}
```

## PASS — a retained user surface has history on disk before the close (the restart cell's discriminant)

```
{
  "historyLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/config/run/ui-console/history/3aedd02be7f7/con_5_HPrmfYrneP4qlCcM3WaRWw.log"
}
```

## PASS — the question opens again after a cancel (the press is repeatable)

```
{
  "text": "Close this terminal?This ends the program running here and removes its tab.CancelClose terminal",
  "cancel": true,
  "confirm": true
}
```

## PASS — confirming the question kills the surface: gone from the listing, refused by name

```
{
  "gone": true,
  "status": {
    "id": "proof-console_status",
    "ok": false,
    "error": {
      "code": "surface_unavailable",
      "message": "no console surface named con:5:HPrmfY…; 3 exist",
      "data": {
        "surface": "con:5:HPrmfY…",
        "count": 3
      }
    }
  },
  "elapsedMs": 6052
}
```

## PASS — the closed surface's selection moves to a neighbour, never a dead lens (#754)

```
{
  "closed": "con:5:HPrmfYrneP4qlCcM3WaRWw",
  "selectedAfterClose": "con:1:2CPPMz9R2U6dvH_azY0mkA"
}
```

## PASS — a close keeps a retained surface's history (the dismissal below is what removes it)

```
{
  "historyLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/config/run/ui-console/history/3aedd02be7f7/con_5_HPrmfYrneP4qlCcM3WaRWw.log"
}
```

## frame close-closed.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-closed.png",
  "bytes": 399759,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "41579647d4dc1205779a17c6492de3dd2c59908e6e7f83c3821e374f6efd308d"
}
```

## PASS — the question is gone once it has been answered

```
null
```

## PASS — an ended row's control names the DISMISSAL, not the kill (#754's two states)

```
{
  "dismissLabel": "Dismiss zsh",
  "ended": {
    "running": false,
    "exit_code": 0,
    "exit_epoch": 1,
    "cols": 100,
    "rows": 30,
    "live": true,
    "truncated": false,
    "dropped_live_bytes": 0,
    "modes": {
      "bracketedPaste": false,
      "applicationCursorKeys": false,
      "mouseTracking": "none"
    },
    "cursor": {
      "x": 0,
      "y": 1
    },
    "last_activity": 1790960921.451,
    "retain": true,
    "secure": false,
    "env_marker": {
      "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
      "value": "con:6:DAaPGBfkuHr0HMwro4CQLQ"
    }
  }
}
```

## PASS — the ended surface's retained history is on disk before the dismissal

```
{
  "dismissedLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/config/run/ui-console/history/3aedd02be7f7/con_6_DAaPGBfkuHr0HMwro4CQLQ.log"
}
```

## PASS — a dismissal asks nothing (there is no process left to protect)

```
{
  "question": null
}
```

## PASS — the dismissal removed the surface from the registry AND its history from disk

```
{
  "gone": true,
  "historyRemoved": true,
  "dismissedLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/config/run/ui-console/history/3aedd02be7f7/con_6_DAaPGBfkuHr0HMwro4CQLQ.log"
}
```

## PASS — the dismissed surface's selection moves to a neighbour too (#754)

```
{
  "dismissed": "con:6:DAaPGBfkuHr0HMwro4CQLQ",
  "selectedAfterDismiss": "con:1:2CPPMz9R2U6dvH_azY0mkA"
}
```

## frame close-dismissed.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-dismissed.png",
  "bytes": 399409,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "c2a29c2f789233d1b44f127c144c2b871a0f1e5cb6b6de1f0f5694aa3676392e"
}
```

## offscreen capture

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 80,
  "rows": 46,
  "bytes": 47039,
  "sha256": "50365f2d44072772781fea53b26d17251957a3786ef58579745fd624925770bd",
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/console-con_1_2CPPMz9R2U6dvH_azY0mkA-offscreen.png"
}
```

## PASS — a capture with no displayed pane is a DOM-rendered reconstruction from the record

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 80,
  "rows": 46,
  "displayedGrid": {
    "cols": 80,
    "rows": 46
  },
  "bytes": 47039
}
```

## four captures across three surfaces (Q-11)

```
{
  "alpha1": {
    "sha": "64b0b5a4c6cbd52a2f9374b99ac6c8b7f8cc6e854af47525bea8bca78aed0626",
    "bytes": 12834,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "8f2b50536b186261f239832841012311739b867e8a4271995a5e636a17e6848f",
    "bytes": 12498,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "64b0b5a4c6cbd52a2f9374b99ac6c8b7f8cc6e854af47525bea8bca78aed0626",
    "bytes": 12834,
    "rendered": "offscreen",
    "attempts": 1
  },
  "empty": {
    "sha": "40145e5623ca5269d27c31a17668e1213bb5ffd8b730cfbfa21978f82a451d3b",
    "bytes": 7186,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — two surfaces with different records give different frames (Q-11)

```
{
  "alpha1": {
    "sha": "64b0b5a4c6cbd52a2f9374b99ac6c8b7f8cc6e854af47525bea8bca78aed0626",
    "bytes": 12834,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "8f2b50536b186261f239832841012311739b867e8a4271995a5e636a17e6848f",
    "bytes": 12498,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — the SAME record captured twice gives the SAME frame (Q-11)

```
{
  "alpha1": {
    "sha": "64b0b5a4c6cbd52a2f9374b99ac6c8b7f8cc6e854af47525bea8bca78aed0626",
    "bytes": 12834,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "64b0b5a4c6cbd52a2f9374b99ac6c8b7f8cc6e854af47525bea8bca78aed0626",
    "bytes": 12834,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — an empty record is its own frame, not another surface's (Q-11)

```
{
  "empty": {
    "sha": "40145e5623ca5269d27c31a17668e1213bb5ffd8b730cfbfa21978f82a451d3b",
    "bytes": 7186,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alphaBytes": 12834,
  "betaBytes": 12498
}
```

## five captures of one large record (Q-13)

```
[
  {
    "sha": "fbfd72336edb6f59743d4408e8c00bcebbc40e1a2ee9e22722a51fbf5c978668",
    "bytes": 81555,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "98fe1c887cffea0d24e80f15cabb023ffbbda03b6000e3c5cd2c43b3b4a88ada",
    "bytes": 81750,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "5bf794523082fb10a2d18d25185d8e47ab101599a366ea01dbba25a11efc48d1",
    "bytes": 81579,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "82df16963f9f4b36c86b2524ac27708f28f33d4bc0867ce8334fd75b20b9af6b",
    "bytes": 81669,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "b917c23377fad1f2ab70e13cbd798938940a4a14a24c1f2f9e15059aa5df7a50",
    "bytes": 81585,
    "rendered": "offscreen",
    "attempts": 1
  }
]
```

## FAIL — a large record is captured five times, none refused, all five the same frame (Q-13)

```
[
  {
    "sha": "fbfd72336edb6f59743d4408e8c00bcebbc40e1a2ee9e22722a51fbf5c978668",
    "bytes": 81555,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "98fe1c887cffea0d24e80f15cabb023ffbbda03b6000e3c5cd2c43b3b4a88ada",
    "bytes": 81750,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "5bf794523082fb10a2d18d25185d8e47ab101599a366ea01dbba25a11efc48d1",
    "bytes": 81579,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "82df16963f9f4b36c86b2524ac27708f28f33d4bc0867ce8334fd75b20b9af6b",
    "bytes": 81669,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "b917c23377fad1f2ab70e13cbd798938940a4a14a24c1f2f9e15059aa5df7a50",
    "bytes": 81585,
    "rendered": "offscreen",
    "attempts": 1
  }
]
```

## PASS — the preload exposes a state-change subscriber

```
armed
```

## PASS — an agent's resize reaches a mounted pane as a broadcast, not only as its own reply

```
{
  "frames": 1,
  "resize": {
    "cols": 110,
    "rows": 33
  },
  "paneGrid": {
    "surface": "con:1:2CPPMz9R2U6dvH_azY0mkA",
    "session_id": "3aedd02be7f7",
    "origin": "agent",
    "command": "sh",
    "argv_tail": "-f -i",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
    "cols": 110,
    "rows": 33,
    "running": true,
    "exit_code": null,
    "last_activity": 1790961139.891,
    "live": true,
    "agent_owned": true,
    "last_actor": "agent",
    "secure": false,
    "retain": false,
    "sizing": "auto",
    "displayed": true,
    "last_mark": null
  }
}
```

## PASS — secure input refuses a read and a capture

```
{
  "read": {
    "code": "secure_input_active",
    "message": "con:1:2CPPMz… is in secure input; reads and captures are refused until it is turned off",
    "data": {
      "secure": true
    }
  },
  "screenshot": {
    "code": "secure_input_active",
    "message": "con:1:2CPPMz… is in secure input; reads and captures are refused until it is turned off",
    "data": {
      "secure": true
    }
  }
}
```

## PASS — the secure span keeps the bytes already retained, live and on disk (§11.4.4)

```
{
  "bytesBefore": 13,
  "bytesAfter": 13,
  "truncatedWhileSecure": false,
  "reopenedHoldsMarker": true,
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/config/run/ui-console/history/3aedd02be7f7/con_11_mx6JSBNvICZDG5OzqMgMgg.log"
}
```

## PASS — an unknown handle names the handle and how many exist

```
{
  "code": "surface_unavailable",
  "message": "no console surface named con:99:nope…; 3 exist",
  "data": {
    "surface": "con:99:nope…",
    "count": 3
  }
}
```

## PASS — an out-of-range grid is refused with the clamp it would have applied

```
{
  "code": "invalid_grid",
  "message": "10x30 is outside the supported grid; the clamp would be 40x30",
  "data": {
    "clamp": {
      "cols": 40,
      "rows": 30
    }
  }
}
```

## PASS — an unknown key lists what is accepted

```
{
  "code": "unknown_key",
  "message": "unknown key \"page-down\"; accepted: enter, return, tab, shift+tab, backspace, escape, space, up, down, left, right, home, end, pageup, pagedown, insert, delete, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, ctrl+a, ctrl+b, ctrl+c, ctrl+d, ctrl+e, ctrl+f, ctrl+g, ctrl+h, ctrl+i, ctrl+j, ctrl+k, ctrl+l, ctrl+m, ctrl+n, ctrl+o, ctrl+p, ctrl+q, ctrl+r, ctrl+s, ctrl+t, ctrl+u, ctrl+v, ctrl+w, ctrl+x, ctrl+y, ctrl+z, ctrl+space, ctrl+[, ctrl+\\, ctrl+], ctrl+^, ctrl+_",
  "data": {
    "accepted": [
      "enter",
      "return",
      "tab",
      "shift+tab",
      "backspace",
      "escape",
      "space",
      "up",
      "down",
      "left",
      "right",
      "home",
      "end",
      "pageup",
      "pagedown",
      "insert",
      "delete",
      "f1",
      "f2",
      "f3",
      "f4",
      "f5",
      "f6",
      "f7",
      "f8",
      "f9",
      "f10",
      "f11",
      "f12",
      "ctrl+a",
      "ctrl+b",
      "ctrl+c",
      "ctrl+d",
      "ctrl+e",
      "ctrl+f",
      "ctrl+g",
      "ctrl+h",
      "ctrl+i",
      "ctrl+j",
      "ctrl+k",
      "ctrl+l",
      "ctrl+m",
      "ctrl+n",
      "ctrl+o",
      "ctrl+p",
      "ctrl+q",
      "ctrl+r",
      "ctrl+s",
      "ctrl+t",
      "ctrl+u",
      "ctrl+v",
      "ctrl+w",
      "ctrl+x",
      "ctrl+y",
      "ctrl+z",
      "ctrl+space",
      "ctrl+[",
      "ctrl+\\",
      "ctrl+]",
      "ctrl+^",
      "ctrl+_"
    ],
    "key": "page-down"
  }
}
```

## PASS — a surface's process exit is observed once, with its code and its generation

```
{
  "running": false,
  "exit_code": 5,
  "exit_epoch": 1,
  "cols": 80,
  "rows": 24,
  "live": true,
  "truncated": false,
  "dropped_live_bytes": 0,
  "modes": {
    "bracketedPaste": false,
    "applicationCursorKeys": false,
    "mouseTracking": "none"
  },
  "cursor": {
    "x": 0,
    "y": 1
  },
  "last_activity": 1790961166.017,
  "retain": false,
  "secure": false,
  "env_marker": {
    "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
    "value": "con:12:8djZd_K3vRHjFl1LJ6f3Jw"
  }
}
```

## PASS — a surface that has not exited reports generation 0

```
{
  "exit_epoch": 0,
  "running": true
}
```

## PASS — an exited surface still reads, and reads as live rather than as history

```
{
  "text": "exited-marker\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n",
  "cols": 80,
  "rows": 24,
  "cursor": {
    "x": 0,
    "y": 1
  },
  "truncated": false,
  "live": true,
  "mode": "viewport"
}
```

## PASS — input to an exited surface is a typed refusal carrying the code

```
{
  "code": "process_exited",
  "message": "con:12:8djZd_… has exited with code 5; its output is still readable",
  "data": {
    "exit_code": 5,
    "retain": false
  }
}
```

## PASS — the exit generation is on disk in the sidecar (§7.3)

```
{
  "exit_epoch": 1,
  "exit_code": 0
}
```

## PASS — a retained surface's bytes are on disk, 0600, and say what it printed

```
{
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/config/run/ui-console/history/3aedd02be7f7/con_13_GM4UG1wTLewqQwZkZNec3Q.log",
  "mode": 384
}
```

## PASS — the retained history is 0600

```
{
  "mode": "600"
}
```

## FAIL — a 8 MiB flood with retention ON leaves main answering (§19.1 P3)

```
{
  "baselineMs": {
    "max": 1067,
    "median": 1051
  },
  "floodMs": {
    "answered": 1,
    "median": 1059,
    "p95": 1059,
    "max": 1059
  },
  "ceilings": {
    "median": 100,
    "p95": 500
  },
  "truncated": false,
  "exit_epoch": 1,
  "bytes": 8388608,
  "producerExitCode": 0,
  "subscriberAttached": "con:14:QEujGNfhxQbgHDSANxHGhA",
  "replayBytesAtSubscribe": 2745528,
  "surface": "con:14:QEujGNfhxQbgHDSANxHGhA"
}
```

## PASS — the flood never grew the app tree past its RSS ceiling

```
{
  "rssBeforeBytes": 584581120,
  "rssPeakBytes": 584695808,
  "ceilingBytes": 268435456,
  "growthBytes": 114688
}
```

## PASS — the ninth agent surface in one session is refused, with the browser's own code

```
{
  "heldBefore": 4,
  "created": 4,
  "refusal": {
    "code": "tab_limit",
    "message": "this session's agent is already running 8 console surfaces; close one first",
    "data": {
      "limit": 8,
      "scope": "session"
    }
  }
}
```

## PASS — closing a running surface signals it, learns its exit code and answers

```
{
  "closed": true,
  "exit_code": 0
}
```

## console_list after the close

```
{
  "surfaces": [
    {
      "surface": "con:2:FLAKYXxdiuCtagifz-1GJg",
      "session_id": "3aedd02be7f7",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '日本\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790960650.261,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:3:r8p2oHG5DICXbcFNiJ8XnA",
      "session_id": "3aedd02be7f7",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '\\346\\227'; sleep 0.3; printf '\\245\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790960652.914,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:12:8djZd_K3vRHjFl1LJ6f3Jw",
      "session_id": "3aedd02be7f7",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf 'exited-marker\\n'; exit 5",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 5,
      "last_activity": 1790961166.017,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:15:86AozwSV6WOu5oXsN8uCiQ",
      "session_id": "3aedd02be7f7",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
      "cols": 100,
      "rows": 30,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790961292.916,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:16:ZGMkLtuuBs_YSWBxiCZENQ",
      "session_id": "3aedd02be7f7",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
      "cols": 80,
      "rows": 44,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790961293.924,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:17:-A6ppJnIQo3HqivqkwWUHw",
      "session_id": "3aedd02be7f7",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
      "cols": 100,
      "rows": 30,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790961294.94,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:18:G2nkFH6jDQKxdajdUSOaYQ",
      "session_id": "3aedd02be7f7",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1790961291.95,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    }
  ],
  "count": 7
}
```

## PASS — a closed surface is gone from the listing

```
{
  "count": 7
}
```

## PASS — the run never held the operator's frontmost application

```
{
  "samples": 1232,
  "frontmostOurs": 0,
  "distinct": [
    null
  ]
}
```

## PASS — the app log carries events, never terminal content (design 11.6.1)

```
{
  "lines": [
    "18:03:56.175 › [console] restored the exec bit on /Users/damian/local-operator-ui/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "18:03:56.176 › [console] host ready on the existing endpoint: 0 surface(s) (node-pty ready)",
    "18:04:01.631 › [console] surface con:1:2CPPMz… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home at 120x40 (agent)",
    "18:04:06.313 › [console] surface con:1:2CPPMz… resized 100x30",
    "18:04:09.497 › [console] surface con:2:FLAKYX… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home at 80x24 (agent)",
    "18:04:10.261 › [console] surface con:2:FLAKYX… exited 0",
    "18:04:11.558 › [console] surface con:3:r8p2oH… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home at 80x24 (agent)",
    "18:04:12.914 › [console] surface con:3:r8p2oH… exited 0",
    "18:04:15.170 › [console] surface con:4:ysju5P… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home at 80x24 (agent)",
    "18:04:20.444 › [console] surface con:4:ysju5P… exited 0",
    "18:04:20.445 › [console] surface con:4:ysju5P… closed with exit 0",
    "18:05:16.582 › [console] surface con:1:2CPPMz… resized 80x46"
  ]
}
```

## PASS — a surface closed while running is restored as ENDED after a relaunch (design 7.3)

```
{
  "restored": {
    "surface": "con:5:HPrmfYrneP4qlCcM3WaRWw",
    "session_id": "3aedd02be7f7",
    "origin": "user",
    "command": "zsh",
    "argv_tail": "",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-54826/home",
    "cols": 80,
    "rows": 46,
    "running": false,
    "exit_code": 1,
    "last_activity": 1790960876.455,
    "live": false,
    "agent_owned": false,
    "last_actor": null
  },
  "count": 4,
  "surfaces": [
    "con:14:QEujGNfhxQbgHDSANxHGhA",
    "con:13:GM4UG1wTLewqQwZkZNec3Q",
    "con:11:mx6JSBNvICZDG5OzqMgMgg",
    "con:5:HPrmfYrneP4qlCcM3WaRWw"
  ]
}
```

## PASS — the dismissed ended surface does NOT come back (#754's restart repro)

```
{
  "dismissed": "con:6:DAaPGBfkuHr0HMwro4CQLQ",
  "present": false
}
```

## PASS — the relaunch restored every retained surface, in the app's own words, and none is running

```
{
  "count": 4,
  "lines": [
    "18:14:58.794 › [console] restored 4 retained surface(s) from history; none of them is running",
    "[2026-10-02 18:03:56.175] [info]  [console] restored the exec bit on /Users/damian/local-operator-ui/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "[2026-10-02 18:14:58.794] [info]  [console] restored 4 retained surface(s) from history; none of them is running"
  ]
}
```

## PASS — the restored ended surface is a row in the strip after the relaunch, offering its Dismiss

```
{
  "reopened": {
    "pane": {
      "x": 740,
      "y": 32,
      "width": 640,
      "height": 868
    },
    "mirror": {
      "x": 748,
      "y": 139.3984375,
      "width": 624,
      "height": 760.6015625
    }
  },
  "restoredRow": {
    "surface": "con:5:HPrmfYrneP4qlCcM3WaRWw",
    "label": "Dismiss zsh",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  }
}
```

## frame close-relaunch.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-relaunch.png",
  "bytes": 392507,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "703939fea7e8a34550ce8626a93425f2dbd9c682ccd99f333b9e3bb997511caf"
}
```