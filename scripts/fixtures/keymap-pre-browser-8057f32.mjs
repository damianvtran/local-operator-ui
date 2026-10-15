// Frozen downgrade-consumer fixture, generated from 8057f32ff24d0087e035eb0dd4d52947dfa0876c
// keymap-chord.ts + keymap-registry.ts via esbuild (tree-shaken exports only).
// Generated bindings use const instead of var (all are immutable), formatted with Biome.
// Do not update with the implementation: it proves the OLD build consumes saved mappings.
// src/renderer/src/shared/keymap/keymap-registry.ts
const KEYMAP_ACTIONS = [
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
const ACTIONS_BY_ID = new Map(
	KEYMAP_ACTIONS.map((action) => [action.id, action]),
);
const actionById = (id) => ACTIONS_BY_ID.get(id);
const RESERVED_CHORDS = /* @__PURE__ */ new Map([
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
	// Canvas-editor chords whose listeners are on `window` — the router's
	// document-phase listener runs first, so a bound action would double-fire.
	["primary+s", "Reserved: saves the canvas document."],
	["primary+o", "Reserved: opens a file in the canvas."],
	// The focused row's move: claimed only when the row offers it, unclaimed on
	// the announce and rowId-null returns, so the router can see those presses.
	["primary+shift+up", "Reserved: moves the focused chat up the pinned order."],
	[
		"primary+shift+down",
		"Reserved: moves the focused chat down the pinned order.",
	],
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

// src/renderer/src/shared/keymap/keymap-chord.ts
const MODIFIER_TOKENS = ["primary", "alt", "shift"];
const MODIFIER_ALIASES = {
	primary: "primary",
	meta: "primary",
	cmd: "primary",
	command: "primary",
	super: "primary",
	ctrl: "primary",
	control: "primary",
	alt: "alt",
	option: "alt",
	shift: "shift",
};
const NAMED_KEY_TOKENS = /* @__PURE__ */ new Set([
	"space",
	"backspace",
	"delete",
	"insert",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
]);
const isChordKeyToken = (token) =>
	NAMED_KEY_TOKENS.has(token) || /^[a-z0-9]$/.test(token);
function normalizeChord(raw) {
	if (typeof raw !== "string") return null;
	const tokens = raw
		.toLowerCase()
		.split("+")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return null;
	const key = tokens[tokens.length - 1];
	if (!isChordKeyToken(key)) return null;
	const modifiers = /* @__PURE__ */ new Set();
	for (const token of tokens.slice(0, -1)) {
		const modifier = MODIFIER_ALIASES[token];
		if (modifier === void 0) return null;
		modifiers.add(modifier);
	}
	const ordered = MODIFIER_TOKENS.filter((token) => modifiers.has(token));
	return [...ordered, key].join("+");
}
const chordHasPrimary = (chord) => chord.split("+").includes("primary");
function effectiveChord(actionId, bindings) {
	const override = bindings?.[actionId];
	if (typeof override === "string" || override === null) return override;
	return actionById(actionId)?.defaultChord ?? null;
}
function sanitizeShortcutBindings(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
	const source = raw;
	const claimed = /* @__PURE__ */ new Set();
	const bindings = {};
	for (const action of KEYMAP_ACTIONS) {
		const stored = source[action.id];
		if (stored === null) {
			bindings[action.id] = null;
			continue;
		}
		const normalized =
			typeof stored === "string" ? normalizeChord(stored) : null;
		const override =
			normalized !== null &&
			chordHasPrimary(normalized) &&
			!RESERVED_CHORDS.has(normalized) &&
			!claimed.has(normalized)
				? normalized
				: null;
		if (override !== null) bindings[action.id] = override;
		const effective = override ?? action.defaultChord;
		if (effective !== null) claimed.add(effective);
	}
	return bindings;
}
export { effectiveChord, sanitizeShortcutBindings };
