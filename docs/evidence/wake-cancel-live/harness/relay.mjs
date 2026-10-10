#!/usr/bin/env node
/**
 * The capture relay: a loopback HTTP proxy that can HOLD one response still.
 *
 *     node docs/evidence/wake-cancel-live/harness/relay.mjs \
 *       --listen 8080 --target 8081 --control <scratch>/relay.json \
 *       --log <scratch>/relay.log
 *
 * ## Why it exists
 *
 * Two frames this set must carry are states the app leaves within ~60 ms on a
 * quiet machine: the `Cancelling…` window while a one-press write is in flight,
 * and the `Cancelled` receipt before the canonical re-read drops the row
 * (measured by QA round 1's DOM trace: `Cancelled` at +56 ms, row gone at
 * +114 ms). `webContents.capturePage()` cannot be asked to win that race — the
 * encode alone outruns it — so the relay gives the capture the time it needs by
 * delaying the RESPONSE, exactly as QA's own recording relay did for the refusal
 * staging (their round 1 report, matrix row 3). Nothing in the app changes: the
 * same requests go to the same daemon, one hop later.
 *
 * ## The knobs
 *
 * `--control` names a JSON file the rig writes between steps:
 *
 *     { "listDelayMs": 0, "deleteDelayMs": 0, "eventsDelayMs": 0, "desktopEventsDelayMs": 0 }
 *
 *   - `listDelayMs` delays `GET /v1/desktop/wakes` — the Schedules page's
 *     listing, and the route's own test rigs' read.
 *   - `deleteDelayMs` delays the `DELETE /v1/desktop/wakes/...` itself, holding
 *     the row's `Cancelling…` window open.
 *   - `eventsDelayMs` delays `GET /v1/desktop/sessions/<id>/events` — the
 *     session's canonical stream, which is what actually delivers the re-read
 *     that drops a cancelled row (`resyncCanonicalSession` RECONNECTS this
 *     stream; it is not a listing fetch). Holding its response is what keeps
 *     the `Cancelled` mark on screen: the mark is the pane body's state, and
 *     the row only leaves when the held snapshot arrives.
 *
 * All three default to 0 (byte-for-byte proxy behaviour) and are read per
 * request, so a scenario can turn them on and off between frames. Every
 * forwarded request is appended to `--log` as one `METHOD path -> status` line,
 * which is where the captured frames' wire claims are read from.
 */

import { createServer, request as httpRequest } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";

const arg = (name, fallback) => {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const LISTEN = Number(arg("listen", "8080"));
const TARGET = Number(arg("target", "8081"));
const CONTROL = arg("control", "");
const LOG = arg("log", "");
const say = (line) => process.stdout.write(`${line}\n`);
const log = (line) => {
	if (LOG) appendFileSync(LOG, `${line}\n`);
};

const knobs = () => {
	try {
		const parsed = JSON.parse(readFileSync(CONTROL, "utf8"));
		return {
			listDelayMs: Number(parsed.listDelayMs ?? 0),
			deleteDelayMs: Number(parsed.deleteDelayMs ?? 0),
			eventsDelayMs: Number(parsed.eventsDelayMs ?? 0),
			desktopEventsDelayMs: Number(parsed.desktopEventsDelayMs ?? 0),
		};
	} catch {
		return {
			listDelayMs: 0,
			deleteDelayMs: 0,
			eventsDelayMs: 0,
			desktopEventsDelayMs: 0,
		};
	}
};

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const server = createServer((incoming, outgoing) => {
	const url = incoming.url ?? "/";
	const method = incoming.method ?? "GET";
	const { listDelayMs, deleteDelayMs, eventsDelayMs, desktopEventsDelayMs } =
		knobs();
	/*
	 * The knobs match on the METHOD and the path's family, never on a session or
	 * wake id: a scenario holds "the listing" or "a wake DELETE" still, and an id
	 * in the rule would be a second place the run's session has to be spelled.
	 */
	const isListing = method === "GET" && url.startsWith("/v1/desktop/wakes");
	const isDelete = method === "DELETE" && url.startsWith("/v1/desktop/wakes/");
	const isEvents =
		method === "GET" && /\/v1\/desktop\/sessions\/[^/]+\/events/.test(url);
	const isDesktopEvents = method === "GET" && url.startsWith("/v1/desktop/events");
	const delay = isListing
		? listDelayMs
		: isDelete
			? deleteDelayMs
			: isEvents
				? eventsDelayMs
				: isDesktopEvents
					? desktopEventsDelayMs
					: 0;

	const headers = { ...incoming.headers, host: `127.0.0.1:${TARGET}` };
	const forward = httpRequest(
		{ host: "127.0.0.1", port: TARGET, path: url, method, headers },
		(upstream) => {
			const finish = () => {
				log(`${method} ${url} -> ${upstream.statusCode}${delay ? ` (held ${delay}ms)` : ""}`);
				outgoing.writeHead(upstream.statusCode ?? 502, upstream.headers);
				upstream.pipe(outgoing);
			};
			if (delay > 0) wait(delay).then(finish);
			else finish();
		},
	);
	forward.on("error", (error) => {
		log(`${method} ${url} -> relay error ${String(error?.message ?? error)}`);
		outgoing.writeHead(502, { "content-type": "application/json" });
		outgoing.end('{"detail":"relay could not reach the daemon"}');
	});
	incoming.pipe(forward);
});

server.listen(LISTEN, "127.0.0.1", () => {
	say(`relay: 127.0.0.1:${LISTEN} -> 127.0.0.1:${TARGET} (control ${CONTROL || "none"})`);
});
