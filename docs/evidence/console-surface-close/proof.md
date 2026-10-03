# Console host end-to-end proof

Scratch: `/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975`
Result: 2 of 82 check(s) FAILED
Reaped stray spawn-helper processes: 0


## PASS — --pair supplied a daemon and a conversation for the pane cells

```
{
  "port": 47391,
  "session": "4023d218fcdc",
  "record": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/config/run/serve/96063.json"
}
```

## PASS — the discovery record carries the console capability

```
{
  "console": true,
  "console_surfaces": 0,
  "console_agent_surfaces": 0,
  "pid": 96129,
  "proto": 1
}
```

## PASS — /health reports the console capability

```
{
  "host": "ui",
  "proto": 1,
  "pid": 96129,
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
  "surface": "con:1:xAsGtK_bUgtU5QV3grWr_g",
  "cols": 120,
  "rows": 40,
  "pid": 96707,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — a surface is born at the grid it was asked for, in the user's home

```
{
  "surface": "con:1:xAsGtK_bUgtU5QV3grWr_g",
  "cols": 120,
  "rows": 40,
  "pid": 96707,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — the handle names its host

```
con:1:xAsGtK_bUgtU5QV3grWr_g
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
  "bytes": 47651,
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
  "sha256": "69e0e4ac07083927d384da872510f7029acdef1d1a4851f30788962f8083abc8",
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/console-con_1_xAsGtK_bUgtU5QV3grWr_g.png"
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
  "bytes": 47651
}
```

## PASS — pressing a tab selects it (#754 leaves select-on-click alone)

```
{
  "runningSurface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
  "selected": "con:5:73aBC75jvsKCm5cg6A7hPQ"
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
  "runningSurface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
  "reading": [
    {
      "surface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
      "label": "Close zsh, tab 1 of 4",
      "opacity": "1",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:1:xAsGtK_bUgtU5QV3grWr_g",
      "label": "Close sh, tab 2 of 4",
      "opacity": "0",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:3:W9Lig1pa77Obl7edpCy2xg",
      "label": "Dismiss sh, tab 3 of 4",
      "opacity": "0",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:2:FaWGvRYlur06d1vMjwQD3w",
      "label": "Dismiss sh, tab 4 of 4",
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
  "surface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
  "label": "Close zsh, tab 1 of 4",
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
    "surface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
    "label": "Close zsh, tab 1 of 4",
    "opacity": "1",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:1:xAsGtK_bUgtU5QV3grWr_g",
    "label": "Close sh, tab 2 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:3:W9Lig1pa77Obl7edpCy2xg",
    "label": "Dismiss sh, tab 3 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:2:FaWGvRYlur06d1vMjwQD3w",
    "label": "Dismiss sh, tab 4 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  }
]
```

## PASS — the close controls' accessible names are unique across the strip, each with its tab position (#754, UX round 1 U4)

```
{
  "labels": [
    "Close zsh, tab 1 of 4",
    "Close sh, tab 2 of 4",
    "Dismiss sh, tab 3 of 4",
    "Dismiss sh, tab 4 of 4"
  ]
}
```

## frame close-affordance.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-affordance.png",
  "bytes": 367603,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "43a1d9d45f83592416f1bb8b70026e881c6ba3e8682c75346120505261ee5d73"
}
```

## PASS — an inactive row's hidden control reveals under the pointer (or the window does not receive pointer moves - the press path's own measured limit)

```
{
  "surface": "con:1:xAsGtK_bUgtU5QV3grWr_g",
  "hover": {
    "hovered": true,
    "opacity": "1"
  }
}
```

## frame close-hover-reveal.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-hover-reveal.png",
  "bytes": 369099,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "00cdce058a1bc53f0eee7a97278f8a01374d0ac4cb5f1b4c6787186f9600cf6a"
}
```

## PASS — focus reveals the hidden control with the ring drawn, and the ring fits inside the strip's clip (#754, design round 1 D2's focus state)

```
{
  "focused": true,
  "focusVisible": true,
  "opacity": "1",
  "outline": "solid 2px offset 1px",
  "ring": {
    "top": 73,
    "bottom": 107,
    "left": 858.15625,
    "right": 892.15625
  },
  "clip": {
    "top": 72,
    "bottom": 109,
    "left": 740,
    "right": 1380
  },
  "fits": true
}
```

## frame close-focus-ring.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-focus-ring.png",
  "bytes": 375563,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "1c97117c98d2da8eb78555d991f2eca8b3ac07b3af3fcba8cabc5e68e897bfd7"
}
```

## PASS — the pointer is parked off the strip and EVERY inactive control waits again (#754's frames after this one hold a strip nobody points at)

```
[
  {
    "surface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
    "label": "Close zsh, tab 1 of 4",
    "opacity": "1",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:1:xAsGtK_bUgtU5QV3grWr_g",
    "label": "Close sh, tab 2 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:3:W9Lig1pa77Obl7edpCy2xg",
    "label": "Dismiss sh, tab 3 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:2:FaWGvRYlur06d1vMjwQD3w",
    "label": "Dismiss sh, tab 4 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  }
]
```

## PASS — a running surface's close asks first, in the shared dialog's own copy (#754)

```
{
  "text": "Close this terminal?This ends the program running here and removes its tab.Its output is kept.CancelClose terminal",
  "cancel": true,
  "confirm": true
}
```

## PASS — the question signals nothing: the surface still runs, and the other row stays selected

```
{
  "running": true,
  "live": true,
  "selected": "con:1:xAsGtK_bUgtU5QV3grWr_g"
}
```

## frame close-question.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-question.png",
  "bytes": 372493,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "96146c18652921dfdea834d3a381b7a25fe7515cf81381261e3d04d0e4f513cd"
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
  "historyLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/config/run/ui-console/history/4023d218fcdc/con_5_73aBC75jvsKCm5cg6A7hPQ.log"
}
```

## PASS — the question opens again after a cancel (the press is repeatable)

```
{
  "text": "Close this terminal?This ends the program running here and removes its tab.Its output is kept.CancelClose terminal",
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
      "message": "no console surface named con:5:73aBC7…; 3 exist",
      "data": {
        "surface": "con:5:73aBC7…",
        "count": 3
      }
    }
  },
  "elapsedMs": 14318
}
```

## PASS — the closed surface's selection moves to a neighbour, never a dead lens (#754)

```
{
  "closed": "con:5:73aBC75jvsKCm5cg6A7hPQ",
  "selectedAfterClose": "con:1:xAsGtK_bUgtU5QV3grWr_g"
}
```

## PASS — after the close the keyboard is in the lens's row, not on the document body (UX round 1, U1)

```
{
  "selectedAfterClose": "con:1:xAsGtK_bUgtU5QV3grWr_g",
  "handedOff": "con:1:xAsGtK_bUgtU5QV3grWr_g"
}
```

## PASS — the keyboard's landing is armed and visible: the successor tab holds focus, `:focus-visible`, and its ring fits the strip's clip (design round 2, D6)

```
{
  "isTab": true,
  "focusVisible": true,
  "outline": "solid 2px offset 2px",
  "reach": 4,
  "ring": {
    "top": 72,
    "bottom": 108,
    "left": 744,
    "right": 799.34375
  },
  "clip": {
    "top": 72,
    "bottom": 109,
    "left": 740,
    "right": 1380
  },
  "fits": true
}
```

## frame close-closed.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-closed.png",
  "bytes": 398042,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "1ce0f0c9b0b9c5dd506b40cd093a3a1865734c4512fec6254e7208e28cea9cda"
}
```

## PASS — a close keeps a retained surface's history (the dismissal below is what removes it)

```
{
  "historyLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/config/run/ui-console/history/4023d218fcdc/con_5_73aBC75jvsKCm5cg6A7hPQ.log"
}
```

## PASS — the question is gone once it has been answered

```
null
```

## PASS — an ended row's control names the DISMISSAL, not the kill (#754's two states)

```
{
  "dismissLabel": "Dismiss zsh, tab 1 of 4",
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
    "last_activity": 1790987465.846,
    "retain": true,
    "secure": false,
    "env_marker": {
      "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
      "value": "con:6:7BKn3Ona6_ON0CGExZ3LqA"
    }
  }
}
```

## PASS — the ended surface's retained history is on disk before the dismissal

```
{
  "dismissedLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/config/run/ui-console/history/4023d218fcdc/con_6_7BKn3Ona6_ON0CGExZ3LqA.log"
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
  "dismissedLog": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/config/run/ui-console/history/4023d218fcdc/con_6_7BKn3Ona6_ON0CGExZ3LqA.log"
}
```

## PASS — the dismissed surface's selection moves to a neighbour too (#754)

```
{
  "dismissed": "con:6:7BKn3Ona6_ON0CGExZ3LqA",
  "selectedAfterDismiss": "con:1:xAsGtK_bUgtU5QV3grWr_g"
}
```

## PASS — after the dismissal the keyboard is handed on too, not dropped (UX round 1, U1)

```
{
  "selectedAfterDismiss": "con:1:xAsGtK_bUgtU5QV3grWr_g",
  "handedOffAfterDismiss": "con:1:xAsGtK_bUgtU5QV3grWr_g"
}
```

## frame close-dismissed.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-dismissed.png",
  "bytes": 398165,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "1d0bb4dcb6a55b9d5093814a144a3e274bc9a98be9311848190879c6c30994a4"
}
```

## PASS — the question withdraws when the surface exits under it - and the row is dismissed by nobody (still listed, ended) (#754, UX round 1 U2)

```
{
  "standingQuestion": {
    "text": "Close this terminal?This ends the program running here and removes its tab.Its output is kept.CancelClose terminal",
    "cancel": true,
    "confirm": true
  },
  "withdrew": true,
  "exitRow": {
    "surface": "con:7:0Ra4i_iaCCtUkxkK_LQaMA",
    "session_id": "4023d218fcdc",
    "origin": "user",
    "command": "zsh",
    "argv_tail": "",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
    "cols": 80,
    "rows": 44,
    "running": false,
    "exit_code": 0,
    "last_activity": 1790987558.363,
    "live": true,
    "agent_owned": false,
    "last_actor": "agent"
  }
}
```

## PASS — the withdrawn question returns the keyboard to the row it came from (UX round 1, U1's own restore case)

```
{
  "exitUnderQuestion": "con:7:0Ra4i_iaCCtUkxkK_LQaMA",
  "focusedAfterWithdraw": "con:7:0Ra4i_iaCCtUkxkK_LQaMA"
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
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/console-con_1_xAsGtK_bUgtU5QV3grWr_g-offscreen.png"
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
    "sha": "80f49d6ac1f79f636d7b8a268c93e027c7e6b4149a30453aa1f0f14b6e5679f3",
    "bytes": 12738,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "c023765882fec1c69783451eb79ce0524ae9b899463aa58903044ff370cd1249",
    "bytes": 11889,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "80f49d6ac1f79f636d7b8a268c93e027c7e6b4149a30453aa1f0f14b6e5679f3",
    "bytes": 12738,
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
    "sha": "80f49d6ac1f79f636d7b8a268c93e027c7e6b4149a30453aa1f0f14b6e5679f3",
    "bytes": 12738,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "c023765882fec1c69783451eb79ce0524ae9b899463aa58903044ff370cd1249",
    "bytes": 11889,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — the SAME record captured twice gives the SAME frame (Q-11)

```
{
  "alpha1": {
    "sha": "80f49d6ac1f79f636d7b8a268c93e027c7e6b4149a30453aa1f0f14b6e5679f3",
    "bytes": 12738,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "80f49d6ac1f79f636d7b8a268c93e027c7e6b4149a30453aa1f0f14b6e5679f3",
    "bytes": 12738,
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
  "alphaBytes": 12738,
  "betaBytes": 11889
}
```

## five captures of one large record (Q-13)

```
[
  {
    "sha": "adb8f88cb4859e9a39699884afa4648977a9360508fb83b035dd446864010119",
    "bytes": 81760,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "f310a86906d1a19810b9906fff3284da63d0e60366cfae4c1829e7f0a35f8988",
    "bytes": 81751,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "a1a57f94a12ff4d941a61c3d245c68f004658c5c81f1ae975cec19460ff08573",
    "bytes": 81668,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "9145348b0922bb0ce80a6d02a4b846dabbe5bc848acc3bae7c9a672045153d3d",
    "bytes": 81574,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "be29ffc36f8e211d71ae087bb4f9b92de7c1c0fbf5dcb912699ea22f584d64d7",
    "bytes": 81563,
    "rendered": "offscreen",
    "attempts": 1
  }
]
```

## FAIL — a large record is captured five times, none refused, all five the same frame (Q-13)

```
[
  {
    "sha": "adb8f88cb4859e9a39699884afa4648977a9360508fb83b035dd446864010119",
    "bytes": 81760,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "f310a86906d1a19810b9906fff3284da63d0e60366cfae4c1829e7f0a35f8988",
    "bytes": 81751,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "a1a57f94a12ff4d941a61c3d245c68f004658c5c81f1ae975cec19460ff08573",
    "bytes": 81668,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "9145348b0922bb0ce80a6d02a4b846dabbe5bc848acc3bae7c9a672045153d3d",
    "bytes": 81574,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "be29ffc36f8e211d71ae087bb4f9b92de7c1c0fbf5dcb912699ea22f584d64d7",
    "bytes": 81563,
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
    "surface": "con:1:xAsGtK_bUgtU5QV3grWr_g",
    "session_id": "4023d218fcdc",
    "origin": "agent",
    "command": "sh",
    "argv_tail": "-f -i",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
    "cols": 110,
    "rows": 33,
    "running": true,
    "exit_code": null,
    "last_activity": 1790987741.005,
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
    "message": "con:1:xAsGtK… is in secure input; reads and captures are refused until it is turned off",
    "data": {
      "secure": true
    }
  },
  "screenshot": {
    "code": "secure_input_active",
    "message": "con:1:xAsGtK… is in secure input; reads and captures are refused until it is turned off",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/config/run/ui-console/history/4023d218fcdc/con_12_e2MdXzzBZ_a0UxOGratLkg.log"
}
```

## PASS — an unknown handle names the handle and how many exist

```
{
  "code": "surface_unavailable",
  "message": "no console surface named con:99:nope…; 4 exist",
  "data": {
    "surface": "con:99:nope…",
    "count": 4
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
  "last_activity": 1790987766.536,
  "retain": false,
  "secure": false,
  "env_marker": {
    "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
    "value": "con:13:FCKH8XSc-YpdmKtrl_P4eA"
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
  "message": "con:13:FCKH8X… has exited with code 5; its output is still readable",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/config/run/ui-console/history/4023d218fcdc/con_14_kikqztqsZO7bLgR_vaR8IQ.log",
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
    "max": 1070,
    "median": 1052
  },
  "floodMs": {
    "answered": 1,
    "median": 1035,
    "p95": 1035,
    "max": 1035
  },
  "ceilings": {
    "median": 100,
    "p95": 500
  },
  "truncated": false,
  "exit_epoch": 1,
  "bytes": 8388608,
  "producerExitCode": 0,
  "subscriberAttached": "con:15:C73hH5LfyQvVpcSPuy2Xrw",
  "replayBytesAtSubscribe": 2651800,
  "surface": "con:15:C73hH5LfyQvVpcSPuy2Xrw"
}
```

## PASS — the flood never grew the app tree past its RSS ceiling

```
{
  "rssBeforeBytes": 899121152,
  "rssPeakBytes": 899121152,
  "ceilingBytes": 268435456,
  "growthBytes": 0
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
      "surface": "con:2:FaWGvRYlur06d1vMjwQD3w",
      "session_id": "4023d218fcdc",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '日本\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790987081.247,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:3:W9Lig1pa77Obl7edpCy2xg",
      "session_id": "4023d218fcdc",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '\\346\\227'; sleep 0.3; printf '\\245\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790987083.947,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:7:0Ra4i_iaCCtUkxkK_LQaMA",
      "session_id": "4023d218fcdc",
      "origin": "user",
      "command": "zsh",
      "argv_tail": "",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 80,
      "rows": 44,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790987558.363,
      "live": true,
      "agent_owned": false,
      "last_actor": "agent"
    },
    {
      "surface": "con:13:FCKH8XSc-YpdmKtrl_P4eA",
      "session_id": "4023d218fcdc",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf 'exited-marker\\n'; exit 5",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 5,
      "last_activity": 1790987766.536,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:16:BuXK1x4oFllUj-1h_C0DLQ",
      "session_id": "4023d218fcdc",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 100,
      "rows": 30,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790987889.318,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:17:wy_8su--OtMegMrcelje1Q",
      "session_id": "4023d218fcdc",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 100,
      "rows": 30,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790987890.357,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:18:xhpO6qjDHPIJTglr0qSEfg",
      "session_id": "4023d218fcdc",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 100,
      "rows": 30,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790987891.393,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:19:YFxFRw0B8-JaBCMrbWAD8Q",
      "session_id": "4023d218fcdc",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1790987888.394,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    }
  ],
  "count": 8
}
```

## PASS — a closed surface is gone from the listing

```
{
  "count": 8
}
```

## PASS — the run never held the operator's frontmost application

```
{
  "samples": 1542,
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
    "01:24:27.194 › [console] restored the exec bit on /Users/damian/local-operator-ui/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "01:24:27.195 › [console] host ready on the existing endpoint: 0 surface(s) (node-pty ready)",
    "01:24:32.425 › [console] surface con:1:xAsGtK… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home at 120x40 (agent)",
    "01:24:37.211 › [console] surface con:1:xAsGtK… resized 100x30",
    "01:24:40.458 › [console] surface con:2:FaWGvR… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home at 80x24 (agent)",
    "01:24:41.248 › [console] surface con:2:FaWGvR… exited 0",
    "01:24:42.600 › [console] surface con:3:W9Lig1… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home at 80x24 (agent)",
    "01:24:43.947 › [console] surface con:3:W9Lig1… exited 0",
    "01:24:46.315 › [console] surface con:4:zIGocd… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home at 80x24 (agent)",
    "01:24:51.628 › [console] surface con:4:zIGocd… exited 0",
    "01:24:51.629 › [console] surface con:4:zIGocd… closed with exit 0",
    "01:25:45.604 › [console] surface con:1:xAsGtK… resized 80x46"
  ]
}
```

## PASS — a surface closed while running is restored as ENDED after a relaunch (design 7.3)

```
{
  "restored": {
    "surface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
    "session_id": "4023d218fcdc",
    "origin": "user",
    "command": "zsh",
    "argv_tail": "",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-95975/home",
    "cols": 80,
    "rows": 46,
    "running": false,
    "exit_code": 1,
    "last_activity": 1790987404.561,
    "live": false,
    "agent_owned": false,
    "last_actor": null
  },
  "count": 5,
  "surfaces": [
    "con:15:C73hH5LfyQvVpcSPuy2Xrw",
    "con:14:kikqztqsZO7bLgR_vaR8IQ",
    "con:12:e2MdXzzBZ_a0UxOGratLkg",
    "con:7:0Ra4i_iaCCtUkxkK_LQaMA",
    "con:5:73aBC75jvsKCm5cg6A7hPQ"
  ]
}
```

## PASS — the dismissed ended surface does NOT come back (#754's restart repro)

```
{
  "dismissed": "con:6:7BKn3Ona6_ON0CGExZ3LqA",
  "present": false
}
```

## PASS — the relaunch restored every retained surface, in the app's own words, and none is running

```
{
  "count": 5,
  "lines": [
    "01:38:14.595 › [console] restored 5 retained surface(s) from history; none of them is running",
    "[2026-10-03 01:24:27.194] [info]  [console] restored the exec bit on /Users/damian/local-operator-ui/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "[2026-10-03 01:38:14.595] [info]  [console] restored 5 retained surface(s) from history; none of them is running"
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
    "surface": "con:5:73aBC75jvsKCm5cg6A7hPQ",
    "label": "Dismiss zsh, tab 5 of 5",
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
  "bytes": 382389,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "8964ccd025c8bd8826cf09d934af2d1484b295c9bca232366c196b5f11b65f8d"
}
```

## PASS — dismissing the last surface removes the strip, shows the empty state, and the keyboard lands on its own New console (#754, UX round 1 U1's empty arm)

```
{
  "empty": {
    "emptyText": true,
    "strip": false,
    "plus": true
  },
  "focusedEmpty": "console-new-surface"
}
```

## frame close-empty.png

```
{
  "file": "/Users/damian/local-operator-ui/.worktrees/console-close-754/docs/evidence/console-surface-close/close-empty.png",
  "bytes": 384859,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "b2a051c9f2cf5a8fd44e039c65db14f035d297e7924d6214e680cd0024a964ff"
}
```

## PASS — every restored surface was dismissible from the strip (the loop's own exit condition)

```
{
  "remaining": []
}
```