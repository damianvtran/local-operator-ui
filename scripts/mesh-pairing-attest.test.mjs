import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * MESH PAIRING ATTESTATION - main's half (`src/main/mesh-pairing-attest.ts`,
 * core PR #4259 `network/pairing_attest.py`). What this guards:
 *
 *  - THE CLICK-PROVENANCE GATE refuses, with NO dial and NO forward, every launch a
 *    person is not driving: CDP/remote debugging (argv or a runtime-appended
 *    switch), `--inspect`, any `--lo-*` switch, the agent launch marker, the dev
 *    driver / smoke-test env, a headless or inactive window mode, no window, a
 *    hidden/minimised/unfocused window, DevTools open, a debugger attached, a dev
 *    (unpackaged) build, a non-macOS host, and a renderer without transient user
 *    activation (read in an isolated world, timer cleared - F2/F3).
 *  - THE ONE-SHOT CONFIRMATION (security review round 1, US-R1-1): an answer with
 *    no token, a replayed token, a token for another card / act / nonce / side, a
 *    token from another frame, document generation or window, an expired token,
 *    and a sender document that changed between consume and dial are all refused
 *    with NO dial and NO forward; a refused attempt burns the token.
 *  - THE NATIVE SHEET (security review round 2, US-R2-1): page activation alone
 *    mints nothing; Cancel/dismissal/a failing sheet send nothing; every label
 *    comes from main's own read (the contract refuses renderer labels); a confirm
 *    main's read cannot back raises no sheet; never two sheets; expiry, a nonce,
 *    document, wording or focus change while the sheet is open mints nothing;
 *    an answer whose code or shares differ from the approved one is refused and
 *    burns the token; the approved answer succeeds exactly once; the card is
 *    re-read right before the dial. The sheet is a typed double: main's
 *    `dialog.showMessageBox` itself is native and is exercised on the Mac lane.
 *  - STATIC ELIGIBILITY (`pairings.eligibility`, design D1 / UX U1) reports the
 *    launch half of the gate only, so the card can disable itself up front.
 *  - ATTEST-THEN-FORWARD with ONE object: the forwarded body is byte-for-byte the
 *    attested answer (sorted shares, decline carries no code, main's own deadline
 *    clamped to the card's expiry), so core's consume matches.
 *  - THE DIAL speaks core's newline-JSON protocol and fails closed: a refused
 *    greeting, a refused frame, a missing socket, garbage and a silent listener
 *    are all refusals.
 *  - `desktop-ipc.ts` never forwards `pairings.answer` on its own.
 *
 * Typed doubles only: no Electron, no window, no backend.
 */

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/main/mesh-pairing-attest";
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
const bundlePath = new URL(
	`./_mesh-pairing-attest-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
globalThis.__handlers = new Map();
const {
	answerMeshPairing,
	confirmMeshPairing,
	meshPairingEligibility,
	pairingStaticRefusal,
	MeshPairingConfirmations,
	MESH_PAIRING_CONFIRMATION_TTL_MS,
	MESH_PAIRING_PROBE_WORLD_ID,
	attestMeshPairing,
	meshPairingFrame,
	meshPairingSocketPath,
	pairingProvenanceRefusal,
	MESH_PAIRING_DEADLINE_S,
	MESH_PAIRING_ATTEST_REFUSED,
	registerDesktopIPC,
	desktopEndpoint,
	desktopRequestSchema,
} = await import(bundlePath.href);
await unlink(bundlePath);

const scratch = mkdtempSync(join(tmpdir(), "lo-pairing-attest-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * What the card does: `pairings.confirm` for this exact act, then the answer
 * carrying the token main minted. Every answer test below goes through it.
 */
async function confirmed(request, h) {
	const minted = await confirmMeshPairing(confirmOf(request), h);
	assert.equal(minted.status, 200, JSON.stringify(minted.body));
	return answerMeshPairing(
		{ ...request, confirmation: minted.body.result.confirmation },
		h,
	);
}

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

const NOW_MS = 1_763_500_000_000;
const NOW_S = NOW_MS / 1000;

/**
 * The `pairings.confirm` request the card sends before `answer`: the SAME exact
 * answer (security review round 2, US-R2-1) - act, code and shares.
 */
const confirmOf = (answer) => ({
	op: "pairings.confirm",
	side: answer.side,
	inviteId: answer.inviteId,
	nonce: answer.nonce,
	decision: answer.decision,
	code: answer.code,
	...(answer.shares !== undefined ? { shares: answer.shares } : {}),
});

/** Core's open inviter card for `inviterAdmit()`, as `GET /mesh/pairings` lists it. */
const inviterRow = (over = {}) => ({
	id: "inviter:inv_abc123",
	side: "inviter",
	stage: "awaiting_confirmation",
	invite_id: "inv_abc123",
	network_id: "net_home",
	network_name: "Home mesh",
	peer_device_id: "dev_studio",
	peer_name: "Studio Mac",
	role: "drive",
	code: "481926",
	fingerprint: "SHA256:ab12cd",
	offers: {
		state: "listed",
		items: [
			{ key: "openai", label: "OpenAI key", kind: "secret", share: true },
			{ key: "anthropic", label: "Anthropic key", kind: "secret", share: true },
			{ key: "github", label: "GitHub token", kind: "secret", share: false },
		],
	},
	expires_at: NOW_S + 600,
	attempts_left: 3,
	nonce: "n0nce.1",
	can_answer_here: true,
	answer_unavailable: null,
	...over,
});

/** Core's open joiner card for the joiner requests below. */
const joinerRow = (over = {}) => ({
	...inviterRow(),
	id: "joiner:inv_j",
	side: "joiner",
	stage: "awaiting_confirmation",
	invite_id: "inv_j",
	nonce: "n2",
	role: "",
	...over,
});

/** The list envelope main's own `pairings.list` read answers with. */
const listed = (...pairings) => ({
	status: 200,
	body: { result: { pairings } },
});

/** Bidi isolates (`messages.ts` isolateArguments) stripped, for text asserts. */
const plain = (text) => text.replace(/[\u2066-\u2069]/g, "");

const inviterAdmit = (extra = {}) => ({
	op: "pairings.answer",
	side: "inviter",
	inviteId: "inv_abc123",
	nonce: "n0nce.1",
	decision: "admit",
	code: "481926",
	shares: ["openai", "anthropic"],
	deadline: NOW_S + 400,
	...extra,
});

/** The sending document as main reads it off the IPC event. */
const mainDocument = (over = {}) => ({
	webContentsId: 7,
	processId: 41,
	frameToken: "frame-token-a",
	generation: 0,
	...over,
});

/** A host double recording every dial and forward. */
function host(overrides = {}) {
	const calls = {
		attest: [],
		forward: [],
		activation: 0,
		sheets: [],
		reads: 0,
	};
	const clock = { ms: NOW_MS };
	return {
		calls,
		clock,
		host: {
			facts: person,
			document: () => mainDocument(),
			confirmations: new MeshPairingConfirmations({ nowMs: () => clock.ms }),
			userActivation: async () => {
				calls.activation += 1;
				return true;
			},
			// Main's own read: both cards open, unchanged, unless a test says otherwise.
			readPairings: async () => {
				calls.reads += 1;
				return listed(inviterRow(), joinerRow());
			},
			// The person presses the sheet's action button unless a test says otherwise.
			showSheet: async (sheet, signal) => {
				calls.sheets.push({ sheet, signal });
				return true;
			},
			configDir: () => "/cfg",
			forward: async (input) => {
				calls.forward.push(input);
				return {
					status: 200,
					body: { result: { status: "sent", attempts_left: 3 } },
				};
			},
			nowMs: () => NOW_MS,
			attest: async (path, frame) => {
				calls.attest.push({ path, frame });
				return null;
			},
			...overrides,
		},
	};
}

test("a launch a person drives passes the gate", () => {
	assert.equal(pairingProvenanceRefusal(person()), null);
});

const refusals = [
	["not macOS", { platform: "linux" }, "not_macos"],
	["an unpackaged dev build", { packaged: false }, "not_packaged"],
	[
		"--remote-debugging-port (CDP)",
		{ argv: ["app", "--remote-debugging-port=9222"] },
		"remote_debugging",
	],
	[
		"--remote-debugging-pipe",
		{ argv: ["app", "--remote-debugging-pipe"] },
		"remote_debugging",
	],
	["--inspect", { argv: ["app", "--inspect"] }, "remote_debugging"],
	["the dev driver switch", { argv: ["app", "--lo-dev-driver"] }, "dev_flag"],
	[
		"the launch probe switch",
		{ argv: ["app", "--lo-launch-probe"] },
		"dev_flag",
	],
	[
		"the agent launch marker",
		{ argv: ["app", "--user-data-dir=/tmp/x"] },
		"dev_flag",
	],
	[
		"the dev driver env",
		{ env: { LOCAL_OPERATOR_UI_DEV_DRIVER: "1" } },
		"dev_flag",
	],
	[
		"a dev driver sub-env",
		{ env: { LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT: "/x.mjs" } },
		"dev_flag",
	],
	[
		"the smoke test env",
		{ env: { LOCAL_OPERATOR_UI_SMOKE_TEST: "1" } },
		"dev_flag",
	],
	["a headless window mode", { windowMode: "headless" }, "window_mode"],
	["an inactive window mode", { windowMode: "inactive" }, "window_mode"],
	["no admitted window", { window: null }, "no_window"],
];
for (const [name, patch, reason] of refusals) {
	test(`the gate refuses ${name}`, () => {
		assert.equal(pairingProvenanceRefusal({ ...person(), ...patch }), reason);
	});
}
const windowRefusals = [
	["an unfocused window", { focused: false }, "window_not_focused"],
	["a hidden window", { visible: false }, "window_not_visible"],
	["a minimised window", { minimized: true }, "window_not_visible"],
	["DevTools open", { devToolsOpened: true }, "devtools_open"],
	[
		"a debugger session attached",
		{ debuggerAttached: true },
		"debugger_attached",
	],
];
for (const [name, patch, reason] of windowRefusals) {
	test(`the gate refuses ${name}`, () => {
		const facts = person();
		assert.equal(
			pairingProvenanceRefusal({
				...facts,
				window: { ...facts.window, ...patch },
			}),
			reason,
		);
	});
}

test("an empty dev-driver env var is not a driver (unset in a parent shell)", () => {
	assert.equal(
		pairingProvenanceRefusal({
			...person(),
			env: { LOCAL_OPERATOR_UI_DEV_DRIVER: "" },
		}),
		null,
	);
});

test("every gate refusal answers 403 and neither dials nor forwards", async () => {
	for (const [, patch, reason] of refusals) {
		const { host: h, calls } = host({
			facts: () => ({ ...person(), ...patch }),
		});
		const response = await answerMeshPairing(inviterAdmit(), h);
		assert.equal(response.status, 403);
		assert.equal(response.body.detail.code, MESH_PAIRING_ATTEST_REFUSED);
		assert.equal(response.body.detail.reason, reason);
		assert.equal(calls.attest.length, 0, `${reason}: no dial`);
		assert.equal(calls.forward.length, 0, `${reason}: no forward`);
		assert.equal(calls.activation, 0, `${reason}: the page is not even asked`);
	}
});

test("no transient user activation: no token is minted, so nothing can answer", async () => {
	const { host: h, calls } = host({ userActivation: async () => false });
	const response = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
	assert.equal(response.status, 403);
	assert.equal(response.body.detail.reason, "no_user_action");
	assert.equal(h.confirmations.size, 0);
	assert.deepEqual([calls.attest.length, calls.forward.length], [0, 0]);
});

test("a renderer that never answers the activation question is refused, not awaited", async () => {
	const { host: h, calls } = host({
		userActivation: () => new Promise(() => {}),
	});
	const started = Date.now();
	const response = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
	assert.equal(response.body.detail.reason, "no_user_action");
	assert.ok(Date.now() - started < 3_000);
	assert.equal(calls.attest.length, 0);
	assert.equal(h.confirmations.size, 0);
});

test("focus lost while the page answered: re-read, refused", async () => {
	let reads = 0;
	const { host: h, calls } = host({
		facts: () => {
			reads += 1;
			const facts = person();
			return reads === 1
				? facts
				: { ...facts, window: { ...facts.window, focused: false } };
		},
	});
	const response = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
	assert.equal(response.body.detail.reason, "window_not_focused");
	assert.equal(calls.attest.length, 0);
	assert.equal(h.confirmations.size, 0);
});

test("attest then forward ONE object: the frame names exactly the forwarded body", async () => {
	const { host: h, calls } = host();
	const response = await confirmed(
		inviterAdmit({ deadline: 9_999_999_999 }),
		h,
	);
	assert.equal(response.status, 200);
	assert.equal(calls.attest.length, 1);
	assert.equal(calls.forward.length, 1);
	const [{ path, frame }] = calls.attest;
	const forwarded = calls.forward[0];
	assert.equal(path, "/cfg/run/attest/mesh-pairing.sock");
	// The renderer's far-future deadline is only a ceiling: main sets its own.
	assert.equal(forwarded.deadline, NOW_S + MESH_PAIRING_DEADLINE_S);
	assert.deepEqual(frame, {
		op: "mesh_pairing_attest",
		side: "inviter",
		invite_id: "inv_abc123",
		nonce: "n0nce.1",
		act: "respond",
		code: "481926",
		shares: ["anthropic", "openai"],
		deadline: NOW_S + MESH_PAIRING_DEADLINE_S,
	});
	// The POST core receives binds the same content core's consume rebuilds.
	assert.ok(desktopRequestSchema.safeParse(forwarded).success);
	const endpoint = desktopEndpoint(forwarded);
	assert.equal(
		endpoint.path,
		"/v1/desktop/mesh/pairings/inviter/inv_abc123/answer",
	);
	assert.equal(endpoint.method, "POST");
	assert.deepEqual(endpoint.body, {
		decision: "admit",
		code: frame.code,
		nonce: frame.nonce,
		deadline: frame.deadline,
		shares: frame.shares,
	});
});

test("a card closer than the deadline window uses its own expiry; a lapsed one is refused", async () => {
	const soon = host();
	await confirmed(inviterAdmit({ deadline: NOW_S + 5 }), soon.host);
	assert.equal(soon.calls.forward[0].deadline, NOW_S + 5);
	const lapsed = host();
	const response = await confirmed(
		inviterAdmit({ deadline: NOW_S }),
		lapsed.host,
	);
	assert.equal(response.body.detail.reason, "expired");
	assert.equal(lapsed.calls.attest.length, 0);
});

test("a decline binds no code; a joiner answer carries no share list", async () => {
	const { host: h, calls } = host();
	await confirmed(
		{
			op: "pairings.answer",
			side: "joiner",
			inviteId: "inv_j",
			nonce: "n2",
			decision: "decline",
			code: "",
			deadline: NOW_S + 100,
		},
		h,
	);
	assert.equal(calls.attest[0].frame.act, "decline");
	assert.equal(calls.attest[0].frame.code, "");
	assert.deepEqual(calls.attest[0].frame.shares, []);
	assert.equal("shares" in calls.forward[0], false);
	assert.equal("shares" in desktopEndpoint(calls.forward[0]).body, false);
});

test("an inviter with no share list sends an explicit empty list (never omitted)", async () => {
	const { host: h, calls } = host();
	await confirmed(inviterAdmit({ shares: undefined }), h);
	assert.deepEqual(calls.forward[0].shares, []);
	assert.deepEqual(desktopEndpoint(calls.forward[0]).body.shares, []);
});

test("a failed attestation is a 403 and forwards nothing", async () => {
	const { host: h, calls } = host({ attest: async () => "frame_refused" });
	const response = await confirmed(inviterAdmit(), h);
	assert.equal(response.status, 403);
	assert.equal(response.body.detail.reason, "frame_refused");
	assert.equal(calls.forward.length, 0);
});

test("the schema refuses an admit without six digits and a decline carrying digits", () => {
	const base = inviterAdmit();
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, code: "" }).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, code: "12345" }).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, decision: "decline" }).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, inviteId: "../x" }).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, extra: 1 }).success,
		false,
	);
});

/* ------------------------------------------- the one-shot confirmation */

/** Mint a token for `request`'s act on host `h`; returns it. */
async function mint(request, h) {
	const minted = await confirmMeshPairing(confirmOf(request), h);
	assert.equal(minted.status, 200);
	return minted.body.result.confirmation;
}

/** An answer refused for `reason` that neither dialled nor forwarded. */
function assertRefused(response, calls, reason) {
	assert.equal(response.status, 403);
	assert.equal(response.body.detail.code, MESH_PAIRING_ATTEST_REFUSED);
	assert.equal(response.body.detail.reason, reason);
	assert.deepEqual([calls.attest.length, calls.forward.length], [0, 0]);
}

test("a minted token is 32 random bytes, never the same twice, one per window", async () => {
	const { host: h } = host();
	const first = await mint(inviterAdmit(), h);
	const second = await mint(inviterAdmit(), h);
	assert.match(first, /^[0-9a-f]{64}$/);
	assert.notEqual(first, second);
	// The second mint REPLACED the first: the store stays bounded per window.
	assert.equal(h.confirmations.size, 1);
	assert.ok(desktopRequestSchema.safeParse(confirmOf(inviterAdmit())).success);
});

test("an answer with no confirmation is refused before any dial", async () => {
	const { host: h, calls } = host();
	assertRefused(
		await answerMeshPairing(inviterAdmit(), h),
		calls,
		"no_confirmation",
	);
});

test("a token is good for ONE answer: the replay finds nothing", async () => {
	const { host: h, calls } = host();
	const token = await mint(inviterAdmit(), h);
	const first = await answerMeshPairing(
		inviterAdmit({ confirmation: token }),
		h,
	);
	assert.equal(first.status, 200);
	const replay = await answerMeshPairing(
		inviterAdmit({ confirmation: token }),
		h,
	);
	assert.equal(replay.body.detail.reason, "no_confirmation");
	assert.deepEqual([calls.attest.length, calls.forward.length], [1, 1]);
});

test("a token minted for one card action cannot answer another (and is burnt trying)", async () => {
	const other = [
		["another act (decline)", { decision: "decline", code: "" }],
		["another invite", { inviteId: "inv_other" }],
		["another stage nonce", { nonce: "n0nce.2" }],
		[
			"another side",
			{ side: "joiner", shares: undefined, inviteId: "inv_abc123" },
		],
	];
	for (const [name, patch] of other) {
		const { host: h, calls } = host();
		const token = await mint(inviterAdmit(), h);
		const response = await answerMeshPairing(
			inviterAdmit({ ...patch, confirmation: token }),
			h,
		);
		assertRefused(response, calls, "confirmation_mismatch");
		// Burnt: the RIGHT answer with the same token is refused too.
		const retry = await answerMeshPairing(
			inviterAdmit({ confirmation: token }),
			h,
		);
		assert.equal(retry.body.detail.reason, "no_confirmation", name);
		assert.equal(calls.forward.length, 0, name);
	}
});

test("a token is bound to its document: another frame, generation or window is refused", async () => {
	const moved = [
		["another frame token", { frameToken: "frame-token-b" }],
		["another renderer process", { processId: 42 }],
		["a navigated document (generation bumped)", { generation: 1 }],
	];
	for (const [name, patch] of moved) {
		let document = mainDocument();
		const { host: h, calls } = host({ document: () => document });
		const token = await mint(inviterAdmit(), h);
		document = mainDocument(patch);
		const response = await answerMeshPairing(
			inviterAdmit({ confirmation: token }),
			h,
		);
		assert.equal(response.body.detail.reason, "confirmation_mismatch", name);
		assert.deepEqual([calls.attest.length, calls.forward.length], [0, 0]);
	}
	// Another WINDOW holds no token of its own at all.
	let document = mainDocument();
	const { host: h, calls } = host({ document: () => document });
	const token = await mint(inviterAdmit(), h);
	document = mainDocument({ webContentsId: 8 });
	assertRefused(
		await answerMeshPairing(inviterAdmit({ confirmation: token }), h),
		calls,
		"no_confirmation",
	);
	// A sender main does not admit (no document) cannot confirm or answer.
	const none = host({ document: () => null });
	assertRefused(
		await confirmMeshPairing(confirmOf(inviterAdmit()), none.host),
		none.calls,
		"no_window",
	);
});

test("a token older than the activation lifespan is refused", async () => {
	const { host: h, calls, clock } = host();
	const token = await mint(inviterAdmit(), h);
	clock.ms += MESH_PAIRING_CONFIRMATION_TTL_MS;
	assertRefused(
		await answerMeshPairing(inviterAdmit({ confirmation: token }), h),
		calls,
		"no_confirmation",
	);
});

test("sender document and focus are re-read immediately before the dial", async () => {
	// The document changes AFTER the token was consumed and checked.
	let reads = 0;
	const flip = host({
		document: () => {
			reads += 1;
			// confirm reads three times (before/after activation, after the
			// sheet), answer's binding once; the 5th is pre-dial.
			return mainDocument(reads >= 5 ? { generation: 1 } : {});
		},
	});
	const token = await mint(inviterAdmit(), flip.host);
	assertRefused(
		await answerMeshPairing(inviterAdmit({ confirmation: token }), flip.host),
		flip.calls,
		"confirmation_mismatch",
	);
	// Focus lost between the gate and the dial.
	let factReads = 0;
	const blur = host({
		facts: () => {
			factReads += 1;
			const facts = person();
			// confirm: 3 reads (gate, late, after the sheet); answer: gate then pre-dial.
			return factReads >= 5
				? { ...facts, window: { ...facts.window, focused: false } }
				: facts;
		},
	});
	const blurToken = await mint(inviterAdmit(), blur.host);
	assertRefused(
		await answerMeshPairing(
			inviterAdmit({ confirmation: blurToken }),
			blur.host,
		),
		blur.calls,
		"window_not_focused",
	);
});

test("the activation read leaves no timer behind (code review F3)", async () => {
	const timers = () =>
		process.getActiveResourcesInfo().filter((kind) => kind === "Timeout")
			.length;
	const before = timers();
	const { host: h } = host();
	await mint(inviterAdmit(), h);
	assert.equal(timers(), before);
});

/* ------------------------- the native sheet (security review round 2, US-R2-1) */

test("page activation alone mints nothing: without the sheet's own button there is no token", async () => {
	// The page reports activation (any click or key press on it would), but the
	// person never pressed the native action button: the sheet was dismissed.
	const { host: h, calls } = host({
		showSheet: async (sheet) => {
			calls.sheets.push({ sheet });
			return false;
		},
	});
	const response = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
	assert.equal(calls.activation, 1, "activation was there - and is not enough");
	assert.equal(calls.sheets.length, 1);
	assert.equal(response.status, 200);
	assert.deepEqual(response.body.result, {
		confirmation: null,
		cancelled: true,
	});
	assert.equal(h.confirmations.size, 0);
	assertRefused(
		await answerMeshPairing(inviterAdmit(), h),
		calls,
		"no_confirmation",
	);
});

test("cancel sends nothing: no token, no dial, no forward, and the sheet is released", async () => {
	const { host: h, calls } = host({ showSheet: async () => false });
	const response = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
	assert.equal(response.body.result.cancelled, true);
	assert.equal(h.confirmations.size, 0);
	assert.equal(h.confirmations.sheetOpen, false);
	assert.deepEqual([calls.attest.length, calls.forward.length], [0, 0]);
	// A sheet that throws (window gone mid-sheet) is a cancel too, never a yes.
	const thrown = host({
		showSheet: async () => {
			throw new Error("window destroyed");
		},
	});
	const failed = await confirmMeshPairing(
		confirmOf(inviterAdmit()),
		thrown.host,
	);
	assert.equal(failed.body.result.cancelled, true);
	assert.equal(thrown.host.confirmations.size, 0);
});

test("a changed code or share list after the sheet is refused, and burns the token", async () => {
	const changed = [
		["another code", { code: "111111" }],
		["one share dropped", { shares: ["openai"] }],
		["a share added", { shares: ["openai", "anthropic", "github"] }],
		["no share list", { shares: undefined }],
		["a decline instead", { decision: "decline", code: "", shares: [] }],
	];
	for (const [name, patch] of changed) {
		const { host: h, calls } = host();
		const token = await mint(inviterAdmit(), h);
		assertRefused(
			await answerMeshPairing(
				inviterAdmit({ ...patch, confirmation: token }),
				h,
			),
			calls,
			"confirmation_mismatch",
		);
		// Burnt: the approved answer with the same token now finds nothing.
		const retry = await answerMeshPairing(
			inviterAdmit({ confirmation: token }),
			h,
		);
		assert.equal(retry.body.detail.reason, "no_confirmation", name);
		assert.equal(calls.forward.length, 0, name);
	}
});

test("the approved answer succeeds exactly once, forwarding the frozen answer", async () => {
	const { host: h, calls } = host();
	const token = await mint(inviterAdmit(), h);
	// The same SET of shares in another order is the same canonical answer.
	const first = await answerMeshPairing(
		inviterAdmit({ shares: ["anthropic", "openai"], confirmation: token }),
		h,
	);
	assert.equal(first.status, 200);
	assert.equal(calls.sheets.length, 1);
	assert.equal(calls.forward.length, 1);
	assert.deepEqual(
		{
			side: calls.forward[0].side,
			inviteId: calls.forward[0].inviteId,
			nonce: calls.forward[0].nonce,
			decision: calls.forward[0].decision,
			code: calls.forward[0].code,
			shares: calls.forward[0].shares,
		},
		{
			side: "inviter",
			inviteId: "inv_abc123",
			nonce: "n0nce.1",
			decision: "admit",
			code: "481926",
			shares: ["anthropic", "openai"],
		},
	);
	const again = await answerMeshPairing(
		inviterAdmit({ confirmation: token }),
		h,
	);
	assertRefused(again, { attest: [], forward: [] }, "no_confirmation");
	assert.equal(calls.forward.length, 1);
	assert.equal(calls.attest.length, 1);
});

test("every sheet label comes from main's own read, never from the renderer", async () => {
	const { host: h, calls } = host();
	await mint(inviterAdmit(), h);
	const [{ sheet }] = calls.sheets;
	assert.equal(plain(sheet.message), "Admit Studio Mac to Home mesh?");
	assert.deepEqual(plain(sheet.detail).split("\n"), [
		"Device: Studio Mac (SHA256:ab12cd)",
		"Role: drive",
		"Code: 481 926",
		"This device will share with Studio Mac: Anthropic key, OpenAI key",
	]);
	assert.equal(sheet.actionLabel, "Admit");
	assert.equal(sheet.cancelLabel, "Cancel");
	// The renderer CANNOT send a label: the contract is strict.
	for (const extra of [
		{ peerName: "Trusted Laptop" },
		{ networkName: "Work" },
		{ labels: { openai: "nothing" } },
	])
		assert.equal(
			desktopRequestSchema.safeParse({ ...confirmOf(inviterAdmit()), ...extra })
				.success,
			false,
		);
	// The joiner names what the PEER shares with it; a decline shares nothing.
	const joiner = host();
	await mint(
		{
			op: "pairings.answer",
			side: "joiner",
			inviteId: "inv_j",
			nonce: "n2",
			decision: "admit",
			code: "481926",
		},
		joiner.host,
	);
	const joinerSheet = joiner.calls.sheets[0].sheet;
	assert.equal(plain(joinerSheet.message), "Join Home mesh from Studio Mac?");
	assert.equal(joinerSheet.actionLabel, "Join");
	assert.ok(
		plain(joinerSheet.detail).includes(
			"Studio Mac will share with this device: OpenAI key, Anthropic key",
		),
	);
	assert.ok(!plain(joinerSheet.detail).includes("Role:"));
	const decline = host();
	await mint(
		inviterAdmit({ decision: "decline", code: "", shares: [] }),
		decline.host,
	);
	const declineSheet = decline.calls.sheets[0].sheet;
	assert.equal(declineSheet.actionLabel, "Decline");
	assert.ok(plain(declineSheet.detail).endsWith("Nothing will be shared."));
	assert.ok(!plain(declineSheet.detail).includes("Code:"));
});

test("a confirm main's read cannot back shows no sheet at all", async () => {
	const cases = [
		[
			"a share core does not offer",
			inviterAdmit({ shares: ["openai", "aws"] }),
			listed(inviterRow()),
			"pairing_changed",
		],
		[
			"a share core offers as not shared",
			inviterAdmit({ shares: ["github"] }),
			listed(inviterRow()),
			"pairing_changed",
		],
		[
			"another stage's nonce",
			inviterAdmit(),
			listed(inviterRow({ nonce: "n0nce.2" })),
			"pairing_changed",
		],
		[
			"a card core says is not answerable",
			inviterAdmit(),
			listed(inviterRow({ can_answer_here: false })),
			"pairing_changed",
		],
		["no such card", inviterAdmit(), listed(joinerRow()), "pairing_closed"],
		[
			"an expired card",
			inviterAdmit(),
			listed(inviterRow({ expires_at: NOW_S - 1 })),
			"expired",
		],
		[
			"a failed read",
			inviterAdmit(),
			{ status: 503, body: { detail: "down" } },
			"pairing_read_failed",
		],
	];
	for (const [name, request, read, reason] of cases) {
		const { host: h, calls } = host({ readPairings: async () => read });
		const response = await confirmMeshPairing(confirmOf(request), h);
		assert.equal(response.body.detail?.reason, reason, name);
		assert.equal(calls.sheets.length, 0, `${name}: no sheet`);
		assert.equal(h.confirmations.size, 0, name);
		assert.equal(h.confirmations.sheetOpen, false, name);
	}
});

test("never two sheets: a confirm while one is open is refused and raises none", async () => {
	let release;
	const { host: h, calls } = host({
		showSheet: (sheet) => {
			calls.sheets.push({ sheet });
			return new Promise((resolve) => {
				release = resolve;
			});
		},
	});
	const first = confirmMeshPairing(confirmOf(inviterAdmit()), h);
	// Let the first reach its sheet.
	while (calls.sheets.length === 0) await new Promise((r) => setImmediate(r));
	const second = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
	assert.equal(second.body.detail.reason, "sheet_open");
	assert.equal(calls.sheets.length, 1);
	release(true);
	assert.equal((await first).status, 200);
	assert.equal(h.confirmations.sheetOpen, false);
	assert.equal(h.confirmations.size, 1);
});

test("expiry while the sheet is open: the sheet closes itself and nothing is minted", async () => {
	// The card has 50 ms left; the person never answers - the expiry aborts it.
	const { host: h, calls } = host({
		readPairings: async () => listed(inviterRow({ expires_at: NOW_S + 0.05 })),
		showSheet: (sheet, signal) => {
			calls.sheets.push({ sheet, signal });
			return new Promise((resolve) => {
				signal.addEventListener("abort", () => resolve(false));
			});
		},
	});
	const response = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
	assert.equal(response.body.detail.reason, "expired");
	assert.equal(calls.sheets[0].signal.aborted, true);
	assert.equal(h.confirmations.size, 0);
	// Approved, but the clock passed the card's expiry while the sheet was up.
	const clock = { ms: NOW_MS };
	const late = host({
		nowMs: () => clock.ms,
		showSheet: async () => {
			clock.ms += 601_000;
			return true;
		},
	});
	const lateResponse = await confirmMeshPairing(
		confirmOf(inviterAdmit()),
		late.host,
	);
	assert.equal(lateResponse.body.detail.reason, "expired");
	assert.equal(late.host.confirmations.size, 0);
});

test("a nonce, document or wording change while the sheet is open invalidates the approval", async () => {
	const changes = [
		["a new stage nonce", { nonce: "n0nce.2" }, "pairing_changed"],
		["the card closed", null, "pairing_closed"],
		["the peer renamed", { peer_name: "Someone Else" }, "pairing_changed"],
		[
			"a share label changed",
			{
				offers: {
					state: "listed",
					items: [
						{ key: "openai", label: "Everything", share: true },
						{ key: "anthropic", label: "Anthropic key", share: true },
					],
				},
			},
			"pairing_changed",
		],
		["the expiry moved", { expires_at: NOW_S + 900 }, "pairing_changed"],
	];
	for (const [name, patch, reason] of changes) {
		let reads = 0;
		const { host: h, calls } = host({
			readPairings: async () => {
				reads += 1;
				if (reads === 1) return listed(inviterRow());
				return patch === null ? listed() : listed(inviterRow(patch));
			},
		});
		const response = await confirmMeshPairing(confirmOf(inviterAdmit()), h);
		assert.equal(response.body.detail?.reason, reason, name);
		assert.equal(calls.sheets.length, 1, name);
		assert.equal(h.confirmations.size, 0, name);
	}
	// The page navigated (document generation bumped) while the sheet was up.
	let generation = 0;
	const moved = host({
		document: () => mainDocument({ generation }),
		showSheet: async () => {
			generation = 1;
			return true;
		},
	});
	const response = await confirmMeshPairing(
		confirmOf(inviterAdmit()),
		moved.host,
	);
	assert.equal(response.body.detail.reason, "confirmation_mismatch");
	assert.equal(moved.host.confirmations.size, 0);
	// Focus did not come back to the window after the sheet: refused, no token.
	let sheetDone = false;
	const blurred = host({
		facts: () => {
			const facts = person();
			return sheetDone
				? { ...facts, window: { ...facts.window, focused: false } }
				: facts;
		},
		showSheet: async () => {
			sheetDone = true;
			return true;
		},
	});
	const blurredResponse = await confirmMeshPairing(
		confirmOf(inviterAdmit()),
		blurred.host,
	);
	assert.equal(blurredResponse.body.detail.reason, "window_not_focused");
	assert.equal(blurred.host.confirmations.size, 0);
});

test("the card is re-read right before the dial: a card that closed after the sheet is not dialled", async () => {
	let reads = 0;
	const { host: h, calls } = host({
		readPairings: async () => {
			reads += 1;
			// confirm reads twice (before and after the sheet); the 3rd is pre-dial.
			return reads >= 3 ? listed() : listed(inviterRow());
		},
	});
	const token = await mint(inviterAdmit(), h);
	assertRefused(
		await answerMeshPairing(inviterAdmit({ confirmation: token }), h),
		calls,
		"pairing_closed",
	);
	// The answer's deadline is capped at the expiry main read, not the renderer's hint.
	const soon = host({
		readPairings: async () => listed(inviterRow({ expires_at: NOW_S + 7 })),
	});
	await confirmed(inviterAdmit({ deadline: NOW_S + 9_999 }), soon.host);
	assert.equal(soon.calls.forward[0].deadline, NOW_S + 7);
});

test("the activation is read in a world of its own, not the page's or the preload's", () => {
	// 0 is the page's main world (a script can redefine the getter there); 999 is
	// Electron's contextIsolation world, which holds the bridge.
	assert.ok(Number.isInteger(MESH_PAIRING_PROBE_WORLD_ID));
	assert.notEqual(MESH_PAIRING_PROBE_WORLD_ID, 0);
	assert.notEqual(MESH_PAIRING_PROBE_WORLD_ID, 999);
});

/* ------------------------------------------------- static eligibility */

test("eligibility reports the launch half of the gate only", () => {
	const eligible = meshPairingEligibility(person());
	assert.deepEqual(eligible, {
		status: 200,
		body: { result: { eligible: true, reason: null } },
	});
	for (const [patch, reason] of [
		[{ platform: "linux" }, "not_macos"],
		[{ packaged: false }, "not_packaged"],
		[{ argv: ["app", "--remote-debugging-port=9222"] }, "remote_debugging"],
		[{ argv: ["app", "--lo-dev-driver"] }, "dev_flag"],
		[{ windowMode: "inactive" }, "window_mode"],
	]) {
		const response = meshPairingEligibility({ ...person(), ...patch });
		assert.deepEqual(response.body.result, { eligible: false, reason });
	}
	// Window state is per-answer, never part of the static reading.
	const facts = person();
	assert.equal(
		pairingStaticRefusal({
			...facts,
			window: { ...facts.window, focused: false },
		}),
		null,
	);
	assert.ok(
		desktopRequestSchema.safeParse({ op: "pairings.eligibility" }).success,
	);
	// Main-only: no core route, so no answer to one can prove the daemon paired.
	assert.equal(
		desktopEndpoint({ op: "pairings.eligibility" }).path.startsWith("/v1/"),
		false,
	);
	assert.equal(
		desktopEndpoint(confirmOf(inviterAdmit())).path.startsWith("/v1/"),
		false,
	);
});

/* ------------------------------------------------------------- the dial */

/** A unix listener speaking core's newline-JSON protocol, scripted per case. */
async function listener(name, { greeting, reply, silent = false }) {
	const path = join(scratch, `${name}.sock`);
	const frames = [];
	const server = createServer((socket) => {
		if (silent) return;
		socket.write(`${greeting}\n`);
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			frames.push(JSON.parse(buffer.slice(0, newline)));
			socket.write(`${reply}\n`);
		});
	});
	await new Promise((resolve) => server.listen(path, resolve));
	return { path, frames, close: () => new Promise((r) => server.close(r)) };
}

const frame = () =>
	meshPairingFrame({ ...inviterAdmit(), deadline: NOW_S + 30 });

test("the dial: greeting ok, one frame, ok reply -> attested", async () => {
	const server = await listener("ok", {
		greeting: '{"ok": true}',
		reply: '{"ok": true}',
	});
	assert.equal(await attestMeshPairing(server.path, frame()), null);
	assert.deepEqual(server.frames, [frame()]);
	await server.close();
});

test("the dial fails closed on every other answer", async () => {
	const cases = [
		[
			"refused-greeting",
			{ greeting: '{"ok": false, "reason": "unsigned"}', reply: "" },
			"listener_refused",
		],
		[
			"refused-frame",
			{
				greeting: '{"ok": true}',
				reply: '{"ok": false, "reason": "bad-frame"}',
			},
			"frame_refused",
		],
		["garbage", { greeting: "not json", reply: "" }, "listener_refused"],
	];
	for (const [name, script, outcome] of cases) {
		const server = await listener(name, script);
		assert.equal(await attestMeshPairing(server.path, frame()), outcome, name);
		await server.close();
	}
	assert.equal(
		await attestMeshPairing(join(scratch, "absent.sock"), frame()),
		"listener_unavailable",
	);
	const silent = await listener("silent", { silent: true });
	assert.equal(
		await attestMeshPairing(silent.path, frame(), { timeoutMs: 200 }),
		"timeout",
	);
	await silent.close();
});

test("the socket path is core's run/attest name", () => {
	assert.equal(
		meshPairingSocketPath("/x/.local-operator"),
		"/x/.local-operator/run/attest/mesh-pairing.sock",
	);
});

/* ------------------------------------------------------------- desktop-ipc */

function registered(answer) {
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
		answer,
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

test("desktop-request never forwards a pairing answer by itself", async () => {
	const { handler, event, forwarded } = registered(undefined);
	assert.equal(typeof handler, "function");
	const response = await handler(event, inviterAdmit());
	assert.equal(response.status, 403);
	assert.equal(response.body.detail.code, MESH_PAIRING_ATTEST_REFUSED);
	assert.equal(forwarded.length, 0);
});

test("desktop-request never forwards confirm or eligibility either", async () => {
	const { handler, event, forwarded } = registered(undefined);
	for (const request of [
		confirmOf(inviterAdmit()),
		{ op: "pairings.eligibility" },
	]) {
		const response = await handler(event, request);
		assert.equal(response.status, 403);
	}
	assert.equal(forwarded.length, 0);
});

test("desktop-request hands a pairing answer to the attester, parsed, and nothing else", async () => {
	const seen = [];
	const { handler, event, forwarded } = registered(async (_event, request) => {
		seen.push(request);
		return { status: 200, body: { result: { status: "sent" } } };
	});
	const response = await handler(event, inviterAdmit());
	assert.equal(response.status, 200);
	assert.equal(seen.length, 1);
	assert.equal(forwarded.length, 0);
	// The other two main-only ops reach the same handler, parsed.
	await handler(event, confirmOf(inviterAdmit()));
	await handler(event, { op: "pairings.eligibility" });
	assert.deepEqual(
		seen.map((request) => request.op),
		["pairings.answer", "pairings.confirm", "pairings.eligibility"],
	);
	assert.equal(forwarded.length, 0);
	// A malformed answer is refused before the attester sees it.
	const bad = await handler(event, { ...inviterAdmit(), code: "12" });
	assert.equal(bad.status, 422);
	const badToken = await handler(event, {
		...inviterAdmit(),
		confirmation: "not-hex",
	});
	assert.equal(badToken.status, 422);
	assert.equal(seen.length, 3);
	// Every other op still forwards as before.
	await handler(event, { op: "pairings.list" });
	assert.deepEqual(forwarded, [{ op: "pairings.list" }]);
});
