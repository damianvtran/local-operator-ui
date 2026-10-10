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
 * follow-up) and are protected instead by `RESERVED_CHORDS` below.
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
		label: "Open console",
		category: "Panels",
		defaultChord: "primary+j",
		scope: "app",
	},
	{
		id: "panel.canvas",
		label: "Open canvas",
		category: "Panels",
		defaultChord: "primary+shift+c",
		scope: "app",
	},
	{
		id: "panel.run",
		label: "Open run details",
		category: "Panels",
		defaultChord: null,
		scope: "app",
	},
	{
		id: "panel.ask",
		label: "Open asks",
		category: "Panels",
		defaultChord: null,
		scope: "app",
	},
	{
		id: "panel.browser",
		label: "Open browser",
		category: "Panels",
		defaultChord: null,
		scope: "app",
	},
	{
		id: "panel.code",
		label: "Open code review",
		category: "Panels",
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
 * The stored overrides: only actions a user rebind appear — absent = the
 * action's default. The shape of `ui-preferences-store.shortcutBindings`.
 */
export type ShortcutBindings = Partial<Record<ActionId, string>>;

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
 * (`⌘+`/`⌘-`/`⌘0`) cannot be captured — by construction, not by omission. And
 * the chords that ARE representable but scoped to a canvas editor or a focused
 * row's move (`⌘S`, `⌘O`, `⌘⇧↑`/`⌘⇧↓`) are left assignable: each preventDefaults
 * at its own listener before the router ever sees it, which is the same
 * carve-out the palette's `defaultPrevented` rule makes.
 */
export const RESERVED_CHORDS: ReadonlyMap<string, string> = new Map([
	// The main process's doors: the renderer never sees these presses, so a
	// bound chord would be a key that does nothing and says nothing.
	["primary+p", "Reserved: opens the command palette from anywhere."],
	["primary+shift+p", "Reserved: opens the command palette on commands."],
	["primary+shift+s", "Reserved: starts speech to text."],
	// Renderer chords that fire app-wide and would double-fire beside a rail
	// action.
	["primary+k", "Reserved: opens the command palette on chats."],
	["primary+n", "Reserved: starts a new chat."],
	["primary+b", "Reserved: toggles the sidebar."],
	["primary+[", "Reserved: moves back between chats."],
	["primary+]", "Reserved: moves forward between chats."],
	["primary+f", "Reserved: searches the transcript."],
	["primary+alt+up", "Reserved: walks up the chat regions."],
	["primary+alt+down", "Reserved: walks down the chat regions."],
	["primary+shift+a", "Reserved: archives the focused conversation."],
	// Native text editing a focused field must keep.
	["primary+c", "Reserved: copy."],
	["primary+x", "Reserved: cut."],
	["primary+v", "Reserved: paste."],
	["primary+a", "Reserved: select all."],
	["primary+z", "Reserved: undo."],
	["primary+shift+z", "Reserved: redo."],
	["primary+y", "Reserved: redo on Windows and Linux."],
	// The application menu's own chords.
	["primary+q", "Reserved: quits the app."],
	["primary+w", "Reserved: closes the window."],
	["primary+m", "Reserved: minimises the window."],
]);
