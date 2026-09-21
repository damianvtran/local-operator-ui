# Console host end-to-end proof

Scratch: `/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135`
Result: every check passed
Reaped stray spawn-helper processes: 0


## PASS — the discovery record carries the console capability

```
{
  "console": true,
  "console_surfaces": 0,
  "console_agent_surfaces": 0,
  "pid": 29145,
  "proto": 1
}
```

## PASS — /health reports the console capability

```
{
  "host": "ui",
  "proto": 1,
  "pid": 29145,
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
  "surface": "con:1:Cjf2etu5eabKivGPO_byMQ",
  "cols": 120,
  "rows": 40,
  "pid": 29275,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — a surface is born at the grid it was asked for, in the user's home

```
{
  "surface": "con:1:Cjf2etu5eabKivGPO_byMQ",
  "cols": 120,
  "rows": 40,
  "pid": 29275,
  "live": true,
  "reveal": "none",
  "revealed": false
}
```

## PASS — the handle names its host

```
con:1:Cjf2etu5eabKivGPO_byMQ
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
  "file": "/tmp/lo-proof-r16-out-29127/input-roundtrip.bin"
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

## PASS — the console trigger is on screen in a conversation's header (Q-5)

```
{
  "x": 1308,
  "y": 116,
  "box": {
    "x": 1292,
    "y": 100,
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
    "y": 116,
    "box": {
      "x": 1292,
      "y": 100,
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
    "x": 721,
    "y": 88.5,
    "width": 659,
    "height": 779.5
  },
  "mirror": {
    "x": 729,
    "y": 165.5,
    "width": 643,
    "height": 702.5
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
  "rows": 45,
  "theme": "localOperatorDark",
  "live": true,
  "bytes": 47139,
  "frame": {
    "width": 1286,
    "height": 1404
  },
  "pane": {
    "x": 721,
    "y": 88.5,
    "width": 659,
    "height": 779.5
  },
  "mirror": {
    "x": 729,
    "y": 165.5,
    "width": 643,
    "height": 702.5
  },
  "sha256": "8ad133ecfd913d1102d0042b658f6fa58ac72bad7b52fc621a10334ec437419b",
  "file": "/tmp/lo-proof-r16-out-29127/console-con_1_Cjf2etu5eabKivGPO_byMQ.png"
}
```

## PASS — a screenshot is the app's own window, cropped to the PANE's rect (design 13.2, Q-5)

```
{
  "rendered": "displayed",
  "cols": 82,
  "rows": 45,
  "frame": {
    "width": 1286,
    "height": 1404
  },
  "mirror": {
    "x": 729,
    "y": 165.5,
    "width": 643,
    "height": 702.5
  },
  "dpr": 2,
  "bytes": 47139
}
```

## offscreen capture

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 82,
  "rows": 45,
  "bytes": 47138,
  "sha256": "4d80c2c6a11fc4247e63de11f2c9cf241e68127f942eca8a26440cbaad2c171c",
  "file": "/tmp/lo-proof-r16-out-29127/console-con_1_Cjf2etu5eabKivGPO_byMQ-offscreen.png"
}
```

## PASS — a capture with no displayed pane is a DOM-rendered reconstruction from the record

```
{
  "rendered": "offscreen",
  "renderer": "dom",
  "attempts": 1,
  "cols": 82,
  "rows": 45,
  "displayedGrid": {
    "cols": 82,
    "rows": 45
  },
  "bytes": 47138
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
    "surface": "con:1:Cjf2etu5eabKivGPO_byMQ",
    "session_id": "abcdef012345",
    "origin": "agent",
    "command": "sh",
    "argv_tail": "-f -i",
    "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
    "cols": 110,
    "rows": 33,
    "running": true,
    "exit_code": null,
    "last_activity": 1789969976.278,
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
    "message": "con:1:Cjf2et… is in secure input; reads and captures are refused until it is turned off",
    "data": {
      "secure": true
    }
  },
  "screenshot": {
    "code": "secure_input_active",
    "message": "con:1:Cjf2et… is in secure input; reads and captures are refused until it is turned off",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/config/run/ui-console/history/abcdef012345/con_5_Mc5K8D3EowBvJ_SQ0JZA6g.log"
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
  "last_activity": 1789969977.223,
  "retain": false,
  "secure": false,
  "env_marker": {
    "name": "LOCAL_OPERATOR_CONSOLE_SURFACE",
    "value": "con:6:otfaJ9dZIb_r3jR_oBIJbw"
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
  "message": "con:6:otfaJ9… has exited with code 5; its output is still readable",
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
  "file": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/config/run/ui-console/history/abcdef012345/con_7_eYLKN8t3ucUMGzC9CFtFLQ.log",
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
    "max": 7,
    "median": 4
  },
  "floodMs": {
    "answered": 123,
    "median": 6,
    "p95": 21,
    "max": 254
  },
  "ceilings": {
    "median": 100,
    "p95": 500
  },
  "truncated": true,
  "exit_epoch": 0,
  "surface": "con:8:ZksOK83wZ71EJmPSNcfRgg"
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
      "surface": "con:2:FNQ04NJDCVgDej3YFel0ow",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '日本\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1789969791.959,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:3:p2ANKJPAKWNqun-y5MxMoA",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf '\\346\\227'; sleep 0.3; printf '\\245\\n'",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 0,
      "last_activity": 1789969792.501,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:6:otfaJ9dZIb_r3jR_oBIJbw",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c printf 'exited-marker\\n'; exit 5",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
      "cols": 80,
      "rows": 24,
      "running": false,
      "exit_code": 5,
      "last_activity": 1789969977.223,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:9:RjWwr-ApTCzK9Xcp_sqlbw",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789970008.02,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:10:VIERpvzxCBlGES_JC1eIYA",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789970008.03,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:11:qF_qnZVgmndnVuPjMFibaw",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789970008.035,
      "live": true,
      "agent_owned": true,
      "last_actor": null
    },
    {
      "surface": "con:12:LGjd_G4xLsES4A3QlMMIMw",
      "session_id": "abcdef012345",
      "origin": "agent",
      "command": "sh",
      "argv_tail": "-c sleep 3",
      "cwd": "/var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home",
      "cols": 100,
      "rows": 30,
      "running": true,
      "exit_code": null,
      "last_activity": 1789970008.046,
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
  "samples": 435,
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
    "01:49:50.645 › [console] restored the exec bit on /Users/damian/local-operator-ui-worktrees/console-pane/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/build/Release/spawn-helper",
    "01:49:50.645 › [console] host ready on the existing endpoint: 0 surface(s) (node-pty ready)",
    "01:49:50.901 › [console] surface con:1:Cjf2et… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home at 120x40 (agent)",
    "01:49:51.657 › [console] surface con:1:Cjf2et… resized 100x30",
    "01:49:51.914 › [console] surface con:2:FNQ04N… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home at 80x24 (agent)",
    "01:49:51.959 › [console] surface con:2:FNQ04N… exited 0",
    "01:49:52.163 › [console] surface con:3:p2ANKJ… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home at 80x24 (agent)",
    "01:49:52.501 › [console] surface con:3:p2ANKJ… exited 0",
    "01:49:52.628 › [console] surface con:4:6uvEBX… started: sh in /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-console-proof-29135/home at 80x24 (agent)",
    "01:49:54.294 › [console] surface con:4:6uvEBX… exited 0",
    "01:49:54.294 › [console] surface con:4:6uvEBX… closed with exit 0",
    "01:52:55.330 › [console] surface con:1:Cjf2et… resized 82x45"
  ]
}
```