import assert from "node:assert/strict";
import { createServer } from "node:http";
import { get } from "node:http";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The browser dev proxy is tooling, but it runs inside the process a developer
 * is using, so a defect here costs a dev-server restart at best and a dead
 * Vite process at worst.
 *
 * QA round 3 found the second case at the wire: subscribe through
 * `/__desktop/stream` against a stub backend, `kill -9` the stub, and about
 * four seconds later the Vite process is gone. The proxy had already written
 * its `200 text/event-stream` headers when the upstream socket died, and the
 * `catch` then set a status and headers again - `ERR_HTTP_HEADERS_SENT` thrown
 * inside an `async` middleware whose returned promise connect never awaits, so
 * the throw became an unhandled rejection and took the process with it. The
 * guard is `if (res.headersSent) { res.destroy(); return; }`; this file drives
 * that arm and the two refusal arms beside it, so the guard cannot be removed
 * without a failure that names it.
 *
 * How this is driven. The shipped plugin is bundled in memory and its
 * `configureServer` is handed a minimal stand-in for the Vite server object it
 * reads (`middlewares.use`, `httpServer`, `config.server.port`), so the
 * middleware under test is the real one and the requests are real loopback
 * HTTP against real stub upstreams. Two things are deliberately NOT in the
 * loop: Vite and connect. connect is what leaves the returned promise
 * unawaited, and this harness reproduces exactly that by capturing the promise
 * instead of awaiting it - awaiting it here would have turned the finding into
 * a rejected promise a test could ignore, which is the failure mode the
 * finding is about. Nothing about the renderer, Electron's IPC relay or a real
 * `local-operator serve` is proven here; the product path is
 * `desktop-renderer-transport.test.mjs`'s subject, not this file's.
 */

// Bundle in memory so this guard uses the shipped TS paths without adding a
// second app build, dependency tree, or generated fixture.
const bundle = await build({
	stdin: {
		contents:
			'export { desktopProxyPlugin } from "./scripts/vite-plugins/desktop-proxy.ts"; export { DESKTOP_STREAM_DETAIL } from "./src/shared/desktop-stream-notice";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { desktopProxyPlugin, DESKTOP_STREAM_DETAIL } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "0123456789ab";
const TOKEN = "synthetic-dev-proxy-token";
const PREVIOUS_BACKEND_URL = process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL;
const PREVIOUS_TOKEN = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
const servers = [];

after(async () => {
	for (const server of servers) await close(server);
	if (PREVIOUS_BACKEND_URL === undefined)
		delete process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL;
	else process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL = PREVIOUS_BACKEND_URL;
	if (PREVIOUS_TOKEN === undefined)
		delete process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	else process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = PREVIOUS_TOKEN;
});

/** A stub upstream on a loopback port this process owns. */
async function upstream(handler) {
	const server = createServer(handler);
	servers.push(server);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, url: `http://127.0.0.1:${server.address().port}` };
}
/** The shipped plugin, driven the way connect drives it. */
async function proxy(backendUrl) {
	process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = TOKEN;
	process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL = backendUrl;
	const middleware = [];
	const rejections = [];
	const server = createServer((req, res) => {
		/*
		 * connect calls the middleware and drops the promise, which is why a
		 * throw in an `async` handler reaches `process` and not the request. The
		 * capture is what makes that arm assertable: `rejections` must stay
		 * empty, and a fix that awaited the promise instead of guarding the
		 * headers would leave this array empty for the wrong reason.
		 */
		Promise.resolve(middleware[0](req, res, () => notFound(res))).catch(
			(error) => rejections.push(error),
		);
	});
	servers.push(server);
	desktopProxyPlugin().configureServer({
		middlewares: { use: (fn) => middleware.push(fn) },
		httpServer: server,
		config: { server: { port: 0 } },
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { port: server.address().port, rejections };
}

function notFound(res) {
	res.statusCode = 404;
	res.end("not found");
}

/*
 * Destroying the sockets is part of the harness rather than a nicety: the
 * unfixed arm of the first test leaves a request open on purpose (nothing closes
 * it, because the throw happens before any reply is finished), and a `close()`
 * that waited on those connections would hang the runner instead of reporting
 * the failure the arm exists to produce. `closeAllConnections` is what makes a
 * red run red in seconds.
 */
const close = (server) =>
	new Promise((resolve) => {
		server.closeAllConnections?.();
		server.close(resolve);
	});

/** A real same-origin EventSource-shaped GET, with its outcome left to the caller. */
function stream(port, url, onResponse) {
	const request = get(
		{
			host: "127.0.0.1",
			port,
			path: url,
			headers: { referer: `http://127.0.0.1:${port}/` },
		},
		onResponse,
	);
	return request;
}

/** One buffered request, for the arms that answer with a JSON detail. */
function read(port, url) {
	return new Promise((resolve, reject) => {
		const request = stream(port, url, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () =>
				resolve({
					status: res.statusCode,
					type: res.headers["content-type"],
					body: Buffer.concat(chunks).toString("utf8"),
				}),
			);
		});
		request.on("error", reject);
	});
}

test("a stream that dies after the headers are written closes the socket instead of writing them twice (QA round 3)", async () => {
	let upstreamSocket = null;
	const stub = await upstream((req, res) => {
		upstreamSocket = res.socket;
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.write('data: {"seq":1}\n\n');
		// Left open on purpose: the death is driven from the client below, so the
		// proxy is provably past its own header write when the upstream goes.
	});
	const { port, rejections } = await proxy(stub.url);

	const seen = { status: null, type: null, body: "" };
	const outcome = await new Promise((resolve) => {
		let settled = false;
		let timer = null;
		const done = (how) => {
			if (!settled) {
				settled = true;
				if (timer) clearTimeout(timer);
				resolve(how);
			}
		};
		// A guard that hung instead of closing must report that, not stall the run.
		timer = setTimeout(() => done("timeout"), 5000);
		const request = stream(
			port,
			`/__desktop/stream?session=${SESSION}&after_seq=0`,
			(res) => {
				seen.status = res.statusCode;
				seen.type = res.headers["content-type"];
				res.on("data", (chunk) => {
					seen.body += chunk.toString();
					// The 200 and this frame are on the wire: now the upstream dies.
					upstreamSocket.destroy();
				});
				res.on("aborted", () => done("aborted"));
				res.on("error", () => done("error"));
				res.on("end", () => done("end"));
			},
		);
		request.on("error", () => done("error"));
	});

	assert.deepEqual(rejections, []);
	assert.equal(seen.status, 200);
	assert.equal(seen.type, "text/event-stream");
	// The detail that cannot be delivered must not be attempted: a JSON body here
	// would mean the catch wrote after the headers, which is the finding.
	assert.doesNotMatch(seen.body, /detail/);
	assert.notEqual(outcome, "timeout");
	assert.notEqual(outcome, "end");

	// The proxy is still serving: the finding's symptom was the whole process
	// exiting, so a later request is the part a reader cares about.
	const probe = await read(port, `/__desktop/stream?session=nope`);
	assert.equal(probe.status, 422);
	assert.match(probe.body, /Invalid stream session\./);
	assert.deepEqual(rejections, []);
});

test("a refusal that arrives before any byte still reaches the reader as the shared sentence", async () => {
	const stub = await upstream((_req, res) => {
		res.writeHead(401, { "content-type": "application/json" });
		res.end(JSON.stringify({ detail: "not your token" }));
	});
	const { port, rejections } = await proxy(stub.url);

	const answer = await read(port, `/__desktop/stream?session=${SESSION}`);
	assert.equal(answer.status, 401);
	assert.equal(answer.type, "application/json");
	// The sentence is the shared constant, not a copy of it.
	assert.deepEqual(JSON.parse(answer.body), {
		detail: DESKTOP_STREAM_DETAIL.refusedWithoutStatus,
	});
	assert.deepEqual(rejections, []);
});

test("an upstream nobody is listening on still reaches the reader as the shared sentence", async () => {
	// A port this process opened and closed, so nothing is listening on it: the
	// `ECONNREFUSED` arm, and the arm that proves the guard does not swallow the
	// refusals that CAN be delivered.
	const reserved = createServer(() => {});
	await new Promise((resolve) => reserved.listen(0, "127.0.0.1", resolve));
	const dead = `http://127.0.0.1:${reserved.address().port}`;
	await close(reserved);

	const { port, rejections } = await proxy(dead);
	const answer = await read(port, `/__desktop/stream?session=${SESSION}`);
	assert.equal(answer.status, 503);
	assert.equal(answer.type, "application/json");
	assert.deepEqual(JSON.parse(answer.body), {
		detail: DESKTOP_STREAM_DETAIL.serverDown,
	});
	assert.deepEqual(rejections, []);
});
