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
 *    activation.
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

/** A host double recording every dial and forward. */
function host(overrides = {}) {
	const calls = { attest: [], forward: [], activation: 0 };
	return {
		calls,
		host: {
			facts: person,
			userActivation: async () => {
				calls.activation += 1;
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

test("no transient user activation: refused, no dial, no forward", async () => {
	const { host: h, calls } = host({ userActivation: async () => false });
	const response = await answerMeshPairing(inviterAdmit(), h);
	assert.equal(response.body.detail.reason, "no_user_action");
	assert.deepEqual([calls.attest.length, calls.forward.length], [0, 0]);
});

test("a renderer that never answers the activation question is refused, not awaited", async () => {
	const { host: h, calls } = host({
		userActivation: () => new Promise(() => {}),
	});
	const started = Date.now();
	const response = await answerMeshPairing(inviterAdmit(), h);
	assert.equal(response.body.detail.reason, "no_user_action");
	assert.ok(Date.now() - started < 3_000);
	assert.equal(calls.attest.length, 0);
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
	const response = await answerMeshPairing(inviterAdmit(), h);
	assert.equal(response.body.detail.reason, "window_not_focused");
	assert.equal(calls.attest.length, 0);
});

test("attest then forward ONE object: the frame names exactly the forwarded body", async () => {
	const { host: h, calls } = host();
	const response = await answerMeshPairing(
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
	await answerMeshPairing(inviterAdmit({ deadline: NOW_S + 5 }), soon.host);
	assert.equal(soon.calls.forward[0].deadline, NOW_S + 5);
	const lapsed = host();
	const response = await answerMeshPairing(
		inviterAdmit({ deadline: NOW_S }),
		lapsed.host,
	);
	assert.equal(response.body.detail.reason, "expired");
	assert.equal(lapsed.calls.attest.length, 0);
});

test("a decline binds no code; a joiner answer carries no share list", async () => {
	const { host: h, calls } = host();
	await answerMeshPairing(
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
	await answerMeshPairing(inviterAdmit({ shares: undefined }), h);
	assert.deepEqual(calls.forward[0].shares, []);
	assert.deepEqual(desktopEndpoint(calls.forward[0]).body.shares, []);
});

test("a failed attestation is a 403 and forwards nothing", async () => {
	const { host: h, calls } = host({ attest: async () => "frame_refused" });
	const response = await answerMeshPairing(inviterAdmit(), h);
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
	// A malformed answer is refused before the attester sees it.
	const bad = await handler(event, { ...inviterAdmit(), code: "12" });
	assert.equal(bad.status, 422);
	assert.equal(seen.length, 1);
	// Every other op still forwards as before.
	await handler(event, { op: "pairings.list" });
	assert.deepEqual(forwarded, [{ op: "pairings.list" }]);
});
