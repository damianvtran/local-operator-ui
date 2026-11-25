import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * ASK ANSWER ATTESTATION - main's half (`src/main/ask-attest.ts`, with the shared
 * gate and dialler in `src/main/app-attest.ts`; core `asks/app_attest.py`).
 *
 * Why it matters: without it every desktop ask answer is stamped
 * `by.surface = unverified`, and the dangerous-delete guard (rightly) refuses it
 * as the operator's consent. With it, a person's answer confirmed on a native
 * sheet is attested to the session's runtime and stamped `desktop`. What this
 * guards:
 *
 *  - THE FRAME is exactly core's `ask_attest` contract (the sibling core test
 *    `tests/unit/asks/test_ask_attest_contract.py` pins the same wire): every key
 *    present, `reason` null, `images` `{question_id, mime_type, sha256}` with the
 *    digest over the base64-DECODED bytes. Checked over a REAL AF_UNIX socket.
 *  - THE GATE: every refusal (debugger, DevTools, CDP/inspect/`--lo-*` switches,
 *    agent launch flag, dev-driver env, hidden/unfocused/minimised window, no
 *    window or a non-admitted sender, non-normal window mode, dev build, not
 *    macOS) dials nothing, forwards nothing and raises no sheet.
 *  - THE SHEET: built from main's own read only; Cancel sends nothing; one sheet
 *    at a time; the ask's expiry closes it; a change while it was open sends
 *    nothing.
 *  - THE FORWARD is byte-identical to the frozen, attested body, even when the
 *    renderer mutates its request object afterwards.
 *  - A missing socket or a refused verdict is a keyed 403 and nothing forwarded.
 *  - Decline and dismiss are never attested: the op cannot express them.
 *  - `desktop-ipc.ts` never forwards the op by itself.
 *
 * Typed doubles plus a real socket: no Electron, no window, no backend.
 */

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/main/ask-attest";
			export * from "./src/main/app-attest";
			export { pairingProvenanceRefusal } from "./src/main/mesh-pairing-attest";
			export { registerDesktopIPC } from "./src/main/desktop-ipc";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
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
						export const ipcMain = { handle: (name, handler) => globalThis.__handlers.set(name, handler) };
						export const shell = { openExternal: async () => {} };
					`,
					loader: "js",
				}));
			},
		},
	],
});
const bundlePath = new URL(`./_ask-attest-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
globalThis.__handlers = new Map();
const {
	ASK_ATTEST_REFUSED,
	ASK_ATTEST_PROBE_WORLD_ID,
	AskSheetLock,
	askAttestFrame,
	askAttestSocketPath,
	askForwardRequest,
	askImageDigests,
	askSessionLabel,
	askSheet,
	attestAskAnswer,
	liveAskRow,
	sheetText,
	attestProvenanceRefusal,
	dialAttest,
	freezeAskAnswer,
	pairingProvenanceRefusal,
	registerDesktopIPC,
	desktopEndpoint,
	desktopRequestSchema,
} = await import(bundlePath.href);
await unlink(bundlePath);

/*
 * AF_UNIX paths cap at 104 bytes on macOS. The scratch dir is the operator's
 * convention for rigs; CI has none, and a long one falls back to /tmp.
 */
const scratchBase = process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir();
let scratch = mkdtempSync(join(scratchBase, "a"));
if (`${scratch}/run/attest/0123456789ab.sock`.length >= 100) {
	rmSync(scratch, { recursive: true, force: true });
	scratch = mkdtempSync("/tmp/a");
}
after(() => rmSync(scratch, { recursive: true, force: true }));

const SID = "0123456789ab";
const ASK = "a-3f9c";
const NOW_MS = 1_763_500_000_000;

/** The facts of a launch a person is driving: the gate's one passing case. */
const person = () => ({
	platform: "darwin",
	packaged: true,
	argv: ["/Applications/Local Operator.app/Contents/MacOS/Local Operator"],
	env: { HOME: "/Users/someone" },
	windowMode: "normal",
	window: {
		visible: true,
		minimized: false,
		focused: true,
		devToolsOpened: false,
		debuggerAttached: false,
	},
});

const win = (over) => ({ window: { ...person().window, ...over } });

/** Every gate refusal: [name, fact patch, expected reason]. */
const refusals = [
	["dev build", { packaged: false }, "not_packaged"],
	["not macOS", { platform: "linux" }, "not_macos"],
	[
		"CDP port",
		{ argv: ["app", "--remote-debugging-port=9222"] },
		"remote_debugging",
	],
	[
		"CDP pipe",
		{ argv: ["app", "--remote-debugging-pipe"] },
		"remote_debugging",
	],
	["inspect", { argv: ["app", "--inspect=0"] }, "remote_debugging"],
	["inspect-brk", { argv: ["app", "--inspect-brk"] }, "remote_debugging"],
	["--lo-* rig switch", { argv: ["app", "--lo-driver"] }, "dev_flag"],
	["agent launch flag", { argv: ["app", "--user-data-dir=/x"] }, "dev_flag"],
	[
		"dev driver env",
		{ env: { LOCAL_OPERATOR_UI_DEV_DRIVER: "1" } },
		"dev_flag",
	],
	[
		"smoke test env",
		{ env: { LOCAL_OPERATOR_UI_SMOKE_TEST: "1" } },
		"dev_flag",
	],
	["headless mode", { windowMode: "headless" }, "window_mode"],
	["inactive mode", { windowMode: "inactive" }, "window_mode"],
	["no admitted window", { window: null }, "no_window"],
	["debugger attached", win({ debuggerAttached: true }), "debugger_attached"],
	["devtools open", win({ devToolsOpened: true }), "devtools_open"],
	["hidden", win({ visible: false }), "window_not_visible"],
	["minimised", win({ minimized: true }), "window_not_visible"],
	["unfocused", win({ focused: false }), "window_not_focused"],
];

/** One open ask as `GET /v1/desktop/asks` lists it. */
const askRow = (over = {}) => ({
	ask_id: ASK,
	session_id: SID,
	status: "open",
	delivered: false,
	expires_at: NOW_MS + 600_000,
	questions: [
		{
			id: "q1",
			question: "Delete ~/workspace/old-exports?",
			options: [{ label: "Yes, delete it" }, { label: "No, keep it" }],
		},
		{ id: "q2", question: "Anything else?" },
		{ id: "pw", question: "Paste the token", secret: true },
	],
	...over,
});

const listed = (...asks) => ({ status: 200, body: { result: { asks } } });

/** A `sessions.list` answer naming the conversation and its bound agent (S1). */
const sessionsListed = (
	rows = [{ id: SID, name: "Tidy old exports", binding: { agent: "cleaner" } }],
) => ({ status: 200, body: { result: { sessions: rows } } });

/** An answered row whose recorded answer was itself confirmed (a trusted stamp). */
const answeredRow = (over = {}) =>
	askRow({
		status: "answered",
		answered_by: { surface: "desktop", proof: "app-signature" },
		...over,
	});

/** Bidi isolates (`messages.ts` isolateArguments) stripped, for text asserts. */
const plain = (text) => text.replace(/[\u2066-\u2069]/g, "");

const respond = (extra = {}) => ({
	op: "asks.attestedAnswer",
	sessionId: SID,
	askId: ASK,
	answers: { q1: ["Yes, delete it"] },
	...extra,
});

const mainDocument = (over = {}) => ({
	webContentsId: 7,
	processId: 41,
	frameToken: "frame-token-a",
	generation: 0,
	...over,
});

/** A host double recording every dial, forward, sheet and read. */
function host(overrides = {}) {
	const calls = {
		attest: [],
		forward: [],
		activation: 0,
		sheets: [],
		reads: 0,
	};
	const clock = { ms: NOW_MS };
	const h = {
		facts: person,
		document: () => mainDocument(),
		userActivation: async () => {
			calls.activation += 1;
			return true;
		},
		readAsks: async () => {
			calls.reads += 1;
			return listed(askRow());
		},
		readSessions: async () => sessionsListed(),
		showSheet: async (sheet) => {
			calls.sheets.push(sheet);
			return true;
		},
		sheet: new AskSheetLock(),
		configDir: () => scratch,
		forward: async (input) => {
			calls.forward.push(JSON.stringify(input));
			// Serve's receipt for an answer the runtime stamped trusted (S3).
			return {
				status: 200,
				body: { result: { detail: "answered", consent_bearing: true } },
			};
		},
		nowMs: () => clock.ms,
		attest: async (path, frame) => {
			calls.attest.push({ path, frame: JSON.stringify(frame) });
			return null;
		},
		...overrides,
	};
	return { host: h, calls, clock };
}

function assertNothingSent(calls, label) {
	assert.equal(calls.attest.length, 0, `${label}: no dial`);
	assert.equal(calls.forward.length, 0, `${label}: no forward`);
}

function assertRefused(response, reason) {
	assert.equal(response.status, 403, JSON.stringify(response.body));
	assert.equal(response.body.detail.code, ASK_ATTEST_REFUSED);
	assert.equal(response.body.detail.reason, reason);
}

/* --------------------------------------------------------------- the frame */

const FRAME_KEYS = [
	"act",
	"answers",
	"ask_id",
	"images",
	"op",
	"reason",
	"session_id",
];

test("the respond frame is core's ask_attest contract, every key present", () => {
	const frame = askAttestFrame(freezeAskAnswer(respond()));
	assert.deepEqual(Object.keys(frame).sort(), FRAME_KEYS);
	assert.deepEqual(frame, {
		op: "ask_attest",
		session_id: SID,
		ask_id: ASK,
		act: "respond",
		answers: { q1: ["Yes, delete it"] },
		images: [],
		reason: null,
	});
});

test("revise: true attests act revise and forwards revise: true", () => {
	const frozen = freezeAskAnswer(respond({ revise: true }));
	assert.equal(askAttestFrame(frozen).act, "revise");
	assert.deepEqual(askForwardRequest(frozen), {
		op: "sessions.answer",
		sessionId: SID,
		askId: ASK,
		answers: { q1: ["Yes, delete it"] },
		revise: true,
	});
	// A first answer carries no `revise` key at all: the plain Submit body, byte for byte.
	assert.equal(
		JSON.stringify(askForwardRequest(freezeAskAnswer(respond()))),
		JSON.stringify({
			op: "sessions.answer",
			sessionId: SID,
			askId: ASK,
			answers: { q1: ["Yes, delete it"] },
		}),
	);
});

test("image digests are sha256 of the DECODED bytes, bound to question and type, sorted", () => {
	const png = Buffer.from("\x89PNG\r\n\x1a\n contract-test pixels", "latin1");
	const gif = Buffer.from("GIF89a pixels", "latin1");
	const images = askImageDigests([
		{
			question_id: "q2",
			mime_type: "image/png",
			data_b64: png.toString("base64"),
		},
		{
			question_id: "q1",
			mime_type: "image/gif",
			data_b64: gif.toString("base64"),
		},
	]);
	const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
	assert.deepEqual(images, [
		{ question_id: "q1", mime_type: "image/gif", sha256: sha(gif) },
		{ question_id: "q2", mime_type: "image/png", sha256: sha(png) },
	]);
	// The easy mistake, a digest over the base64 TEXT, is not what is sent.
	assert.notEqual(images[1].sha256, sha(Buffer.from(png.toString("base64"))));
	const frame = askAttestFrame(freezeAskAnswer(respond()), [
		{
			question_id: "q2",
			mime_type: "image/png",
			data_b64: png.toString("base64"),
		},
	]);
	assert.deepEqual(frame.images, [images[1]]);
});

test("the socket is <config>/run/attest/<session_id>.sock", () => {
	assert.equal(
		askAttestSocketPath("/x/.local-operator", SID),
		`/x/.local-operator/run/attest/${SID}.sock`,
	);
});

/* ------------------------------------------------------- the real socket */

/**
 * A listener speaking core's protocol (`AttestService._on_connection`): greet,
 * then one reply per frame line. `greeting`/`reply` shape the verdicts.
 */
async function listener({
	greeting = { ok: true },
	reply = { ok: true },
} = {}) {
	const dir = join(scratch, "run", "attest");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = join(dir, `${SID}.sock`);
	rmSync(path, { force: true });
	const frames = [];
	const server = createServer((socket) => {
		socket.setEncoding("utf8");
		let buffer = "";
		socket.write(`${JSON.stringify(greeting)}\n`);
		if (!greeting.ok) return socket.end();
		socket.on("data", (chunk) => {
			buffer += chunk;
			let at = buffer.indexOf("\n");
			while (at >= 0) {
				frames.push(buffer.slice(0, at));
				buffer = buffer.slice(at + 1);
				socket.write(`${JSON.stringify(reply)}\n`);
				at = buffer.indexOf("\n");
			}
		});
	});
	await new Promise((resolve) => server.listen(path, resolve));
	return {
		path,
		frames,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
				rmSync(path, { force: true });
			}),
	};
}

test("the whole ceremony over a REAL socket: the exact frame, then the same body forwarded", async () => {
	const live = await listener();
	try {
		const { host: h, calls } = host({ attest: undefined });
		const response = await attestAskAnswer(respond(), h);
		assert.equal(response.status, 200, JSON.stringify(response.body));
		assert.equal(live.frames.length, 1);
		const frame = JSON.parse(live.frames[0]);
		assert.deepEqual(Object.keys(frame).sort(), FRAME_KEYS);
		assert.deepEqual(frame, {
			op: "ask_attest",
			session_id: SID,
			ask_id: ASK,
			act: "respond",
			answers: { q1: ["Yes, delete it"] },
			images: [],
			reason: null,
		});
		assert.deepEqual(calls.forward, [
			JSON.stringify({
				op: "sessions.answer",
				sessionId: SID,
				askId: ASK,
				answers: { q1: ["Yes, delete it"] },
			}),
		]);
		// The attested answers and the forwarded answers are the same content.
		assert.deepEqual(JSON.parse(calls.forward[0]).answers, frame.answers);
	} finally {
		await live.close();
	}
});

test("a missing socket (cold runtime) is listener_unavailable and nothing is forwarded", async () => {
	rmSync(join(scratch, "run", "attest", `${SID}.sock`), { force: true });
	const { host: h, calls } = host({ attest: undefined });
	const response = await attestAskAnswer(respond(), h);
	assertRefused(response, "listener_unavailable");
	assert.equal(calls.forward.length, 0);
	assert.equal(
		calls.sheets.length,
		1,
		"the person had confirmed; the dial failed",
	);
});

/* ------------------------------------------- a parked runtime (a-f372) */

/*
 * THE REPRODUCTION (session 00e6a1cd8f62, ask a-f372): the operator confirmed on
 * the sheet while the session's runtime was parked; it came up ~1.07 s later, so
 * the one dial met no socket and the answer could not be attested. These tests
 * drive the REAL dialler against a REAL AF_UNIX listener that only exists once
 * the host's `ensureListener` (the engage) has brought it up.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("parked runtime: the engage starts when the sheet opens, the late socket is waited for, the answer is attested", async () => {
	rmSync(join(scratch, "run", "attest", `${SID}.sock`), { force: true });
	const order = [];
	let live = null;
	const { host: h, calls } = host({
		attest: undefined,
		ensureListener: async (sessionId) => {
			order.push(`ensure:${sessionId}`);
			// The runtime binds its socket a beat after the engage, as in a-f372.
			await sleep(150);
			live = await listener();
			return true;
		},
		showSheet: async (sheet) => {
			order.push("sheet");
			calls.sheets.push(sheet);
			return true;
		},
		listenerWaitMs: 5_000,
	});
	try {
		const response = await attestAskAnswer(respond(), h);
		assert.equal(response.status, 200, JSON.stringify(response.body));
		assert.deepEqual(
			order,
			[`ensure:${SID}`, "sheet"],
			"warmed BEFORE the sheet",
		);
		assert.equal(live?.frames.length, 1, "exactly one attested frame");
		assert.equal(calls.forward.length, 1, "forwarded once, after the attest");
	} finally {
		await live?.close();
	}
});

test("parked runtime that never binds: a bounded wait, then listener_timeout and nothing forwarded", async () => {
	rmSync(join(scratch, "run", "attest", `${SID}.sock`), { force: true });
	const { host: h, calls } = host({
		attest: undefined,
		ensureListener: async () => true,
		listenerWaitMs: 400,
	});
	const started = performance.now();
	const response = await attestAskAnswer(respond(), h);
	const elapsed = performance.now() - started;
	assertRefused(response, "listener_timeout");
	assert.equal(calls.forward.length, 0);
	assert.ok(elapsed >= 400, `waited the bound (${elapsed} ms)`);
	assert.ok(elapsed < 2_000, `and no longer (${elapsed} ms)`);
});

test("an engage that fails or throws is runtime_not_started, never a send", async () => {
	for (const ensureListener of [
		async () => false,
		async () => {
			throw new Error("relay down");
		},
		() => {
			throw new Error("sync throw");
		},
	]) {
		rmSync(join(scratch, "run", "attest", `${SID}.sock`), { force: true });
		const { host: h, calls } = host({
			attest: undefined,
			ensureListener,
			listenerWaitMs: 5_000,
		});
		const started = performance.now();
		const response = await attestAskAnswer(respond(), h);
		assertRefused(response, "runtime_not_started");
		assert.equal(calls.forward.length, 0);
		assert.ok(
			performance.now() - started < 2_000,
			"no full wait once the engage said no",
		);
	}
});

test("the ask expiring during the wait is expired: no dial after it, nothing forwarded", async () => {
	const dials = [];
	const {
		host: h,
		calls,
		clock,
	} = host({
		attest: async () => {
			dials.push(clock.ms);
			return "listener_unavailable";
		},
		ensureListener: async () => true,
		listenerWaitMs: 5_000,
	});
	const timer = setTimeout(() => {
		clock.ms = NOW_MS + 600_001;
	}, 250);
	try {
		const response = await attestAskAnswer(respond(), h);
		assertRefused(response, "expired");
		assert.equal(calls.forward.length, 0);
		assert.ok(
			dials.every((at) => at < NOW_MS + 600_000),
			"no dial past expiry",
		);
	} finally {
		clearTimeout(timer);
	}
});

test("the retry is bounded, retries only a missing listener, and re-runs the gate between dials", async () => {
	let dials = 0;
	const { host: h } = host({
		attest: async () => {
			dials += 1;
			return "listener_unavailable";
		},
		ensureListener: async () => true,
		listenerWaitMs: 500,
	});
	assertRefused(await attestAskAnswer(respond(), h), "listener_timeout");
	// One dial per ASK_LISTENER_POLL_MS (100 ms) over 500 ms, plus the first.
	assert.ok(dials >= 3 && dials <= 8, `bounded dials (${dials})`);

	// A listener that answered (refused) is a verdict, not a missing socket.
	let refusedDials = 0;
	const refused = host({
		attest: async () => {
			refusedDials += 1;
			return "listener_refused";
		},
		ensureListener: async () => true,
		listenerWaitMs: 5_000,
	});
	assertRefused(
		await attestAskAnswer(respond(), refused.host),
		"listener_refused",
	);
	assert.equal(refusedDials, 1);

	// Focus lost while waiting is the gate's refusal on the next retry.
	let focused = true;
	const unfocused = host({
		attest: async () => {
			focused = false;
			return "listener_unavailable";
		},
		facts: () => {
			const facts = person();
			return facts.window
				? { ...facts, window: { ...facts.window, focused } }
				: facts;
		},
		ensureListener: async () => true,
		listenerWaitMs: 5_000,
	});
	assertRefused(
		await attestAskAnswer(respond(), unfocused.host),
		"window_not_focused",
	);
	assert.equal(unfocused.calls.forward.length, 0);
});

test("a refused verdict on accept is listener_refused; a refused frame is frame_refused; neither forwards", async () => {
	for (const [shape, reason] of [
		[{ greeting: { ok: false, reason: "signature" } }, "listener_refused"],
		[{ reply: { ok: false, reason: "bad-frame" } }, "frame_refused"],
	]) {
		const live = await listener(shape);
		try {
			const { host: h, calls } = host({ attest: undefined });
			assertRefused(await attestAskAnswer(respond(), h), reason);
			assert.equal(calls.forward.length, 0, reason);
		} finally {
			await live.close();
		}
	}
});

test("the dialler fails closed on garbage and on a silent listener", async () => {
	const path = join(scratch, "g.sock");
	const server = createServer((socket) => socket.write("not json\n"));
	await new Promise((resolve) => server.listen(path, resolve));
	try {
		assert.equal(await dialAttest(path, {}), "listener_refused");
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
	const quiet = join(scratch, "q.sock");
	const silent = createServer(() => {});
	await new Promise((resolve) => silent.listen(quiet, resolve));
	try {
		assert.equal(await dialAttest(quiet, {}, { timeoutMs: 50 }), "timeout");
	} finally {
		silent.close();
	}
});

/* ---------------------------------------------------------------- the gate */

test("every gate refusal answers 403 and neither dials, forwards, reads nor raises a sheet", async () => {
	for (const [name, patch, reason] of refusals) {
		const { host: h, calls } = host({
			facts: () => ({ ...person(), ...patch }),
		});
		assertRefused(await attestAskAnswer(respond(), h), reason);
		assertNothingSent(calls, name);
		assert.equal(calls.sheets.length, 0, `${name}: no sheet`);
		assert.equal(calls.activation, 0, `${name}: the page is not even asked`);
		assert.equal(calls.reads, 0, `${name}: no read`);
	}
});

test("the ask gate is the pairing gate: one shared rule set, no drift", () => {
	for (const [name, patch] of refusals)
		assert.equal(
			attestProvenanceRefusal({ ...person(), ...patch }),
			pairingProvenanceRefusal({ ...person(), ...patch }),
			name,
		);
	assert.equal(attestProvenanceRefusal(person()), null);
});

test("a non-admitted sender (no document) is refused before anything", async () => {
	const { host: h, calls } = host({ document: () => null });
	assertRefused(await attestAskAnswer(respond(), h), "no_window");
	assertNothingSent(calls, "no document");
	assert.equal(calls.sheets.length, 0);
});

test("no page activation raises no sheet (the pre-filter)", async () => {
	const { host: h, calls } = host({ userActivation: async () => false });
	assertRefused(await attestAskAnswer(respond(), h), "no_user_action");
	assert.equal(calls.sheets.length, 0);
	assertNothingSent(calls, "no activation");
});

/* --------------------------------------------------------------- the sheet */

test("Cancel/Escape sends nothing and is not an error", async () => {
	const { host: h, calls } = host({
		showSheet: async (sheet) => {
			calls.sheets.push(sheet);
			return false;
		},
	});
	const response = await attestAskAnswer(respond(), h);
	assert.equal(response.status, 200);
	assert.deepEqual(response.body, { result: { cancelled: true } });
	assertNothingSent(calls, "cancel");
	assert.equal(h.sheet.isOpen, false, "the sheet lock is released");
});

test("the sheet's words come from main's own read; a secret is never shown", async () => {
	const { host: h, calls } = host();
	await attestAskAnswer(
		respond({
			answers: {
				q1: ["Yes, delete it"],
				q2: ["only the csv files"],
			},
		}),
		h,
	);
	const [sheet] = calls.sheets;
	const detail = plain(sheet.detail);
	assert.match(detail, /Delete ~\/workspace\/old-exports\?\n→ Yes, delete it/);
	assert.match(detail, /Anything else\?\n→ “only the csv files”/);
	assert.equal(plain(sheet.message), "Send this answer as yours?");
	// D3: the button repeats the question's verb.
	assert.equal(sheet.actionLabel, "Send");
	assert.equal(sheet.cancelLabel, "Cancel");
});

test("the contract refuses renderer-supplied labels or question text", () => {
	for (const extra of [{ label: "Yes" }, { question: "Fake?" }, { sheet: "x" }])
		assert.equal(desktopRequestSchema.safeParse(respond(extra)).success, false);
	assert.equal(desktopRequestSchema.safeParse(respond()).success, true);
	assert.equal(
		desktopRequestSchema.safeParse(respond({ answers: {} })).success,
		false,
		"an empty answer map is not an answer",
	);
});

test("an answer main's read cannot back raises no sheet", async () => {
	const cases = [
		["no such ask", listed(askRow({ ask_id: "a-other" })), "ask_closed"],
		[
			"other session",
			listed(askRow({ session_id: "ffffffffffff" })),
			"ask_closed",
		],
		["already answered", listed(askRow({ status: "answered" })), "ask_closed"],
		[
			"expired by clock",
			listed(askRow({ expires_at: NOW_MS - 1 })),
			"ask_closed",
		],
		[
			"unknown question",
			listed(askRow({ questions: [{ id: "zz", question: "?" }] })),
			"ask_closed",
		],
		["read refused", { status: 503, body: {} }, "ask_read_failed"],
		["old backend", { status: 200, body: { result: {} } }, "ask_read_failed"],
	];
	for (const [name, read, reason] of cases) {
		const { host: h, calls } = host({ readAsks: async () => read });
		assertRefused(await attestAskAnswer(respond(), h), reason);
		assert.equal(calls.sheets.length, 0, `${name}: no sheet`);
		assertNothingSent(calls, name);
	}
	const thrown = host({ readAsks: async () => Promise.reject(new Error("x")) });
	assertRefused(
		await attestAskAnswer(respond(), thrown.host),
		"ask_read_failed",
	);
});

test("revise needs an answered, undelivered ask", async () => {
	const ok = host({
		readAsks: async () => listed(answeredRow()),
	});
	const response = await attestAskAnswer(respond({ revise: true }), ok.host);
	assert.equal(response.status, 200);
	assert.equal(
		plain(ok.calls.sheets[0].message),
		"Change your answer to this?",
	);
	assert.equal(JSON.parse(ok.calls.attest[0].frame).act, "revise");
	assert.equal(ok.calls.sheets[0].actionLabel, "Change answer");
	const delivered = host({
		readAsks: async () => listed(answeredRow({ delivered: true })),
	});
	assertRefused(
		await attestAskAnswer(respond({ revise: true }), delivered.host),
		"ask_closed",
	);
	const open = host();
	assertRefused(
		await attestAskAnswer(respond({ revise: true }), open.host),
		"ask_closed",
	);
});

test("one sheet at a time: a second request while one is open is refused, never queued", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const { host: h, calls } = host({
		showSheet: async (sheet) => {
			calls.sheets.push(sheet);
			await gate;
			return true;
		},
	});
	const first = attestAskAnswer(respond(), h);
	await new Promise((resolve) => setImmediate(resolve));
	while (calls.sheets.length === 0) await new Promise((r) => setImmediate(r));
	assertRefused(await attestAskAnswer(respond(), h), "sheet_open");
	release();
	assert.equal((await first).status, 200);
	assert.equal(calls.sheets.length, 1);
	assert.equal(calls.forward.length, 1);
});

test("the ask's expiry closes the sheet: nothing sent", async () => {
	const { host: h, calls } = host({
		readAsks: async () => listed(askRow({ expires_at: NOW_MS + 20 })),
		nowMs: () => NOW_MS,
		showSheet: (sheet, signal) =>
			new Promise((resolve) => {
				calls.sheets.push(sheet);
				signal.addEventListener("abort", () => resolve(false));
			}),
	});
	assertRefused(await attestAskAnswer(respond(), h), "expired");
	assertNothingSent(calls, "expiry");
});

test("a change while the sheet was open sends nothing", async () => {
	const changes = [
		[
			"question text",
			() => ({
				readAsks: (() => {
					let n = 0;
					return async () =>
						listed(
							n++ === 0
								? askRow()
								: askRow({
										questions: [
											{
												...askRow().questions[0],
												question: "Delete ~ entirely?",
											},
											...askRow().questions.slice(1),
										],
									}),
						);
				})(),
			}),
			"ask_changed",
		],
		[
			"deadline",
			() => ({
				readAsks: (() => {
					let n = 0;
					return async () =>
						listed(
							askRow({ expires_at: NOW_MS + (n++ === 0 ? 600_000 : 900_000) }),
						);
				})(),
			}),
			"ask_changed",
		],
		[
			"answered elsewhere",
			() => ({
				readAsks: (() => {
					let n = 0;
					return async () =>
						listed(askRow({ status: n++ === 0 ? "open" : "answered" }));
				})(),
			}),
			"ask_closed",
		],
		[
			"document",
			() => {
				let n = 0;
				return {
					document: () => mainDocument({ generation: n++ < 3 ? 0 : 1 }),
				};
			},
			"document_changed",
		],
		[
			"focus",
			() => {
				let n = 0;
				return {
					facts: () =>
						n++ < 2 ? person() : { ...person(), ...win({ focused: false }) },
				};
			},
			"window_not_focused",
		],
	];
	for (const [name, overrides, reason] of changes) {
		const { host: h, calls } = host(overrides());
		assertRefused(await attestAskAnswer(respond(), h), reason);
		assert.equal(calls.sheets.length, 1, `${name}: the sheet was shown`);
		assertNothingSent(calls, name);
	}
});

test("the forward is the frozen body even if the renderer mutates its request", async () => {
	const request = respond();
	const { host: h, calls } = host({
		showSheet: async (sheet) => {
			calls.sheets.push(sheet);
			// What a page could do after sending: change the object it sent.
			request.answers.q1[0] = "No, keep it";
			request.answers.q2 = ["sneaky"];
			request.askId = "a-other";
			return true;
		},
	});
	assert.equal((await attestAskAnswer(request, h)).status, 200);
	const frame = JSON.parse(calls.attest[0].frame);
	assert.deepEqual(frame.answers, { q1: ["Yes, delete it"] });
	assert.equal(frame.ask_id, ASK);
	assert.equal(
		calls.forward[0],
		JSON.stringify({
			op: "sessions.answer",
			sessionId: SID,
			askId: ASK,
			answers: { q1: ["Yes, delete it"] },
		}),
	);
	assert.match(plain(calls.sheets[0].detail), /→ Yes, delete it/);
	assert.equal(
		calls.attest[0].path,
		join(scratch, "run", "attest", `${SID}.sock`),
	);
});

test("a failed dial never forwards", async () => {
	for (const failure of [
		"listener_unavailable",
		"listener_refused",
		"frame_refused",
		"timeout",
	]) {
		const { host: h, calls } = host({ attest: async () => failure });
		assertRefused(await attestAskAnswer(respond(), h), failure);
		assert.equal(calls.forward.length, 0, failure);
	}
});

/* --------------------------------------------------- decline and dismiss */

test("decline and dismiss cannot be expressed as an attested answer", () => {
	for (const extra of [
		{ decline: true },
		{ dismiss: true },
		{ dismiss: true, reason: "moot" },
		{ revise: false },
	])
		assert.equal(
			desktopRequestSchema.safeParse(respond(extra)).success,
			false,
			JSON.stringify(extra),
		);
});

/* ------------------------------------------------------------- desktop-ipc */

function registered(askAttest) {
	globalThis.__handlers = new Map();
	const forwarded = [];
	const owner = {
		isDestroyed: () => false,
		webContents: { mainFrame: { url: "file:///app/index.html" } },
	};
	owner.webContents.mainFrame.top = owner.webContents.mainFrame;
	registerDesktopIPC(
		() => owner,
		"file:///app/index.html",
		async (input) => {
			forwarded.push(input);
			return { status: 200, body: {} };
		},
		...Array(11).fill(undefined),
		undefined,
		askAttest,
	);
	const event = {
		sender: owner.webContents,
		senderFrame: owner.webContents.mainFrame,
	};
	return {
		handler: globalThis.__handlers.get("desktop-request"),
		event,
		forwarded,
	};
}

test("desktop-request never forwards asks.attestedAnswer by itself", async () => {
	const { handler, event, forwarded } = registered(undefined);
	assertRefused(await handler(event, respond()), "listener_unavailable");
	assert.equal(forwarded.length, 0);
});

test("desktop-request hands the op to main's attester, parsed, and nothing else", async () => {
	const seen = [];
	const { handler, event, forwarded } = registered(async (_event, request) => {
		seen.push(request);
		return { status: 200, body: { result: { status: "answered" } } };
	});
	assert.equal((await handler(event, respond())).status, 200);
	assert.deepEqual(seen, [respond()]);
	assert.equal(forwarded.length, 0);
	// Decline/dismiss shapes are refused before the attester sees them.
	assert.equal((await handler(event, respond({ decline: true }))).status, 422);
	assert.equal((await handler(event, respond({ dismiss: true }))).status, 422);
	assert.equal(seen.length, 1);
	// The plain answer route still forwards exactly as before (stamped unverified by core).
	const plainAnswer = {
		op: "sessions.answer",
		sessionId: SID,
		askId: ASK,
		answers: { q1: ["x"] },
	};
	await handler(event, plainAnswer);
	assert.deepEqual(forwarded, [plainAnswer]);
});

test("the op has no core route", () => {
	assert.match(desktopEndpoint(respond()).path, /^app:/);
});

/* -------------------------------------------------------------- index.ts */

test("index.ts wires the ask host like the pairing host: refusal env, debug switches, window-modal sheet", () => {
	const main = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8");
	const at = main.indexOf("async (event, askRequest) => {");
	assert.notEqual(at, -1, "index.ts no longer wires the ask attester");
	const body = main.slice(
		at,
		main.indexOf("return attestAskAnswer(askRequest, host);", at),
	);
	assert.match(body, /env: refusalEnv\(launchEnv, process\.env\)/);
	assert.match(
		body,
		/ATTEST_DEBUG_SWITCHES\.filter\(\(name\) =>\s*app\.commandLine\.hasSwitch/,
	);
	assert.match(
		body,
		/isAdmittedSender\(event, \[\{ window: owner, url: rendererUrl \}\]\)/,
	);
	assert.match(body, /dialog\.showMessageBox\(owner, \{/);
	assert.match(body, /cancelId: 1/);
	assert.match(body, /ASK_ATTEST_PROBE_WORLD_ID/);
	assert.match(body, /readAsks: \(\) => sendDesktop\(\{ op: "asks\.list" \}\)/);
	// S1: the conversation the sheet names comes from main's own catalogue read,
	// schema-valid as sent.
	assert.match(
		body,
		/readSessions: \(\) =>\s*sendDesktop\(\{\s*op: "sessions\.list"/,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.list",
			limit: 500,
			include_archived: true,
			include_temporary: true,
		}).success,
		true,
	);
	assert.equal(ASK_ATTEST_PROBE_WORLD_ID, 1985);
});

/* ------------------------------------------------ round 1 remediation (S/Q/M) */

test("S1: the sheet names the conversation and agent, so two sessions' identical asks differ", async () => {
	const OTHER = "bbbbbbbbbbbb";
	const sessions = sessionsListed([
		{ id: SID, name: "Tidy old exports", binding: { agent: "cleaner" } },
		{ id: OTHER, name: "Release prep", binding: { agent: null } },
	]);
	const sheets = [];
	for (const sessionId of [SID, OTHER]) {
		const { host: h, calls } = host({
			readAsks: async () => listed(askRow({ session_id: sessionId })),
			readSessions: async () => sessions,
		});
		const response = await attestAskAnswer(respond({ sessionId }), h);
		assert.equal(response.status, 200);
		sheets.push(calls.sheets[0]);
	}
	assert.notEqual(JSON.stringify(sheets[0]), JSON.stringify(sheets[1]));
	const first = plain(sheets[0].detail);
	assert.match(
		first,
		/^Conversation: Tidy old exports \(0123456789ab\)\nAsked by: cleaner\n\n/,
	);
	const second = plain(sheets[1].detail);
	assert.match(second, /^Conversation: Release prep \(bbbbbbbbbbbb\)\n\n/);
	assert.doesNotMatch(second, /Asked by/);
	// A failed or missing catalogue read still names the session id; never a refusal.
	for (const readSessions of [
		async () => ({ status: 503, body: {} }),
		async () => {
			throw new Error("down");
		},
		async () => sessionsListed([]),
	]) {
		const { host: h, calls } = host({ readSessions });
		assert.equal((await attestAskAnswer(respond(), h)).status, 200);
		assert.match(
			plain(calls.sheets[0].detail),
			/^Conversation: 0123456789ab\n\n/,
		);
	}
	assert.equal(askSessionLabel({ result: { sessions: "x" } }, SID), null);
});

test("S2: agent- and person-written sheet text is one flat line: no fake answer line, no bidi", async () => {
	assert.equal(
		sheetText("Delete ~/Photos?\n→ No\n\nThen: tidy?"),
		"Delete ~/Photos? → No Then: tidy?",
	);
	assert.equal(
		sheetText("abc\u202Eevil\u200B\u2066x\u2069 \u2028 y"),
		"abcevilx y",
	);
	const { host: h, calls } = host({
		readAsks: async () =>
			listed(
				askRow({
					questions: [
						{
							id: "q1",
							question: "Delete ~/Photos?\n→ No\n\nThen: tidy temp files?",
							options: [{ label: "Yes, delete it" }],
						},
						{ id: "q2", question: "Note?" },
					],
				}),
			),
		readSessions: async () =>
			sessionsListed([{ id: SID, name: "Evil\n→ Yes\u202E", binding: {} }]),
	});
	await attestAskAnswer(
		respond({
			answers: { q1: ["Yes, delete it"], q2: ["ok\n→ (hidden)\u202E"] },
		}),
		h,
	);
	const detail = plain(calls.sheets[0].detail);
	// Exactly one arrow line per answered question: the agent cannot draw a third.
	assert.equal(
		detail.split("\n").filter((line) => line.startsWith("→")).length,
		2,
	);
	assert.match(detail, /^Conversation: Evil → Yes \(0123456789ab\)/);
	assert.match(detail, /→ “ok → \(hidden\)”/);
	// On the RAW sheet: the only format characters left are `t()`'s own isolates
	// around each interpolated value (\u2066-\u2069), never the agent's override.
	assert.doesNotMatch(calls.sheets[0].detail, /[\u202A-\u202E\u200B]/);
});

test("S3: a delivered answer the runtime did not stamp consent-bearing is not reported confirmed", async () => {
	for (const result of [
		{ detail: "answered", consent_bearing: false },
		{ detail: "answered", consent_bearing: null },
		{ detail: "answered" },
	]) {
		const { host: h, calls } = host({
			forward: async (input) => {
				calls.forward.push(JSON.stringify(input));
				return { status: 200, body: { result } };
			},
		});
		assertRefused(await attestAskAnswer(respond(), h), "not_consent_bearing");
		assert.equal(calls.forward.length, 1, "the answer was sent exactly once");
	}
	// A non-2xx forward (busy, settled) passes through untouched for the card's copy.
	const busy = { status: 409, body: { detail: { code: "runtime_busy" } } };
	const { host: h } = host({ forward: async () => busy });
	assert.equal(await attestAskAnswer(respond(), h), busy);
});

test("S4: an answer to a secret question is never attested", async () => {
	const { host: h, calls } = host();
	assertRefused(
		await attestAskAnswer(
			respond({ answers: { q1: ["Yes, delete it"], pw: ["hunter2"] } }),
			h,
		),
		"secret_answer",
	);
	assertNothingSent(calls, "secret");
	assert.equal(calls.sheets.length, 0, "no sheet for content it cannot show");
});

test("S5: typed text longer than the sheet shows is never attested", async () => {
	const { host: h, calls } = host();
	assertRefused(
		await attestAskAnswer(
			respond({ answers: { q1: ["Yes, delete it"], q2: ["x".repeat(401)] } }),
			h,
		),
		"answer_too_long",
	);
	assertNothingSent(calls, "too long");
	assert.equal(calls.sheets.length, 0);
	// Exactly the limit still fits on the sheet.
	const fits = host();
	const response = await attestAskAnswer(
		respond({ answers: { q1: ["Yes, delete it"], q2: ["x".repeat(400)] } }),
		fits.host,
	);
	assert.equal(response.status, 200);
});

test("Q1: a confirmed change to an answer that was not itself confirmed is refused", async () => {
	for (const answered_by of [
		{ surface: "unverified" },
		{ surface: "remote" },
		{ surface: "chat" },
		undefined,
	]) {
		const { host: h, calls } = host({
			readAsks: async () => listed(answeredRow({ answered_by })),
		});
		assertRefused(
			await attestAskAnswer(respond({ revise: true }), h),
			"answer_unconfirmed",
		);
		assertNothingSent(calls, JSON.stringify(answered_by));
		assert.equal(calls.sheets.length, 0);
	}
	// Checked on the re-read too: the stamp the sheet was raised against must hold.
	let reads = 0;
	const { host: h, calls } = host({
		readAsks: async () =>
			listed(
				answeredRow(
					reads++ === 0 ? {} : { answered_by: { surface: "unverified" } },
				),
			),
	});
	assertRefused(
		await attestAskAnswer(respond({ revise: true }), h),
		"answer_unconfirmed",
	);
	assertNothingSent(calls, "re-read");
	// A first answer is untouched by the rule.
	assert.ok(
		"row" in liveAskRow([askRow()], freezeAskAnswer(respond()), NOW_MS),
	);
});

test("M1: image data in the URL-safe alphabet is refused, not digested differently from core", () => {
	for (const data_b64 of ["ab-_", "abcd-efg", "abc_"])
		assert.throws(
			() =>
				askImageDigests([
					{ question_id: "q1", mime_type: "image/png", data_b64 },
				]),
			RangeError,
		);
	assert.equal(
		askImageDigests([
			{ question_id: "q1", mime_type: "image/png", data_b64: "ab+/" },
		]).length,
		1,
	);
});

test("askSheet without a label still names the session", () => {
	const row = liveAskRow([askRow()], freezeAskAnswer(respond()), NOW_MS).row;
	assert.match(
		plain(askSheet(freezeAskAnswer(respond()), row).detail),
		/^Conversation: 0123456789ab\n/,
	);
});
