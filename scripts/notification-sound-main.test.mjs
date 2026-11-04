/*
 * The two main-process halves of Settings -> Notifications (review round 1, m4):
 *
 *     node --test scripts/notification-sound-main.test.mjs
 *
 *  - `src/main/notification-test.ts`, the "Send test notification" banner:
 *    headless is `suppressed`, an unsupported OS is `unsupported`, a stalled
 *    sound refresh is bounded, and the banner carries the configured sound.
 *  - `src/main/desktop-media.ts`'s upload branch: the multipart body (file and
 *    `name`), the refusal pass-through scoped to this op ONLY, and the params
 *    kept as short scalars (n2).
 *
 * Electron is a fixture (no app, no banner), and `fetch` is a stub, so no
 * request leaves the process; the code under test is production's own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ELECTRON = /^electron$/;
const ANY = /.*/;
const electronFixture = {
	name: "electron-fixture",
	setup(builder) {
		builder.onResolve({ filter: ELECTRON }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		builder.onLoad({ filter: ANY, namespace: "fixture" }, () => ({
			contents: `
				export class Notification {
					static isSupported() { return true; }
					constructor(options) { this.options = options; }
					on() {} once() {} off() {}
					show() {}
				}
			`,
			loader: "js",
		}));
	},
};

const load = async (contents) => {
	const out = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		plugins: [electronFixture],
		logLevel: "silent",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
};

const { sendTestNotification } = await load(
	'export { sendTestNotification } from "./src/main/notification-test";',
);
const { requestDesktopMediaOutcome, scalarParams } = await load(
	'export { requestDesktopMediaOutcome, scalarParams } from "./src/main/desktop-media";',
);

/** A banner double that records what it was built with and whether it showed. */
const banners = () => {
	const made = [];
	return {
		made,
		create: (options) => {
			const banner = { options, shown: false };
			made.push(banner);
			return {
				show: () => {
					banner.shown = true;
				},
				once: () => {},
			};
		},
	};
};

test("headless never raises a banner (`suppressed`)", async () => {
	const { made, create } = banners();
	const result = await sendTestNotification({
		windowRaise: "never",
		sound: () => null,
		create,
		isSupported: () => true,
	});
	assert.deepEqual(result, { shown: false, reason: "suppressed" });
	assert.equal(made.length, 0);
});

test("an OS without notifications answers `unsupported`", async () => {
	const { made, create } = banners();
	const result = await sendTestNotification({
		windowRaise: "focus",
		sound: () => null,
		create,
		isSupported: () => false,
	});
	assert.deepEqual(result, { shown: false, reason: "unsupported" });
	assert.equal(made.length, 0);
});

test("a stalled sound refresh is bounded, then the banner goes out", async () => {
	const { made, create } = banners();
	let refreshed = 0;
	const started = Date.now();
	const result = await sendTestNotification({
		windowRaise: "focus",
		// A refresh that never settles: the bound must release the banner.
		sound: () => ({
			refresh: () => {
				refreshed += 1;
				return new Promise(() => {});
			},
		}),
		create,
		isSupported: () => true,
	});
	const waited = Date.now() - started;
	assert.deepEqual(result, { shown: true });
	assert.equal(refreshed, 1, "the plan is re-read first");
	assert.ok(waited >= 1400 && waited < 3000, `bounded wait, took ${waited}ms`);
	assert.equal(made.length, 1);
	assert.equal(made[0].shown, true);
	assert.equal(made[0].options.title, "Test notification");
	assert.equal(
		made[0].options.body,
		"This is how your notifications will sound.",
	);
	assert.equal(
		typeof made[0].options.silent,
		"boolean",
		"the banner carries the notification sound options",
	);
});

/* ------------------------------------------------------------- the relay */

const drive = async (request, bytes, respond) => {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return respond(String(url), init);
	};
	try {
		const outcome = await requestDesktopMediaOutcome(
			request,
			bytes,
			"http://127.0.0.1:1111",
			"test-bearer",
		);
		return { ...outcome, calls };
	} finally {
		globalThis.fetch = original;
	}
};
const json = (status, body) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
const BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

test("upload posts multipart file + name to the daemon with the bearer", async () => {
	const { response, calls } = await drive(
		{ op: "notification_sounds.upload", fileName: "bell.wav", name: "Bell" },
		BYTES,
		() => json(201, { status: 201, result: { id: "custom-bell-000001" } }),
	);
	assert.equal(response.kind, "json");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "http://127.0.0.1:1111/v1/notification-sounds");
	assert.equal(calls[0].init.method, "POST");
	assert.match(
		new Headers(calls[0].init.headers).get("authorization") ?? "",
		/Bearer test-bearer/,
	);
	const form = calls[0].init.body;
	assert.ok(form instanceof FormData, "multipart body");
	assert.equal(form.get("name"), "Bell");
	const file = form.get("file");
	assert.equal(file.name, "bell.wav");
	assert.equal(file.size, BYTES.byteLength);
});

test("an upload refusal forwards the daemon's code and scalar params", async () => {
	const { response } = await drive(
		{ op: "notification_sounds.upload", fileName: "song.mp3" },
		BYTES,
		() =>
			json(422, {
				detail: {
					code: "too_long",
					params: { seconds: "184.2", nested: { a: 1 }, list: [1, 2] },
					text: "song.mp3 is 184.2 seconds long.",
				},
			}),
	);
	assert.equal(response.kind, "error");
	assert.deepEqual(response.refusal, {
		code: "too_long",
		params: { seconds: "184.2" },
	});
});

test("no other op carries a refusal (the pass-through is scoped)", async () => {
	const { response } = await drive(
		{ op: "notification_sounds.audio", soundId: "soft-pulse", volume: 70 },
		null,
		() =>
			json(404, {
				detail: { code: "not_found", params: { id: "x" }, text: "Not found." },
			}),
	);
	assert.equal(response.kind, "error");
	assert.equal(response.refusal, undefined);
});

test("params are kept as at most 8 short scalars", () => {
	const many = Object.fromEntries(
		Array.from({ length: 12 }, (_, i) => [`k${i}`, i]),
	);
	assert.equal(Object.keys(scalarParams(many)).length, 8);
	assert.deepEqual(
		scalarParams({
			s: "x".repeat(500),
			n: 3,
			b: true,
			nan: Number.NaN,
			o: {},
			[`${"k".repeat(65)}`]: 1,
		}),
		{ s: "x".repeat(128), n: 3, b: true },
	);
	assert.equal(scalarParams({ o: {} }), undefined);
});
