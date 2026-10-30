import { t } from "../../../../i18n/messages";

/**
 * The keyboard actions a user can assign, and the chords that are never assignable.
 *
 * WHY A REGISTRY (issue #928). Shortcuts in this tree were one hand-rolled module
 * per gesture — `canvas-shortcut.ts`, `new-chat-shortcut.ts`,
 * `palette-shortcut.ts`, each with its own modifier guard and its own spelling of
 * the chord it answers — and none of them was reachable from a settings screen.
 * The registry is the ONE place an action is declared: the id its override is
 * stored under, the sentence a reader sees, whether it ships bound, and the scope
 * it acts in. The six rail actions are its first consumers; the fixed gestures
 * the tree already answers are deliberately NOT folded in (that is the recorded
 * follow-up) and are protected instead by `RESERVED_CHORDS` below. The
 * backend-owned `keymap.start_recording` action is the exception: its default
 * is deliberately absent from the reserved set now that its main-process door
 * follows that saved binding.
 *
 * IDS ARE PERSISTED DATA. An id is the key of the renderer's stored
 * `shortcutBindings` override, so renaming one without a migration silently
 * orphans a user's binding (`sanitizeShortcutBindings` drops the unknown id).
 *
 * THE REGISTRY ORDER IS LOAD-BEARING. The settings list renders one row per
 * action in this order, and `sanitizeShortcutBindings` keeps the FIRST of two
 * stored bindings that collide — so the order is the deterministic tie-break a
 * hand-edited blob resolves through. It follows the action table the design
 * settled (`panel.console`, `panel.canvas`, then the four the rail lists); it is
 * deliberately NOT `PANEL_RAIL_ORDER`, which is the rail's own drawing order and
 * a UI concern, not the registry's.
 */

/**
 * Every action the registry ships. A string-literal union so a typo in a call
 * site is a type error, and so the ids read as one vocabulary at every use.
 */
export type ActionId =
	| "panel.console"
	| "panel.canvas"
	| "panel.run"
	| "panel.ask"
	| "panel.browser"
	| "panel.code";

/**
 * One registry entry.
 *
 * `defaultChord` is the CANONICAL string (see `normalizeChord`): lowercase,
 * `primary` for the app modifier, modifiers in `primary+alt+shift` order, one
 * key last. `null` means the action ships unbound and a user assigns it in
 * settings — the issue's own preference for actions whose default would be a
 * guess.
 */
export type KeymapAction = {
	id: ActionId;
	/** The sentence a reader sees; sentence case. */
	label: string;
	/** The settings group this row files under ("Panels" is the only value today). */
	category: string;
	/** The chord it ships with, canonical; null = ships unbound. */
	defaultChord: string | null;
	/** Where the action acts; every shipped action is app-wide. */
	scope: "app";
};

/**
 * The actions, in the registry order the sanitizer and the settings list use.
 *
 * THE DEFAULTS ARE THE DELIBERATE ONES: `primary+j` for the console is the
 * issue's suggestion and VS Code's terminal convention; `primary+shift+c` is the
 * chord the app already ships, prints and answers for the canvas (it becomes a
 * default here, not a hard-coded binding — the retirement `canvas-shortcut.ts`'s
 * own note records). The rest ship unbound: an invented default the user did not
 * ask for is a chord taken away from some other tool.
 */
export const KEYMAP_ACTIONS: readonly KeymapAction[] = [
	{
		id: "panel.console",
		get label() {
			return t("ui.settings.shortcuts.action.open_console");
		},
		get category() {
			return t("ui.settings.shortcuts.category.panels");
		},
		defaultChord: "primary+j",
		scope: "app",
	},
	{
		id: "panel.canvas",
		get label() {
			return t("ui.settings.shortcuts.action.open_canvas");
		},
		get category() {
			return t("ui.settings.shortcuts.category.panels");
		},
		defaultChord: "primary+shift+c",
		scope: "app",
	},
	{
		id: "panel.run",
		get label() {
			return t("ui.settings.shortcuts.action.open_run_details");
		},
		get category() {
			return t("ui.settings.shortcuts.category.panels");
		},
		defaultChord: null,
		scope: "app",
	},
	{
		id: "panel.ask",
		get label() {
			return t("ui.settings.shortcuts.action.open_asks");
		},
		get category() {
			return t("ui.settings.shortcuts.category.panels");
		},
		defaultChord: null,
		scope: "app",
	},
	{
		id: "panel.browser",
		get label() {
			return t("ui.settings.shortcuts.action.open_browser");
		},
		get category() {
			return t("ui.settings.shortcuts.category.panels");
		},
		defaultChord: null,
		scope: "app",
	},
	{
		id: "panel.code",
		get label() {
			return t("ui.settings.shortcuts.action.open_code_review");
		},
		get category() {
			return t("ui.settings.shortcuts.category.panels");
		},
		defaultChord: null,
		scope: "app",
	},
];

/** The actions by id, for the lookups `effectiveChord` and the UI make. */
const ACTIONS_BY_ID: ReadonlyMap<ActionId, KeymapAction> = new Map(
	KEYMAP_ACTIONS.map((action) => [action.id, action]),
);

export const actionById = (id: ActionId): KeymapAction | undefined =>
	ACTIONS_BY_ID.get(id);

/**
 * The stored overrides: only actions a user touched appear. `undefined` (key
 * absent) = the action's default; a string = a canonical chord; `null` = the
 * explicit no-chord state the settings row's Clear button writes (UX round 1's
 * U4 — a defaulted action must be releasable, and absence already means "the
 * default", so the two states need two values). The shape of
 * `ui-preferences-store.shortcutBindings`.
 */
export type ShortcutBindings = Partial<Record<ActionId, string | null>>;

/**
 * The chords capture refuses, each with the sentence shown under the field.
 *
 * WHY A RESERVED SET (the backend's `keymap.py` reserved-set philosophy): a
 * chord that another part of the app already answers, or that a focused field
 * needs, must not be assignable — a user who binds it would get a shortcut that
 * silently double-fires or a text field that loses copy. The sentence names the
 * JOB rather than the owner, because the job is what the user is taking away.
 *
 * MAINTENANCE RULE, stated here because the list is only as honest as the scan
 * that keeps it: a lane that adds a fixed chord to this tree adds it here in the
 * same change, and the list was scanned from the fixed chord inventory with
 * `git grep 'metaKey || '` over `src/` (the RFC's procedure). That scan was
 * re-run when the set was created; `scripts/keymap-registry.test.mjs` pins the
 * shape, not the inventory.
 *
 * WHAT IS DELIBERATELY ABSENT: punctuation keys are unrepresentable in the
 * canonical grammar (`normalizeChord` refuses them), so the zoom trio
 * (`⌘+`/`⌘-`/`⌘0`) cannot be captured — by construction, not by omission.
 *
 * WHAT IS NOT ABSENT, after review round 1's F1 = QA's Q1 (measured, not read):
 * the canvas editors' save/open chords (`⌘S`, `⌘O`) and the focused row's move
 * (`⌘⇧↑`/`⌘⇧↓`) ARE reserved below. They were left assignable on the claim that
 * each `preventDefault`s at its own listener before the router sees the press —
 * and that claim is false in the app's phase order. Their listeners sit on
 * `window` (the canvas editors), while the router is on `document`; in the
 * bubble phase `document` runs FIRST, so a bound action fires beside the
 * editor's (bind `⌘O` and one press opens the file dialog AND toggles the
 * panel). The pin-move chords call `preventDefault` only when the focused row
 * offers the move: on the announce return and the rowId-null return the
 * sidebar answers WITHOUT claiming, so the router fires on the same press
 * (QA's three-path probe). Reserved with their jobs named; the palette's
 * `defaultPrevented` carve-out does not reach any of them.
 */
/**
 * These were assignable before browser focus routing existed. Keep a saved
 * assignment dormant rather than erase it on the next unrelated preference
 * write: an older build can still read the original map on downgrade (R15).
 * This exception must never include pre-existing reserved/invalid chords.
 */
export const LEGACY_BROWSER_CHORDS: ReadonlySet<string> = new Set([
	// 0 was previously assignable. F was already reserved, and punctuation
	// cannot parse as a saved binding, so none of those gets a retention exception.
	"primary+0",
	"primary+r",
	"primary+shift+r",
	"primary+t",
	"primary+shift+t",
	"primary+l",
	...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => `primary+${digit}`),
]);

/*
 * A string-valued Map whose messages resolve on each read. The public shape is
 * load-bearing for keymap consumers and their inventory checks; eager t() at
 * module import would freeze pre-negotiation English, while storing functions
 * would break that API. Iteration resolves too, not just get(), so inventory
 * checks and renderers see the same localized sentences.
 */
class LazyReservedChordMap extends Map<string, string> {
	private readonly copy: ReadonlyMap<string, () => string>;

	constructor(entries: Iterable<readonly [string, () => string]>) {
		super();
		this.copy = new Map(entries);
	}

	override get(chord: string): string | undefined {
		return this.copy.get(chord)?.();
	}

	override has(chord: string): boolean {
		return this.copy.has(chord);
	}

	override get size(): number {
		return this.copy.size;
	}

	override *entries(): MapIterator<[string, string]> {
		for (const [chord, copy] of this.copy) yield [chord, copy()];
	}

	override *keys(): MapIterator<string> {
		yield* this.copy.keys();
	}

	override *values(): MapIterator<string> {
		for (const copy of this.copy.values()) yield copy();
	}

	override forEach(
		callback: (value: string, key: string, map: Map<string, string>) => void,
		thisArg?: unknown,
	): void {
		for (const [chord, sentence] of this) {
			callback.call(thisArg, sentence, chord, this);
		}
	}

	override [Symbol.iterator](): MapIterator<[string, string]> {
		return this.entries();
	}
}

export const RESERVED_CHORDS: ReadonlyMap<string, string> =
	new LazyReservedChordMap([
		// The main process's doors: the renderer never sees these presses, so a
		// bound chord would be a key that does nothing and says nothing.
		["primary+p", () => t("ui.settings.shortcuts.reserved.palette_anywhere")],
		[
			"primary+shift+p",
			() => t("ui.settings.shortcuts.reserved.palette_commands"),
		],
		// Renderer chords that fire app-wide and would double-fire beside a rail
		// action.
		["primary+k", () => t("ui.settings.shortcuts.reserved.palette_chats")],
		["primary+n", () => t("ui.settings.shortcuts.reserved.new_chat")],
		["primary+b", () => t("ui.settings.shortcuts.reserved.toggle_sidebar")],
		// Focus-dependent: inside the browser surface these are page back/forward
		// (`shared/browser-chord.ts`); everywhere else they move between chats.
		["primary+[", () => t("ui.settings.shortcuts.reserved.browser_back")],
		["primary+]", () => t("ui.settings.shortcuts.reserved.browser_forward")],
		["primary+f", () => t("ui.settings.shortcuts.reserved.find")],
		[
			"primary+alt+up",
			() => t("ui.settings.shortcuts.reserved.chat_region_up"),
		],
		[
			"primary+alt+down",
			() => t("ui.settings.shortcuts.reserved.chat_region_down"),
		],
		["primary+shift+a", () => t("ui.settings.shortcuts.reserved.archive_chat")],
		["primary+shift+l", () => t("ui.settings.shortcuts.reserved.chat_tags")],
		// Canvas-editor chords whose listeners are on `window` — the router's
		// document-phase listener runs first, so a bound action would double-fire.
		["primary+s", () => t("ui.settings.shortcuts.reserved.canvas_save")],
		["primary+o", () => t("ui.settings.shortcuts.reserved.canvas_open")],
		// The focused row's move: claimed only when the row offers it, unclaimed on
		// the announce and rowId-null returns, so the router can see those presses.
		[
			"primary+shift+up",
			() => t("ui.settings.shortcuts.reserved.chat_move_up"),
		],
		[
			"primary+shift+down",
			() => t("ui.settings.shortcuts.reserved.chat_move_down"),
		],
		// Native text editing a focused field must keep.
		["primary+c", () => t("ui.settings.shortcuts.reserved.copy")],
		["primary+x", () => t("ui.settings.shortcuts.reserved.cut")],
		["primary+v", () => t("ui.settings.shortcuts.reserved.paste")],
		["primary+a", () => t("ui.settings.shortcuts.reserved.select_all")],
		["primary+z", () => t("ui.settings.shortcuts.reserved.undo")],
		["primary+shift+z", () => t("ui.settings.shortcuts.reserved.redo")],
		["primary+y", () => t("ui.settings.shortcuts.reserved.redo_windows_linux")],
		// The browser surface's fixed chords (`shared/browser-chord.ts`, brief a1-8).
		// Inside the browser the main-process hook and the DOM door claim these before
		// any app binding can run, so an assignable one would be silently dead there.
		// Reserved rather than "app bindings win in the browser" because the browser
		// must keep Chrome muscle memory, and a refusal at capture time is the only
		// moment the user can be told. Ctrl+Tab needs no row: `tab` is an end-edit key
		// the grammar refuses, so it cannot be captured at all. Digits are listed per key: the grammar has no
		// range, and `normalizeChord` is the single spelling Settings matches on.
		["primary+r", () => t("ui.settings.shortcuts.reserved.browser_reload")],
		[
			"primary+shift+r",
			() => t("ui.settings.shortcuts.reserved.browser_reload_cache"),
		],
		["primary+t", () => t("ui.settings.shortcuts.reserved.browser_new_tab")],
		[
			"primary+shift+t",
			() => t("ui.settings.shortcuts.reserved.browser_reopen_tab"),
		],
		["primary+l", () => t("ui.settings.shortcuts.reserved.browser_address")],
		...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit): [string, () => string] => [
			`primary+${digit}`,
			digit === 9
				? () => t("ui.settings.shortcuts.reserved.browser_last_tab")
				: () =>
						t("ui.settings.shortcuts.reserved.browser_numbered_tab", { digit }),
		]),
		["primary+0", () => t("ui.settings.shortcuts.reserved.zoom_reset")],
		// Punctuation cannot be assigned by the current grammar; rows document the
		// fixed native keys without widening what Settings can capture/store.
		["primary+plus", () => t("ui.settings.shortcuts.reserved.zoom_in")],
		["primary+=", () => t("ui.settings.shortcuts.reserved.zoom_in")],
		["primary+-", () => t("ui.settings.shortcuts.reserved.zoom_out")],
		// The application menu's own chords.
		["primary+q", () => t("ui.settings.shortcuts.reserved.quit")],
		["primary+w", () => t("ui.settings.shortcuts.reserved.close")],
		["primary+m", () => t("ui.settings.shortcuts.reserved.minimise")],
	]);
