/**
 * Which palette door a keypress asks for, decided in MAIN.
 *
 * WHY THIS IS A MODULE RATHER THAN THE BRANCH IT USED TO BE. `Cmd/Ctrl+P` and
 * `Cmd/Ctrl+Shift+P` are answered in the main process (a `before-input-event`
 * hook, which is where they have always been), so the only way to test what
 * they DO without a focused, visible window is to lift the decision out of the
 * listener. QA round 1 measured exactly that limit (Q-B1/Q-B2/Q-B3): a
 * `headless` run creates a window that is never shown, the hook is guarded by
 * `isFocused() && isVisible()`, so the branch can never run in a lane that
 * cannot show a window - `Cmd+P` dispatched through CDP left the palette shut
 * in every attempt, and the old and new modifier code behave identically there.
 * The decision is pure (platform plus the five fields of Electron's `Input`
 * this branch reads), so it is stated here once and driven directly by
 * `scripts/palette-main-door.test.mjs`. The listener in `index.ts` keeps only
 * what is genuinely about the window: the focus gate, `preventDefault`, and the
 * send.
 *
 * THE MODIFIER IS READ PER PLATFORM (issue #850). `input.control || input.meta`
 * is this app's usual "Cmd or Ctrl" reading, and it is wrong ON macOS for this
 * one branch, because the palette's own WALK binds Ctrl+P as its "previous row"
 * step (`paletteStepIntent`, issue #761): folding Control into Cmd meant a
 * focused macOS window swallowed that step before the renderer saw it, so the
 * cap was bound, reachable in a rig, and dead in the shipped app (design round
 * 1, D1). So darwin answers Cmd alone here and lets Control pass through to the
 * renderer. Windows and Linux keep the usual reading (Cmd is meaningless there,
 * and neither platform has a renderer gesture on Ctrl+P), which is why this is
 * a platform split rather than a straight deletion.
 *
 * SCOPE: the PALETTE branch only. The zoom and speech-to-text branches in
 * `index.ts` keep `isCmdOrCtrl`, because neither collides with a renderer
 * gesture and changing them would be a second, unrequested behaviour change.
 *
 * K IS DELIBERATELY NOT HERE. `Cmd/Ctrl+K` - the gesture the app now teaches -
 * is answered in the RENDERER, because a `before-input-event` hook fires before
 * the renderer sees the key at all and two surfaces in the canvas already own
 * Cmd+K (the code editor's AI edit and the Markdown editor's link insert, which
 * is what Cmd+K means in every editor these users have met). One keystroke, one
 * owner: answering it here as well would answer one press twice and the palette
 * would never open. See
 * `src/renderer/src/features/command-palette/palette-shortcut.ts`.
 */

/** The two channels main sends on, one per door. */
export const PALETTE_DOOR_CHANNELS = {
	everything: "toggle-command-palette",
	commands: "toggle-command-palette-commands",
} as const;

export type PaletteDoorChannel =
	(typeof PALETTE_DOOR_CHANNELS)[keyof typeof PALETTE_DOOR_CHANNELS];

/**
 * The fields of Electron's `Input` this rule reads, spelled out rather than
 * imported: `Input` also carries `modifiers`, `code` and the rest, and naming
 * the surface keeps the rule's own vocabulary visible at the one place a reader
 * asks what it can see. It is a structural subset, so `index.ts` passes the
 * hook's own `input` unchanged.
 */
export type PalettePressInput = {
	control: boolean;
	meta: boolean;
	shift: boolean;
	key: string;
	/** Electron's `Input.type`: `"keyDown"`, `"keyUp"` or `"char"`. */
	type: string;
	/** Set by the OS when the key is held; absent on some synthetic events. */
	isAutoRepeat?: boolean;
};

/**
 * The door a press asks for, or `null` for a press this branch does not answer.
 *
 * `null` covers everything that is not a single fresh press of P with this
 * platform's modifier: a non-modifier press, another key, `keyUp`/`char`, and
 * an AUTO-REPEAT. The auto-repeat arm is deliberate - the hook fires once per
 * repeat, and holding `Cmd+P` would otherwise toggle the palette open and shut
 * many times a second. One press, one toggle.
 *
 * The window's own state is NOT read here: whether the press is delivered is
 * `index.ts`'s focus gate, and folding it in would make this rule untestable
 * without a window, which is the whole reason it exists.
 */
export const paletteDoorChannel = (
	platform: NodeJS.Platform,
	input: PalettePressInput,
): PaletteDoorChannel | null => {
	const modifier =
		platform === "darwin" ? input.meta : input.control || input.meta;
	if (!modifier) return null;
	if (input.key.toLowerCase() !== "p") return null;
	if (input.type !== "keyDown") return null;
	if (input.isAutoRepeat) return null;
	return input.shift
		? PALETTE_DOOR_CHANNELS.commands
		: PALETTE_DOOR_CHANNELS.everything;
};
