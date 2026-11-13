/**
 * A SUGGESTED COMMAND ON AN ASK: what the card may offer, decided as pure rules.
 *
 * An agent that needs the user to do something in a terminal ("glab is signed
 * out — run `glab auth login`") can attach the command to its question
 * (`PendingAskQuestion.command`, core `AskQuestion.command`) and say where it
 * is meant to run (`command_target`). The card then offers two quiet actions:
 * INSERT types the command into a NEW terminal tab of the conversation without
 * pressing Enter, and RUN… types it AND presses Enter after a confirmation
 * dialog. This module is the whole decision surface, kept free of React so
 * `scripts/ask-command.test.mjs` can drive every branch with plain objects.
 *
 * ## Why the core rule is applied twice
 *
 * The core refuses a malformed command at the tool boundary, but this card also
 * renders rows the core did not shape: a peer's mesh row, an older or newer
 * daemon, a hand-written fixture. A command is bytes destined for a shell, so
 * the UI never trusts the wire's word that it was validated: `askCommandOf`
 * re-applies the same rule and answers `null` for anything the core would have
 * refused, and a `null` draws no action at all. The rule (core `_shape`):
 *
 *  - a string that is ALREADY stripped (core stores the stripped value, so a
 *    surrounding space can only be a forged or foreign row — refused, not
 *    re-stripped, so this side never "repairs" something into a command);
 *  - 1..500 characters, counted in code points as Python's `len` counts them;
 *  - no character in Unicode categories Cc (C0/DEL/C1: newline, CR, tab, ESC —
 *    so no line break can submit a line and no bracketed-paste terminator can
 *    escape the paste), Cf (bidi overrides, zero-width characters, BOM — what the
 *    user reads must be what the shell gets) or Zl/Zp (line/paragraph separators).
 *
 * ## Why Run is offered only on the right device (fail closed)
 *
 * The terminal this app opens is a node-pty on THE COMPUTER SHOWING THE CARD,
 * whatever conversation it belongs to (`src/main/console/host.ts`: the console
 * has no notion of a remote conversation). A command meant for the agent's
 * machine therefore must never run on the viewer's computer with one click when
 * the agent works somewhere else: `glab auth login` would sign in the wrong
 * computer. So RUN is offered only when the command will run where it is meant
 * to (`askCommandRunnable`):
 *
 *  - `command_target: "user"` — the command is for the user's own computer,
 *    which is this one by definition; or
 *  - `command_target: "agent"` AND the agent's device is provably this one
 *    (`askAgentPlacement` answers `here`).
 *
 * Everything else — a remote conversation, a backend this app reaches over the
 * network, a conversation the catalogue cannot place, a missing or unknown
 * target — offers INSERT only (plus the selectable command), with a line that
 * says why. Insert is safe on any device: it types, it never presses Enter.
 */
import type { PendingAskQuestion } from "../../../../shared/desktop-session-contract";

/** Core's `max_length` for `AskQuestion.command`, in code points. */
export const ASK_COMMAND_MAX_CHARS = 500;

/**
 * Cc, Cf, Zl and Zp — the categories core refuses. `\p{...}` with the `u` flag
 * is the same Unicode database classification Python's `unicodedata.category`
 * reads, so the two sides refuse the same characters.
 */
const REFUSED_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Where the command is meant to run; `unknown` is anything the wire did not
 * spell as one of the two values, and it is never runnable. */
export type AskCommandTarget = "agent" | "user" | "unknown";

export type AskCommandHint = {
	/** The exact bytes to type, already validated. */
	command: string;
	target: AskCommandTarget;
};

/**
 * The question's command, validated, or `null` when there is none or it would
 * not pass the core's rule. The ONLY reader of `question.command`.
 */
export function askCommandOf(
	question: Pick<PendingAskQuestion, "command" | "command_target"> | null,
): AskCommandHint | null {
	const command = question?.command;
	if (typeof command !== "string") return null;
	if (command.length === 0 || command !== command.trim()) return null;
	// Code points, not UTF-16 units: an emoji is one character to Python's `len`.
	if ([...command].length > ASK_COMMAND_MAX_CHARS) return null;
	if (REFUSED_CHARACTERS.test(command)) return null;
	const raw = question?.command_target;
	const target: AskCommandTarget =
		raw === "agent" || raw === "user" ? raw : "unknown";
	return { command, target };
}

/**
 * Where the conversation's AGENT works, relative to the computer showing this
 * card.
 *
 *  - `here`: provably this computer.
 *  - `elsewhere`: provably another device; `device` is its display name when the
 *    catalogue carries one, else `null`.
 *  - `unknown`: nothing this UI holds proves either — treated as "not here".
 */
export type AskAgentPlacement =
	| { kind: "here" }
	| { kind: "elsewhere"; device: string | null }
	| { kind: "unknown" };

/** The hostnames that are this computer. The attach path's own loopback set
 * (`desktop-api.ts` accepts the same three for a sign-in redirect). */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Whether the backend this renderer talks to runs on this computer.
 *
 * The desktop app normally owns (or discovers) a daemon on loopback, but a
 * launch can ATTACH to a backend it did not start
 * (`LOCAL_OPERATOR_UI_ATTACH_BACKEND_URL`, `src/main/backend/attach-backend.ts`),
 * and that URL may name another host. Every conversation that backend serves
 * then has its agent THERE, so a non-loopback (or unparseable) URL is not "here".
 */
export function isLoopbackBackendUrl(url: string | null | undefined): boolean {
	if (typeof url !== "string" || url.trim() === "") return false;
	try {
		return LOOPBACK_HOSTS.has(new URL(url).hostname);
	} catch {
		return false;
	}
}

/** The catalogue row fields the placement reads (`CanonicalSessionRow`). */
type PlacementRow = {
	session_id: string;
	locality?: unknown;
	owner_device?: unknown;
	owner_device_name?: unknown;
};

/** The placement fact a peers-inclusive page settled (`PlacementFact`). */
type PlacementFactLike = { locality?: unknown; owner_device?: unknown };

/**
 * THE PREDICATE: is the agent of conversation `sessionId` on this computer?
 *
 * Three facts, all required for `here`, each failing closed:
 *
 *  1. The backend is on loopback (`isLoopbackBackendUrl`). A backend on another
 *     host is `elsewhere` for every conversation it serves.
 *  2. Nothing says the conversation lives on a peer: neither the placement fact
 *     (`placementFacts[id].locality === "remote"`, settled by a peers listing or
 *     a move) nor the row's own `locality === "remote"` — the same two sources
 *     `remoteOwnedId` reads (`canonical-sessions-store.ts`). Either one makes it
 *     `elsewhere`, named by the row's device when it carries one.
 *  3. The catalogue HOLDS the conversation. A row with no `locality` came from
 *     a plain listing of the attached backend, which only ever lists the
 *     conversations it owns (a plain page "can never speak about" peers), so a
 *     present row is this backend's — and by (1) this computer's. An id the
 *     catalogue does not hold (a deep link not yet listed, a fleet row from a
 *     conversation the list has not paged in) proves nothing: `unknown`.
 *
 * This is deliberately STRICTER than `remoteOwnedId`, whose "absence is not
 * remote" fails toward local because its callers fail safe that way. Here the
 * safe side is the opposite: a one-click run on the wrong computer.
 */
export function askAgentPlacement(input: {
	sessionId: string | null | undefined;
	backendUrl: string | null | undefined;
	sessions: readonly PlacementRow[];
	placementFacts: Readonly<Record<string, PlacementFactLike | undefined>>;
}): AskAgentPlacement {
	const { sessionId, backendUrl, sessions, placementFacts } = input;
	if (!isLoopbackBackendUrl(backendUrl)) {
		return { kind: "elsewhere", device: null };
	}
	if (!sessionId) return { kind: "unknown" };
	const row = sessions.find((entry) => entry.session_id === sessionId);
	const fact = placementFacts[sessionId];
	if (fact?.locality === "remote" || row?.locality === "remote") {
		return { kind: "elsewhere", device: deviceLabelOf(row, fact) };
	}
	return row ? { kind: "here" } : { kind: "unknown" };
}

/** The device's display name, or `null` — never an invented English floor, so
 * the caller picks the localized "another device" sentence instead. */
function deviceLabelOf(
	row: PlacementRow | undefined,
	fact: PlacementFactLike | undefined,
): string | null {
	const name =
		typeof row?.owner_device_name === "string"
			? row.owner_device_name.trim()
			: "";
	if (name) return name;
	const id =
		typeof row?.owner_device === "string" && row.owner_device
			? row.owner_device
			: typeof fact?.owner_device === "string"
				? fact.owner_device
				: "";
	// `deviceName`'s fallback (`chat-device-model.ts`): the id's tail.
	return id ? id.slice(-8) : null;
}

/**
 * RUN… (type + Enter, behind the confirmation) is offered only when the command
 * will run on the device it is meant for. See the module note.
 */
export function askCommandRunnable(
	hint: AskCommandHint,
	placement: AskAgentPlacement,
): boolean {
	if (hint.target === "user") return true;
	return hint.target === "agent" && placement.kind === "here";
}

/**
 * Which sentence the card shows beside a command it will NOT run, or `null`
 * when Run is offered (the dialog then states the device itself).
 *
 *  - `elsewhere`: "The agent works on {device}. This runs here, not there."
 *  - `elsewhere_unnamed`: the same fact with no device name to give.
 *  - `unplaced`: the catalogue cannot say where the agent works.
 *  - `target_unknown`: the row does not say where the command should run.
 */
export type AskCommandNotice =
	| { kind: "elsewhere"; device: string }
	| { kind: "elsewhere_unnamed" }
	| { kind: "unplaced" }
	| { kind: "target_unknown" };

export function askCommandNotice(
	hint: AskCommandHint,
	placement: AskAgentPlacement,
): AskCommandNotice | null {
	if (askCommandRunnable(hint, placement)) return null;
	if (hint.target === "unknown") return { kind: "target_unknown" };
	if (placement.kind === "elsewhere") {
		return placement.device
			? { kind: "elsewhere", device: placement.device }
			: { kind: "elsewhere_unnamed" };
	}
	return { kind: "unplaced" };
}

/**
 * What the RUN dialog says about the device, given Run was offered.
 *
 *  - `local`: this computer is where the agent works (or the placement is
 *    unknown but the command is the user's own) — "runs on this computer".
 *  - `remote_user`: a `user` command in a conversation whose agent is on another
 *    device — the dialog says it runs HERE, not on {device}.
 */
export type AskCommandDialogDevice =
	| { kind: "local" }
	| { kind: "remote_user"; device: string | null };

export function askCommandDialogDevice(
	placement: AskAgentPlacement,
): AskCommandDialogDevice {
	return placement.kind === "elsewhere"
		? { kind: "remote_user", device: placement.device }
		: { kind: "local" };
}
