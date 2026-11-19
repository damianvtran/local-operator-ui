/**
 * The main-process half of answering a mesh pairing from the Mesh approvals tray.
 *
 * WHY THIS EXISTS. The operator asked that pairing two devices "does NOT require
 * running terminal commands, ideally it should be through the UI mesh approvals".
 * Core (local-operator #4259) serves the cards and an answer route, but the route
 * acts only after consuming an APP ATTESTATION: a frame the signed, unmodified
 * desktop app's MAIN process sent over `<config>/run/attest/mesh-pairing.sock`,
 * naming exactly the answer about to be POSTed. Core identifies the dialler by
 * kernel audit token and Security.framework (`asks/app_attest.py`, #4132); nothing
 * this file says about itself counts there. This module is the dialler, plus the
 * one decision core cannot make from outside the process: whether a PERSON clicked.
 *
 * WHAT IT PROTECTS, HONESTLY. The desktop API is reachable by anything holding the
 * desktop bearer - including an agent the operator runs - and the six digits are
 * not a secret (they are in the park JSON and the pending files). Without the
 * attestation such an agent could POST the code and complete a pairing nobody saw.
 * With it, an agent holding ONLY the bearer cannot answer through the desktop API.
 * It is process-identity proof on a SIGNED build, not proof of a human at the
 * relay: the same-user terminal fallback (`lop network confirm`, `lop network join
 * --confirm`) stays, and so do the 0600 decision files. Dev and unsigned builds
 * never attest - core's verifier refuses them with no override (operator decision
 * D4) - and non-macOS hosts have no listener at all, so the card there says so
 * and points at the terminal.
 *
 * THE CLICK-PROVENANCE GATE (#4132's rules, applied before any dial). An attested
 * answer must come from:
 *   - the app's own main window document (the same `isAdmittedSender` test every
 *     desktop channel uses - checked by the caller), on a window that is VISIBLE,
 *     not minimised and FOCUSED;
 *   - a launch with no driver attached: no `--remote-debugging-*` / `--inspect*`
 *     switch, no `--lo-*` switch (the dev driver, the launch probe and every rig
 *     switch share that prefix on purpose - see `launch-probe.ts`), no agent
 *     launch marker (`--user-data-dir`, `window-mode.ts` AGENT_LAUNCH_FLAGS), no
 *     dev-driver/smoke-test environment, no DevTools open on the window and no
 *     `webContents.debugger` session attached;
 *   - window mode `normal` (a `headless` or `inactive` launch is a rig by
 *     definition: it exists so an agent can drive the app without a person);
 *   - a ONE-SHOT CONFIRMATION main minted for THIS card's exact action (security
 *     review round 1, US-R1-1). The card's button first asks main for it
 *     (`pairings.confirm`); main mints it only while the sending document holds
 *     TRANSIENT USER ACTIVATION (`navigator.userActivation.isActive`, which a
 *     click or key press grants for a few seconds and no page script can grant),
 *     read in an ISOLATED WORLD so a page script that redefined the getter in the
 *     main world cannot answer for it (code review F2). The token is bound to the
 *     webContents, the frame (process id + frame token), a document generation
 *     main bumps on every cross-document navigation or renderer loss, and the
 *     card's side + invite_id + nonce + act; `pairings.answer` consumes it ONCE
 *     (a mismatch burns it too) and main re-reads sender, document, visibility and
 *     focus immediately before it dials. So an activation earned on one card, one
 *     act or one document cannot answer another, and a replay finds nothing.
 *     Input can only be synthesised into the renderer by CDP or the dev driver,
 *     both refused above; OS-level synthetic input (accessibility automation) is
 *     the residual this gate shares with #4132 and does not claim to close.
 * Every refusal is a 403 the card renders as "approve this on the device itself";
 * nothing is dialled, nothing is POSTed, no attempt is spent.
 *
 * ORDER. confirm (gate → isolated activation read → mint) → answer (consume →
 * gate → re-read sender document → attest the EXACT body: side, invite_id, nonce,
 * act, code, sorted shares, deadline → forward that same body). The renderer never
 * sees the socket and cannot reach it: `MESH_PAIRING_MAIN_OPS` are the desktop ops
 * `desktop-ipc.ts` never forwards on its own.
 *
 * NO `electron` IMPORT. Every Electron fact arrives through `PairingAnswerHost`,
 * so the gate and the dialler are tested with plain typed doubles
 * (`scripts/mesh-pairing-attest.test.mjs`) and cannot drift from what main wires.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { type Socket, createConnection } from "node:net";
import { join } from "node:path";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../shared/desktop-contract";
import { DEV_DRIVER_ENV } from "./dev-driver";
import { AGENT_LAUNCH_FLAGS, type WindowMode } from "./window-mode";

/** The one desktop op main attests before forwarding. */
export const MESH_PAIRING_ANSWER_OP = "pairings.answer" as const;

/** Core's dial contract (`network/pairing_attest.py` LISTENER_NAME / ATTEST_OP). */
export const MESH_PAIRING_ATTEST_OP = "mesh_pairing_attest";
export const MESH_PAIRING_SOCKET_NAME = "mesh-pairing.sock";

/**
 * How far ahead of now main sets the attested `deadline`, in seconds.
 *
 * Core's attestation table keeps a row 30 s (`app_attest.py`, "30 s is the design
 * note's figure") and the route requires `now < deadline <= expires_at`. Main
 * attests and forwards in one hop, so the deadline only has to outlive that hop;
 * matching the table's own lifetime means an attestation and its deadline expire
 * together, and a card with less time left than this uses its own expiry instead.
 */
export const MESH_PAIRING_DEADLINE_S = 30;

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
export const MESH_PAIRING_DIAL_TIMEOUT_MS = 10_000;

/** How long main waits for the renderer to report its activation state, in ms. */
export const MESH_PAIRING_ACTIVATION_TIMEOUT_MS = 1_000;

/**
 * How long a minted confirmation stays consumable, in ms.
 *
 * It may not outlive the activation that minted it: Chromium's transient user
 * activation lasts 5 s (`UserActivationState`, kActivationLifespan), so a token
 * older than that would vouch for a click the browser itself no longer counts.
 * The card asks for it and answers in back-to-back IPC hops, so honest use spends
 * milliseconds of this.
 */
export const MESH_PAIRING_CONFIRMATION_TTL_MS = 5_000;

/**
 * The isolated world main reads the activation in. Not 0 (the page's own world,
 * where a script can redefine `navigator.userActivation`) and not 999 (Electron's
 * `contextIsolation` preload world, which holds the bridge): a world nothing else
 * in the app ever runs code in.
 */
export const MESH_PAIRING_PROBE_WORLD_ID = 1_984;

/** The refusal code every local refusal answers with (403, the card's "use the device" copy). */
export const MESH_PAIRING_ATTEST_REFUSED = "pairing_attest_refused";

/** Why main would not attest. Stable strings: the renderer and the tests key on them. */
export type PairingProvenanceRefusal =
	| "not_macos"
	| "not_packaged"
	| "remote_debugging"
	| "dev_flag"
	| "window_mode"
	| "no_window"
	| "window_not_visible"
	| "window_not_focused"
	| "devtools_open"
	| "debugger_attached"
	| "no_user_action"
	/** The answer carried no live token: never minted, expired, or already spent. */
	| "no_confirmation"
	/** A token minted for another card, act, frame or document. Burnt by the attempt. */
	| "confirmation_mismatch";

/** The refusals that depend only on how the app was launched (see `pairingStaticRefusal`). */
export type PairingStaticRefusal = Extract<
	PairingProvenanceRefusal,
	"not_macos" | "not_packaged" | "remote_debugging" | "dev_flag" | "window_mode"
>;

/** Why the attestation itself failed (after the gate passed). */
export type PairingAttestFailure =
	| "listener_unavailable"
	| "listener_refused"
	| "frame_refused"
	| "timeout"
	| "expired";

/** The facts the gate decides on. Everything here is read by main, never sent by a renderer. */
export type PairingProvenanceFacts = {
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

/** Switches that attach a debugger/driver, matched as `--name` or `--name=value`. */
export const MESH_PAIRING_DEBUG_SWITCHES = [
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
 * Split out so main can tell the renderer UP FRONT (`pairings.eligibility`) that
 * a card here can only be answered from a terminal (design D1 / UX U1: an unsigned
 * or dev build used to take six digits and then refuse them). Nothing here changes
 * while the process lives, so one read at mount is the truth for the session.
 */
export function pairingStaticRefusal(
	facts: Omit<PairingProvenanceFacts, "window">,
): PairingStaticRefusal | null {
	if (facts.platform !== "darwin") return "not_macos";
	if (!facts.packaged) return "not_packaged";
	if (MESH_PAIRING_DEBUG_SWITCHES.some((name) => hasSwitch(facts.argv, name)))
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
export function pairingProvenanceRefusal(
	facts: PairingProvenanceFacts,
): PairingProvenanceRefusal | null {
	const launch = pairingStaticRefusal(facts);
	if (launch) return launch;
	const window = facts.window;
	if (window === null) return "no_window";
	if (window.debuggerAttached) return "debugger_attached";
	if (window.devToolsOpened) return "devtools_open";
	if (!window.visible || window.minimized) return "window_not_visible";
	if (!window.focused) return "window_not_focused";
	return null;
}

/** `<config>/run/attest/mesh-pairing.sock` - core's `run_dir(config, "run/attest")`. */
export function meshPairingSocketPath(configDir: string): string {
	return join(configDir, "run", "attest", MESH_PAIRING_SOCKET_NAME);
}

/** The frame core's `pairing_attest.validate_frame` reads; built from the request main forwards. */
export type MeshPairingAttestFrame = {
	op: typeof MESH_PAIRING_ATTEST_OP;
	side: "inviter" | "joiner";
	invite_id: string;
	nonce: string;
	act: "respond" | "decline";
	code: string;
	shares: string[];
	deadline: number;
};

export type PairingAnswerRequest = Extract<
	DesktopRequest,
	{ op: typeof MESH_PAIRING_ANSWER_OP }
>;

/**
 * The frame for one answer. `shares` is sorted (core binds the sorted list) and a
 * decline carries `code: ""` (core refuses a decline that carries digits).
 */
export function meshPairingFrame(
	request: PairingAnswerRequest & { deadline: number },
): MeshPairingAttestFrame {
	return {
		op: MESH_PAIRING_ATTEST_OP,
		side: request.side,
		invite_id: request.inviteId,
		nonce: request.nonce,
		act: request.decision === "admit" ? "respond" : "decline",
		code: request.decision === "admit" ? request.code : "",
		shares: [...(request.shares ?? [])].sort(),
		deadline: request.deadline,
	};
}

/** How the dialler connects; injected so tests use a real socket in a scratch dir or a double. */
export type PairingSocketConnect = (path: string) => Socket;

/**
 * Dial the listener and attest one frame: `null` on success, else why not.
 *
 * Wire (core `AttestService._on_connection`): newline-delimited JSON. The listener
 * verifies the dialler on accept and answers `{"ok": true}` or a refusal; main then
 * writes the frame and reads one more line. Anything else - a closed socket, a
 * non-JSON line, a timeout - is a refusal: this fails closed everywhere.
 */
export function attestMeshPairing(
	socketPath: string,
	frame: MeshPairingAttestFrame,
	{
		connect = (path) => createConnection(path),
		timeoutMs = MESH_PAIRING_DIAL_TIMEOUT_MS,
	}: { connect?: PairingSocketConnect; timeoutMs?: number } = {},
): Promise<PairingAttestFailure | null> {
	return new Promise((resolve) => {
		let settled = false;
		let buffer = "";
		let greeted = false;
		const socket = connect(socketPath);
		const finish = (outcome: PairingAttestFailure | null) => {
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
 * Which document sent a pairing op, as MAIN reads it from the IPC event - never
 * from the request. `generation` is main's own count of cross-document
 * navigations and renderer losses on that webContents (see `index.ts`): a frame
 * token alone can survive a same-site navigation that reuses the frame host, so
 * the count is what makes "the same document" mean the same loaded page.
 */
export type PairingDocument = {
	webContentsId: number;
	processId: number;
	frameToken: string;
	generation: number;
};

/** What a confirmation vouches for: one act, on one card, from one document. */
export type PairingConfirmationBinding = {
	document: PairingDocument;
	side: "inviter" | "joiner";
	inviteId: string;
	nonce: string;
	act: "respond" | "decline";
};

function sameDocument(a: PairingDocument, b: PairingDocument): boolean {
	return (
		a.webContentsId === b.webContentsId &&
		a.processId === b.processId &&
		a.frameToken === b.frameToken &&
		a.generation === b.generation
	);
}

function sameBinding(
	a: PairingConfirmationBinding,
	b: PairingConfirmationBinding,
): boolean {
	return (
		sameDocument(a.document, b.document) &&
		a.side === b.side &&
		a.inviteId === b.inviteId &&
		a.nonce === b.nonce &&
		a.act === b.act
	);
}

/** A token's wire shape: 32 random bytes, lowercase hex (the contract's regex). */
const CONFIRMATION_TOKEN = /^[0-9a-f]{64}$/;

/**
 * Main's outstanding one-shot confirmations (security review round 1, US-R1-1).
 *
 * AT MOST ONE PER webContents: minting replaces the previous token, so the store
 * is bounded by the number of windows and an abandoned mint cannot pile up. A
 * consume ALWAYS removes that webContents' token - a wrong card, act or document
 * burns it, so a probe cannot learn which binding a live token has and retry.
 * Tokens are 32 random bytes compared in constant time; they never leave the
 * renderer that asked and are never logged.
 */
export class MeshPairingConfirmations {
	readonly #tokens = new Map<
		number,
		{
			token: Buffer;
			binding: PairingConfirmationBinding;
			expiresAtMs: number;
		}
	>();
	readonly #nowMs: () => number;
	readonly #ttlMs: number;

	constructor({
		nowMs = Date.now,
		ttlMs = MESH_PAIRING_CONFIRMATION_TTL_MS,
	}: { nowMs?: () => number; ttlMs?: number } = {}) {
		this.#nowMs = nowMs;
		this.#ttlMs = ttlMs;
	}

	mint(binding: PairingConfirmationBinding): string {
		const token = randomBytes(32);
		this.#tokens.set(binding.document.webContentsId, {
			token,
			binding,
			expiresAtMs: this.#nowMs() + this.#ttlMs,
		});
		return token.toString("hex");
	}

	/** `null` when `token` is the live one for exactly `binding`; consumed either way. */
	consume(
		token: string | undefined,
		binding: PairingConfirmationBinding,
	): "no_confirmation" | "confirmation_mismatch" | null {
		const entry = this.#tokens.get(binding.document.webContentsId);
		this.#tokens.delete(binding.document.webContentsId);
		if (!entry || typeof token !== "string" || !CONFIRMATION_TOKEN.test(token))
			return "no_confirmation";
		const offered = Buffer.from(token, "hex");
		if (
			offered.length !== entry.token.length ||
			!timingSafeEqual(offered, entry.token) ||
			this.#nowMs() >= entry.expiresAtMs
		)
			return "no_confirmation";
		return sameBinding(entry.binding, binding) ? null : "confirmation_mismatch";
	}

	/** Drop a window's token (its renderer navigated, crashed or closed). */
	forget(webContentsId: number): void {
		this.#tokens.delete(webContentsId);
	}

	/** Outstanding tokens; for tests. */
	get size(): number {
		return this.#tokens.size;
	}
}

/** What main supplies per pairing op; every field is main's own reading. */
export type PairingAnswerHost = {
	/** The gate's facts, read at the moment of the call. */
	facts: () => PairingProvenanceFacts;
	/**
	 * The SENDING document, read from the IPC event now, or null when the sender is
	 * not the main window's main frame (or that window is gone).
	 */
	document: () => PairingDocument | null;
	/**
	 * Whether the main window's renderer holds transient user activation NOW, read
	 * in an isolated world (`MESH_PAIRING_PROBE_WORLD_ID`). Main asks the page; it
	 * never takes the renderer's word in the request.
	 */
	userActivation: () => Promise<boolean>;
	confirmations: MeshPairingConfirmations;
	configDir: () => string;
	forward: (input: unknown) => Promise<DesktopResponse>;
	nowMs?: () => number;
	attest?: typeof attestMeshPairing;
};

/** A local refusal, in the desktop plane's `{detail: {code, message}}` shape. */
export function pairingAttestRefusal(
	reason: PairingProvenanceRefusal | PairingAttestFailure,
): DesktopResponse {
	return {
		status: 403,
		body: {
			detail: {
				code: MESH_PAIRING_ATTEST_REFUSED,
				reason,
				// The renderer keys its own copy on `code`/`reason`; this sentence is
				// for logs and older renderers only.
				message: `This app could not approve the pairing here (${reason}).`, // i18n: ignore main-process diagnostic, renderer renders keyed copy
			},
		},
	};
}

/**
 * `pairings.eligibility`: whether this LAUNCH could ever attest, and if not why.
 * Only the static half of the gate - focus, visibility and DevTools change while
 * the app runs and are judged per answer.
 */
export function meshPairingEligibility(
	facts: Omit<PairingProvenanceFacts, "window">,
): DesktopResponse {
	const reason = pairingStaticRefusal(facts);
	return {
		status: 200,
		body: { result: { eligible: reason === null, reason } },
	};
}

/**
 * Ask the page, bounded: a hung renderer is refused rather than awaited, and the
 * timer is cleared once the page answers (code review F3).
 */
async function boundedActivation(host: PairingAnswerHost): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			host.userActivation().catch(() => false),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(
					() => resolve(false),
					MESH_PAIRING_ACTIVATION_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export type PairingConfirmRequest = Extract<
	DesktopRequest,
	{ op: "pairings.confirm" }
>;

/**
 * `pairings.confirm`: mint the one-shot token for one card action.
 *
 * Gate first (no page is consulted for a launch that may not attest), then the
 * isolated-world activation read, then the gate and the sender's document AGAIN -
 * the window may have lost focus, or the page navigated, while it answered.
 */
export async function confirmMeshPairing(
	request: PairingConfirmRequest,
	host: PairingAnswerHost,
): Promise<DesktopResponse> {
	const refused = pairingProvenanceRefusal(host.facts());
	if (refused) return pairingAttestRefusal(refused);
	const document = host.document();
	if (!document) return pairingAttestRefusal("no_window");
	if (!(await boundedActivation(host)))
		return pairingAttestRefusal("no_user_action");
	const late = pairingProvenanceRefusal(host.facts());
	if (late) return pairingAttestRefusal(late);
	const after = host.document();
	if (!after || !sameDocument(document, after))
		return pairingAttestRefusal("confirmation_mismatch");
	const confirmation = host.confirmations.mint({
		document,
		side: request.side,
		inviteId: request.inviteId,
		nonce: request.nonce,
		act: request.decision === "admit" ? "respond" : "decline",
	});
	return { status: 200, body: { result: { confirmation } } };
}

/**
 * Answer one card: gate, consume the confirmation, re-check, attest, forward.
 * `request` is already schema-valid (`desktop-ipc.ts` parsed it); `deadline` in
 * it is the card's expiry hint only.
 */
export async function answerMeshPairing(
	request: PairingAnswerRequest,
	host: PairingAnswerHost,
): Promise<DesktopResponse> {
	const document = host.document();
	const binding = document
		? {
				document,
				side: request.side,
				inviteId: request.inviteId,
				nonce: request.nonce,
				act:
					request.decision === "admit"
						? ("respond" as const)
						: ("decline" as const),
			}
		: null;
	// Consumed FIRST, whatever happens next: a token is good for one try, so a
	// refusal below never leaves a live one behind for a scripted retry.
	const spent = binding
		? host.confirmations.consume(request.confirmation, binding)
		: "no_window";
	const refused = pairingProvenanceRefusal(host.facts());
	if (refused) return pairingAttestRefusal(refused);
	if (spent) return pairingAttestRefusal(spent);

	const nowS = Math.floor((host.nowMs ?? Date.now)() / 1000);
	const ceiling = request.deadline ?? Number.POSITIVE_INFINITY;
	const deadline = Math.min(nowS + MESH_PAIRING_DEADLINE_S, ceiling);
	if (!(deadline > nowS)) return pairingAttestRefusal("expired");

	// ONE object is attested and forwarded, so the two cannot disagree. Shares are
	// sorted and, for the inviter, always explicit (core requires them on an admit
	// and accepts `[]` on a decline). The joiner has no list and sends none; the
	// confirmation token is main's own and never reaches core.
	const forwarded: PairingAnswerRequest & { deadline: number } = {
		op: request.op,
		side: request.side,
		inviteId: request.inviteId,
		nonce: request.nonce,
		decision: request.decision,
		code: request.decision === "admit" ? request.code : "",
		deadline,
		...(request.side === "inviter"
			? { shares: [...(request.shares ?? [])].sort() }
			: {}),
	};
	// Revalidated IMMEDIATELY before the dial: the same sender document and a
	// window that is still visible and focused.
	const late = pairingProvenanceRefusal(host.facts());
	if (late) return pairingAttestRefusal(late);
	const now = host.document();
	if (!now || !document || !sameDocument(document, now))
		return pairingAttestRefusal("confirmation_mismatch");
	const failure = await (host.attest ?? attestMeshPairing)(
		meshPairingSocketPath(host.configDir()),
		meshPairingFrame(forwarded),
	);
	if (failure) return pairingAttestRefusal(failure);
	return host.forward(forwarded);
}

/**
 * The pairing ops MAIN answers itself (`desktop-ipc.ts` checks this before any
 * generic forwarding): the attested answer, the one-shot confirmation it needs,
 * and the launch's static eligibility. None is ever forwarded as sent.
 */
export const MESH_PAIRING_MAIN_OPS: ReadonlySet<string> = new Set([
	MESH_PAIRING_ANSWER_OP,
	"pairings.confirm",
	"pairings.eligibility",
]);

/** A schema-valid request for one of `MESH_PAIRING_MAIN_OPS`. */
export type PairingMainRequest = Extract<
	DesktopRequest,
	{ op: "pairings.answer" | "pairings.confirm" | "pairings.eligibility" }
>;

/** Whether a renderer input is one of main's own pairing ops. */
export function isMeshPairingMainOp(input: unknown): boolean {
	return (
		typeof input === "object" &&
		input !== null &&
		MESH_PAIRING_MAIN_OPS.has(String((input as { op?: unknown }).op))
	);
}
