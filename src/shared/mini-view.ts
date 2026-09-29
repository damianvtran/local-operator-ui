/**
 * The mini view's shared vocabulary: channel names, payload shapes and the
 * pure formatting the three processes have to agree on.
 *
 * WHY THIS FILE EXISTS IN `src/shared/`. The mini view is the app's only
 * window besides the main one whose IPC is a contract across main, the preload
 * and a renderer, and the same discipline `window-chrome.ts` records applies
 * here: a channel name or a payload shape spelled twice is how one of the two
 * drifts, and the drift is silent because both halves are well-formed strings.
 * So the names, the status union and the display mapping live here once, and
 * `scripts/mini-view-contract.test.mjs` pins the three consumers against this
 * file rather than against each other.
 *
 * WHAT IT DELIBERATELY IS NOT. It imports nothing from Electron and nothing
 * from the renderer: `formatQuickSendDisplay` is a pure mapping over the
 * stored value and a platform string, so the desktop suite can run it in
 * process for all three platforms, and the settings-side surfaces can reuse it
 * without pulling a window in.
 */

/**
 * Main -> the mini renderer: the composer is on screen and may take the
 * keystroke.
 *
 * The payload carries an arrival stamp so a renderer can tell a re-summon from
 * a stale replay; nothing decides from it, and the design's `{ at: number }`
 * shape is kept literal so a later field is an addition rather than a
 * reinterpretation.
 */
export const MINI_VIEW_SUMMONED = "mini-view:summoned";

/**
 * The mini renderer -> main: put the window away.
 *
 * A reason rather than a bare call, because the four dismissals are different
 * acts (Esc, losing focus, a completed send, the error's own dismiss) and the
 * log line for a hide is the only account of why a window disappeared.
 */
export const MINI_VIEW_DISMISS = "mini-view:dismiss";

/** Main -> every renderer: the live registration state (settings row badge). */
export const MINI_VIEW_REGISTRATION = "mini-view:registration";

/** Renderer -> main: the current registration state, for a freshly mounted row. */
export const MINI_VIEW_REGISTRATION_GET = "mini-view:registration-get";

/**
 * Whether the global shortcut is live, and why not when it is not.
 *
 * `registered` is the only state in which pressing the chord opens the mini
 * view. `taken` means the system refused the chord at `register()` — Electron's
 * `register() === false`; the platform's answer is narrower than the word:
 * macOS returns false only for a duplicate inside this process (a cross-app
 * conflict there registers true and is the silent dead key the settings row's
 * macOS boundary sentence exists for — see `mini-copy.ts`), while Windows and
 * Linux refuse a chord another process holds. `invalid` means the stored value
 * names a chord this system cannot express; `unavailable` is the platform-level
 * refusal (Wayland sessions own the global shortcut space, so a registration
 * there would be a silent dead key). Every one of the four is surfaced to the
 * settings row and logged — a dead key nobody is told about is the failure this
 * design forbids.
 */
export const MINI_VIEW_REGISTRATION_STATUSES = [
	"registered",
	"taken",
	"invalid",
	"unavailable",
] as const;

export type MiniViewRegistrationStatus =
	(typeof MINI_VIEW_REGISTRATION_STATUSES)[number];

export interface MiniViewRegistrationState {
	/** The effective stored value the registration was attempted with. */
	value: string;
	/** The resolved Electron accelerator, or "" when no chord was resolvable. */
	accelerator: string;
	status: MiniViewRegistrationStatus;
	/**
	 * The machine-readable reason for a non-`registered` status, for the log
	 * line and the settings row's detail. Never the sole user-facing copy: the
	 * row renders its own sentence per status (see the settings control).
	 */
	reason?: string;
}

/**
 * Why the mini view was dismissed. One name per act, the same discipline the
 * raise triggers keep: a hide the log cannot explain is indistinguishable from
 * a window that vanished.
 */
export const MINI_VIEW_DISMISS_REASONS = [
	"escape",
	"blur",
	"sent",
	"error-dismiss",
] as const;

export type MiniViewDismissReason = (typeof MINI_VIEW_DISMISS_REASONS)[number];

/** Whether a value off the wire is one of the four named dismissals. */
export function isMiniViewDismissReason(
	value: unknown,
): value is MiniViewDismissReason {
	return (
		typeof value === "string" &&
		(MINI_VIEW_DISMISS_REASONS as readonly string[]).includes(value)
	);
}

/** The payload main stamps onto a summon. */
export interface MiniViewSummonedPayload {
	at: number;
}

/** Whether a value off the wire has the summon payload's shape. */
export function isMiniViewSummonedPayload(
	value: unknown,
): value is MiniViewSummonedPayload {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { at?: unknown }).at === "number"
	);
}

/**
 * Whether a value off the wire has the registration state's shape.
 *
 * THE PRELOAD'S OWN RULE MADE REAL (review round 1, R2/nit-1): its
 * `onRegistration` listener used to hand the payload to the callback
 * unvalidated while the namespace's comment claimed every listener verified
 * its shape, and a malformed push would reach the settings row and the mini
 * header, which degrade silently. Required fields are the two the consumers
 * read unconditionally; `reason` is optional by contract and, when present,
 * must still be a string.
 */
export function isMiniViewRegistrationState(
	value: unknown,
): value is MiniViewRegistrationState {
	if (value === null || typeof value !== "object") return false;
	const state = value as Partial<MiniViewRegistrationState>;
	if (typeof state.value !== "string") return false;
	if (typeof state.accelerator !== "string") return false;
	if (state.reason !== undefined && typeof state.reason !== "string")
		return false;
	return (MINI_VIEW_REGISTRATION_STATUSES as readonly unknown[]).includes(
		state.status,
	);
}

/**
 * The mini view's fixed size, in DIP. One pair of numbers, because THREE
 * consumers depend on them agreeing: the main process sizes the window, the
 * renderer lays its composer out to those bounds, and the evidence scene
 * photographs at that size. 640 x 168 is the design's figure: one composer row
 * that grows to four lines plus one hint row, never resized.
 */
export const MINI_VIEW_WIDTH = 640;
export const MINI_VIEW_HEIGHT = 168;

/**
 * The shipped hotkey default, in the STORED grammar (`primary+alt+space`).
 *
 * HERE RATHER THAN IN `src/main/`: three processes read it — the registrar
 * falls back to it when `config.yml` is unreadable, the settings-side surfaces
 * render it, and the mini view's header shows it when no registration state is
 * readable yet — and one literal read by three processes is how defaults
 * drift. The cross-repo guard is the desktop suite's: the drift case in
 * `scripts/hotkey-registration.test.mjs` asserts this equals
 * `keymap.quick_send`'s default in the committed registry fixture.
 */
export const DEFAULT_QUICK_SEND_VALUE = "primary+alt+space";

/** The three platforms the display mapping distinguishes, as CSS spells them. */
export type MiniViewPlatform = "mac" | "win" | "linux";

/** A key token that names a function key (`f1`..`f24`), at module scope so the
 * test is one compiled literal rather than one per call. */
const FUNCTION_KEY_TOKEN = /^f([1-9]|1[0-9]|2[0-4])$/;

/**
 * Whether a stored-grammar key token names a function key.
 *
 * Exported because TWO surfaces need the same answer from different grammars:
 * the display mapping below, and the desktop capture rules in the settings
 * control (where bare function keys are the one modifier-less chord a global
 * shortcut may take). One predicate, so the two cannot disagree about `f8`.
 */
export function isFunctionKeyToken(token: string): boolean {
	return FUNCTION_KEY_TOKEN.test(token);
}

/**
 * The stored value's tokens as a person reads them, per platform.
 *
 * This is DISPLAY ONLY and it is deliberately not the registrar's mapping:
 * `resolveAccelerator` (main) answers "what does Electron register", while this
 * answers "what does a reader see on this machine's keys". The difference
 * shows on macOS: the stored `primary` renders as the Command glyph, because
 * that is the key under the reader's finger, while `meta` is also Command —
 * two spellings of one physical key that mean different things when the file
 * travels to another OS (§A.4's documented asymmetry).
 */
export function formatQuickSendDisplay(
	value: string,
	platform: MiniViewPlatform,
): string {
	const parts = formatQuickSendTokens(value, platform);
	/*
	 * macOS renders modifiers as glyphs and joins them with NO separator (⌘⌥Space
	 * is how the system prints it); the other platforms use "+" between words.
	 */
	return platform === "mac" ? parts.join("") : parts.join("+");
}

/**
 * The stored value's tokens as a person reads them, ONE ENTRY PER CAP.
 *
 * The pieces `formatQuickSendDisplay` joins, exported because the mini
 * header draws the chord as the app's key caps (`KeyboardShortcut` splits its
 * `shortcut` prop on "+") and a macOS sentence spelling — `⌘⌥Space`, no
 * separators — cannot be split back without guessing. One token table, so the
 * caps and the sentences can never disagree about the same chord (design
 * round 1, D4).
 */
export function formatQuickSendTokens(
	value: string,
	platform: MiniViewPlatform,
): string[] {
	const mac = platform === "mac";
	const MODIFIERS: Record<string, string> = mac
		? {
				primary: "⌘",
				meta: "⌘",
				ctrl: "⌃",
				alt: "⌥",
				shift: "⇧",
			}
		: {
				primary: "Ctrl",
				meta: platform === "win" ? "Win" : "Super",
				ctrl: "Ctrl",
				alt: "Alt",
				shift: "Shift",
			};
	const KEY_NAMES: Record<string, string> = {
		space: "Space",
		backspace: "Backspace",
		delete: "Delete",
		insert: "Insert",
		home: "Home",
		end: "End",
		pageup: "PageUp",
		pagedown: "PageDown",
		up: "Up",
		down: "Down",
		left: "Left",
		right: "Right",
	};
	return value
		.split("+")
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length > 0)
		.map((token) => {
			if (token in MODIFIERS) return MODIFIERS[token];
			if (token in KEY_NAMES) return KEY_NAMES[token];
			if (isFunctionKeyToken(token)) return token.toUpperCase();
			if (token.length === 1) return token.toUpperCase();
			return token;
		});
}
