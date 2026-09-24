/*
 * QA round 2 proxy for PR #482, on 8080 (the one port the renderer CSP allows
 * besides the operator's own 1111), in front of a daemon on an OS-chosen port.
 *
 * Instrumentation, none of it in the app:
 *  - every SSE stream is parsed frame by frame: the `open` frame's
 *    payload.subscription_id names the stream, and each `aside_delta` frame on it
 *    is counted under THAT id and under its aside_id, with the delta sizes kept,
 *    so "addressed to this pane's subscription" is a wire reading;
 *  - every aside POST is logged with the subscription_id it carried, the status
 *    and the response body (the 409 copy the panel must quote);
 *  - OLD_DAEMON=1 emulates a daemon that predates the field: an aside POST whose
 *    body carries `subscription_id` is answered 422
 *    {"detail":"The request has invalid fields."} (the exact body
 *    local_operator/server/app.py produces for a /v1/desktop/ validation error)
 *    and is NOT forwarded; a body without it is forwarded unchanged.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { basename, join } from "node:path";

const PORT = Number(process.env.PROXY_PORT ?? 8080);
const BACKEND_PORT = Number(process.env.BACKEND_PORT);
const RECORD_SRC = process.env.RECORD_SRC ?? "";
const RECORDS_OUT = process.env.RECORDS_OUT ?? "";
const LOG = process.env.PROXY_LOG ?? "";
const STATS_OUT = process.env.STATS_OUT ?? "";
const OLD_DAEMON = process.env.OLD_DAEMON === "1";
if (!BACKEND_PORT) {
	console.error("proxy-r2: BACKEND_PORT is required");
	process.exit(2);
}
const log = (line) => {
	const s = `${new Date().toISOString()} ${line}`;
	if (LOG) appendFileSync(LOG, `${s}\n`);
};
const stats = {
	oldDaemon: OLD_DAEMON,
	asidePosts: [],
	streams: [],
	asideDeltaFrames: 0,
	deltasBySubscription: {},
	deltasByAside: {},
	refused422: 0,
};
const writeStats = () => {
	if (STATS_OUT) writeFileSync(STATS_OUT, `${JSON.stringify(stats, null, 2)}\n`);
};
function mirrorRecord() {
	if (!RECORD_SRC || !RECORDS_OUT) return;
	try {
		const record = JSON.parse(readFileSync(RECORD_SRC, "utf8"));
		mkdirSync(RECORDS_OUT, { recursive: true });
		writeFileSync(
			join(RECORDS_OUT, basename(RECORD_SRC)),
			`${JSON.stringify({ ...record, host: "127.0.0.1", port: PORT }, null, 2)}\n`,
		);
	} catch (error) {
		log(`record mirror failed: ${error?.message ?? error}`);
	}
}
const readBody = (req) =>
	new Promise((resolve) => {
		const parts = [];
		req.on("data", (c) => parts.push(c));
		req.on("end", () => resolve(Buffer.concat(parts)));
	});

/** A per-response SSE parser: splits on blank lines, parses `data:` JSON. */
function sseWatcher(url) {
	const stream = {
		url,
		openedAt: new Date().toISOString(),
		subscriptionId: null,
		asideDeltas: 0,
		deltaSizes: [],
	};
	stats.streams.push(stream);
	let buffer = "";
	return (chunk) => {
		buffer += chunk.toString("utf8");
		let at = buffer.indexOf("\n\n");
		while (at !== -1) {
			const block = buffer.slice(0, at);
			buffer = buffer.slice(at + 2);
			at = buffer.indexOf("\n\n");
			const data = block
				.split("\n")
				.filter((l) => l.startsWith("data:"))
				.map((l) => l.slice(5).trimStart())
				.join("\n");
			if (!data) continue;
			let frame;
			try {
				frame = JSON.parse(data);
			} catch {
				continue;
			}
			const frames = Array.isArray(frame) ? frame : [frame];
			for (const f of frames) {
				if (f?.type === "open") stream.subscriptionId = f.payload?.subscription_id ?? null;
				if (f?.type === "aside_delta") {
					const sub = String(stream.subscriptionId);
					stream.asideDeltas += 1;
					stream.deltaSizes.push((f.payload?.delta ?? "").length);
					stats.asideDeltaFrames += 1;
					stats.deltasBySubscription[sub] = (stats.deltasBySubscription[sub] ?? 0) + 1;
					const id = String(f.payload?.aside_id);
					stats.deltasByAside[id] = (stats.deltasByAside[id] ?? 0) + 1;
				}
			}
		}
	};
}

const server = createServer(async (req, res) => {
	const url = req.url ?? "";
	const isAsidePost = req.method === "POST" && /\/asides$/.test(url);
	let body = null;
	let entry = null;
	if (isAsidePost) {
		body = await readBody(req);
		let parsed = null;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {}
		entry = {
			at: new Date().toISOString(),
			url,
			asideId: parsed?.request_id ?? null,
			continues: parsed?.aside_id ?? null,
			questionHead: String(parsed?.text ?? "").slice(0, 60),
			carriedSubscriptionField: parsed ? "subscription_id" in parsed : null,
			subscriptionId: parsed?.subscription_id ?? null,
			status: null,
			response: null,
		};
		stats.asidePosts.push(entry);
		if (OLD_DAEMON && parsed && "subscription_id" in parsed) {
			stats.refused422 += 1;
			entry.status = 422;
			entry.response = '{"detail":"The request has invalid fields."}';
			entry.emulated = "old daemon: refused the unknown field, not forwarded";
			res.writeHead(422, { "content-type": "application/json" });
			res.end(entry.response);
			writeStats();
			return;
		}
	}
	const proxied = httpRequest(
		{
			host: "127.0.0.1",
			port: BACKEND_PORT,
			method: req.method,
			path: url,
			headers: {
				...req.headers,
				host: `127.0.0.1:${BACKEND_PORT}`,
				...(body ? { "content-length": String(body.length) } : {}),
			},
		},
		(upstream) => {
			res.writeHead(upstream.statusCode ?? 502, upstream.headers);
			res.flushHeaders?.();
			const sse = String(upstream.headers["content-type"] ?? "").includes("text/event-stream")
				? sseWatcher(url)
				: null;
			const kept = [];
			upstream.on("data", (chunk) => {
				if (sse) sse(chunk);
				if (entry) kept.push(chunk);
			});
			upstream.on("end", () => {
				if (entry) {
					entry.status = upstream.statusCode;
					entry.response = Buffer.concat(kept).toString("utf8").slice(0, 600);
					writeStats();
				}
			});
			upstream.pipe(res);
		},
	);
	proxied.on("error", (error) => {
		log(`upstream error ${req.method} ${url}: ${error?.message ?? error}`);
		if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
		res.end("proxy: backend unreachable");
	});
	if (body) proxied.end(body);
	else req.pipe(proxied);
});
server.listen(PORT, "127.0.0.1", () => {
	log(`proxy-r2 on 127.0.0.1:${PORT} -> 127.0.0.1:${BACKEND_PORT} oldDaemon=${OLD_DAEMON}`);
	mirrorRecord();
	setInterval(mirrorRecord, 4000).unref();
	setInterval(writeStats, 1000).unref();
	writeStats();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		writeStats();
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 500).unref();
	});
}
