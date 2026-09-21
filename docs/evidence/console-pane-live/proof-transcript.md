# Console host end-to-end proof

Scratch: `/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970`
Result: every check passed
Reaped stray spawn-helper processes: 0


## PASS — the discovery record carries the console capability

```
{
  "console": true,
  "console_surfaces": 0,
  "console_agent_surfaces": 0,
  "pid": 4973,
  "proto": 1
}
```

## PASS — /health reports the console capability

```
{
  "host": "ui",
  "proto": 1,
  "pid": 4973,
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
  "surface": "con:1:mIOBC_qswcoFmseNhCqHDA",
  "cols": 120,
  "rows": 40,
  "pid": 5082,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — a surface is born at the grid it was asked for, in the user's home

```
{
  "surface": "con:1:mIOBC_qswcoFmseNhCqHDA",
  "cols": 120,
  "rows": 40,
  "pid": 5082,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — the handle names its host

```
con:1:mIOBC_qswcoFmseNhCqHDA
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
  "file": "/tmp/lo-proof-r2-out-4966/input-roundtrip.bin"
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

## PASS — the app is wearing a named theme (the capture view is fed its name)

```
localOperatorDark
```

## PASS — the renderer reports a rect and main decides the grid from it

```
{
  "surface": "con:1:mIOBC_qswcoFmseNhCqHDA",
  "session_id": "proof-session",
  "origin": "agent",
  "command": "sh",
  "argv_tail": "-f -i",
  "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
  "cols": 94,
  "rows": 25,
  "running": true,
  "exit_code": null,
  "last_activity": 1789957570.692,
  "live": true,
  "agent_owned": true,
  "last_actor": "agent",
  "secure": false,
  "retain": false,
  "sizing": "auto",
  "displayed": true,
  "last_mark": null
}
```

## capture geometry

```
{
  "rendered": "displayed",
  "cols": 94,
  "rows": 25,
  "theme": "localOperatorDark",
  "live": true,
  "bytes": 95723,
  "sha256": "de0be35faa3b754bf34c79d1f0b3b3e16310fc90d0ff9cc05e4c44cba4d8f75e",
  "file": "/tmp/lo-proof-r2-out-4966/console-con_1_mIOBC_qswcoFmseNhCqHDA.png"
}
```

## PASS — a screenshot is the app's own window, cropped to the pane's rect (design 13.2)

```
{
  "rendered": "displayed",
  "cols": 94,
  "rows": 25,
  "bytes": 95723
}
```

## offscreen capture

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 94,
  "rows": 25,
  "bytes": 40980,
  "sha256": "b3c92450c6b61b8ed8024a183d94baa0053ff4160945fd10146d09cc43a0ad90",
  "file": "/tmp/lo-proof-r2-out-4966/console-con_1_mIOBC_qswcoFmseNhCqHDA-offscreen.png"
}
```

## PASS — a capture with no displayed pane is a DOM-rendered reconstruction from the record

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 94,
  "rows": 25,
  "bytes": 40980
}
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
    "surface": "con:1:mIOBC_qswcoFmseNhCqHDA",
    "session_id": "proof-session",
    "origin": "agent",
    "command": "sh",
    "argv_tail": "-f -i",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
    "cols": 110,
    "rows": 33,
    "running": true,
    "exit_code": null,
    "last_activity": 1789957571.042,
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
    "message": "con:1:mIOBC_… is in secure input; reads and captures are refused until it is turned off",
    "data": {
      "secure": true
    }
  },
  "screenshot": {
    "code": "secure_input_active",
    "message": "con:1:mIOBC_… is in secure input; reads and captures are refused until it is turned off",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/config/run/ui-console/history/proof-session/con_5_IyMuA3YnxuS7M6apZuHEXw.log"
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
  "last_activity": 1789957572.07,
  "retain": false,
  "secure": false,
  "env_marker": {
    "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
    "value": "con:6:PqkZdoaYkq-C53f0_6znLw"
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
  "message": "con:6:PqkZdo… has exited with code 5; its output is still readable",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/config/run/ui-console/history/proof-session/con_7_hIuKADZl8vEGScbf_5dbhw.log",
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
    "max": 6,
    "median": 5
  },
  "floodMs": {
    "answered": 140,
    "median": 4,
    "p95": 10,
    "max": 118
  },
  "ceilings": {
    "median": 100,
    "p95": 500
  },
  "truncated": true,
  "exit_epoch": 0,
  "surface": "con:8:A0scTyGOmvwAiP4x83x8sw"
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
      "surface": "con:2:JRQqhwbWK-7yWhYiYMPcXA",
      "session_id": "proof-session",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '日本\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1789957568.114,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:3:NZsLlGJ4HdgTd4OUXT2xAw",
      "session_id": "proof-session",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '\\346\\227'; sleep 0.3; printf '\\245\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1789957568.659,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:6:PqkZdoaYkq-C53f0_6znLw",
      "session_id": "proof-session",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf 'exited-marker\\n'; exit 5",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 5,
      "last_activity": 1789957572.07,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:9:Pw-DNMlugnYx4BVxffKbQw",
      "session_id": "proof-session",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789957602.799,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:10:O6V4qTTaVviUALL0c6AOJQ",
      "session_id": "proof-session",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789957602.805,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:11:hh-A7_Mdo6BdfaIjfL2t6w",
      "session_id": "proof-session",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789957602.811,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:12:Jh9h-1IzW_672LCZGkv8Aw",
      "session_id": "proof-session",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789957602.817,
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
  "samples": 74,
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
    "22:26:06.986 › [console] restored the exec bit on /Users/damian/local-operator-ui-worktrees/console-pane/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/build/Release/spawn-helper",
    "22:26:06.986 › [console] host ready on the existing endpoint: 0 surface(s) (node-pty ready)",
    "22:26:07.237 › [console] surface con:1:mIOBC_… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home at 120x40 (agent)",
    "22:26:07.856 › [console] surface con:1:mIOBC_… resized 100x30",
    "22:26:08.089 › [console] surface con:2:JRQqhw… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home at 80x24 (agent)",
    "22:26:08.114 › [console] surface con:2:JRQqhw… exited 0",
    "22:26:08.308 › [console] surface con:3:NZsLlG… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home at 80x24 (agent)",
    "22:26:08.659 › [console] surface con:3:NZsLlG… exited 0",
    "22:26:08.741 › [console] surface con:4:HJgMiG… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-4970/home at 80x24 (agent)",
    "22:26:10.362 › [console] surface con:4:HJgMiG… exited 0",
    "22:26:10.362 › [console] surface con:4:HJgMiG… closed with exit 0",
    "22:26:10.734 › [console] surface con:1:mIOBC_… resized 94x25"
  ]
}
```