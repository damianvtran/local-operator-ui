# Console host end-to-end proof

Scratch: `/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295`
Result: every check passed
Reaped stray spawn-helper processes: 0

> **NOTE, added 2026-09-21 (memory-bounding round).** This transcript is the run at head
> `5407f5425`. Its flood cell line (`a 30 s `yes` flood…`) is HISTORICAL: that cell sampled for a
> wall-clock 30 s from an unbounded `yes` and did not require the producer to exit, and it has
> since been resized to a fixed 8 MiB stimulus that ends on the producer's exit — which is a
> different cell with a different assertion. The recorded PASS below is not reproducible against
> the current rig, and the run of the resized cell is outstanding: it needs the app launched, so
> it belongs to QA's bounded live run rather than to the round that changed it.


## PASS — the discovery record carries the console capability

```
{
  "console": true,
  "console_surfaces": 0,
  "console_agent_surfaces": 0,
  "pid": 66298,
  "proto": 1
}
```

## PASS — /health reports the console capability

```
{
  "host": "ui",
  "proto": 1,
  "pid": 66298,
  "console": true,
  "capabilities": [
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
  "surface": "con:1:Cnm6tUc0UecSKZmQwDEh_Q",
  "cols": 120,
  "rows": 40,
  "pid": 66423,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — a surface is born at the grid it was asked for, in the user's home

```
{
  "surface": "con:1:Cnm6tUc0UecSKZmQwDEh_Q",
  "cols": 120,
  "rows": 40,
  "pid": 66423,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — the handle names its host

```
con:1:Cnm6tUc0UecSKZmQwDEh_Q
```

## PASS — the runtime restored the helper's exec bit (trap 1)

```
{
  "helper": "/Users/damian/local-operator-ui-worktrees/console-pane/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
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
  "file": "/tmp/lo-proof-r29-out-66292/input-roundtrip.bin"
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
  "x": 1308,
  "y": 27.5,
  "box": {
    "x": 1292,
    "y": 11.5,
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
    "x": 1308,
    "y": 27.5,
    "box": {
      "x": 1292,
      "y": 11.5,
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
    "x": 721,
    "y": 0,
    "width": 659,
    "height": 868
  },
  "mirror": {
    "x": 729,
    "y": 77,
    "width": 643,
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
  "cols": 82,
  "rows": 50,
  "theme": "localOperatorDark",
  "live": true,
  "bytes": 48159,
  "frame": {
    "width": 1286,
    "height": 1582
  },
  "pane": {
    "x": 721,
    "y": 0,
    "width": 659,
    "height": 868
  },
  "mirror": {
    "x": 729,
    "y": 77,
    "width": 643,
    "height": 791
  },
  "dpr": 2,
  "sha256": "e473d47467d462f8787de6875ff6702153303bcafc102f9fa451a1b0cb35f46c",
  "file": "/tmp/lo-proof-r29-out-66292/console-con_1_Cnm6tUc0UecSKZmQwDEh_Q.png"
}
```

## PASS — a screenshot is the app's own window, cropped to the PANE's rect (design 13.2, Q-5)

```
{
  "rendered": "displayed",
  "cols": 82,
  "rows": 50,
  "frame": {
    "width": 1286,
    "height": 1582
  },
  "mirror": {
    "x": 729,
    "y": 77,
    "width": 643,
    "height": 791
  },
  "dpr": 2,
  "bytes": 48159
}
```

## offscreen capture

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 82,
  "rows": 50,
  "bytes": 48035,
  "sha256": "e50e262e6019c2d8dd3d0a4a6e4d36ebcc1efad1a5bcaf2cc7de06075239e933",
  "file": "/tmp/lo-proof-r29-out-66292/console-con_1_Cnm6tUc0UecSKZmQwDEh_Q-offscreen.png"
}
```

## PASS — a capture with no displayed pane is a DOM-rendered reconstruction from the record

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 82,
  "rows": 50,
  "displayedGrid": {
    "cols": 82,
    "rows": 50
  },
  "bytes": 48035
}
```

## four captures across three surfaces (Q-11)

```
{
  "alpha1": {
    "sha": "8a6a645feba64a7278f5c3cfe60a5982ec8c515ab20cbf13edfe99effe767ce0",
    "bytes": 12439,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "90f947859e959fb12234f18a23df0344462b003b3fc945be908c96f27b65e2b3",
    "bytes": 12132,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "8a6a645feba64a7278f5c3cfe60a5982ec8c515ab20cbf13edfe99effe767ce0",
    "bytes": 12439,
    "rendered": "offscreen",
    "attempts": 1
  },
  "empty": {
    "sha": "4170b8779af6b9fcb1787e4739e38e4020684e01145a60f9e498bbf1cff01d21",
    "bytes": 6629,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — two surfaces with different records give different frames (Q-11)

```
{
  "alpha1": {
    "sha": "8a6a645feba64a7278f5c3cfe60a5982ec8c515ab20cbf13edfe99effe767ce0",
    "bytes": 12439,
    "rendered": "offscreen",
    "attempts": 1
  },
  "beta": {
    "sha": "90f947859e959fb12234f18a23df0344462b003b3fc945be908c96f27b65e2b3",
    "bytes": 12132,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — the SAME record captured twice gives the SAME frame (Q-11)

```
{
  "alpha1": {
    "sha": "8a6a645feba64a7278f5c3cfe60a5982ec8c515ab20cbf13edfe99effe767ce0",
    "bytes": 12439,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alpha2": {
    "sha": "8a6a645feba64a7278f5c3cfe60a5982ec8c515ab20cbf13edfe99effe767ce0",
    "bytes": 12439,
    "rendered": "offscreen",
    "attempts": 1
  }
}
```

## PASS — an empty record is its own frame, not another surface's (Q-11)

```
{
  "empty": {
    "sha": "4170b8779af6b9fcb1787e4739e38e4020684e01145a60f9e498bbf1cff01d21",
    "bytes": 6629,
    "rendered": "offscreen",
    "attempts": 1
  },
  "alphaBytes": 12439,
  "betaBytes": 12132
}
```

## five captures of one large record (Q-13)

```
[
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  }
]
```

## PASS — a large record is captured five times, none refused, all five the same frame (Q-13)

```
[
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
    "rendered": "offscreen",
    "attempts": 1
  },
  {
    "sha": "52dc0a171e1a588b4bb795782aa923f23f6b46433d3427d32623c0e24e9bacf7",
    "bytes": 73615,
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
    "surface": "con:1:Cnm6tUc0UecSKZmQwDEh_Q",
    "session_id": "abcdef012345",
    "origin": "agent",
    "command": "sh",
    "argv_tail": "-f -i",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
    "cols": 110,
    "rows": 33,
    "running": true,
    "exit_code": null,
    "last_activity": 1790002724.496,
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
    "message": "con:1:Cnm6tU… is in secure input; reads and captures are refused until it is turned off",
    "data": {
      "secure": true
    }
  },
  "screenshot": {
    "code": "secure_input_active",
    "message": "con:1:Cnm6tU… is in secure input; reads and captures are refused until it is turned off",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/config/run/ui-console/history/abcdef012345/con_9_vBKuYYMw6bgqjQTwSYxOuA.log"
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
  "modes": {
    "bracketedPaste": false,
    "applicationCursorKeys": false,
    "mouseTracking": "none"
  },
  "cursor": {
    "x": 0,
    "y": 1
  },
  "last_activity": 1790002725.506,
  "retain": false,
  "secure": false,
  "env_marker": {
    "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
    "value": "con:10:bMNBNQ-W_I1zqnUCPt-KNA"
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
  "message": "con:10:bMNBNQ… has exited with code 5; its output is still readable",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/config/run/ui-console/history/abcdef012345/con_11_E0WjiXooUpw1cPGyQrAhHg.log",
  "mode": 384
}
```

## PASS — the retained history is 0600

```
{
  "mode": "600"
}
```

## PASS — a 30 s `yes` flood with retention ON leaves main answering (§19.1 P3)

```
{
  "baselineMs": {
    "max": 4,
    "median": 3
  },
  "floodMs": {
    "answered": 138,
    "median": 3,
    "p95": 9,
    "max": 114
  },
  "ceilings": {
    "median": 100,
    "p95": 500
  },
  "truncated": true,
  "exit_epoch": 0,
  "surface": "con:12:0he_u8NptZ1J5Vj8Pf79mw"
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
      "surface": "con:2:Hip3FCdxbFMLChF8rkYxVA",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '日本\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790002696.285,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:3:xpPXAhD-V8wvuBL0QJzbfw",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '\\346\\227'; sleep 0.3; printf '\\245\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1790002696.826,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:10:bMNBNQ-W_I1zqnUCPt-KNA",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf 'exited-marker\\n'; exit 5",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 5,
      "last_activity": 1790002725.506,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:13:FdKlvBIzbGCGs6FuIaRqwA",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1790002756.312,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:14:IRvyPFSuApAS0_xMYv6GeA",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1790002756.318,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:15:a_UzOmtQiU9oYhayBrsGHA",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1790002756.325,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:16:8KzIMtjmcWE_tA0Hox9gkg",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1790002756.331,
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
  "samples": 126,
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
    "10:58:14.861 › [console] restored the exec bit on /Users/damian/local-operator-ui-worktrees/console-pane/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/build/Release/spawn-helper",
    "10:58:14.861 › [console] host ready on the existing endpoint: 0 surface(s) (node-pty ready)",
    "10:58:15.161 › [console] surface con:1:Cnm6tU… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home at 120x40 (agent)",
    "10:58:15.789 › [console] surface con:1:Cnm6tU… resized 100x30",
    "10:58:16.117 › [console] surface con:2:Hip3FC… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home at 80x24 (agent)",
    "10:58:16.286 › [console] surface con:2:Hip3FC… exited 0",
    "10:58:16.443 › [console] surface con:3:xpPXAh… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home at 80x24 (agent)",
    "10:58:16.826 › [console] surface con:3:xpPXAh… exited 0",
    "10:58:16.891 › [console] surface con:4:pUw2R3… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-66295/home at 80x24 (agent)",
    "10:58:18.505 › [console] surface con:4:pUw2R3… exited 0",
    "10:58:18.507 › [console] surface con:4:pUw2R3… closed with exit 0",
    "10:58:19.822 › [console] surface con:1:Cnm6tU… resized 82x50"
  ]
}
```