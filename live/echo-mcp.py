#!/usr/bin/env python3
"""A minimal stdio MCP server, for the Integrations live-run rig.

Why a hand-written server rather than an installed one: the scene's claim is
that Settings > Integrations can add a local command, TEST it and remove it with
no conversation and no model provider. The test has to end in a real connect
with a real tool count, so the server has to answer `initialize` and
`tools/list` - and nothing else. A hand-written one has no install step, no
network, and no version to drift; it is a file in the rig's scratch tree, which
is exactly what `--integration-command` takes.

It speaks newline-delimited JSON-RPC on stdin/stdout: the transport the MCP
specification defines for stdio servers, which is what the backend's client
(and every other one) uses.

Reads one JSON object per line, answers requests, and stops at stdin EOF.
"""

import json
import sys

PROTOCOL_VERSION = "2024-11-05"
TOOLS = [
    {
        "name": "echo",
        "description": "Return the text it was given.",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    }
]


def handle(request):
    """The answer to one request, or None for a notification."""
    method = request.get("method")
    request_id = request.get("id")
    if request_id is None:
        # A notification (`notifications/initialized`): nothing is owed back.
        return None
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "rig-echo", "version": "1.0.0"},
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        arguments = (request.get("params") or {}).get("arguments") or {}
        text = str(arguments.get("text", ""))
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"content": [{"type": "text", "text": text}]},
        }
    if method in ("ping",):
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": f"method not found: {method}"},
    }


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        response = handle(request)
        if response is None:
            continue
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
