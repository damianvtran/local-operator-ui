import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The palette's two MAIN-OWNED chords, driven as a RULE rather than read off a
 * listener.
 *
 * WHY THIS FILE EXISTS, and it is a QA round's finding rather than a tidy-up.
 * `Cmd/Ctrl+P` and `Cmd/Ctrl+Shift+P` are answered in `src/main/index.ts`'s
 * `before-input-event` hook, which is guarded by
 * `mainWindow.isFocused() && mainWindow.isVisible()`. A `headless` run creates a
 * window that is never shown, so that gate can never be satisfied and the
 * chords cannot be pressed in any lane that cannot show one (measured: QA round
 * 1's Q-B1/Q-B2/Q-B3, where `Cmd+P` dispatched through CDP left the palette shut
 * in every attempt and the old and new modifier code behaved identically). The
 * decision was therefore lifted into `src/main/palette-door.ts` as a PURE
 * function - platform plus the five `Input` fields the branch reads - so the
 * whole matrix is pinned here, by execution, without a window.
 *
 * WHAT THIS IS NOT: the press. It says which channel a press WOULD produce; it
 * does not prove a focused macOS window answers one, which is the residual owed
 * to QA and stated on the pull request. `palette-contract.test.mjs` keeps the
 * wiring half (that the listener sends what this rule returns on the platform
 * it is running).
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/palette-door";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { PALETTE_DOOR_CHANNELS, paletteDoorChannel } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A press, with everything unset unless the test asks for it. */
const press = (overrides = {}) => ({
	control: false,
	meta: false,
	shift: false,
	key: "p",
	type: "keyDown",
	isAutoRepeat: false,
	...overrides,
});

test("the two doors are the two channels the renderer subscribes to", () => {
	/*
	 * The strings ARE the contract with the renderer's subscriptions
	 * (`use-command-palette-shortcut.ts`), and a typo on either side is a door
	 * that silently does nothing. Spelled out here rather than imported from the
	 * hook, because the point of the assertion is that the two halves agree.
	 */
	assert.equal(PALETTE_DOOR_CHANNELS.everything, "toggle-command-palette");
	assert.equal(
		PALETTE_DOOR_CHANNELS.commands,
		"toggle-command-palette-commands",
	);
	assert.notEqual(
		PALETTE_DOOR_CHANNELS.everything,
		PALETTE_DOOR_CHANNELS.commands,
	);
});

test("on macOS the palette's modifier is Cmd alone", () => {
	/*
	 * Issue #850's macOS half. `control || meta` would swallow the palette's own
	 * Ctrl+P walk step (`paletteStepIntent`) before the renderer saw it, so darwin
	 * answers meta and lets Control pass through.
	 */
	assert.equal(
		paletteDoorChannel("darwin", press({ meta: true })),
		"toggle-command-palette",
	);
	assert.equal(
		paletteDoorChannel("darwin", press({ meta: true, shift: true })),
		"toggle-command-palette-commands",
	);
	assert.equal(
		paletteDoorChannel("darwin", press({ control: true })),
		null,
		"Ctrl+P must reach the renderer's walk step, so darwin refuses it here",
	);
	assert.equal(
		paletteDoorChannel("darwin", press({ control: true, shift: true })),
		null,
	);
});

test("on Windows and Linux the modifier is Ctrl or Cmd", () => {
	for (const platform of ["win32", "linux"]) {
		assert.equal(
			paletteDoorChannel(platform, press({ control: true })),
			"toggle-command-palette",
		);
		assert.equal(
			paletteDoorChannel(platform, press({ control: true, shift: true })),
			"toggle-command-palette-commands",
		);
		/*
		 * Meta stays accepted off darwin: it is this app's usual "Cmd or Ctrl"
		 * reading, and neither platform has a renderer gesture on it.
		 */
		assert.equal(
			paletteDoorChannel(platform, press({ meta: true })),
			"toggle-command-palette",
		);
		assert.equal(
			paletteDoorChannel(platform, press({ meta: true, shift: true })),
			"toggle-command-palette-commands",
		);
	}
});

test("the chord is a chord, and the letter is read case-insensitively", () => {
	assert.equal(paletteDoorChannel("darwin", press()), null);
	assert.equal(
		paletteDoorChannel("darwin", press({ meta: true, shift: true })),
		"toggle-command-palette-commands",
	);
	for (const platform of ["darwin", "win32", "linux"]) {
		assert.equal(
			paletteDoorChannel(platform, press({ meta: true, key: "P" })),
			"toggle-command-palette",
			"the letter's case depends on the layout and the modifiers",
		);
	}
});

test("nothing else about the chord is accepted", () => {
	assert.equal(
		paletteDoorChannel("darwin", press({ meta: true, key: "k" })),
		null,
		"Cmd/Ctrl+K is the renderer's door, deliberately not main's",
	);
	assert.equal(
		paletteDoorChannel("darwin", press({ meta: true, key: "s" })),
		null,
		"Cmd+Shift+S is speech-to-text, a different branch",
	);
	assert.equal(
		paletteDoorChannel(
			"linux",
			press({ control: true, key: "p", type: "keyUp" }),
		),
		null,
		"a key UP is not a press",
	);
	assert.equal(
		paletteDoorChannel(
			"linux",
			press({ control: true, key: "p", type: "char" }),
		),
		null,
	);
});

test("an auto-repeat is refused, so a held chord toggles once", () => {
	/*
	 * `before-input-event` fires once per OS repeat, so without this arm holding
	 * Cmd+P toggles the palette many times a second. One press, one toggle.
	 */
	assert.equal(
		paletteDoorChannel("darwin", press({ meta: true, isAutoRepeat: true })),
		null,
	);
	assert.equal(
		paletteDoorChannel(
			"win32",
			press({ control: true, isAutoRepeat: true, shift: true }),
		),
		null,
	);
});
