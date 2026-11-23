/**
 * The main-process half of answering a queued ask AS THE OPERATOR from the desktop.
 *
 * WHY THIS EXISTS. Core stamps every ask answer with the surface that gave it
 * (`asks/surfaces`), and the dangerous-delete guard counts an answer as the
 * operator's consent only when that stamp is proved. A runtime the wake
 * supervisor, a peer or a model's `bash` started gives the desktop app no
 * capability to prove with, so the operator's own click on a card used to land as
 * `by.surface = unverified` and the guard - correctly - refused it as consent.
 * Core's fix (`asks/app_attest.py`, local-operator #4132) is a per-runtime AF_UNIX
 * listener at `<config>/run/attest/<session_id>.sock` that identifies its dialler
 * by kernel audit token and the app's CODE SIGNATURE, and records the exact answer
 * content that dialler attests, single-use, for 30 s. When serve's ordinary
 * `ask_respond` / `ask_revise` then carries the SAME content, the stamp is
 * `desktop` (`proof: app-signature`). Nothing dialled that listener until this
 * module: it is the dialler, plus the one decision core cannot make from outside
 * the process - whether a PERSON confirmed this exact answer.
 *
 * WHAT IT PROTECTS, HONESTLY. The desktop API is reachable by anything holding the
 * desktop bearer - an agent the operator runs, a peer, Team Bridge, a relay. None
 * of them can produce an attested answer: the listener admits only the signed,
 * unmodified app's main process, and main attests only after its own click-
 * provenance gate (`app-attest.ts`) AND a native sheet the person approved. An
 * agent holding only the bearer can still answer through `sessions.answer`; that
 * answer is stamped `unverified`, exactly as before, and the guard keeps refusing
 * it as consent. Nothing here weakens the guard: an attestation only ever
 * vouches for content a person approved on a trusted control.
 *   - Dev and unsigned builds NEVER attest (operator decision D4): the gate
 *     refuses `not_packaged` and core's verifier refuses them with no override.
 *   - The residual is OS-level synthetic input (Accessibility/TCC-granted
 *     automation clicking the real native sheet), shared with #4132 and the
 *     pairing card; this does not claim to close it.
 *   - Phone and relay answers are a separate, signed-device follow-up; this file
 *     covers the desktop window only.
 *
 * THE CEREMONY (`attestAskAnswer`), one main-only op `asks.attestedAnswer`:
 *   1. The gate (packaged macOS build, `normal` window mode, no debugger, DevTools,
 *      CDP/inspect/`--lo-*` switch, agent launch flag or dev-driver env; the main
 *      window visible, not minimised and focused) and the sender document.
 *   2. The isolated-world activation read - a PRE-FILTER only, so a page cannot
 *      raise sheets the person never asked for. It authorizes nothing.
 *   3. FREEZE the exact answer (session, ask, act, answers) before anything is
 *      read or shown. Everything after attests and forwards that object.
 *   4. Claim the ONE sheet (a second request while one is open is refused, never
 *      queued: a queue would let a page line up sheets behind the one being read).
 *   5. Main reads the ask ITSELF (`asks.list`, the same read the fleet drawer
 *      uses). Every word of the sheet - question text, chosen option labels, the
 *      image count - comes from that read and the frozen answer, never from
 *      renderer-supplied labels. The ask must still be answerable for this act.
 *   6. A WINDOW-MODAL native sheet (`dialog.showMessageBox(mainWindow, ...)`),
 *      which no page script, CDP session or dev driver can click. It closes itself
 *      at the ask's expiry. Cancel, Escape and dismissal dial and forward nothing.
 *   7. Only on the sheet's confirm button: re-read the ask (still answerable, same
 *      words, same expiry), re-run the whole gate (focus included) and the sender
 *      document, then dial the session's socket with the FROZEN content, then
 *      forward that same frozen body through the ordinary `sessions.answer` route.
 *   A missing socket (cold runtime, no listener) or a refused verdict is a keyed
 *   403 the card renders, offering the unconfirmed send or the conversation -
 *   never a silent forward as if it were verified.
 *   8. Read the forward's own receipt: serve answers `consent_bearing` from the
 *      runtime's STAMP. Anything but `true` (a stale or impostor listener that
 *      said ok, an older serve) is the keyed `not_consent_bearing` - the ONE
 *      refusal after which the answer WAS sent - so the card never reports a
 *      confirmation the guard will not count (security review round 1, S3).
 *
 * WHAT MAIN REFUSES TO ATTEST, because the sheet could not show it honestly:
 *   - an answer to a SECRET question (the sheet shows "(hidden)", so the person
 *     would vouch for content they cannot see; a secret is never consent) - S4;
 *   - typed text longer than the sheet shows (`ASK_SHEET_TEXT_LIMIT`) - S5;
 *   - a CHANGE to an answer that was not itself confirmed: core keeps the WEAKEST
 *     surface across an answer and its revisions (`asks/store.py` fold, deliberate
 *     anti-laundering, owned by core #4493), so a confirmed revision of a
 *     plain-sent answer can never become consent. Main reads `answered_by` from
 *     its own `asks.list` row and refuses unless it is a guard-trusted surface
 *     (QA round 1, Q1). Absent `answered_by` is unverified: fail closed.
 *
 * WHAT THE SHEET NAMES (security review round 1, S1): the conversation (its
 * title from main's own `sessions.list` read, plus its session id) and the agent
 * bound to it, so a renderer that names ANOTHER session's identical ask cannot get
 * an indistinguishable sheet. Every agent- or person-written string on the sheet
 * is flattened (`sheetText`: newlines collapsed, control/format/bidi characters
 * stripped) so a question cannot draw a fake answer line (S2).
 *
 * WHICH ACTS. Only `respond` and `revise` are attested: they carry an answer the
 * guard may read as consent. Decline and dismiss approve nothing, so they keep
 * their ordinary path and this op cannot express them (its schema is strict).
 *
 * The renderer never sees the socket and cannot reach it: `ASK_ATTEST_MAIN_OPS`
 * are desktop ops `desktop-ipc.ts` never forwards on its own.
 *
 * NO `electron` IMPORT. Every Electron fact arrives through `AskAnswerHost`, so the
 * ceremony is tested with typed doubles and a real socket
 * (`scripts/ask-attest.test.mjs`) and cannot drift from what main wires.
 */

import { createHash } from "node:crypto";
import { t } from "../i18n/index";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../shared/desktop-contract";
import {
	type AttestDialFailure,
	type AttestDocument,
	type AttestProvenanceFacts,
	type AttestProvenanceRefusal,
	attestProvenanceRefusal,
	attestSocketPath,
	boundedActivation,
	dialAttest,
	sameAttestDocument,
} from "./app-attest";

/** The one desktop op main answers itself for an attested ask answer. */
export const ASK_ATTEST_OP = "asks.attestedAnswer" as const;

/** Core's frame `op` (`AttestService._ask_frame`). */
export const ASK_ATTEST_FRAME_OP = "ask_attest";

/** The refusal code every local refusal answers with (403; the card keys its copy on `reason`). */
export const ASK_ATTEST_REFUSED = "ask_attest_refused";

/**
 * The isolated world main reads page activation in. Not 0 (the page's own world,
 * where a script can redefine `navigator.userActivation`), not 999 (the preload
 * world) and not the pairing probe's 1984, so the two probes never share globals.
 */
export const ASK_ATTEST_PROBE_WORLD_ID = 1_985;

/** How many characters of one question or answer the sheet shows before an ellipsis. */
export const ASK_SHEET_TEXT_LIMIT = 400;

/** Why main would not attest, or why the attestation failed. Stable: the card keys on it. */
export type AskAttestRefusal =
	| AttestProvenanceRefusal
	| AttestDialFailure
	| "no_user_action"
	/** The sending document changed (navigation, renderer loss) mid-ceremony. */
	| "document_changed"
	/** A native confirmation sheet is already open; this request raised none. */
	| "sheet_open"
	/** Main's own read of the asks failed: nothing to name on a sheet. */
	| "ask_read_failed"
	/** Main's read has no such ask, or it can no longer take this act. */
	| "ask_closed"
	/** The ask's words, questions or deadline changed while the sheet was open. */
	| "ask_changed"
	/** The ask's deadline passed before the answer could be attested. */
	| "expired"
	/** The answer includes a secret question's value, which the sheet cannot show. */
	| "secret_answer"
	/** Typed text is longer than the sheet shows. */
	| "answer_too_long"
	/** A change to an answer that was not itself confirmed (core keeps the weakest). */
	| "answer_unconfirmed"
	/** SENT, but the runtime did not stamp it consent-bearing (see step 8). */
	| "not_consent_bearing";

/**
 * Core's `asks.surfaces.GUARD_TRUSTED_SURFACES`: the stamps the dangerous-delete
 * guard counts as the operator's. Mirrored, not owned: main reads it only to
 * refuse a revise-confirm that core's weakest-surface fold could never honour.
 */
export const GUARD_TRUSTED_SURFACES: ReadonlySet<string> = new Set([
	"terminal",
	"tui",
	"desktop",
	"mirror",
]);

export type AskAttestedAnswerRequest = Extract<
	DesktopRequest,
	{ op: typeof ASK_ATTEST_OP }
>;

/** The forward main sends after attesting: the ordinary queued-ask answer body. */
export type AskForwardRequest = Extract<
	DesktopRequest,
	{ op: "sessions.answer" }
>;

/**
 * The ONE answer a sheet asks about and an attestation vouches for, frozen before
 * anything is read or shown. Deep-copied and frozen so a renderer that mutates the
 * object it sent (or sends again) cannot change what is attested or forwarded.
 */
export type FrozenAskAnswer = Readonly<{
	sessionId: string;
	askId: string;
	act: "respond" | "revise";
	answers: Readonly<Record<string, readonly string[]>>;
}>;

export function freezeAskAnswer(
	request: Pick<
		AskAttestedAnswerRequest,
		"sessionId" | "askId" | "answers" | "revise"
	>,
): FrozenAskAnswer {
	const answers: Record<string, readonly string[]> = {};
	for (const [questionId, values] of Object.entries(request.answers))
		answers[questionId] = Object.freeze(values.map((value) => String(value)));
	return Object.freeze({
		sessionId: request.sessionId,
		askId: request.askId,
		act: request.revise === true ? "revise" : "respond",
		answers: Object.freeze(answers),
	});
}

/** One image as core's dispatch arm receives it (`data_b64` is the payload). */
export type AskWireImage = {
	question_id: string;
	mime_type: string;
	data_b64: string;
};

/** One attested image: core's `attested_images` shape. */
export type AskAttestImage = {
	question_id: string;
	mime_type: string;
	sha256: string;
};

/**
 * Core's `image_digests` rule: sha256 hex of the base64-DECODED bytes (never the
 * base64 text - the core contract test pins that exact mistake as `unverified`),
 * bound to the question it answers and its MIME type, sorted (order is not part of
 * the answer). The queued-ask route carries no images today, so `askAttestFrame`
 * defaults to none; this is the rule a future image answer must use.
 *
 * STANDARD ALPHABET ONLY (code review round 1, M1). Node's base64 decoder also
 * accepts the URL-safe `-`/`_`; Python's `b64decode` does not (it drops them and
 * then fails), so the two sides would digest different bytes for one payload.
 * Such a payload THROWS here: a caller must refuse to attest an image core could
 * never match rather than send a digest that silently fails closed.
 */
export function askImageDigests(
	images: readonly AskWireImage[],
): AskAttestImage[] {
	return images
		.map((image) => {
			const text = String(image.data_b64 ?? "");
			if (/[-_]/.test(text))
				throw new RangeError("image data is not standard base64"); // i18n: ignore main-process diagnostic, never shown
			return {
				question_id: String(image.question_id ?? ""),
				mime_type: String(image.mime_type ?? ""),
				sha256: createHash("sha256")
					.update(Buffer.from(text, "base64"))
					.digest("hex"),
			};
		})
		.sort((a, b) =>
			a.question_id !== b.question_id
				? a.question_id < b.question_id
					? -1
					: 1
				: a.mime_type !== b.mime_type
					? a.mime_type < b.mime_type
						? -1
						: 1
					: a.sha256 < b.sha256
						? -1
						: a.sha256 > b.sha256
							? 1
							: 0,
		);
}

/**
 * The frame core's `AttestService._ask_frame` reads. EVERY key is always present
 * (the core contract test `test_ask_attest_contract.py` pins the key set):
 * `images` is `[]` when none, and `reason` is `null` because only a dismissal
 * carries one and a dismissal is never attested here.
 */
export type AskAttestFrame = {
	op: typeof ASK_ATTEST_FRAME_OP;
	session_id: string;
	ask_id: string;
	act: "respond" | "revise";
	answers: Record<string, string[]>;
	images: AskAttestImage[];
	reason: null;
};

export function askAttestFrame(
	answer: FrozenAskAnswer,
	images: readonly AskWireImage[] = [],
): AskAttestFrame {
	const answers: Record<string, string[]> = {};
	for (const [questionId, values] of Object.entries(answer.answers))
		answers[questionId] = [...values];
	return {
		op: ASK_ATTEST_FRAME_OP,
		session_id: answer.sessionId,
		ask_id: answer.askId,
		act: answer.act,
		answers,
		images: askImageDigests(images),
		reason: null,
	};
}

/**
 * The forward, built from the FROZEN answer: byte-for-byte the body the plain
 * Submit/Revise doors build (`answerQueuedAsk` / `reviseQueuedAsk` in
 * `ask-answer.ts`), so serve sends the runtime exactly the content attested.
 */
export function askForwardRequest(answer: FrozenAskAnswer): AskForwardRequest {
	const answers: Record<string, string[]> = {};
	for (const [questionId, values] of Object.entries(answer.answers))
		answers[questionId] = [...values];
	return {
		op: "sessions.answer",
		sessionId: answer.sessionId,
		askId: answer.askId,
		answers,
		...(answer.act === "revise" ? { revise: true } : {}),
	};
}

/** `<config>/run/attest/<session_id>.sock` - core's `socket_path(run_dir, sid)`. */
export function askAttestSocketPath(
	configDir: string,
	sessionId: string,
): string {
	return attestSocketPath(configDir, `${sessionId}.sock`);
}

/** One question as MAIN reads it: only what the sheet and the checks use. */
export type MainAskQuestion = {
	id: string;
	question: string;
	options: string[];
	secret: boolean;
};

/** One ask as MAIN reads it from `asks.list`. */
export type MainAskRow = {
	askId: string;
	sessionId: string;
	status: string;
	delivered: boolean;
	/** Epoch ms of the deadline, or null when the row names none. */
	expiresAtMs: number | null;
	/** `answered_by.surface` of the recorded answer, or null when the row has none. */
	answeredBySurface: string | null;
	questions: MainAskQuestion[];
};

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function mainAskRow(raw: unknown): MainAskRow | null {
	const row = record(raw);
	if (!row || !Array.isArray(row.questions)) return null;
	const questions: MainAskQuestion[] = [];
	for (const item of row.questions) {
		const question = record(item);
		if (!question || !str(question.id)) return null;
		questions.push({
			id: str(question.id),
			question: str(question.question),
			options: Array.isArray(question.options)
				? question.options.map((option) => str(record(option)?.label))
				: [],
			secret: question.secret === true,
		});
	}
	const expires = row.expires_at;
	return {
		askId: str(row.ask_id),
		sessionId: str(row.session_id),
		status: str(row.status),
		delivered: row.delivered === true,
		expiresAtMs:
			typeof expires === "number" && Number.isFinite(expires) ? expires : null,
		answeredBySurface: str(record(row.answered_by)?.surface) || null,
		questions,
	};
}

/**
 * The ask the frozen answer addresses, if main's read shows it still answerable
 * for this act; else why not.
 *
 * - `respond` needs `open`; `revise` needs `answered` and NOT yet delivered (the
 *   window design §10 names; core refuses otherwise, this only keeps a sheet from
 *   asking about an answer core would refuse).
 * - Every answered question id must be one of the ask's questions, so a sheet
 *   never shows an answer to a question main cannot name.
 * - A row past its deadline is closed whatever its status says.
 */
export function liveAskRow(
	asks: unknown,
	answer: FrozenAskAnswer,
	nowMs: number,
):
	| { row: MainAskRow }
	| { refusal: "ask_closed" | "ask_read_failed" | "answer_unconfirmed" } {
	if (!Array.isArray(asks)) return { refusal: "ask_read_failed" };
	const raw = asks.find((item) => {
		const row = record(item);
		return (
			row !== null &&
			row.ask_id === answer.askId &&
			row.session_id === answer.sessionId
		);
	});
	const row = raw === undefined ? null : mainAskRow(raw);
	if (!row) return { refusal: "ask_closed" };
	const answerable =
		answer.act === "respond"
			? row.status === "open"
			: row.status === "answered" && !row.delivered;
	if (!answerable) return { refusal: "ask_closed" };
	if (row.expiresAtMs !== null && !(row.expiresAtMs > nowMs))
		return { refusal: "ask_closed" };
	const ids = new Set(row.questions.map((question) => question.id));
	const keys = Object.keys(answer.answers);
	if (keys.length === 0 || keys.some((key) => !ids.has(key)))
		return { refusal: "ask_closed" };
	// Q1: core's fold keeps the weakest surface, so only a change to an answer that
	// was ITSELF trusted can still be consent afterwards. Checked on both reads.
	if (
		answer.act === "revise" &&
		!GUARD_TRUSTED_SURFACES.has(row.answeredBySurface ?? "")
	)
		return { refusal: "answer_unconfirmed" };
	return { row };
}

/**
 * Whether the sheet can show `answer` honestly enough to attest it: no secret
 * question's value (S4) and no typed text past `ASK_SHEET_TEXT_LIMIT` (S5).
 * Measured on the flattened text the sheet would draw.
 */
export function askAttestable(
	answer: FrozenAskAnswer,
	row: MainAskRow,
): "secret_answer" | "answer_too_long" | null {
	for (const question of row.questions) {
		const values = answer.answers[question.id];
		if (!values) continue;
		if (question.secret) return "secret_answer";
		for (const value of values)
			if (
				!question.options.includes(value) &&
				sheetText(value).length > ASK_SHEET_TEXT_LIMIT
			)
				return "answer_too_long";
	}
	return null;
}

/** The words of one native confirmation sheet, built by MAIN alone. */
export type AskSheet = {
	message: string;
	detail: string;
	/** The one button that confirms (index 0); the other is Cancel. */
	actionLabel: string;
	cancelLabel: string;
};

/** Unicode control (Cc) and format (Cf: bidi overrides/isolates, zero-width) characters. */
const SHEET_INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/**
 * Agent- or person-written text as ONE flat line for the native sheet (S2): every
 * whitespace run (newlines, U+2028/2029 included) becomes one space, and control
 * and format characters are removed, so a question cannot draw its own fake
 * "→ No" line and a bidi override cannot reorder what the person reads.
 */
export function sheetText(text: string): string {
	return text
		.replace(/\s+/gu, " ")
		.replace(SHEET_INVISIBLE, "")
		.replace(/\s+/gu, " ")
		.trim();
}

function clip(text: string, limit = ASK_SHEET_TEXT_LIMIT): string {
	const flat = sheetText(text);
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** How many characters of a conversation title or agent name the sheet shows. */
export const ASK_SHEET_LABEL_LIMIT = 120;

/**
 * Which conversation an ask belongs to, from MAIN's own read (`sessions.list`):
 * its display name and bound agent, each "" when the read has none.
 */
export type AskSessionLabel = { title: string; agent: string };

/** The conversation's row in a `sessions.list` answer, reduced to the sheet's label. */
export function askSessionLabel(
	body: unknown,
	sessionId: string,
): AskSessionLabel | null {
	const sessions = record(record(body)?.result)?.sessions;
	if (!Array.isArray(sessions)) return null;
	const row = sessions
		.map(record)
		.find((item) => item !== null && item.id === sessionId);
	if (!row) return null;
	return {
		title: str(row.name),
		agent: str(record(row.binding)?.agent),
	};
}

/**
 * The sheet for `answer` against main's own `row`. The question text and option
 * labels are the row's. A chosen value that is one of the question's options is
 * shown as that label; anything else is the person's own typed text, shown as
 * sent (clipped for length) because it IS what will be sent - and a secret
 * question's value is never put on screen.
 */
export function askSheet(
	answer: FrozenAskAnswer,
	row: MainAskRow,
	label: AskSessionLabel | null = null,
): AskSheet {
	const lines: string[] = [];
	// S1: the session id ALWAYS (it is what the attestation is bound to), the title
	// and the agent when main's read has them.
	const title = clip(label?.title ?? "", ASK_SHEET_LABEL_LIMIT);
	const agent = clip(label?.agent ?? "", ASK_SHEET_LABEL_LIMIT);
	const where = [
		title
			? t("ui.chat.ask_attest.sheet.conversation", {
					title,
					session: answer.sessionId,
				})
			: t("ui.chat.ask_attest.sheet.conversation_untitled", {
					session: answer.sessionId,
				}),
	];
	if (agent) where.push(t("ui.chat.ask_attest.sheet.agent", { agent }));
	lines.push(where.join("\n"));
	for (const question of row.questions) {
		const values = answer.answers[question.id];
		if (!values) continue;
		const shown = question.secret
			? t("ui.chat.ask_attest.sheet.secret_value")
			: values.length === 0
				? t("ui.chat.ask_attest.sheet.no_value")
				: values
						.map((value) =>
							question.options.includes(value)
								? clip(value)
								: t("ui.chat.ask_attest.sheet.typed_value", {
										value: clip(value),
									}),
						)
						.join(", ");
		lines.push(
			t("ui.chat.ask_attest.sheet.answer_line", {
				question: clip(question.question) || question.id,
				answer: shown,
			}),
		);
	}
	lines.push(t("ui.chat.ask_attest.sheet.consent_note"));
	return {
		message:
			answer.act === "revise"
				? t("ui.chat.ask_attest.sheet.message_revise")
				: t("ui.chat.ask_attest.sheet.message_respond"),
		detail: lines.join("\n\n"),
		// D3: the button repeats the question's verb (macOS alert convention, and the
		// mesh sheet's "Admit"/"Join").
		actionLabel:
			answer.act === "revise"
				? t("ui.chat.ask_attest.sheet.button.change")
				: t("ui.chat.ask_attest.sheet.button.send"),
		cancelLabel: t("ui.chat.ask_attest.sheet.button.cancel"),
	};
}

/**
 * The ONE native sheet that may be open for an ask answer. A second request while
 * one is open is refused, never queued (a queue would let a page line up sheets
 * behind the one being read, and a reflexive second click would confirm the next).
 */
export class AskSheetLock {
	#open = false;

	/** Claim the sheet; false when one is already open. */
	open(): boolean {
		if (this.#open) return false;
		this.#open = true;
		return true;
	}

	close(): void {
		this.#open = false;
	}

	get isOpen(): boolean {
		return this.#open;
	}
}

/** What main supplies per call; every field is main's own reading. */
export type AskAnswerHost = {
	/** The gate's facts, read at the moment of the call. */
	facts: () => AttestProvenanceFacts;
	/** The SENDING document, or null when it is not the main window's main frame. */
	document: () => AttestDocument | null;
	/** Isolated-world `navigator.userActivation.isActive`: a pre-filter only. */
	userActivation: () => Promise<boolean>;
	/** Main's own `asks.list` read (`GET /v1/desktop/asks`). */
	readAsks: () => Promise<DesktopResponse>;
	/**
	 * Main's own `sessions.list` read, for the conversation the sheet names (S1).
	 * A failed or missing read is not a refusal: the sheet still names the session id.
	 */
	readSessions: () => Promise<DesktopResponse>;
	/**
	 * Show `sheet` WINDOW-MODAL on the main window and resolve true ONLY for its
	 * action button. Cancel, Escape, closing it, an abort through `signal` (the
	 * ask's expiry) or any failure is false.
	 */
	showSheet: (sheet: AskSheet, signal: AbortSignal) => Promise<boolean>;
	sheet: AskSheetLock;
	configDir: () => string;
	/** The ordinary desktop forwarder (the same one `sessions.answer` rides). */
	forward: (input: AskForwardRequest) => Promise<DesktopResponse>;
	nowMs?: () => number;
	attest?: (
		socketPath: string,
		frame: AskAttestFrame,
	) => Promise<AttestDialFailure | null>;
};

/** A local refusal, in the desktop plane's `{detail: {code, reason, message}}` shape. */
export function askAttestRefusal(reason: AskAttestRefusal): DesktopResponse {
	return {
		status: 403,
		body: {
			detail: {
				code: ASK_ATTEST_REFUSED,
				reason,
				// The card keys its own copy on `code`/`reason`; this sentence is for
				// logs and older renderers only.
				message: `This app could not confirm the answer as yours (${reason}).`, // i18n: ignore main-process diagnostic, renderer renders keyed copy
			},
		},
	};
}

async function readSessionLabel(
	host: AskAnswerHost,
	sessionId: string,
): Promise<AskSessionLabel | null> {
	try {
		const response = await host.readSessions();
		if (!(response.status >= 200 && response.status < 300)) return null;
		return askSessionLabel(response.body, sessionId);
	} catch {
		return null;
	}
}

async function readLiveAsk(
	host: AskAnswerHost,
	answer: FrozenAskAnswer,
	nowMs: number,
): Promise<ReturnType<typeof liveAskRow>> {
	let response: DesktopResponse;
	try {
		response = await host.readAsks();
	} catch {
		return { refusal: "ask_read_failed" };
	}
	if (!(response.status >= 200 && response.status < 300))
		return { refusal: "ask_read_failed" };
	return liveAskRow(record(record(response.body)?.result)?.asks, answer, nowMs);
}

/**
 * `asks.attestedAnswer`: the whole ceremony (see the file header). `request` is
 * already schema-valid (`desktop-ipc.ts` parsed it).
 */
export async function attestAskAnswer(
	request: AskAttestedAnswerRequest,
	host: AskAnswerHost,
): Promise<DesktopResponse> {
	const nowMs = host.nowMs ?? Date.now;
	const refused = attestProvenanceRefusal(host.facts());
	if (refused) return askAttestRefusal(refused);
	const document = host.document();
	if (!document) return askAttestRefusal("no_window");
	// Frozen BEFORE the first await: nothing the renderer does after sending can
	// change what is shown, attested or forwarded.
	const answer = freezeAskAnswer(request);
	if (!(await boundedActivation(() => host.userActivation())))
		return askAttestRefusal("no_user_action");
	const late = attestProvenanceRefusal(host.facts());
	if (late) return askAttestRefusal(late);
	const after = host.document();
	if (!after || !sameAttestDocument(document, after))
		return askAttestRefusal("document_changed");
	if (!host.sheet.open()) return askAttestRefusal("sheet_open");
	try {
		const before = await readLiveAsk(host, answer, nowMs());
		if ("refusal" in before) return askAttestRefusal(before.refusal);
		const unshowable = askAttestable(answer, before.row);
		if (unshowable) return askAttestRefusal(unshowable);
		const label = await readSessionLabel(host, answer.sessionId);
		const sheet = askSheet(answer, before.row, label);
		const expiresAtMs = before.row.expiresAtMs;
		// The ask's own clock closes the sheet: a confirmation after expiry is no answer.
		const expiry = new AbortController();
		const timer =
			expiresAtMs === null
				? undefined
				: setTimeout(() => expiry.abort(), Math.max(0, expiresAtMs - nowMs()));
		let approved = false;
		try {
			approved = (await host.showSheet(sheet, expiry.signal)) === true;
		} catch {
			approved = false;
		} finally {
			clearTimeout(timer);
		}
		if (expiry.signal.aborted) return askAttestRefusal("expired");
		// No sheet could be shown, or it closed with its window: not the person's
		// cancel, so say why instead of reporting "cancelled".
		if (!approved && !host.document()) return askAttestRefusal("no_window");
		// Cancel, Escape or a dismissed sheet: nothing dialled, nothing sent, and not
		// an error either - the card just becomes answerable again.
		if (!approved)
			return { status: 200, body: { result: { cancelled: true } } };
		const current = host.document();
		if (!current || !sameAttestDocument(document, current))
			return askAttestRefusal("document_changed");
		const again = await readLiveAsk(host, answer, nowMs());
		if ("refusal" in again) return askAttestRefusal(again.refusal);
		// What the person read must still be true: same deadline, same words.
		const reread = askSheet(answer, again.row, label);
		if (
			again.row.expiresAtMs !== expiresAtMs ||
			reread.message !== sheet.message ||
			reread.detail !== sheet.detail
		)
			return askAttestRefusal("ask_changed");
		// The focus gate is read AFTER the fresh read, not in the first task after
		// the sheet closes: AppKit may hand key status back to the parent a beat
		// after the sheet orders out (pairing code review round 3, R3-m1).
		const settled = attestProvenanceRefusal(host.facts());
		if (settled) return askAttestRefusal(settled);
		// And the sender document once more, right before the dial: the fresh read
		// awaited core, and the page may have navigated meanwhile.
		const dialling = host.document();
		if (!dialling || !sameAttestDocument(document, dialling))
			return askAttestRefusal("document_changed");
		if (expiresAtMs !== null && !(expiresAtMs > nowMs()))
			return askAttestRefusal("expired");
		// ONE frozen answer is attested and forwarded, so the two cannot disagree
		// and neither can differ from what the sheet showed.
		const failure = await (host.attest ?? dialAttest)(
			askAttestSocketPath(host.configDir(), answer.sessionId),
			askAttestFrame(answer),
		);
		if (failure) return askAttestRefusal(failure);
		const forwarded = await host.forward(askForwardRequest(answer));
		// Step 8 (S3): a delivered answer the runtime did not stamp consent-bearing
		// must not read as a confirmation. A non-2xx forward (busy, settled) is the
		// ordinary refusal and passes through for the card's own copy.
		if (
			forwarded.status >= 200 &&
			forwarded.status < 300 &&
			record(record(forwarded.body)?.result)?.consent_bearing !== true
		)
			return askAttestRefusal("not_consent_bearing");
		return forwarded;
	} finally {
		host.sheet.close();
	}
}

/**
 * The ask ops MAIN answers itself (`desktop-ipc.ts` checks this before any generic
 * forwarding). Never forwarded as sent: there is no core route by this name, and
 * forwarding it would skip the ceremony.
 */
export const ASK_ATTEST_MAIN_OPS: ReadonlySet<string> = new Set([
	ASK_ATTEST_OP,
]);

/** Whether a renderer input is one of main's own ask-attestation ops. */
export function isAskAttestMainOp(input: unknown): boolean {
	return (
		typeof input === "object" &&
		input !== null &&
		ASK_ATTEST_MAIN_OPS.has(String((input as { op?: unknown }).op))
	);
}
