# Console host end-to-end proof

Scratch: `/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705`
Result: 1 of 81 check(s) FAILED
Reaped stray spawn-helper processes: 0

> **NOTE, added 2026-10-11 by the #929/#952 evidence-completion pass.** This
> transcript is the run at head `cb3e03c795e`, replacing the September run this set
> carried (that generation is in git history). It settles the pending the #929
> thread carried: the two rig cells that change edited — the ended surface's
> dismissal (cell 5) and the question withdrawing under an exit (cell 6) — PASS
> live, `exit 3` and all. The two cells the #754 thread once recorded as red on
> this host (`a large record is captured five times`, `a 8 MiB flood with
> retention ON`) came back GREEN here. **ONE CELL FAILS, and it is not this
> change's:** `the restored ended surface is a row in the strip after the
> relaunch` — since #894 (the bound conversation's right-slot memory) a launch
> RESTORES an open console pane, so the rig's reopen presses the trigger's
> toggle and CLOSES it; the pane poll then times out. The cell predates #894 and
> a rig fix is owed (press only when the pane is not already mounted). Raw
> counts: 81 checks asked, 80 passed, 1 failed — the `Result:` line above is the
> run's own.


## PASS — --pair supplied a daemon and a conversation for the pane cells

```
{
  "port": 7741,
  "session": "dabb511d26b4",
  "record": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/config/run/serve/99719.json"
}
```

## PASS — the discovery record carries the console capability

```
{
  "console": true,
  "console_surfaces": 0,
  "console_agent_surfaces": 0,
  "pid": 99903,
  "proto": 1
}
```

## PASS — /health reports the console capability

```
{
  "host": "ui",
  "proto": 1,
  "pid": 99903,
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
  "surface": "con:1:qJfB7odI4QRpURHhaz2cfw",
  "cols": 120,
  "rows": 40,
  "pid": 142,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — a surface is born at the grid it was asked for, in the user's home

```
{
  "surface": "con:1:qJfB7odI4QRpURHhaz2cfw",
  "cols": 120,
  "rows": 40,
  "pid": 142,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — the handle names its host

```
con:1:qJfB7odI4QRpURHhaz2cfw
```

## PASS — the runtime restored the helper's exec bit (trap 1)

```
{
  "helper": "/Users/damian/local-operator-ui/.worktrees/evidence-951-952/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
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
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/input-roundtrip.bin"
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
  "x": 1358,
  "y": 88,
  "box": {
    "x": 1342,
    "y": 72,
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
    "tag_": "browser-pane-trigger",
    "closest": false
  },
  "triggerAt": {
    "x": 1358,
    "y": 88,
    "box": {
      "x": 1342,
      "y": 72,
      "width": 32,
      "height": 32
    }
  }
}
```

## how the pane was opened

```
{
  "pressTook": false
}
```

## PASS — the pane is mounted on a conversation and its terminal is on screen (Q-5)

```
{
  "pane": {
    "x": 740,
    "y": 32,
    "width": 596,
    "height": 868
  },
  "mirror": {
    "x": 748,
    "y": 109,
    "width": 580,
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
  "cols": 74,
  "rows": 46,
  "theme": "localOperatorDark",
  "live": true,
  "bytes": 44468,
  "frame": {
    "width": 1160,
    "height": 1582
  },
  "pane": {
    "x": 740,
    "y": 32,
    "width": 596,
    "height": 868
  },
  "mirror": {
    "x": 748,
    "y": 109,
    "width": 580,
    "height": 791
  },
  "dpr": 2,
  "sha256": "40b045b27a42e9d8e3e5bf3ca08e12aaab175e9c292c31286c2860b110bd0f5d",
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/console-con_1_qJfB7odI4QRpURHhaz2cfw.png"
}
```

## PASS — a screenshot is the app's own window, cropped to the PANE's rect (design 13.2, Q-5)

```
{
  "rendered": "displayed",
  "cols": 74,
  "rows": 46,
  "frame": {
    "width": 1160,
    "height": 1582
  },
  "mirror": {
    "x": 748,
    "y": 109,
    "width": 580,
    "height": 791
  },
  "dpr": 2,
  "bytes": 44468
}
```

## PASS — pressing a tab selects it (#754 leaves select-on-click alone)

```
{
  "runningSurface": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
  "selected": "con:5:gKRai-5gg0KZD_dHLbYGHQ"
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
  "runningSurface": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
  "reading": [
    {
      "surface": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
      "label": "Close zsh, tab 1 of 4",
      "opacity": "1",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:1:qJfB7odI4QRpURHhaz2cfw",
      "label": "Close sh, tab 2 of 4",
      "opacity": "0",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:3:BuEpYbs4sVK7bWv0Oz0kqw",
      "label": "Dismiss sh, tab 3 of 4",
      "opacity": "0",
      "width": 28,
      "height": 28,
      "tag": "button",
      "tabIndex": 0
    },
    {
      "surface": "con:2:UhnSz6eryYBCkkpx4u8vTQ",
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
  "surface": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
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
    "surface": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
    "label": "Close zsh, tab 1 of 4",
    "opacity": "1",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:1:qJfB7odI4QRpURHhaz2cfw",
    "label": "Close sh, tab 2 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:3:BuEpYbs4sVK7bWv0Oz0kqw",
    "label": "Dismiss sh, tab 3 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:2:UhnSz6eryYBCkkpx4u8vTQ",
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
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/close-affordance.png",
  "bytes": 373380,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "ce7840b76904271eb361912713547b1aeae1e93f0038bcf65efa4c924453f819"
}
```

## PASS — an inactive row's hidden control reveals under the pointer (or the window does not receive pointer moves - the press path's own measured limit)

```
{
  "surface": "con:1:qJfB7odI4QRpURHhaz2cfw",
  "hover": {
    "hovered": true,
    "opacity": "1"
  }
}
```

## frame close-hover-reveal.png

```
{
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/close-hover-reveal.png",
  "bytes": 374461,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "7d5587c47bab189dfac3f26686210568c45448fbb409d02947254ee442b2bb11"
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
    "right": 1336
  },
  "fits": true
}
```

## frame close-focus-ring.png

```
{
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/close-focus-ring.png",
  "bytes": 380865,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "9b5a1a7dee5163136e44df220e8abb18e5fc5c90b340d739d940284e7d04c0a0"
}
```

## PASS — the pointer is parked off the strip and EVERY inactive control waits again (#754's frames after this one hold a strip nobody points at)

```
[
  {
    "surface": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
    "label": "Close zsh, tab 1 of 4",
    "opacity": "1",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:1:qJfB7odI4QRpURHhaz2cfw",
    "label": "Close sh, tab 2 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:3:BuEpYbs4sVK7bWv0Oz0kqw",
    "label": "Dismiss sh, tab 3 of 4",
    "opacity": "0",
    "width": 28,
    "height": 28,
    "tag": "button",
    "tabIndex": 0
  },
  {
    "surface": "con:2:UhnSz6eryYBCkkpx4u8vTQ",
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
  "selected": "con:1:qJfB7odI4QRpURHhaz2cfw"
}
```

## frame close-question.png

```
{
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/close-question.png",
  "bytes": 374166,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "f541784c5b09acf3f762e772f912321cd322c4b384c980c3f6a487508a77a44a"
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
  "historyLog": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/config/run/ui-console/history/dabb511d26b4/con_5_gKRai-5gg0KZD_dHLbYGHQ.log"
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
      "message": "no console surface named con:5:gKRai-…; 3 exist",
      "data": {
        "surface": "con:5:gKRai-…",
        "count": 3
      }
    }
  },
  "elapsedMs": 88
}
```

## PASS — the closed surface's selection moves to a neighbour, never a dead lens (#754)

```
{
  "closed": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
  "selectedAfterClose": "con:1:qJfB7odI4QRpURHhaz2cfw"
}
```

## PASS — after the close the keyboard is in the lens's row, not on the document body (UX round 1, U1)

```
{
  "selectedAfterClose": "con:1:qJfB7odI4QRpURHhaz2cfw",
  "handedOff": "con:1:qJfB7odI4QRpURHhaz2cfw"
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
    "right": 1336
  },
  "fits": true
}
```

## frame close-closed.png

```
{
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/close-closed.png",
  "bytes": 399778,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "6d94ff9f86d964c712de59e42e0e0994642a555cf3a49318a1b0969c2843a471"
}
```

## PASS — a close keeps a retained surface's history (the dismissal below is what removes it)

```
{
  "historyLog": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/config/run/ui-console/history/dabb511d26b4/con_5_gKRai-5gg0KZD_dHLbYGHQ.log"
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
    "exit_code": 3,
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
      "y": 2
    },
    "last_activity": 1791706717.845,
    "retain": true,
    "secure": false,
    "env_marker": {
      "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
      "value": "con:6:tJ_LIv4qAI2uF-isNogG2w"
    }
  }
}
```

## PASS — the ended surface's retained history is on disk before the dismissal

```
{
  "dismissedLog": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/config/run/ui-console/history/dabb511d26b4/con_6_tJ_LIv4qAI2uF-isNogG2w.log"
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
  "dismissedLog": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/config/run/ui-console/history/dabb511d26b4/con_6_tJ_LIv4qAI2uF-isNogG2w.log"
}
```

## PASS — the dismissed surface's selection moves to a neighbour too (#754)

```
{
  "dismissed": "con:6:tJ_LIv4qAI2uF-isNogG2w",
  "selectedAfterDismiss": "con:1:qJfB7odI4QRpURHhaz2cfw"
}
```

## PASS — after the dismissal the keyboard is handed on too, not dropped (UX round 1, U1)

```
{
  "selectedAfterDismiss": "con:1:qJfB7odI4QRpURHhaz2cfw",
  "handedOffAfterDismiss": "con:1:qJfB7odI4QRpURHhaz2cfw"
}
```

## frame close-dismissed.png

```
{
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/close-dismissed.png",
  "bytes": 399825,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "5fc675a525adde1604ace83356e16d5232589e5eae8431f4e072e87213ea5b38"
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
    "surface": "con:7:ePxy0cjEK-RBSdiAjVvLgw",
    "session_id": "dabb511d26b4",
    "origin": "user",
    "command": "zsh",
    "argv_tail": "",
    "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
    "cols": 74,
    "rows": 44,
    "running": false,
    "exit_code": 3,
    "last_activity": 1791706718.84,
    "live": true,
    "agent_owned": false,
    "last_actor": "agent"
  }
}
```

## PASS — the withdrawn question returns the keyboard to the row it came from (UX round 1, U1's own restore case)

```
{
  "exitUnderQuestion": "con:7:ePxy0cjEK-RBSdiAjVvLgw",
  "focusedAfterWithdraw": "con:7:ePxy0cjEK-RBSdiAjVvLgw"
}
```

## offscreen capture

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 74,
  "rows": 46,
  "bytes": 43339,
  "sha256": "eede9b3b7e2c258641a315411c1f8c837d92f3682e87a7f3bd166a8cadafda99",
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/console-con_1_qJfB7odI4QRpURHhaz2cfw-offscreen.png"
}
```

## PASS — a capture with no displayed pane is a DOM-rendered reconstruction from the record

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 74,
  "rows": 46,
  "displayedGrid": {
    "cols": 74,
    "rows": 46
  },
  "bytes": 43339
}
```

## four captures across three surfaces (Q-11)

```
{
  "alpha1": {
    "sha": "2c9e609961de95a4ade9b7cd763781a530cdda5a6515cc71c141ae3b6a164537",
    "bytes": 11961,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "b4d140909f228480f46477aa2a1632c688f92893f6eb72df0e2a0fb45b06d503",
    "bytes": 11772,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "2c9e609961de95a4ade9b7cd763781a530cdda5a6515cc71c141ae3b6a164537",
    "bytes": 11961,
    "rendered": "offscreen",
    "attempts": 1
  },
  "empty": {
    "sha": "bc265d7d60d716d1938a6d31fb03c267dd71856ada98143c414b39014566824a",
    "bytes": 6393,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — two surfaces with different records give different frames (Q-11)

```
{
  "alpha1": {
    "sha": "2c9e609961de95a4ade9b7cd763781a530cdda5a6515cc71c141ae3b6a164537",
    "bytes": 11961,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "b4d140909f228480f46477aa2a1632c688f92893f6eb72df0e2a0fb45b06d503",
    "bytes": 11772,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — the SAME record captured twice gives the SAME frame (Q-11)

```
{
  "alpha1": {
    "sha": "2c9e609961de95a4ade9b7cd763781a530cdda5a6515cc71c141ae3b6a164537",
    "bytes": 11961,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "2c9e609961de95a4ade9b7cd763781a530cdda5a6515cc71c141ae3b6a164537",
    "bytes": 11961,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — an empty record is its own frame, not another surface's (Q-11)

```
{
  "empty": {
    "sha": "bc265d7d60d716d1938a6d31fb03c267dd71856ada98143c414b39014566824a",
    "bytes": 6393,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alphaBytes": 11961,
  "betaBytes": 11772
}
```

## five captures of one large record (Q-13)

```
[
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  }
]
```

## PASS — a large record is captured five times, none refused, all five the same frame (Q-13)

```
[
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "ca762e47ed6ef3bc11f5717d30f98b11fa24d52332d23b869a3e8cebe84c9609",
    "bytes": 71145,
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
    "surface": "con:1:qJfB7odI4QRpURHhaz2cfw",
    "session_id": "dabb511d26b4",
    "origin": "agent",
    "command": "sh",
    "argv_tail": "-f -i",
    "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
    "cols": 110,
    "rows": 33,
    "running": true,
    "exit_code": null,
    "last_activity": 1791706726.407,
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
    "message": "con:1:qJfB7o… is in secure input; reads and captures are refused until it is turned off",
    "data": {
      "secure": true
    }
  },
  "screenshot": {
    "code": "secure_input_active",
    "message": "con:1:qJfB7o… is in secure input; reads and captures are refused until it is turned off",
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
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/config/run/ui-console/history/dabb511d26b4/con_12_ac2pWhLNyimLhWaCurE3lA.log"
}
```

## PASS — an unknown handle names the handle and how many exist

```
{
  "code": "surface_unavailable",
  "message": "no console surface named con:99:nope…; 2 exist",
  "data": {
    "surface": "con:99:nope…",
    "count": 2
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
  "last_activity": 1791706727.3,
  "retain": false,
  "secure": false,
  "env_marker": {
    "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
    "value": "con:13:1zSg_6BMHdrPfSyApy0hSQ"
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
  "message": "con:13:1zSg_6… has exited with code 5; its output is still readable",
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
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/config/run/ui-console/history/dabb511d26b4/con_14_qjrU7PZGRRSVc74ziImvrQ.log",
  "mode": 384
}
```

## PASS — the retained history is 0600

```
{
  "mode": "600"
}
```

## PASS — a 8 MiB flood with retention ON leaves main answering (§19.1 P3)

```
{
  "baselineMs": {
    "max": 282,
    "median": 4
  },
  "floodMs": {
    "answered": 57,
    "median": 4,
    "p95": 13,
    "max": 138
  },
  "ceilings": {
    "median": 100,
    "p95": 500
  },
  "truncated": false,
  "exit_epoch": 1,
  "bytes": 8388608,
  "producerExitCode": 0,
  "subscriberAttached": "con:15:pRbxxSCDJRE7WCD7MWCcxQ",
  "replayBytesAtSubscribe": 0,
  "surface": "con:15:pRbxxSCDJRE7WCD7MWCcxQ"
}
```

## PASS — the flood never grew the app tree past its RSS ceiling

```
{
  "rssBeforeBytes": 695926784,
  "rssPeakBytes": 820281344,
  "ceilingBytes": 268435456,
  "growthBytes": 124354560
}
```

## PASS — the ninth agent surface in one session is refused, with the browser's own code

```
{
  "heldBefore": 2,
  "created": 6,
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
      "surface": "con:7:ePxy0cjEK-RBSdiAjVvLgw",
      "session_id": "dabb511d26b4",
      "origin": "user",
      "command": "zsh",
      "argv_tail": "",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 74,
      "rows": 44,
      "running": false,
      "exit_code": 3,
      "last_activity": 1791706718.84,
      "live": true,
      "agent_owned": false,
      "last_actor": "agent"
    },
    {
      "surface": "con:13:1zSg_6BMHdrPfSyApy0hSQ",
      "session_id": "dabb511d26b4",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf 'exited-marker\\n'; exit 5",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 5,
      "last_activity": 1791706727.3,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:16:IM7w6ZJ_-aYqCl5SxygpzA",
      "session_id": "dabb511d26b4",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1791706756.262,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:17:6KFtTMrxntvS2W02USJobw",
      "session_id": "dabb511d26b4",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1791706756.269,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:18:1ToYripM4dqzPVFRwXXjKQ",
      "session_id": "dabb511d26b4",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1791706756.277,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:19:MPTAQVNnHmUVi1vXPj0Nzg",
      "session_id": "dabb511d26b4",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1791706756.285,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:20:443DuYxnGKvzVvRr8OAe_w",
      "session_id": "dabb511d26b4",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1791706756.292,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:21:hcwvPt_n0HcWaEwF1CcTjQ",
      "session_id": "dabb511d26b4",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1791706756.3,
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
  "samples": 686,
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
    "04:13:28.594 › [console] restored the exec bit on /Users/damian/local-operator-ui/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "04:13:28.594 › [console] host ready on the existing endpoint: 0 surface(s) (node-pty ready)",
    "04:13:28.781 › [console] surface con:1:qJfB7o… started: sh in /Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home at 120x40 (agent)",
    "04:13:29.476 › [console] surface con:1:qJfB7o… resized 100x30",
    "04:13:29.736 › [console] surface con:2:UhnSz6… started: sh in /Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home at 80x24 (agent)",
    "04:13:29.759 › [console] surface con:2:UhnSz6… exited 0",
    "04:13:29.960 › [console] surface con:3:BuEpYb… started: sh in /Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home at 80x24 (agent)",
    "04:13:30.332 › [console] surface con:3:BuEpYb… exited 0",
    "04:13:30.421 › [console] surface con:4:RIRojT… started: sh in /Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home at 80x24 (agent)",
    "04:13:32.057 › [console] surface con:4:RIRojT… exited 0",
    "04:13:32.058 › [console] surface con:4:RIRojT… closed with exit 0",
    "04:18:33.673 › [console] surface con:1:qJfB7o… resized 74x46"
  ]
}
```

## PASS — a surface closed while running is restored as ENDED after a relaunch (design 7.3)

```
{
  "restored": {
    "surface": "con:5:gKRai-5gg0KZD_dHLbYGHQ",
    "session_id": "dabb511d26b4",
    "origin": "user",
    "command": "zsh",
    "argv_tail": "",
    "cwd": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/tmp/lo-console-proof-99705/home",
    "cols": 74,
    "rows": 46,
    "running": false,
    "exit_code": 1,
    "last_activity": 1791706717.537,
    "live": false,
    "agent_owned": false,
    "last_actor": null
  },
  "count": 5,
  "surfaces": [
    "con:15:pRbxxSCDJRE7WCD7MWCcxQ",
    "con:14:qjrU7PZGRRSVc74ziImvrQ",
    "con:12:ac2pWhLNyimLhWaCurE3lA",
    "con:7:ePxy0cjEK-RBSdiAjVvLgw",
    "con:5:gKRai-5gg0KZD_dHLbYGHQ"
  ]
}
```

## PASS — the dismissed ended surface does NOT come back (#754's restart repro)

```
{
  "dismissed": "con:6:tJ_LIv4qAI2uF-isNogG2w",
  "present": false
}
```

## PASS — the relaunch restored every retained surface, in the app's own words, and none is running

```
{
  "count": 5,
  "lines": [
    "04:19:18.581 › [console] restored 5 retained surface(s) from history; none of them is running",
    "[2026-10-11 04:13:28.594] [info]  [console] restored the exec bit on /Users/damian/local-operator-ui/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "[2026-10-11 04:19:18.581] [info]  [console] restored 5 retained surface(s) from history; none of them is running"
  ]
}
```

## FAIL — the restored ended surface is a row in the strip after the relaunch, offering its Dismiss

```
{
  "reopened": {
    "failed": true,
    "hash": "#/chat",
    "app": 3,
    "trigger": true,
    "pane": false,
    "mirror": false,
    "slot": false,
    "viaDomClick": null,
    "openedByPress": null,
    "tourTags": [
      "nav-item-chat",
      "nav-item-aida",
      "nav-item-agents",
      "nav-item-projects",
      "nav-item-schedules",
      "nav-item-browser",
      "nav-item-agent-hub",
      "chat-session-row",
      "chat-session-row",
      "nav-item-settings",
      "pane-row",
      "chat-column",
      "chat-header",
      "chat-input-textarea",
      "chat-input-attach-file-button",
      "ask-pane-trigger",
      "browser-pane-trigger",
      "console-pane-trigger",
      "console-pane-blip",
      "open-canvas-button",
      "code-pane-trigger"
    ],
    "stored": "{\"state\":{\"activeSessionId\":\"dabb511d26b4\",\"activeDraftKey\":null,\"cwd\":\"~\",\"forgotten\":{},\"drafts\":{}},\"version\":0}",
    "main": "console close\nNo agent\nNo team\n​\nOn this device\nStart of conversation\n\n[row 0000] written conversation ever this ever scrolls back stays while reader holds left at\n\n[row 0001] where scrolls scrolls ex"
  },
  "restoredRow": null
}
```

## frame close-relaunch.png

```
{
  "file": "/Users/damian/.local-operator/sessions/636c9a7e16e7/scratchpad/proof-out/close-relaunch.png",
  "bytes": 388830,
  "size": {
    "width": 2760,
    "height": 1800
  },
  "viewport": {
    "width": 1380,
    "height": 900,
    "dpr": 2
  },
  "sha256": "70537861bead6b69d98584a69754226de3cf7195c9da45354b6f7b06442217c9"
}
```

## PASS — every restored surface was dismissible from the strip (the loop's own exit condition)

```
{
  "remaining": []
}
```