/**
 * The shared half of every main-process APP ATTESTATION: the click-provenance gate
 * and the generic dialler for core's per-runtime attestation listeners.
 *
 * WHY THIS EXISTS. Core (`asks/app_attest.py`, local-operator #4132) trusts an
 * answer as the operator's only when the signed, unmodified desktop app's MAIN
 * process attested its exact content over an AF_UNIX listener under
 * `<config>/run/attest/`. Core identifies the dialler by kernel audit token and
 * Security.framework; nothing this file says about itself counts there. What core
 * cannot decide from outside the process is whether a PERSON drove the answer, so
 * main decides that here, before any dial. Two consumers share it:
 *
 *   - `mesh-pairing-attest.ts` (pairing cards, `mesh-pairing.sock`), and
 *   - `ask-attest.ts` (queued ask answers, `<session_id>.sock`).
 *
 * It was extracted from `mesh-pairing-attest.ts` with NO behaviour change so the
 * second consumer reuses the exact gate the pairing card's security reviews
 * hardened, instead of a copy that could drift (`scripts/mesh-pairing-attest.test.mjs`
 * pins the pairing behaviour; `scripts/ask-attest.test.mjs` pins the shared parts
 * from the ask side).
 *
 * WHAT THE GATE PROTECTS, HONESTLY. It refuses every launch a person is not
 * driving - CDP/remote debugging, `--inspect*`, any `--lo-*` rig switch, the agent
 * launch marker, the dev-driver/smoke-test env, a `headless`/`inactive` window
 * mode, DevTools, an attached debugger, a hidden/minimised/unfocused window, a dev
 * (unpackaged) build, a non-macOS host. Dev and unsigned builds never attest
 * (operator decision D4; core's verifier refuses them too, with no override).
 * The residual it shares with core is OS-level synthetic input (Accessibility /
 * TCC-granted automation clicking a real native sheet): it does not claim to
 * close that.
 *
 * NO `electron` IMPORT: every Electron fact arrives as plain data (`AttestProvenanceFacts`)
 * so the gate and the dialler are tested with typed doubles and a real socket.
 */

import { type Socket, createConnection } from "node:net";
import { join } from "node:path";
import { DEV_DRIVER_ENV } from "./dev-driver";
import { AGENT_LAUNCH_FLAGS, type WindowMode } from "./window-mode";

/**
 * How long one dial may take end to end, in ms.
 *
 * The listener verifies the dialler on accept AND per frame; its expensive step
 * (the nested static code check) measured 1.6-3.3 s warm, one measurement each,
 * and is cached per process after the first (`app_attest.py` docstring, "Step 4
 * costs"). Two verifies on a cold cache is ~6.6 s at that maximum, so 10 s sits
 * above it; a slower listener is refused rather than waited on, and a refused
 * dial spends nothing on core's side.
 */
export const ATTEST_DIAL_TIMEOUT_MS = 10_000;

/** How long main waits for the renderer to report its activation state, in ms. */
export const ATTEST_ACTIVATION_TIMEOUT_MS = 1_000;

/** The gate's refusals. Stable strings: renderers and tests key on them. */
export type AttestProvenanceRefusal =
	| "not_macos"
	| "not_packaged"
	| "remote_debugging"
	| "dev_flag"
	| "window_mode"
	| "no_window"
	| "window_not_visible"
	| "window_not_focused"
	| "devtools_open"
	| "debugger_attached";

/** The refusals that depend only on how the app was launched. */
export type AttestStaticRefusal = Extract<
	AttestProvenanceRefusal,
	"not_macos" | "not_packaged" | "remote_debugging" | "dev_flag" | "window_mode"
>;

/** Why a dial failed (after the gate passed). */
export type AttestDialFailure =
	| "listener_unavailable"
	| "listener_refused"
	| "frame_refused"
	| "timeout";

/** The facts the gate decides on. Everything here is read by main, never sent by a renderer. */
export type AttestProvenanceFacts = {
	platform: NodeJS.Platform;
	packaged: boolean;
	argv: readonly string[];
	env: Readonly<Record<string, string | undefined>>;
	windowMode: WindowMode;
	window: {
		visible: boolean;
		minimized: boolean;
		focused: boolean;
		devToolsOpened: boolean;
		debuggerAttached: boolean;
	} | null;
};

/**
 * Environment variables that mean "something other than a person drives this
 * process". The dev driver's whole family shares the `DEV_DRIVER_ENV` prefix;
 * the smoke test is the packaged-bundle rig.
 */
const DRIVER_ENV_PREFIXES = [DEV_DRIVER_ENV, "LOCAL_OPERATOR_UI_SMOKE_TEST"];

/**
 * Merge env sources for the `dev_flag` refusal, keeping, per key, any NON-EMPTY
 * value from any source.
 *
 * Why not a plain spread: main has two envs - the launch snapshot (`launchEnv`)
 * and `process.env` after the cwd `.env` was folded in with `override: true`.
 * A spread lets the later source win per key, so a `.env` line
 * `LOCAL_OPERATOR_UI_DEV_DRIVER=` would blank a driver variable the process was
 * launched with, and the refusal (which treats empty as unset, see the test "an
 * empty dev-driver env var is not a driver") would pass a launch the driver
 * still arms from `launchEnv`. Keeping any non-empty value means a driver
 * variable set in EITHER env refuses. Use it only for refusals: for a fact that
 * GRANTS something (window mode, driver arming) a merged env is the wrong read,
 * and main uses `launchEnv` alone.
 */
export function refusalEnv(
	...sources: readonly Readonly<Record<string, string | undefined>>[]
): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const source of sources)
		for (const [key, value] of Object.entries(source))
			if (value !== undefined && value !== "" && !(key in merged))
				merged[key] = value;
	return merged;
}

/** Switches that attach a debugger/driver, matched as `--name` or `--name=value`. */
export const ATTEST_DEBUG_SWITCHES = [
	"--remote-debugging-port",
	"--remote-debugging-pipe",
	"--remote-debugging-address",
	"--inspect",
	"--inspect-brk",
	"--inspect-port",
	"--inspect-publish-uid",
];

function hasSwitch(argv: readonly string[], name: string): boolean {
	return argv.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

/**
 * The launch half of the gate: `null` when this process could ever attest.
 *
 * Split out so main can tell a renderer UP FRONT that a card here cannot be
 * confirmed (design D1 / UX U1). Nothing here changes while the process lives,
 * so one read at mount is the truth for the session.
 */
export function attestStaticRefusal(
	facts: Omit<AttestProvenanceFacts, "window">,
): AttestStaticRefusal | null {
	if (facts.platform !== "darwin") return "not_macos";
	if (!facts.packaged) return "not_packaged";
	if (ATTEST_DEBUG_SWITCHES.some((name) => hasSwitch(facts.argv, name)))
		return "remote_debugging";
	if (
		facts.argv.some((arg) => arg.startsWith("--lo-")) ||
		AGENT_LAUNCH_FLAGS.some((name) => hasSwitch(facts.argv, name)) ||
		Object.keys(facts.env).some(
			(key) =>
				facts.env[key] !== undefined &&
				facts.env[key] !== "" &&
				DRIVER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)),
		)
	)
		return "dev_flag";
	if (facts.windowMode !== "normal") return "window_mode";
	return null;
}

/**
 * The gate: `null` when main may attest, else the first rule that refused.
 *
 * Order is cheapest-and-most-structural first so the reason a person reads is the
 * one that matters (a dev build says "not packaged", not "window not focused").
 */
export function attestProvenanceRefusal(
	facts: AttestProvenanceFacts,
): AttestProvenanceRefusal | null {
	const launch = attestStaticRefusal(facts);
	if (launch) return launch;
	const window = facts.window;
	if (window === null) return "no_window";
	if (window.debuggerAttached) return "debugger_attached";
	if (window.devToolsOpened) return "devtools_open";
	if (!window.visible || window.minimized) return "window_not_visible";
	if (!window.focused) return "window_not_focused";
	return null;
}

/** `<config>/run/attest/<name>` - core's `run_dir(config, ATTEST_RUN_DIRNAME)` leaf. */
export function attestSocketPath(configDir: string, name: string): string {
	return join(configDir, "run", "attest", name);
}

/** How the dialler connects; injected so tests use a real socket in a scratch dir or a double. */
export type AttestSocketConnect = (path: string) => Socket;

/**
 * Dial one attestation listener and attest one frame: `null` on success, else why not.
 *
 * Wire (core `AttestService._on_connection`): newline-delimited JSON. The listener
 * verifies the dialler on accept and answers `{"ok": true}` or a refusal; main then
 * writes the frame and reads one more line. Anything else - a closed socket, a
 * non-JSON line, a timeout - is a refusal: this fails closed everywhere. A missing
 * socket (no live runtime, a non-macOS core) is `listener_unavailable`.
 */
export function dialAttest(
	socketPath: string,
	frame: unknown,
	{
		connect = (path) => createConnection(path),
		timeoutMs = ATTEST_DIAL_TIMEOUT_MS,
	}: { connect?: AttestSocketConnect; timeoutMs?: number } = {},
): Promise<AttestDialFailure | null> {
	return new Promise((resolve) => {
		let settled = false;
		let buffer = "";
		let greeted = false;
		const socket = connect(socketPath);
		const finish = (outcome: AttestDialFailure | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			resolve(outcome);
		};
		const timer = setTimeout(() => finish("timeout"), timeoutMs);
		socket.setEncoding("utf8");
		socket.on("error", () =>
			finish(greeted ? "frame_refused" : "listener_unavailable"),
		);
		socket.on("close", () =>
			finish(greeted ? "frame_refused" : "listener_unavailable"),
		);
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newline = buffer.indexOf("\n");
			while (newline >= 0 && !settled) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				let reply: { ok?: unknown } | null = null;
				try {
					reply = JSON.parse(line) as { ok?: unknown };
				} catch {
					reply = null;
				}
				const ok = reply !== null && reply.ok === true;
				if (!greeted) {
					if (!ok) return finish("listener_refused");
					greeted = true;
					socket.write(`${JSON.stringify(frame)}\n`);
				} else {
					return finish(ok ? null : "frame_refused");
				}
				newline = buffer.indexOf("\n");
			}
		});
	});
}

/**
 * Ask the page whether it holds transient user activation, bounded: a hung
 * renderer is refused rather than awaited, and the timer is cleared once the page
 * answers (code review F3). A PRE-FILTER only - it keeps a page from raising
 * native sheets nobody asked for; the sheet is what authorizes.
 */
export async function boundedActivation(
	read: () => Promise<boolean>,
	timeoutMs: number = ATTEST_ACTIVATION_TIMEOUT_MS,
): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			read().catch(() => false),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Which document sent an op, as MAIN reads it from the IPC event - never from the
 * request. `generation` is main's own count of cross-document navigations and
 * renderer losses on that webContents (see `index.ts`): a frame token alone can
 * survive a same-site navigation that reuses the frame host, so the count is what
 * makes "the same document" mean the same loaded page.
 */
export type AttestDocument = {
	webContentsId: number;
	processId: number;
	frameToken: string;
	generation: number;
};

export function sameAttestDocument(
	a: AttestDocument,
	b: AttestDocument,
): boolean {
	return (
		a.webContentsId === b.webContentsId &&
		a.processId === b.processId &&
		a.frameToken === b.frameToken &&
		a.generation === b.generation
	);
}
