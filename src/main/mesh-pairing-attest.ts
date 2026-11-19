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
 *   - a ONE-SHOT CONFIRMATION main minted for ONE EXACT ANSWER after the person
 *     approved it on a TRUSTED CONTROL (security review rounds 1-2, US-R1-1 and
 *     US-R2-1). Page activation is not that control: any input on the page - a
 *     click on unrelated chrome, a key press in another field - grants it, and
 *     it binds nothing about the answer. So the card's button sends main the
 *     exact answer (`pairings.confirm`: act, code, sorted explicit shares);
 *     main FREEZES its canonical form, reads the pairing cards from core ITSELF
 *     and shows a WINDOW-MODAL NATIVE SHEET (`dialog.showMessageBox(mainWindow,
 *     ...)`) whose every word - device, action, role, code, the exact
 *     credentials shared or "nothing" - comes from that read, never from the
 *     renderer. Only the sheet's own Admit/Join/Decline button mints a token;
 *     Cancel, Escape and dismissal mint nothing, and the sheet closes itself at
 *     the card's expiry. One sheet at a time: a second request while one is open
 *     is refused, never queued. Before minting, main revalidates the expiry, the
 *     gate (focus included), the sender document and a FRESH read whose card,
 *     nonce and sheet text are unchanged. The token is bound to the webContents,
 *     the frame (process id + frame token), a document generation main bumps on
 *     every cross-document navigation or renderer loss, and the frozen answer;
 *     `pairings.answer` must present the IDENTICAL answer, and consumes the
 *     token ONCE either way (a changed code or share list burns it). The forward
 *     is built from the frozen answer, and main re-reads the card, sender,
 *     document, visibility and focus immediately before it dials. The
 *     isolated-world activation read (`navigator.userActivation.isActive`, code
 *     review F2) stays as a PRE-FILTER only, so a page cannot raise sheets the
 *     person never asked for. A native sheet cannot be clicked by CDP or the dev
 *     driver (both refused above anyway); OS-level synthetic input
 *     (accessibility automation) is the residual this gate shares with #4132
 *     and does not claim to close.
 * Every refusal is a 403 the card renders as keyed copy; nothing is dialled,
 * nothing is POSTed, no attempt is spent.
 *
 * ORDER. confirm (gate → activation pre-filter → freeze the answer → claim the
 * sheet → main's own read → native sheet → revalidate → mint) → answer (consume
 * for the identical answer → gate → re-read card and sender document → attest
 * the FROZEN body: side, invite_id, nonce, act, code, sorted shares, deadline →
 * forward that same body). The renderer never sees the socket and cannot reach
 * it: `MESH_PAIRING_MAIN_OPS` are the desktop ops
 * `desktop-ipc.ts` never forwards on its own.
 *
 * NO `electron` IMPORT. Every Electron fact arrives through `PairingAnswerHost`,
 * so the gate and the dialler are tested with plain typed doubles
 * (`scripts/mesh-pairing-attest.test.mjs`) and cannot drift from what main wires.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { type Socket, createConnection } from "node:net";
import { join } from "node:path";
import { formatList } from "../i18n/format";
import { t } from "../i18n/index";
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
 * How long a minted confirmation stays consumable, in ms, counted from the
 * native sheet's approval (not from the page click).
 *
 * The card sends `pairings.answer` in the IPC hop right after `pairings.confirm`
 * resolves, so honest use spends milliseconds of this; 5 s is Chromium's own
 * transient-activation lifespan (`UserActivationState`, kActivationLifespan),
 * kept as the bound so a token never outlives the shortest proof of presence
 * the app already relies on.
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
	/** A token minted for another answer, frame or document. Burnt by the attempt. */
	| "confirmation_mismatch"
	/** A native confirmation sheet is already open; this request raised none. */
	| "sheet_open"
	/** Main's own read of the cards failed: nothing to name on a sheet. */
	| "pairing_read_failed"
	/** Main's read has no such card: it was answered, withdrawn or ended. */
	| "pairing_closed"
	/** The card moved on (new nonce/stage, no longer answerable, shares not offered, words changed). */
	| "pairing_changed";

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

/**
 * The ONE answer a confirmation vouches for, frozen by main before anything is
 * shown (security review round 2, US-R2-1). Canonical: `act` in core's words, a
 * decline's code always "" and its shares always [] (nothing is shared on a
 * decline), a joiner's shares always [] (it has no list; main forwards none),
 * an inviter's shares sorted (core binds the sorted list). `pairings.confirm`
 * and `pairings.answer` both pass through `canonicalPairingAnswer`, so "the same
 * answer" means these six values are equal - nothing the renderer phrases
 * differently can make two different answers compare equal, or the reverse.
 */
export type PairingCanonicalAnswer = Readonly<{
	side: "inviter" | "joiner";
	inviteId: string;
	nonce: string;
	act: "respond" | "decline";
	code: string;
	shares: readonly string[];
}>;

export function canonicalPairingAnswer(
	request: Pick<
		PairingAnswerRequest,
		"side" | "inviteId" | "nonce" | "decision" | "code" | "shares"
	>,
): PairingCanonicalAnswer {
	const admit = request.decision === "admit";
	return Object.freeze({
		side: request.side,
		inviteId: request.inviteId,
		nonce: request.nonce,
		act: admit ? "respond" : "decline",
		code: admit ? request.code : "",
		shares: Object.freeze(
			admit && request.side === "inviter"
				? [...(request.shares ?? [])].sort()
				: [],
		),
	});
}

function sameAnswer(a: PairingCanonicalAnswer, b: PairingCanonicalAnswer) {
	return (
		a.side === b.side &&
		a.inviteId === b.inviteId &&
		a.nonce === b.nonce &&
		a.act === b.act &&
		a.code === b.code &&
		a.shares.length === b.shares.length &&
		a.shares.every((key, index) => key === b.shares[index])
	);
}

/** What a confirmation vouches for: one exact answer, from one document. */
export type PairingConfirmationBinding = {
	document: PairingDocument;
	answer: PairingCanonicalAnswer;
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
	return sameDocument(a.document, b.document) && sameAnswer(a.answer, b.answer);
}

/** A token's wire shape: 32 random bytes, lowercase hex (the contract's regex). */
const CONFIRMATION_TOKEN = /^[0-9a-f]{64}$/;

/** What a consumed token hands the answer: the frozen answer and its ceremony's expiry. */
export type PairingConfirmed = {
	answer: PairingCanonicalAnswer;
	/** The card's `expires_at` as MAIN read it when the person approved (seconds). */
	expiresAtS: number;
};

/**
 * Main's outstanding one-shot confirmations (security review rounds 1-2,
 * US-R1-1 / US-R2-1), and the one native sheet that may be open.
 *
 * AT MOST ONE TOKEN PER webContents: minting replaces the previous token, so the
 * store is bounded by the number of windows and an abandoned mint cannot pile
 * up. A consume ALWAYS removes that webContents' token - a different answer or
 * document burns it, so a probe cannot learn which answer a live token has and
 * retry. Tokens are 32 random bytes compared in constant time; they never leave
 * the renderer that asked and are never logged.
 *
 * AT MOST ONE SHEET IN THE APP: a second confirm while a sheet is open is
 * refused, never queued (a queue would let a page line up sheets behind the one
 * the person is reading, and a reflexive second click would approve the next).
 */
export class MeshPairingConfirmations {
	readonly #tokens = new Map<
		number,
		{
			token: Buffer;
			binding: PairingConfirmationBinding;
			expiresAtMs: number;
			ceremonyExpiresAtS: number;
		}
	>();
	readonly #nowMs: () => number;
	readonly #ttlMs: number;
	#sheetOpen = false;

	constructor({
		nowMs = Date.now,
		ttlMs = MESH_PAIRING_CONFIRMATION_TTL_MS,
	}: { nowMs?: () => number; ttlMs?: number } = {}) {
		this.#nowMs = nowMs;
		this.#ttlMs = ttlMs;
	}

	mint(
		binding: PairingConfirmationBinding,
		ceremonyExpiresAtS: number,
	): string {
		const token = randomBytes(32);
		this.#tokens.set(binding.document.webContentsId, {
			token,
			binding,
			expiresAtMs: this.#nowMs() + this.#ttlMs,
			ceremonyExpiresAtS,
		});
		return token.toString("hex");
	}

	/** The frozen answer when `token` is the live one for exactly `binding`; consumed either way. */
	consume(
		token: string | undefined,
		binding: PairingConfirmationBinding,
	):
		| { refusal: "no_confirmation" | "confirmation_mismatch" }
		| { confirmed: PairingConfirmed } {
		const entry = this.#tokens.get(binding.document.webContentsId);
		this.#tokens.delete(binding.document.webContentsId);
		if (!entry || typeof token !== "string" || !CONFIRMATION_TOKEN.test(token))
			return { refusal: "no_confirmation" };
		const offered = Buffer.from(token, "hex");
		if (
			offered.length !== entry.token.length ||
			!timingSafeEqual(offered, entry.token) ||
			this.#nowMs() >= entry.expiresAtMs
		)
			return { refusal: "no_confirmation" };
		return sameBinding(entry.binding, binding)
			? {
					confirmed: {
						answer: entry.binding.answer,
						expiresAtS: entry.ceremonyExpiresAtS,
					},
				}
			: { refusal: "confirmation_mismatch" };
	}

	/** Claim the one sheet; false when one is already open. */
	openSheet(): boolean {
		if (this.#sheetOpen) return false;
		this.#sheetOpen = true;
		return true;
	}

	closeSheet(): void {
		this.#sheetOpen = false;
	}

	/** Whether a sheet is open now; for tests. */
	get sheetOpen(): boolean {
		return this.#sheetOpen;
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

/**
 * The words of one native confirmation sheet. Built by MAIN from its own read of
 * the pairing (`pairingSheet`), never from anything the renderer sent.
 */
export type PairingSheet = {
	message: string;
	detail: string;
	/** The one button that approves (index 0); the other is Cancel. */
	actionLabel: string;
	cancelLabel: string;
};

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
	 * in an isolated world (`MESH_PAIRING_PROBE_WORLD_ID`). A PRE-FILTER only since
	 * US-R2-1: it keeps a page from raising sheets nobody asked for; the native
	 * sheet is what authorizes.
	 */
	userActivation: () => Promise<boolean>;
	/**
	 * Core's open pairing cards (`pairings.list` → `GET /v1/desktop/mesh/pairings`),
	 * read by MAIN through its own forwarder. Anything but a 2xx carrying
	 * `result.pairings` is a failed read (refused, never guessed). The sheet's
	 * every label and the answerability check come from it.
	 */
	readPairings: () => Promise<DesktopResponse>;
	/**
	 * Show `sheet` as a WINDOW-MODAL native message box on the main window and
	 * resolve true ONLY for its action button. Cancel, Escape, closing it, an
	 * abort through `signal` (the card's expiry) or any failure is false.
	 */
	showSheet: (sheet: PairingSheet, signal: AbortSignal) => Promise<boolean>;
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

/** One open card as MAIN reads it: only the fields the sheet and the checks use. */
export type MainPairingRow = {
	side: "inviter" | "joiner";
	inviteId: string;
	nonce: string;
	peerName: string;
	/** The fingerprint, else the device id, else "" - what tells two "Studio Mac"s apart. */
	peerId: string;
	networkName: string;
	role: string;
	expiresAtS: number;
	canAnswerHere: boolean;
	/** Offered items in core's order, `share` as core says (reduce-only list). */
	offers: { key: string; label: string; share: boolean }[];
	offersListed: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/**
 * Find the card `answer` is for in main's own read, or say why it cannot be
 * answered now. Strict on what binds (side, id, nonce, answerability, expiry,
 * offered keys); display fields fall back the way the card's parser does
 * (`mesh-pairings.ts` `parsePairingRow`), so the sheet names what the card drew.
 */
export function livePairingRow(
	rows: unknown,
	answer: PairingCanonicalAnswer,
	nowS: number,
):
	| { row: MainPairingRow }
	| {
			refusal:
				| "pairing_read_failed"
				| "pairing_closed"
				| "pairing_changed"
				| "expired";
	  } {
	if (!Array.isArray(rows)) return { refusal: "pairing_read_failed" };
	const raw = rows
		.map(record)
		.find(
			(item) =>
				item !== null &&
				item.side === answer.side &&
				str(item.invite_id) === answer.inviteId,
		);
	if (!raw) return { refusal: "pairing_closed" };
	const offersRecord = record(raw.offers) ?? {};
	const items = Array.isArray(offersRecord.items) ? offersRecord.items : [];
	const state = str(offersRecord.state);
	const offers = items
		.map(record)
		.filter((item): item is Record<string, unknown> => item !== null)
		.map((item) => ({
			key: str(item.key),
			label: str(item.label) || str(item.key),
			share: item.share !== false,
		}))
		.filter((item) => item.key !== "");
	const expiresAtS = Number(raw.expires_at);
	const row: MainPairingRow = {
		side: answer.side,
		inviteId: answer.inviteId,
		nonce: str(raw.nonce),
		peerName: str(raw.peer_name) || str(raw.peer_device_id),
		peerId: str(raw.fingerprint) || str(raw.peer_device_id),
		networkName: str(raw.network_name) || str(raw.network_id),
		role: str(raw.role),
		expiresAtS: Number.isFinite(expiresAtS) ? expiresAtS : 0,
		canAnswerHere: raw.can_answer_here === true,
		offers,
		// The card's own rule (`pairingOffersView`): a legacy inviter `sent` reads as listed.
		offersListed:
			(state === "listed" || (answer.side === "inviter" && state === "sent")) &&
			offers.length > 0,
	};
	if (!(row.expiresAtS > nowS)) return { refusal: "expired" };
	// A new stage (new nonce) is a new question: the answer was for the old one.
	if (row.nonce === "" || row.nonce !== answer.nonce || !row.canAnswerHere)
		return { refusal: "pairing_changed" };
	// Reduce-only: every share must be an item core offers as shared, by key.
	const offered = new Set(
		row.offersListed
			? row.offers.filter((item) => item.share).map((item) => item.key)
			: [],
	);
	if (answer.shares.some((key) => !offered.has(key)))
		return { refusal: "pairing_changed" };
	return { row };
}

/** Six digits as the card draws them ("481 926"). */
function groupedCode(code: string): string {
	return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/**
 * The sheet for one exact answer, every label from MAIN's read of the card.
 *
 * It names the device (with its fingerprint or id, so two devices of the same
 * name differ), the action, the role, the code being confirmed and the exact
 * credentials that move: what THIS device shares (the inviter's kept list) or
 * what the peer shares with it (the joiner's offered list) - "nothing" when
 * none, and always "nothing" on a decline.
 */
export function pairingSheet(
	answer: PairingCanonicalAnswer,
	row: MainPairingRow,
): PairingSheet {
	const values = { peer: row.peerName, network: row.networkName };
	const admit = answer.act === "respond";
	const message =
		answer.side === "inviter"
			? admit
				? t("ui.mesh.pairing.sheet.message.inviter_admit", values)
				: t("ui.mesh.pairing.sheet.message.inviter_decline", values)
			: admit
				? t("ui.mesh.pairing.sheet.message.joiner_admit", values)
				: t("ui.mesh.pairing.sheet.message.joiner_decline", values);
	const lines = [
		row.peerId
			? t("ui.mesh.pairing.sheet.device", {
					peer: row.peerName,
					id: row.peerId,
				})
			: t("ui.mesh.pairing.sheet.device_name_only", { peer: row.peerName }),
	];
	if (row.role) lines.push(t("ui.mesh.pairing.sheet.role", { role: row.role }));
	if (admit)
		lines.push(
			t("ui.mesh.pairing.sheet.code", { code: groupedCode(answer.code) }),
		);
	if (!admit) lines.push(t("ui.mesh.pairing.sheet.shares_decline"));
	else if (answer.side === "inviter") {
		const labels = answer.shares.map(
			(key) => row.offers.find((item) => item.key === key)?.label ?? key,
		);
		lines.push(
			labels.length > 0
				? t("ui.mesh.pairing.sheet.shares_outgoing", {
						peer: row.peerName,
						list: formatList(labels),
					})
				: t("ui.mesh.pairing.sheet.shares_outgoing_none", {
						peer: row.peerName,
					}),
		);
	} else {
		const labels = row.offersListed
			? row.offers.filter((item) => item.share).map((item) => item.label)
			: [];
		lines.push(
			labels.length > 0
				? t("ui.mesh.pairing.sheet.shares_incoming", {
						peer: row.peerName,
						list: formatList(labels),
					})
				: t("ui.mesh.pairing.sheet.shares_incoming_none", {
						peer: row.peerName,
					}),
		);
	}
	return {
		message,
		detail: lines.join("\n"),
		actionLabel: !admit
			? t("ui.mesh.pairing.sheet.button.decline")
			: answer.side === "inviter"
				? t("ui.mesh.pairing.sheet.button.admit")
				: t("ui.mesh.pairing.sheet.button.join"),
		cancelLabel: t("ui.mesh.pairing.sheet.button.cancel"),
	};
}

async function readLiveRow(
	host: PairingAnswerHost,
	answer: PairingCanonicalAnswer,
	nowS: number,
): Promise<ReturnType<typeof livePairingRow>> {
	let response: DesktopResponse;
	try {
		response = await host.readPairings();
	} catch {
		return { refusal: "pairing_read_failed" };
	}
	const result =
		response.status >= 200 && response.status < 300
			? record(record(response.body)?.result)
			: null;
	return livePairingRow(result?.pairings, answer, nowS);
}

/**
 * `pairings.confirm`: ask the person, on a native sheet, about ONE exact answer,
 * and mint the one-shot token only if they approve it (security review round 2,
 * US-R2-1).
 *
 * 1. Gate, sender document, and the isolated-world activation read - a
 *    PRE-FILTER, so a page cannot raise sheets on its own; it authorizes nothing.
 * 2. FREEZE the canonical answer (act, code, sorted shares, side, invite, nonce)
 *    before anything is read or shown.
 * 3. Claim the one sheet (a second request while one is open is refused).
 * 4. Read the cards from core ITSELF; refuse unless this exact card is open,
 *    answerable, at this nonce, with every share one core offers.
 * 5. Show the window-modal sheet, built from that read alone; it closes itself
 *    at the card's expiry. Anything but the action button mints nothing.
 * 6. After approval, revalidate EVERYTHING - expiry, gate (focus included),
 *    sender document, and a fresh read whose card and sheet text are unchanged -
 *    and only then mint, bound to the document and the frozen answer.
 */
export async function confirmMeshPairing(
	request: PairingConfirmRequest,
	host: PairingAnswerHost,
): Promise<DesktopResponse> {
	const nowMs = host.nowMs ?? Date.now;
	const refused = pairingProvenanceRefusal(host.facts());
	if (refused) return pairingAttestRefusal(refused);
	const document = host.document();
	if (!document) return pairingAttestRefusal("no_window");
	const answer = canonicalPairingAnswer(request);
	if (!(await boundedActivation(host)))
		return pairingAttestRefusal("no_user_action");
	const late = pairingProvenanceRefusal(host.facts());
	if (late) return pairingAttestRefusal(late);
	const after = host.document();
	if (!after || !sameDocument(document, after))
		return pairingAttestRefusal("confirmation_mismatch");
	if (!host.confirmations.openSheet())
		return pairingAttestRefusal("sheet_open");
	try {
		const before = await readLiveRow(host, answer, Math.floor(nowMs() / 1000));
		if ("refusal" in before) return pairingAttestRefusal(before.refusal);
		const sheet = pairingSheet(answer, before.row);
		const remainingMs = before.row.expiresAtS * 1000 - nowMs();
		if (!(remainingMs > 0)) return pairingAttestRefusal("expired");
		// The card's own clock closes the sheet: an approval after expiry is no answer.
		const expiry = new AbortController();
		const timer = setTimeout(() => expiry.abort(), remainingMs);
		let approved = false;
		try {
			approved = (await host.showSheet(sheet, expiry.signal)) === true;
		} catch {
			approved = false;
		} finally {
			clearTimeout(timer);
		}
		// The card's clock closed the sheet (or ran out as it was answered): no answer.
		if (expiry.signal.aborted) return pairingAttestRefusal("expired");
		// Cancel, Escape or a dismissed sheet: nothing minted, nothing sent, and not
		// an error either - the card just becomes answerable again.
		if (!approved)
			return {
				status: 200,
				body: { result: { confirmation: null, cancelled: true } },
			};
		const nowS = Math.floor(nowMs() / 1000);
		if (!(before.row.expiresAtS > nowS)) return pairingAttestRefusal("expired");
		const settled = pairingProvenanceRefusal(host.facts());
		if (settled) return pairingAttestRefusal(settled);
		const current = host.document();
		if (!current || !sameDocument(document, current))
			return pairingAttestRefusal("confirmation_mismatch");
		const again = await readLiveRow(host, answer, nowS);
		if ("refusal" in again) return pairingAttestRefusal(again.refusal);
		// What the person read must still be true: same expiry, same words.
		const reread = pairingSheet(answer, again.row);
		if (
			again.row.expiresAtS !== before.row.expiresAtS ||
			reread.message !== sheet.message ||
			reread.detail !== sheet.detail
		)
			return pairingAttestRefusal("pairing_changed");
		const confirmation = host.confirmations.mint(
			{ document, answer },
			before.row.expiresAtS,
		);
		return { status: 200, body: { result: { confirmation } } };
	} finally {
		host.confirmations.closeSheet();
	}
}

/**
 * Answer one card: consume the confirmation for the IDENTICAL answer, re-check
 * everything, attest, forward. `request` is already schema-valid
 * (`desktop-ipc.ts` parsed it); its `deadline` is the card's expiry hint only.
 */
export async function answerMeshPairing(
	request: PairingAnswerRequest,
	host: PairingAnswerHost,
): Promise<DesktopResponse> {
	const document = host.document();
	const offered = canonicalPairingAnswer(request);
	// Consumed FIRST, whatever happens next: a token is good for one try, so a
	// refusal below never leaves a live one behind for a scripted retry - and a
	// changed code or share list burns it rather than being told what to fix.
	const spent = document
		? host.confirmations.consume(request.confirmation, {
				document,
				answer: offered,
			})
		: ({ refusal: "no_window" } as const);
	const refused = pairingProvenanceRefusal(host.facts());
	if (refused) return pairingAttestRefusal(refused);
	if ("refusal" in spent) return pairingAttestRefusal(spent.refusal);
	const { answer, expiresAtS } = spent.confirmed;

	const nowS = Math.floor((host.nowMs ?? Date.now)() / 1000);
	const ceiling = Math.min(
		expiresAtS,
		request.deadline ?? Number.POSITIVE_INFINITY,
	);
	const deadline = Math.min(nowS + MESH_PAIRING_DEADLINE_S, ceiling);
	if (!(deadline > nowS)) return pairingAttestRefusal("expired");

	// ONE object, built from the FROZEN answer, is attested and forwarded, so the
	// two cannot disagree and neither can differ from what the sheet showed.
	// Shares are sorted and, for the inviter, always explicit (core requires them
	// on an admit and accepts `[]` on a decline). The joiner has no list and sends
	// none; the confirmation token is main's own and never reaches core.
	const forwarded: PairingAnswerRequest & { deadline: number } = {
		op: request.op,
		side: answer.side,
		inviteId: answer.inviteId,
		nonce: answer.nonce,
		decision: answer.act === "respond" ? "admit" : "decline",
		code: answer.code,
		deadline,
		...(answer.side === "inviter" ? { shares: [...answer.shares] } : {}),
	};
	// Revalidated IMMEDIATELY before the dial: the card is still open at this
	// nonce with these shares, and the same sender document holds a window that
	// is still visible and focused.
	const live = await readLiveRow(host, answer, nowS);
	if ("refusal" in live) return pairingAttestRefusal(live.refusal);
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
