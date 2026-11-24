import assert from "node:assert/strict";
import { createServer } from "node:http";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";

/**
 * The agent's picture on a session's OS banner (operator request 2026-11-23).
 *
 * Three layers, each against the shipped TypeScript bundled in memory:
 *
 * - the media relay op `sessions.notification_avatar`, against a real local
 *   HTTP server standing in for core's
 *   `GET /v1/desktop/sessions/{id}/notification-avatar` (exact path, closed
 *   query, bearer, ETag forwarding, 404 refusal, never-sent shapes);
 * - `SessionNotificationAvatars`, the memory-only cache keyed by core's ETag;
 * - `DesktopNotifier.show`, with an injected image source: picture on a
 *   single-session banner, app icon on 404 / timeout / capability absent /
 *   burst digest, and the banner is never dropped.
 *
 * Electron is a fixture: `Notification` records its options so the `icon`
 * that reached the OS boundary is what is asserted.
 */
const bundle = await build({
	stdin: {
		contents: `
export { DesktopNotifier } from "./src/main/desktop-notifier";
export * from "./src/main/session-notification-avatars";
export { requestDesktopMediaOutcome } from "./src/main/desktop-media";
export { TEAM_BRIDGE_IMAGE_WAIT_MS } from "./src/main/team-bridge-notifier";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.app.json",
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `
			export const app = { getPath: () => "/nonexistent", dock: { bounce() { return 1; }, cancelBounce() {} } };
			export const nativeTheme = { shouldUseDarkColors: false };
			export const BrowserWindow = class {};
			export const shell = {};
			export const nativeImage = { createFromBuffer() { return { isEmpty: () => true }; } };
			export class Notification {
				static isSupported() { return true; }
				constructor(options) { if (globalThis.__toastThrows) throw new Error("toast refused"); this.options = options; globalThis.__toasts.push(options); }
				on(event, handler) { this.handlers ??= {}; this.handlers[event] = handler; }
				once(event, handler) { this.on(event, handler); }
				off(event) { if (this.handlers) delete this.handlers[event]; }
				show() { globalThis.__shown.push(this); }
				close() {}
			}
		`,
					loader: "js",
				}));
			},
		},
	],
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "123456abcdef";
const OTHER = "abcdef123456";
const COMPLETION = `tok_${"c".repeat(12)}`;

beforeEach(() => {
	globalThis.__toasts = [];
	globalThis.__shown = [];
	globalThis.__toastThrows = false;
});

/** A minimal PNG header at the requested square size; the validator checks
 * the signature and IHDR dimensions before anything is decoded. */
function png(size = 256) {
	const data = Buffer.alloc(64);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
	data.writeUInt32BE(13, 8);
	data.writeUInt32BE(0x49484452, 12);
	data.writeUInt32BE(size, 16);
	data.writeUInt32BE(size, 20);
	return new Uint8Array(data);
}

function bytes(etag, size = 256) {
	return {
		kind: "bytes",
		status: 200,
		mimeType: "image/png",
		data: png(size),
		...(etag ? { etag } : {}),
	};
}

const NOT_FOUND = {
	kind: "error",
	status: 404,
	detail: "The avatar could not be read.",
};

/**
 * A cache over a scripted backend; `answer` is called per request.
 *
 * Each unanswered request holds a REF'd handle until it settles, as the real
 * relay's open HTTP socket does. Without it a test that awaits `read()` while a
 * scripted core hangs leaves only `read()`'s deliberately unref'd deadline
 * timer on the loop, and Node 22's runner (CI) then sees an empty event loop
 * and cancels the test and every one after it ("Promise resolution is still
 * pending but the event loop has already resolved", Full Test Suite run
 * 45294799133). Node 24 happened to keep running, which hid it locally.
 * `settled()` waits for every request this cache started.
 */
function cache({ answer = () => bytes('"a1"'), enabled = true } = {}) {
	const requests = [];
	const decoded = [];
	const inFlight = [];
	const clock = { now: 1_000, theme: "light" };
	const images = new m.SessionNotificationAvatars({
		enabled: () => enabled,
		request: async (input) => {
			requests.push(input);
			const socket = setInterval(() => {}, 1_000);
			const answered = (async () => answer(input, requests.length))();
			inFlight.push(answered.catch(() => undefined));
			try {
				return await answered;
			} finally {
				clearInterval(socket);
			}
		},
		decode: (data) => {
			const icon = { id: decoded.length + 1, bytes: data.byteLength };
			decoded.push(icon);
			return icon;
		},
		theme: () => clock.theme,
		now: () => clock.now,
	});
	const settled = () => Promise.all(inFlight);
	return { images, requests, decoded, clock, settled };
}

// ---------------------------------------------------------------- relay

async function withCore(handler, run) {
	const seen = [];
	const server = createServer((req, res) => {
		seen.push({ url: req.url, auth: req.headers.authorization });
		handler(req, res);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	try {
		await run(origin, seen);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

test("relay: exact path, closed query, bearer; PNG bytes and a valid ETag come back", async () => {
	let etag = '"sha256-abc:256:dark"';
	await withCore(
		(_req, res) => {
			res.writeHead(200, {
				"Content-Type": "image/png",
				...(etag ? { ETag: etag } : {}),
			});
			res.end(Buffer.from(png()));
		},
		async (origin, seen) => {
			const request = {
				op: "sessions.notification_avatar",
				sessionId: SESSION,
				size: 256,
				theme: "dark",
			};
			const send = async () =>
				(await m.requestDesktopMediaOutcome(request, null, origin, "s3cret"))
					.response;
			const first = await send();
			assert.equal(first.kind, "bytes");
			assert.equal(first.mimeType, "image/png");
			assert.equal(first.etag, '"sha256-abc:256:dark"');
			assert.equal(first.data.byteLength, 64);
			assert.deepEqual(seen[0], {
				url: `/v1/desktop/sessions/${SESSION}/notification-avatar?size=256&theme=dark`,
				auth: "Bearer s3cret",
			});
			// A malformed validator is dropped rather than becoming a cache key.
			etag = 'nope "unquoted';
			assert.equal((await send()).etag, undefined);
			etag = null;
			assert.equal((await send()).etag, undefined);
		},
	);
});

test("relay: 404 (no agent / no picture) is an error answer, never bytes", async () => {
	await withCore(
		(_req, res) => {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					detail: { code: "not_found", domain: "agent_avatar" },
				}),
			);
		},
		async (origin) => {
			const { response, answered } = await m.requestDesktopMediaOutcome(
				{
					op: "sessions.notification_avatar",
					sessionId: SESSION,
					size: 256,
					theme: "light",
				},
				null,
				origin,
				"s3cret",
			);
			assert.equal(answered, true);
			assert.equal(response.kind, "error");
			assert.equal(response.status, 404);
		},
	);
});

test("relay: a non-PNG 200 is refused without buffering it as an image", async () => {
	await withCore(
		(_req, res) => {
			res.writeHead(200, { "Content-Type": "image/jpeg" });
			res.end(Buffer.from([0xff, 0xd8, 0xff]));
		},
		async (origin) => {
			const { response } = await m.requestDesktopMediaOutcome(
				{
					op: "sessions.notification_avatar",
					sessionId: SESSION,
					size: 64,
					theme: "light",
				},
				null,
				origin,
				"s3cret",
			);
			assert.equal(response.kind, "error");
			assert.equal(response.status, 502);
		},
	);
});

test("relay: malformed shapes are refused before anything is sent", async () => {
	await withCore(
		(_req, res) => res.end(),
		async (origin, seen) => {
			for (const bad of [
				{ sessionId: "../../etc" },
				{ sessionId: "ABCDEF123456" },
				{ size: 128 },
				{ theme: "sepia" },
				{ extra: "x" },
			]) {
				const { response, answered } = await m.requestDesktopMediaOutcome(
					{
						op: "sessions.notification_avatar",
						sessionId: SESSION,
						size: 256,
						theme: "light",
						...bad,
					},
					null,
					origin,
					"s3cret",
				);
				assert.equal(answered, false, JSON.stringify(bad));
				assert.equal(response.status, 422);
			}
			assert.equal(seen.length, 0);
		},
	);
});

// ---------------------------------------------------------------- cache

test("cache: one request per session lease; hit afterwards without asking", async () => {
	const { images, requests } = cache();
	const first = await images.read(SESSION, 250);
	assert.ok(first);
	assert.deepEqual(requests, [
		{
			op: "sessions.notification_avatar",
			sessionId: SESSION,
			size: 256,
			theme: "light",
		},
	]);
	assert.equal(await images.read(SESSION, 250), first);
	assert.equal(images.peek(SESSION), first);
	assert.equal(requests.length, 1);
});

test("cache: sessions bound to one agent share one decoded image via the ETag", async () => {
	const { images, decoded } = cache({ answer: () => bytes('"same"') });
	const a = await images.read(SESSION, 250);
	const b = await images.read(OTHER, 250);
	assert.equal(a, b);
	assert.equal(decoded.length, 1);
});

test("cache: a changed picture (new ETag) after the lease shows the new image", async () => {
	let tag = '"v1"';
	const { images, clock } = cache({ answer: () => bytes(tag) });
	const before = await images.read(SESSION, 250);
	tag = '"v2"';
	clock.now += m.SESSION_NOTIFICATION_AVATAR_SESSION_TTL_MS;
	const after = await images.read(SESSION, 250);
	assert.notEqual(after, before);
});

test("cache: without an ETag a re-ask never reuses the old decode", async () => {
	const { images, clock, decoded } = cache({ answer: () => bytes(undefined) });
	await images.read(SESSION, 250);
	clock.now += m.SESSION_NOTIFICATION_AVATAR_SESSION_TTL_MS;
	await images.read(SESSION, 250);
	assert.equal(decoded.length, 2);
});

test("cache: a 404 is leased negative for 30 s, then asked again", async () => {
	const { images, requests, clock } = cache({ answer: () => NOT_FOUND });
	assert.equal(await images.read(SESSION, 250), undefined);
	assert.equal(await images.read(SESSION, 250), undefined);
	assert.equal(requests.length, 1, "a burst does not re-ask");
	clock.now += m.SESSION_NOTIFICATION_AVATAR_NEGATIVE_TTL_MS;
	await images.read(SESSION, 250);
	assert.equal(requests.length, 2);
});

test("cache: renderer_busy is transient and is NOT leased negative", async () => {
	const { images, requests } = cache({
		answer: () => ({ ...NOT_FOUND, status: 503, code: "renderer_busy" }),
	});
	await images.read(SESSION, 250);
	await images.read(SESSION, 250);
	assert.equal(requests.length, 2);
});

test("cache: any 503 (even uncoded) is no image now, not a negative lease", async () => {
	const { images, requests } = cache({
		answer: () => ({ ...NOT_FOUND, status: 503 }),
	});
	await images.read(SESSION, 250);
	await images.read(SESSION, 250);
	assert.equal(requests.length, 2);
});

test("cache: concurrent banners for one session coalesce into ONE request", async () => {
	let release;
	const { images, requests } = cache({
		answer: () =>
			new Promise((resolve) => {
				release = () => resolve(bytes('"one"'));
			}),
	});
	const reads = [1, 2, 3, 4].map(() => images.read(SESSION, 250));
	release();
	const icons = await Promise.all(reads);
	assert.equal(requests.length, 1);
	assert.ok(icons.every((icon) => icon && icon === icons[0]));
});

test("cache: a burst never exceeds two requests in flight", async () => {
	const releases = [];
	const { images, requests, settled } = cache({
		answer: () =>
			new Promise((resolve) => releases.push(() => resolve(NOT_FOUND))),
	});
	const ids = ["aaaaaaaaaaa1", "aaaaaaaaaaa2", "aaaaaaaaaaa3", "aaaaaaaaaaa4"];
	const reads = ids.map((id) => images.read(id, 20));
	assert.equal(requests.length, m.SESSION_NOTIFICATION_AVATAR_CONCURRENCY);
	assert.deepEqual(await Promise.all(reads), [
		undefined,
		undefined,
		undefined,
		undefined,
	]);
	for (const release of releases) release();
	await settled();
	// The lane frees once the hung requests settle: a skipped session asks now.
	const late = images.read(ids[3], 20);
	assert.equal(requests.length, m.SESSION_NOTIFICATION_AVATAR_CONCURRENCY + 1);
	releases.at(-1)();
	await late;
	await settled();
});

test("cache: a request that throws synchronously does not pin a dead flight (R1-4)", async () => {
	let calls = 0;
	const images = new m.SessionNotificationAvatars({
		enabled: () => true,
		request: (_input) => {
			calls += 1;
			if (calls === 1) throw new Error("relay not ready");
			return Promise.resolve(bytes('"after"'));
		},
		decode: (data) => ({ bytes: data.byteLength }),
		theme: () => "light",
		now: () => 1_000,
	});
	assert.equal(await images.read(SESSION, 250), undefined);
	assert.ok(await images.read(SESSION, 250), "the next banner asks again");
	assert.equal(calls, 2);
});

test("cache: a malformed PNG (wrong size) is no icon", async () => {
	const { images, decoded } = cache({ answer: () => bytes('"x"', 64) });
	assert.equal(await images.read(SESSION, 250), undefined);
	assert.equal(decoded.length, 0);
});

test("cache: theme is part of the key", async () => {
	const { images, requests, clock } = cache();
	await images.read(SESSION, 250);
	clock.theme = "dark";
	await images.read(SESSION, 250);
	assert.deepEqual(
		requests.map((r) => r.theme),
		["light", "dark"],
	);
});

test("cache: capability off means no request at all", async () => {
	const { images, requests } = cache({ enabled: false });
	assert.equal(await images.read(SESSION, 250), undefined);
	assert.equal(requests.length, 0);
});

test("cache: a hanging core resolves at the deadline; the late answer warms the next banner", async () => {
	let release;
	const { images, settled } = cache({
		answer: () =>
			new Promise((resolve) => {
				release = () => resolve(bytes('"late"'));
			}),
	});
	const started = Date.now();
	assert.equal(await images.read(SESSION, 20), undefined);
	assert.ok(Date.now() - started < 200);
	release();
	await settled();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.ok(images.peek(SESSION));
});

test("cache: clear() drops everything and discards an in-flight answer", async () => {
	let release;
	const { images, requests } = cache({
		answer: (_input, n) =>
			n === 1
				? new Promise((resolve) => {
						release = () => resolve(bytes('"old"'));
					})
				: bytes('"new"'),
	});
	const pending = images.read(SESSION, 50);
	images.clear();
	release();
	await pending;
	assert.equal(images.peek(SESSION), undefined, "old core's answer discarded");
	await images.read(SESSION, 250);
	assert.equal(requests.length, 2);
});

test("budget: the session banner wait is the operator-approved Team Bridge 250 ms", () => {
	assert.equal(
		m.SESSION_NOTIFICATION_IMAGE_WAIT_MS,
		m.TEAM_BRIDGE_IMAGE_WAIT_MS,
	);
});

// ---------------------------------------------------------------- notifier

function completionFrame(overrides = {}) {
	return {
		session_id: SESSION,
		epoch: "abc123",
		seq: 7,
		type: "notification",
		payload: {
			contract: 1,
			kind: "complete",
			title: "Quarterly revenue model",
			status: "Complete",
			body: "Rebuilt the forecast.",
			body_is_snippet: true,
			title_is_session_name: true,
			dedupe_key: `complete:${SESSION}:${Math.random()}`,
			completion_token: COMPLETION,
			session_name: "Quarterly revenue model",
			focus_policy: "always",
			...overrides,
		},
	};
}

/** A notifier over a composing backend that always lets this app claim, with
 * an injected image source and a manual wait timer. */
function notifier(source) {
	const timers = [];
	const n = new m.DesktopNotifier(
		() => null,
		async (input) =>
			input?.op === "capabilities"
				? {
						status: 200,
						body: { result: { features: { notification_contract: 1 } } },
					}
				: { status: 200, body: { result: { claimed: true } } },
		"focus",
		undefined,
		undefined,
		{
			images: source,
			setWaitTimer: (callback, delay) => {
				timers.push({ callback, delay });
				return timers.length;
			},
			clearWaitTimer: () => undefined,
		},
	);
	return { n, timers };
}

function source({ enabled = true, read }) {
	const reads = [];
	return {
		reads,
		enabled: () => enabled,
		read: (sessionId, deadline) => {
			reads.push({ sessionId, deadline });
			return read(sessionId);
		},
		peek: () => undefined,
		clear: () => undefined,
	};
}

const drain = () => new Promise((resolve) => setTimeout(resolve, 20));

test("notifier: a single-session banner carries the agent composite as its icon", async () => {
	const face = { agent: "face" };
	const s = source({ read: async () => face });
	const { n } = notifier(s);
	n.observe(SESSION, completionFrame());
	await drain();
	assert.equal(globalThis.__toasts.length, 1);
	assert.equal(globalThis.__toasts[0].icon, face);
	assert.equal(globalThis.__toasts[0].title, "Quarterly revenue model");
	assert.deepEqual(s.reads, [
		{ sessionId: SESSION, deadline: m.SESSION_NOTIFICATION_IMAGE_WAIT_MS },
	]);
	assert.equal(globalThis.__shown.length, 1);
});

test("notifier: no agent picture (404) posts today's banner, with no icon key", async () => {
	const { n } = notifier(source({ read: async () => undefined }));
	n.observe(SESSION, completionFrame());
	await drain();
	assert.equal(globalThis.__toasts.length, 1);
	assert.equal("icon" in globalThis.__toasts[0], false);
});

test("notifier: a source that never answers posts at the 250 ms deadline without an icon", async () => {
	const { n, timers } = notifier(source({ read: () => new Promise(() => {}) }));
	n.observe(SESSION, completionFrame());
	await drain();
	assert.equal(globalThis.__toasts.length, 0, "held only for the budget");
	assert.equal(timers.length, 1);
	assert.equal(timers[0].delay, 250);
	timers[0].callback();
	await drain();
	assert.equal(globalThis.__toasts.length, 1, "never dropped");
	assert.equal("icon" in globalThis.__toasts[0], false);
});

test("notifier: a post that throws after the icon wait is not an unhandled rejection (R1-1)", async () => {
	const unhandled = [];
	const listen = (reason) => unhandled.push(reason);
	process.on("unhandledRejection", listen);
	try {
		globalThis.__toastThrows = true;
		const { n } = notifier(source({ read: async () => ({ agent: "face" }) }));
		n.observe(SESSION, completionFrame());
		await drain();
		assert.equal(globalThis.__toasts.length, 0);
		assert.deepEqual(unhandled, []);
	} finally {
		process.off("unhandledRejection", listen);
	}
});

test("notifier: a source that throws or rejects still posts the banner", async () => {
	for (const read of [
		() => {
			throw new Error("boom");
		},
		() => Promise.reject(new Error("boom")),
	]) {
		globalThis.__toasts = [];
		const { n } = notifier(source({ read }));
		n.observe(SESSION, completionFrame());
		await drain();
		assert.equal(globalThis.__toasts.length, 1);
		assert.equal("icon" in globalThis.__toasts[0], false);
	}
});

test("notifier: capability absent - nothing is read and the banner posts", async () => {
	const s = source({ enabled: false, read: async () => ({ never: true }) });
	const { n } = notifier(s);
	n.observe(SESSION, completionFrame());
	await drain();
	assert.equal(globalThis.__toasts.length, 1);
	assert.equal("icon" in globalThis.__toasts[0], false);
	assert.equal(s.reads.length, 0);
});

test("notifier: a burst digest names several conversations and keeps the app icon", async () => {
	const s = source({ read: async () => ({ agent: "face" }) });
	const { n } = notifier(s);
	n.observe(
		SESSION,
		completionFrame({
			completion_token: undefined,
			burst_count: 3,
			session_ids: [SESSION, OTHER, "cccccccccccc"],
		}),
	);
	await drain();
	assert.equal(globalThis.__toasts.length, 1);
	assert.equal("icon" in globalThis.__toasts[0], false);
	assert.equal(s.reads.length, 0);
});
