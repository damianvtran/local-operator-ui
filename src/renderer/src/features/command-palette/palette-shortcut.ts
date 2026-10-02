/**
 * The command palette's keyboard gestures, as decisions rather than listeners.
 *
 * Two of them, and they are different layers. THE DOOR — which keystrokes
 * toggle the palette, and which ones belong to a surface that got there first
 * (`paletteShortcutIntent`). THE WALK — the presses that move the selection
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
 * Cmd/Ctrl+P stays owned by the main process, and since issue #659 it has a job
 * of its own rather than being a second door to this same list: it opens the
 * palette SEEDED to its conversations source, the quick switcher (the seed
 * itself is `palette-search.ts`'s `CONVERSATION_SWITCHER_SEED`). Two gestures,
 * one surface, two owners, no keystroke claimed twice.
 */

/** What a keystroke asks the palette to do. */
export type PaletteShortcutIntent = "toggle" | null;

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
 * Whether this keystroke is the palette's.
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
	return event.key.toLowerCase() === "k" ? "toggle" : null;
}

/**
 * The gesture as the app writes it, for copy and for the sidebar's key caps.
 *
 * One function rather than a string per call site: the tour's prose and the
 * rail's caps have to agree with the handler above, and the only way to keep
 * two spellings of a shortcut honest is to spell it once.
 */
export function paletteShortcutLabel(isMac: boolean): string {
	return isMac ? "⌘K" : "Ctrl+K";
}

/** The same gesture as `KeyboardShortcut` prop text, which splits on `+`. */
export function paletteShortcutCaps(isMac: boolean): string {
	return isMac ? "⌘+K" : "Ctrl+K";
}

/**
 * The Cmd/Ctrl+P door (issue #659), as the app writes it.
 *
 * One spelling for the same reason the caps above share one: the tour's prose
 * names this chord, and a later rebinding cannot then leave a stale `⌘P` in
 * user-facing copy.
 */
export function switcherShortcutLabel(isMac: boolean): string {
	return isMac ? "⌘P" : "Ctrl+P";
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
 * renderer in the packaged app.
 *
 * `Ctrl+N` is here alone. `Ctrl+P` is bound (`paletteStepCaps`) and steps
 * wherever it arrives — the UX and QA rigs measured it stepping previous —
 * but in the packaged app it never arrives while the window is focused and
 * visible: main's `before-input-event` hook (`src/main/index.ts:3492-3500`)
 * preventDefaults the press and answers it with `toggle-command-palette`,
 * which the renderer turns into the `#` switcher seed
 * (`use-command-palette-shortcut.ts`). So from the typed state this legend is
 * drawn in, the press would discard the query rather than move the selection
 * (design round 1, D1): teaching it as a movement key would promise something
 * the app does not do.
 *
 * The asymmetry is deliberate and pinned in `scripts/palette-shortcut.test.mjs`
 * (advertised ⊆ bound, `Ctrl+P` bound but not advertised) plus a wiring pin in
 * `scripts/palette-contract.test.mjs`. If a main-process pass-through ever
 * makes P reachable, this function is the single place the advertised set
 * lives — that change is the operator's call, not a copy edit.
 */
export function paletteReachableStepCaps(): [string] {
	return ["Ctrl+N"];
}
