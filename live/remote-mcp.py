#!/usr/bin/env python3
"""A remote (HTTP) MCP server, for the Integrations live-run rig's URL half.

Why the SDK's own server rather than a hand-rolled JSON-RPC endpoint: the
subject under test is the BACKEND's HTTP transport and this app's row for it, and
the one thing a hand-written stub cannot promise is that it speaks the protocol
the real client expects (streamable HTTP: `initialize`, session ids, and either
SSE or a JSON response). The SDK's `MCPServer` IS the reference implementation
the client was written against, so the remote half of the run exercises the same
handshake a real remote server does.

One tool, so the row's tool count is a number the scene can assert rather than a
number that happens to be there.

Usage: remote-mcp.py <port>
"""

import sys

from mcp.server.mcpserver import MCPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8111

server = MCPServer("rig-remote")


@server.tool()
def echo(text: str) -> str:
    """Return the text it was given."""
    return text


if __name__ == "__main__":
    # `json_response` is left at its default (SSE): the transport the protocol
    # specifies, and the one a real remote MCP server serves.
    server.run(transport="streamable-http", host="127.0.0.1", port=PORT)
