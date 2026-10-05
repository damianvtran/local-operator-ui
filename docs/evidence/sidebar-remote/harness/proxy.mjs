/**
 * A PASS-THROUGH in front of a real daemon, so a live run's WIRE is readable.
 *
 * WHY A PROXY AND NOT A GUESS. Half of this pass's claim is a wire fact - the
 * sidebar's catalogue poll never carries `include_peers`, and the ONE federated
 * read is the ambient observer's own (`limit=200`) - and a live daemon keeps no
 * log a rig can read. The app is pointed at this server instead of the daemon;
 * every request is forwarded verbatim and its method/path/query recorded to a
 * jsonl file the drive reads, exactly as the fixture server records its own.
 *
 * STREAMING IS REAL STREAMING: the session stream (`/events`) is a long-lived
 * SSE response, so the upstream body is PIPED rather than buffered - a proxy
 * that collected a body would hang the pane's stream the moment the live run
 * opened a conversation. Nothing is rewritten in either direction; this is an
 * observability shim, not a second transport.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
const PORT = Number(arg("port", "24327"));
const TARGET = arg("target", "http://127.0.0.1:1111");
const WIRE = arg("wire", "/tmp/rig-live-wire.jsonl");
const target = new URL(TARGET);

mkdirSync(dirname(WIRE), { recursive: true });
writeFileSync(WIRE, "");

const server = createServer((req, res) => {
	appendFileSync(
		WIRE,
		`${JSON.stringify({ at: Date.now(), method: req.method, path: req.url })}\n`,
	);
	const upstream = httpRequest(
		{
			hostname: target.hostname,
			port: target.port,
			path: req.url,
			method: req.method,
			headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
		},
		(upstreamRes) => {
			res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
			upstreamRes.pipe(res);
		},
	);
	upstream.on("error", (error) => {
		res.writeHead(502, { "content-type": "application/json" });
		res.end(JSON.stringify({ detail: `proxy: ${error.message}` }));
	});
	req.pipe(upstream);
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`live proxy on http://127.0.0.1:${PORT} -> ${TARGET} (${WIRE})`);
});
