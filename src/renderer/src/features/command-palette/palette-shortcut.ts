/**
 * The command palette's keyboard gestures, as decisions rather than listeners.
 *
 * Two of them, and they are different layers. THE DOORS — which keystrokes open
 * the palette, which VIEW each one asks for, and which presses belong to a
 * surface that got there first (`paletteShortcutIntent`, `paletteDoorOutcome`).
 * THE WALK — the presses that move the selection
 * while the palette is open: the arrows, and since issue #761 the Ctrl+N /
 * Ctrl+P pair (`paletteStepIntent`, with its arithmetic in
 * `paletteStepIndex`). The pair is BOUND in full and ADVERTISED where it
 * reaches (`paletteStepCaps` vs `paletteReachableStepCaps`, below); both
 * decisions are pure and pinned in `scripts/palette-shortcut.test.mjs`, and
 * the listeners live in `use-command-palette-shortcut.ts` (the door) and
 * `command-palette.tsx` (the walk).
 *
 * ## Why the renderer owns this, and not the main process
 *
 * The palette used to be opened by a `before-input-event` hook in the main
 * process answering Cmd/Ctrl+P. That works wherever the WINDOW has focus, and
 * it cannot know what the renderer is doing — which is exactly the problem with
 * Cmd/Ctrl+K: two surfaces in the canvas already own that gesture (the code
 * editor opens its AI edit on it, the Markdown editor inserts a link, which is
 * what Cmd+K means in every editor a user has met). A main-process hook fires
 * before the renderer sees the key at all, so binding it there would silently
 * take the gesture away from both.
 *
 * Deciding in the renderer instead lets the ordering that already exists do the
 * work: React handlers run as the event bubbles to the root, our window
 * listener runs last, and `defaultPrevented` is the editor saying "mine". So
 * the palette opens everywhere else, and inside a canvas editor the shortcut
 * keeps meaning what the editor says it means.
 *
 * ## The three doors (issue #850)
 *
 * One surface, three chords, one rule. Cmd/Ctrl+K opens the palette on CHATS
 * (`#`), Cmd/Ctrl+P opens it on EVERYTHING (no seed), and Cmd/Ctrl+Shift+P opens
 * it on COMMANDS (`>`). The K door is decided in the renderer (the paragraph
 * above says why); the other two stay in main's `before-input-event` and arrive
 * over IPC, because they work wherever the window has focus and main has already
 * swallowed the press by the time the renderer sees it.
 *
 * WHAT A PRESS DOES depends on what is already on screen, and that decision is
 * `paletteDoorOutcome` below — one rule for all three doors, reading the OPEN
 * state and the CURRENT QUERY's scope. A closed palette opens on the door's
 * seed; an open palette already showing this door's view CLOSES; an open palette
 * showing a different view SWITCHES to this door's seed without closing. So the
 * same press is "open" or "close" depending on where you already are, and the
 * door whose view is showing is the one that gets you out.
 *
 * A DOOR'S VIEW IS ITS SEED'S SCOPE, derived through `parsePaletteQuery` rather
 * than mapped a second time: a door that opened on `#` while believing it was
 * the everything door would be two answers to one question.
 */

import {
	COMMAND_SCOPE_SEED,
	CONVERSATION_SWITCHER_SEED,
	parsePaletteQuery,
} from "./palette-search";

/** Which of the palette's three doors a press is asking for (issue #850). */
export type PaletteDoor = "chats" | "everything" | "commands";

/** The door this keystroke IS, or `null` when the press is not the palette's. */
export type PaletteShortcutIntent = PaletteDoor | null;

/** The subset of `KeyboardEvent` the decision reads. */
export type ShortcutEvent = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	defaultPrevented: boolean;
	repeat: boolean;
};

/**
 * Which door this keystroke is, or `null`.
 *
 * Since issue #850 the renderer's own chord is the CHATS door: Cmd/Ctrl+K opens
 * the palette seeded to its conversations source, the quick switcher the
 * `CONVERSATION_SWITCHER_SEED` names. It opened the UNSEEDED palette until the
 * commands door arrived and the two chords swapped views — the K half of that
 * swap lives here, and the two IPC halves in `use-command-palette-shortcut.ts`.
 *
 * `Cmd` and `Ctrl` are both accepted rather than one per platform: the app
 * ships on all three, `Cmd` is meaningless off macOS, and a renderer cannot do
 * anything about a user who presses the other one out of habit.
 *
 * `defaultPrevented` is the editor rule described at the top of this file — it
 * is checked rather than the focus target, because "did the surface I am typing
 * in claim this key" is a question the event answers exactly, and "is the focus
 * in something editable" is a guess that would break the palette for anyone
 * composing a message (the case every chat app expects the gesture to work in).
 *
 * `repeat` is refused so holding the chord does not strobe the dialog, and
 * `shift`/`alt` are refused so the gesture stays a two-key chord that nothing
 * else is likely to extend.
 */
export function paletteShortcutIntent(
	event: ShortcutEvent,
): PaletteShortcutIntent {
	if (!(event.metaKey || event.ctrlKey)) return null;
	if (event.altKey || event.shiftKey) return null;
	if (event.repeat) return null;
	if (event.defaultPrevented) return null;
	return event.key.toLowerCase() === "k" ? "chats" : null;
}

/* ------------------------------------------------------------------ *
 * The doors, as one rule (issue #850)
 * ------------------------------------------------------------------ */

/**
 * The seed each door opens the palette with.
 *
 * The two named seeds live in `palette-search.ts` (they are claims about its
 * scope table, pinned there); the everything door's seed is the EMPTY STRING,
 * which is the palette's ordinary browse — every source, the list that teaches
 * the prefixes. That is a value rather than a missing one, which is why it is
 * spelled here instead of being left to a fallback arm.
 */
const PALETTE_DOOR_SEEDS: Record<PaletteDoor, string> = {
	chats: CONVERSATION_SWITCHER_SEED,
	everything: "",
	commands: COMMAND_SCOPE_SEED,
};

/** What a door press asks the palette to do. */
export type PaletteDoorOutcome =
	| { action: "open"; query: string }
	| { action: "close" }
	| { action: "switch"; query: string };

/**
 * The rule all three doors share (issue #850): where this press lands, given
 * where the palette already is.
 *
 * ONE DECISION, THREE DOORS. `door` says which chord was pressed; `state` is the
 * live palette — whether it is open, and the query in its field. Nothing else is
 * read, and in particular no new store state is introduced: the "view" a door
 * means is derived from its own seed through the SAME parser a typed query goes
 * through, so the door and the query cannot disagree about what `#` means.
 *
 * The three answers:
 *
 * - closed  -> `open` with the door's seed;
 * - open, and the field is already in this door's view -> `close`;
 * - open, in a different view -> `switch`, i.e. write this door's seed.
 *
 * The middle arm is why a repeat press closes at all (before #850, the switcher
 * key could only move an open palette, never dismiss it), and the last is why
 * Cmd+K from the commands view goes to chats rather than closing the surface.
 *
 * `state.query` is the FIELD's text rather than a remembered mode, which is what
 * makes "is this door's view showing" answerable when the user has edited the
 * field by hand: backspacing a `>` leaves the everything view, so the K door
 * switches rather than closing, exactly as it would from a fresh open.
 */
export function paletteDoorOutcome(
	door: PaletteDoor,
	state: { open: boolean; query: string },
): PaletteDoorOutcome {
	const seed = PALETTE_DOOR_SEEDS[door];
	const view = parsePaletteQuery(seed).scope;
	if (!state.open) return { action: "open", query: seed };
	if (parsePaletteQuery(state.query).scope === view) return { action: "close" };
	return { action: "switch", query: seed };
}

/**
 * Each door's chord as the app writes it in prose, for copy that names it.
 *
 * One table rather than a string per call site: the tour's prose and the rail's
 * caps have to agree with the listeners, and the only way to keep two spellings
 * of a shortcut honest is to spell it once. Since issue #850 there are three
 * chords, and the `commands` one is the reason this is a table rather than a
 * pair of functions — a third `⌘⇧P` spelled by hand at its one call site is
 * exactly how a stale cap gets in.
 */
export function paletteDoorLabel(door: PaletteDoor, isMac: boolean): string {
	switch (door) {
		case "chats":
			return isMac ? "⌘K" : "Ctrl+K";
		case "commands":
			return isMac ? "⌘⇧P" : "Ctrl+Shift+P";
		default:
			return isMac ? "⌘P" : "Ctrl+P";
	}
}

/** The same chords as `KeyboardShortcut` prop text, which splits on `+`. */
export function paletteDoorCaps(door: PaletteDoor, isMac: boolean): string {
	switch (door) {
		case "chats":
			return isMac ? "⌘+K" : "Ctrl+K";
		case "commands":
			return isMac ? "⌘+⇧+P" : "Ctrl+Shift+P";
		default:
			return isMac ? "⌘+P" : "Ctrl+P";
	}
}

/* ------------------------------------------------------------------ *
 * The walk (issue #761)
 * ------------------------------------------------------------------ */

/** One step of the walk: forward, or back. */
export type PaletteStep = "next" | "previous";

/** What a key pressed in the palette's field asks the selection to do. */
export type PaletteStepIntent = PaletteStep | null;

/** The subset of `KeyboardEvent` the walk's decision reads. */
export type PaletteStepEvent = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
};

/**
 * Whether this press walks the list, and which way.
 *
 * THE ARROWS' OWN GUARD, kept where the branches used to carry it: a MODIFIED
 * arrow is not the list's. Shift+Arrow is the caret extending a selection,
 * Alt+Arrow is the OS's, and on Windows and Linux Ctrl+Arrow is the caret's
 * word-jump — all three reached the list once and none of them belongs to it
 * (UX round 2, U3; round 3's review caught that the first guard was
 * macOS-only). `meta+Arrow` is left to the list, because Cmd+Arrow has no
 * caret meaning here.
 *
 * THE PAIR, added beside them: `ctrl+n` / `ctrl+p` step next / previous — the
 * Emacs-style pair launchers and completion lists commonly honour, and
 * exactly what the arrows' guard above leaves free. `ctrl` is required and
 * `meta` refused, rather than the both-modifiers rule the door's chord uses:
 * the pair is Control's on every platform, and on macOS `Cmd+N` / `Cmd+P` are
 * this app's own chords (new chat, the switcher), each with a job that is not
 * this one. Shift and Alt are refused for the pair the way the arrows refuse
 * them: a chord this app does not implement stays available rather than
 * firing the neighbouring one.
 */
export function paletteStepIntent(event: PaletteStepEvent): PaletteStepIntent {
	if (event.key === "ArrowDown")
		return event.shiftKey || event.altKey || event.ctrlKey ? null : "next";
	if (event.key === "ArrowUp")
		return event.shiftKey || event.altKey || event.ctrlKey ? null : "previous";
	const key = event.key.toLowerCase();
	if (key !== "n" && key !== "p") return null;
	if (!event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
		return null;
	return key === "n" ? "next" : "previous";
}

/**
 * Where a step lands, in a list of `count` rows — or nowhere, when there are
 * none.
 *
 * The arithmetic the arrows have always used, written once so the pair cannot
 * drift from them: both wrap at both ends. `count = 0` answers null rather
 * than the NaN `% 0` produced — a NaN index left every row unselected with no
 * way back, reachable by typing a query that matched nothing and pressing
 * Down. `current` is kept inside the list by the component's own clamp effect;
 * this only ever wraps.
 */
export function paletteStepIndex(
	current: number,
	count: number,
	step: PaletteStep,
): number | null {
	if (count <= 0) return null;
	return step === "next"
		? (current + 1) % count
		: (current - 1 + count) % count;
}

/**
 * The walk's pair, as `KeyboardShortcut` prop text, next then previous — the
 * BOUND set: every spelling `paletteStepIntent` accepts.
 *
 * One spelling for the same reason the door's caps share one — and unlike
 * them, NO `isMac` split: the pair is Control's on every platform (see
 * `paletteStepIntent`), so the spelling that is true everywhere is the only
 * one. `scripts/palette-shortcut.test.mjs` pins each spelling by feeding it
 * back through the decision, so the copy cannot drift from the binding.
 *
 * The footer does NOT draw this set directly — see
 * `paletteReachableStepCaps` below for why half of it must not be taught.
 */
export function paletteStepCaps(): [string, string] {
	return ["Ctrl+N", "Ctrl+P"];
}

/**
 * The walk's caps as the footer ADVERTISES them: the halves that REACH the
 * renderer in the packaged app, which since issue #850 is a PLATFORM question.
 *
 * `Ctrl+N` is advertised everywhere. `Ctrl+P` is bound (`paletteStepCaps`) and
 * steps wherever it arrives — the UX and QA rigs measured it stepping previous —
 * and on macOS it now ARRIVES: main's `before-input-event` hook no longer folds
 * `input.control` into Cmd on darwin (see the P branch in `src/main/index.ts`),
 * so Ctrl+P is not swallowed there and the renderer's own step sees it.
 *
 * EVERYWHERE ELSE IT IS STILL DEAD, and the footer must not teach it: on Windows
 * and Linux main keeps treating Ctrl as the modifier, preventDefaults the press
 * and answers it with the palette's everything door, so from the typed state this
 * legend is drawn in the press would discard the query rather than move the
 * selection (design round 1, D1).
 *
 * So the advertised set is a function of the platform, and the caller is the
 * component that already knows it (`command-palette.tsx`). The invariant the two
 * sets share is unchanged and pinned in `scripts/palette-shortcut.test.mjs`:
 * advertised ⊆ bound, and the one cap that differs is the one the platform
 * decides. If main's pass-through ever moves (a non-darwin platform adopting the
 * same split, or darwin reverting), this function is the single place the
 * advertised set lives — that change is the operator's call, not a copy edit.
 */
export function paletteReachableStepCaps(isMac: boolean): string[] {
	return isMac ? ["Ctrl+N", "Ctrl+P"] : ["Ctrl+N"];
}
