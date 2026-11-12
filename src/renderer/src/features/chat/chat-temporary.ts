/**
 * Temporary chats, as decisions the app can be tested on rather than as JSX
 * conditions (`chat-archived.ts`'s twin, for its reason: the sidebar and the
 * header cannot be rendered in this repo's node suite, so the rules live here and
 * `scripts/chat-temporary.test.mjs` runs them).
 *
 * WHAT A TEMPORARY CHAT IS: an ordinary conversation of the user's own that the
 * core deletes once it has been idle for its window (`features.temporary_chats`,
 * contract §2.3). While it lives it is viewable and steerable like any other; it
 * is left out of the normal lists and drawn only in the sidebar's own
 * `Temporary · N` group.
 *
 * EVERY RULE HERE FAILS CLOSED ON THE CAPABILITY. With `temporary_chats` absent
 * the client reads no row's `temporary`, partitions nothing and offers nothing,
 * so an older core renders the app it rendered before this feature existed.
 */
import type {
	SessionTemporaryInfo,
	TemporaryHoldCode,
} from "../../../../shared/desktop-session-contract";

/** The last stretch of the idle window in which the countdown is drawn (amber). */
export const TEMPORARY_COUNTDOWN_S = 5 * 60;

/** The refusal code a pin or project link answers for a temporary chat (409). */
export const SESSION_TEMPORARY_CODE = "session_temporary";
/** The 404 code for an id the core deleted as a temporary chat. */
export const SESSION_TEMPORARY_DELETED_CODE = "session_temporary_deleted";

/** The closed hold vocabulary of contract §2.2, in the order the core lists it. */
export const TEMPORARY_HOLD_CODES: readonly TemporaryHoldCode[] = [
	"running",
	"on_screen",
	"open_ask",
	"armed_wake",
	"armed_monitor",
	"unread_mail",
	"operator_hold",
	"unseen_result",
	"unsaved_files",
	"linked",
	"cannot_verify",
];

type RowWithTemporary = { temporary?: SessionTemporaryInfo | null };

/**
 * Whether the row's `temporary` is the object the wire promises.
 *
 * Shape-checked rather than truthiness-checked: a malformed value is read as NOT
 * temporary, which keeps the conversation in the ordinary list - the visible
 * direction, never the hidden one.
 */
export function temporaryInfo(
	row: RowWithTemporary | null | undefined,
	enabled: boolean,
): SessionTemporaryInfo | null {
	if (!enabled || !row) return null;
	const info = row.temporary;
	if (info === null || typeof info !== "object") return null;
	if (typeof info.marked_at !== "number" || !Number.isFinite(info.marked_at))
		return null;
	return info;
}

/**
 * The rows the normal lists may draw, and the rows the `Temporary` group draws.
 *
 * The withdrawn arm returns the SAME array and reads no row, `visibleRows`'s
 * rule: a stale optimistic value on a row must never hide a conversation behind
 * a group that is not drawn.
 */
export function partition<T extends RowWithTemporary>(
	rows: T[],
	enabled: boolean,
): { normal: T[]; temporary: T[] } {
	if (!enabled) return { normal: rows, temporary: [] };
	let any = false;
	for (const row of rows) {
		if (temporaryInfo(row, true) !== null) {
			any = true;
			break;
		}
	}
	// Identity kept when nothing is temporary: a 500-row list must not re-render
	// for a partition that moved nothing.
	if (!any) return { normal: rows, temporary: [] };
	const normal: T[] = [];
	const temporary: T[] = [];
	for (const row of rows)
		(temporaryInfo(row, true) !== null ? temporary : normal).push(row);
	return { normal, temporary };
}

/**
 * Whether the collapsed `Temporary · N` group opens by itself: only while it
 * holds the conversation on screen, so the reader can always see the row of the
 * chat they are in, and the group otherwise stays out of the way.
 */
export function groupOpenByDefault(
	currentId: string | null | undefined,
	temporaryRows: readonly { session_id: string }[],
): boolean {
	if (!currentId) return false;
	return temporaryRows.some((row) => row.session_id === currentId);
}

/**
 * Whole minutes left before deletion, rounded DOWN, never below 1; `null` while
 * held.
 *
 * Down, not up (QA round 1, Q-4): the core stamps `deletes_at` a fraction of a
 * second after the mark, so a ceiling read a fresh 30-minute chat as "31 min" -
 * longer than the window the setting names. The floor never promises more time
 * than is left; the `1` floor keeps the last minute from reading "0".
 */
export function minutesLeft(
	info: SessionTemporaryInfo,
	nowS: number,
): number | null {
	if (info.hold !== null && info.hold !== undefined) return null;
	if (typeof info.deletes_at !== "number" || !Number.isFinite(info.deletes_at))
		return null;
	return Math.max(1, Math.floor((info.deletes_at - nowS) / 60));
}

/**
 * Whether the amber countdown is drawn: only in the last five minutes, and never
 * while a hold applies (a held chat is not counting down).
 */
export function showCountdown(
	deletesAt: number | null | undefined,
	nowS: number,
): boolean {
	if (typeof deletesAt !== "number" || !Number.isFinite(deletesAt))
		return false;
	return deletesAt - nowS <= TEMPORARY_COUNTDOWN_S;
}

/**
 * The row's secondary line, as a key and its params: why the chat is held, or
 * how long it has left. A hold code this build does not know reads as the
 * generic `cannot_verify` sentence rather than a guess at its meaning.
 */
export function deletesInLabel(
	info: SessionTemporaryInfo,
	nowS: number,
):
	| { key: "deletes_in"; minutes: number }
	| { key: "hold"; code: TemporaryHoldCode } {
	if (info.hold !== null && info.hold !== undefined)
		return { key: "hold", code: holdCode(info.hold) };
	const minutes = minutesLeft(info, nowS);
	if (minutes === null) return { key: "hold", code: "cannot_verify" };
	return { key: "deletes_in", minutes };
}

function holdCode(code: string): TemporaryHoldCode {
	return (TEMPORARY_HOLD_CODES as readonly string[]).includes(code)
		? (code as TemporaryHoldCode)
		: "cannot_verify";
}

/**
 * The catalogue key for each hold code, spelled out so every key is a literal
 * the i18n gates can see (a template would hide eleven keys from them).
 */
const HOLD_LABEL_KEYS = {
	running: "ui.chat.sidebar_view.temporary.hold.running",
	on_screen: "ui.chat.sidebar_view.temporary.hold.on_screen",
	open_ask: "ui.chat.sidebar_view.temporary.hold.open_ask",
	armed_wake: "ui.chat.sidebar_view.temporary.hold.armed_wake",
	armed_monitor: "ui.chat.sidebar_view.temporary.hold.armed_monitor",
	unread_mail: "ui.chat.sidebar_view.temporary.hold.unread_mail",
	operator_hold: "ui.chat.sidebar_view.temporary.hold.operator_hold",
	unseen_result: "ui.chat.sidebar_view.temporary.hold.unseen_result",
	unsaved_files: "ui.chat.sidebar_view.temporary.hold.unsaved_files",
	linked: "ui.chat.sidebar_view.temporary.hold.linked",
	cannot_verify: "ui.chat.sidebar_view.temporary.hold.cannot_verify",
} as const satisfies Record<TemporaryHoldCode, string>;

/** The catalogue key for a hold code; unknown codes fall to `cannot_verify`. */
export function holdLabelKey(
	code: string,
): (typeof HOLD_LABEL_KEYS)[TemporaryHoldCode] {
	return HOLD_LABEL_KEYS[holdCode(code)];
}

/**
 * Which header-menu item applies to the conversation on screen: `keep` on a
 * temporary chat, `make` on an ordinary one, nothing without the capability or
 * on a draft (a draft's switch is the header toggle, not the menu).
 */
export function temporaryMenuAction(
	enabled: boolean,
	isDraft: boolean,
	info: SessionTemporaryInfo | null,
): "keep" | "make" | null {
	if (!enabled || isDraft) return null;
	return info !== null ? "keep" : "make";
}

/**
 * The remedy a refusal offers: "Keep and pin" / "Keep and link" when the core
 * refused because the chat is temporary, nothing otherwise.
 */
export function refusalRemedy(
	code: string | undefined,
	act: "pin" | "link",
): "keep_and_pin" | "keep_and_link" | null {
	if (code !== SESSION_TEMPORARY_CODE) return null;
	return act === "pin" ? "keep_and_pin" : "keep_and_link";
}

/**
 * The rows a picker that ATTACHES a conversation to something durable may
 * offer: the project "Link a session" picker and the chief-of-staff options
 * (review round 1, R1-1). A temporary chat cannot be linked or designated until
 * it is kept, so offering one is offering a 409; the race that can still produce
 * one (a chat marked elsewhere after the list read) is the link handler's to
 * remedy (`refusalRemedy`).
 */
export function attachableSessions<T extends RowWithTemporary>(
	rows: T[],
	enabled: boolean,
): T[] {
	return partition(rows, enabled).normal;
}

/**
 * The rows the Ctrl+Tab switcher is built from: the normal list, plus the
 * conversation ON SCREEN when that one is temporary (QA round 1, Q-2).
 *
 * The run itself still skips temporary chats; only row 0 - the chat the reader
 * is in - needs its row back, because the switcher titles row 0 from this list
 * and without it a temporary chat read "Untitled chat".
 */
export function switcherSessions<
	T extends RowWithTemporary & { session_id: string },
>(rows: T[], enabled: boolean, displayedId: string | null): T[] {
	const { normal, temporary } = partition(rows, enabled);
	if (!displayedId || temporary.length === 0) return normal;
	const current = temporary.find((row) => row.session_id === displayedId);
	return current ? [current, ...normal] : normal;
}

/**
 * Whether a draft's create carries `temporary: true`.
 *
 * Never toward a peer (review round 1, R1-2): the core answers 422
 * `temporary_peer_unsupported` (contract §8 defers it), so the switch is shown
 * disabled while a peer is the destination and a draft persisted with both
 * still creates an ordinary chat rather than failing the whole create. Never
 * without the capability, for the persisted-draft reason on `ChatDraft.temporary`.
 */
export function draftCreatesTemporary(
	draft: { temporary?: boolean; peer?: string } | null | undefined,
	enabled: boolean,
): boolean {
	return enabled && draft?.temporary === true && !draft.peer;
}

/**
 * The composer's invitation while a draft will be created temporary (design
 * round 1, D1): the screen says so in words, not only in the toggle's colour,
 * before the first send - the moment it matters. `null` keeps the app's own
 * idle line.
 */
export function temporaryDraftPlaceholderKey(
	draftTemporary: boolean | undefined,
): "ui.chat.composer.placeholder.temporary" | null {
	return draftTemporary === true
		? "ui.chat.composer.placeholder.temporary"
		: null;
}

/** Whether a refusal's code says the conversation was deleted as a temporary chat. */
export function isTemporaryDeleted(code: string | null | undefined): boolean {
	return code === SESSION_TEMPORARY_DELETED_CODE;
}
