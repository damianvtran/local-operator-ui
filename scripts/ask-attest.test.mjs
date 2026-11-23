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
	attestAskAnswer,
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
		showSheet: async (sheet) => {
			calls.sheets.push(sheet);
			return true;
		},
		sheet: new AskSheetLock(),
		configDir: () => scratch,
		forward: async (input) => {
			calls.forward.push(JSON.stringify(input));
			return { status: 200, body: { result: { status: "answered" } } };
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
				pw: ["hunter2"],
			},
		}),
		h,
	);
	const [sheet] = calls.sheets;
	const detail = plain(sheet.detail);
	assert.match(detail, /Delete ~\/workspace\/old-exports\?\n→ Yes, delete it/);
	assert.match(detail, /Anything else\?\n→ “only the csv files”/);
	assert.match(detail, /Paste the token\n→ \(hidden\)/);
	assert.doesNotMatch(detail, /hunter2/);
	assert.equal(plain(sheet.message), "Send this answer as yours?");
	assert.equal(sheet.actionLabel, "Confirm");
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
		readAsks: async () => listed(askRow({ status: "answered" })),
	});
	const response = await attestAskAnswer(respond({ revise: true }), ok.host);
	assert.equal(response.status, 200);
	assert.equal(
		plain(ok.calls.sheets[0].message),
		"Change your answer to this?",
	);
	assert.equal(JSON.parse(ok.calls.attest[0].frame).act, "revise");
	const delivered = host({
		readAsks: async () =>
			listed(askRow({ status: "answered", delivered: true })),
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
	assert.equal(ASK_ATTEST_PROBE_WORLD_ID, 1985);
});
