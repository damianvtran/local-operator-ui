import type { ITheme } from "@xterm/xterm";

/**
 * The console mirror's colours, taken from the theme's roles.
 *
 * Design: `docs/design/ui-console-tab.md` 9.1 (the mapping table), 9.2 (the honest
 * gap, stated there rather than discovered in a frame), 9.3 (what is asserted and
 * what is only looked at), 9.5 (the one place the app influences the program).
 *
 * ROLES, NEVER HEXES, the same rule `code-mirror-theme.ts` follows and for the
 * same reason: a literal here would be a second, unmeasured colour system that no
 * palette author can see and `pnpm check-themes` cannot reach. Every value below
 * is a role name, resolved through the palette to whatever that theme says.
 *
 * WHY THIS RESOLVES AT PAINT RATHER THAN PASSING `var(--color-*)`. CodeMirror can
 * be handed `var()` because it emits real CSS. xterm cannot: its theme values are
 * parsed into RGBA by its own colour parser and painted into DOM cells, and a
 * `var()` is not a colour to that parser — every key would be dropped and the
 * terminal would silently fall back to xterm's own defaults
 * (`#000000`/`#ffffff`), which is a themed terminal in appearance only. So the
 * table names roles and `readTerminalTheme` resolves them from the computed
 * style of the theme root; a theme swap re-resolves, and nothing here is baked
 * into a build.
 *
 * THE SIXTEEN ANSI SLOTS ARE THE PROGRAM'S VOCABULARY, NOT THE APP'S (9.2). The
 * palette contract carries four gated hues, so six chromatic slots cannot be
 * sourced one-for-one and two pairs are deliberately the same role:
 * `blue`/`cyan` are both `info`, `magenta` is `danger`, and each `bright*`
 * variant is its base role. That is the design's stated position rather than an
 * oversight: a TUI printing red text is not the app making a colour decision,
 * and the app's job is to render that vocabulary legibly on the terminal ground
 * (which `scripts/contrast-contract.mjs` asserts) rather than to invent sixteen
 * hues per palette. `accent` is deliberately NOT in the ANSI set: it measures
 * ΔE00 0.00 against `success` on monokai, `info` on dune and `ink` on obsidian.
 *
 * WHAT IS HONESTLY LOST, in the same breath: a program that distinguishes its
 * normal and bright variants, or its blue and cyan, gets one colour from this
 * app. The trigger for adding roles is named in the design (§9.2): a TUI the
 * product ships that relies on those two being distinguishable, observed in the
 * design round's frames. Until then the gap is stated here rather than papered
 * over with a per-theme invention nobody measured.
 */
export const TERMINAL_THEME_ROLES = {
	background: "sunken",
	foreground: "ink",
	cursor: "accent",
	cursorAccent: "surface",
	selectionBackground: "accentWash",
	/** 0, the terminal's "black": the dimmest legible ink, because a literal
	 * black on a dark `sunken` ground is invisible rather than neutral. */
	black: "inkDim",
	red: "danger",
	green: "success",
	yellow: "warning",
	blue: "info",
	magenta: "danger",
	cyan: "info",
	white: "ink",
	/** 8, "bright black": `inkMuted` is the step between `black` and `white`
	 * that the contract already carries for secondary text. */
	brightBlack: "inkMuted",
	brightRed: "danger",
	brightGreen: "success",
	brightYellow: "warning",
	brightBlue: "info",
	brightMagenta: "danger",
	brightCyan: "info",
	brightWhite: "ink",
} as const;

/** The ANSI slots, in the order a terminal numbers them, so the contract's own
 * table and this one can be compared slot by slot (`console-theme.test.mjs`). */
export const TERMINAL_ANSI_SLOTS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const;

/** The keys of the theme, which is the table above's own key set. */
export type TerminalThemeRole = keyof typeof TERMINAL_THEME_ROLES;

/** `accentWash` -> `accent-wash`: the one spelling difference between the
 * palettes' role names and the CSS variables generated from them. */
export const kebabRole = (role: string): string =>
	role.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * The theme as xterm wants it, resolved from the document's computed style.
 *
 * Reads `--color-<role>` (the Tailwind name the app's components use) and falls
 * back to `--lo-<role>` (the palette's own variable, which is what `--color-*`
 * points at) for a document that renders without the `@theme` block — the
 * Storybook runner mounts components directly, and an evidence rig may drive a
 * page whose stylesheet is still loading.
 *
 * A role that resolves to nothing is OMITTED rather than guessed. xterm then
 * keeps its own default for that one key, which is visible in a frame as an
 * unthemed cell rather than as a crash in a pane, and `missingTerminalRoles`
 * makes it assertable where a frame can be looked at.
 */
export const readTerminalTheme = (
	root: HTMLElement = document.documentElement,
): ITheme => {
	const styles = getComputedStyle(root);
	const theme: Record<string, string> = {};
	for (const role of Object.keys(TERMINAL_THEME_ROLES) as TerminalThemeRole[]) {
		const value = resolveTerminalRole(styles, TERMINAL_THEME_ROLES[role]);
		if (value) theme[role] = value;
	}
	/*
	 * LOUD WHEN NOTHING RESOLVES, once per document theme.
	 *
	 * The omitted-role behaviour above is deliberate and stays: xterm keeps its own
	 * default for a key, which shows up in a frame as an unthemed cell rather than as
	 * a crash. What was wrong was the silence — a document wearing a `data-theme` no
	 * palette answers renders the WHOLE terminal in xterm's `#000000`/`#ffffff`, and
	 * nothing anywhere said so. The condition is "no role resolved at all" rather than
	 * "some are missing", because a single missing role is a defect this warning
	 * cannot distinguish from a stylesheet that is still loading, while zero is
	 * unambiguous and is the case that produced an unthemed screenshot.
	 */
	if (Object.keys(theme).length === 0) {
		warnUnresolvedTheme(root);
	}
	return theme as ITheme;
};

/** Warned-once bookkeeping, keyed by the document's own theme attribute. */
const warnedThemes = new Set<string>();

const warnUnresolvedTheme = (root: HTMLElement): void => {
	const name = root.dataset.theme ?? "(none)";
	if (warnedThemes.has(name)) return;
	warnedThemes.add(name);
	console.warn(
		`[console] no terminal role resolved for theme "${name}": the terminal is painting xterm's own defaults, not this app's palette`,
	);
};

/** Which of the table's roles the document does not currently resolve. Empty in
 * any real render; a non-empty answer is how a frame's unthemed cell is told
 * apart from a deliberately plain one. */
export const missingTerminalRoles = (
	root: HTMLElement = document.documentElement,
): string[] => {
	const styles = getComputedStyle(root);
	const missing: string[] = [];
	for (const role of Object.keys(TERMINAL_THEME_ROLES) as TerminalThemeRole[]) {
		if (!resolveTerminalRole(styles, TERMINAL_THEME_ROLES[role]))
			missing.push(role);
	}
	return missing;
};

/**
 * The mono face and step the mirror renders at.
 *
 * `--font-mono` is the app's own stack (Geist Mono, which ships as a Nerd Font
 * patch — §2.7), read from the token rather than restated, and `TERMINAL_FONT_SIZE`
 * is xterm's `fontSize` in pixels.
 *
 * 13, and the reason is the app's own ramp rather than a preference: the mono
 * steps the app ships are 11px (`code-mirror-theme.ts`) and 13px (`text-mono`),
 * and a terminal is read for longer than a diff is. xterm's cell is then
 * measured, not assumed — `measureCell` below is what the pane reports to main,
 * so the pane's default width is derived from this face's real advance rather
 * than from the spike's Menlo.
 */
export const TERMINAL_FONT_SIZE = 13;

/** Resolve one role through the generated theme variables. */
const resolveTerminalRole = (
	styles: CSSStyleDeclaration,
	role: string,
): string => {
	const kebab = kebabRole(role);
	const direct = styles.getPropertyValue(`--color-${kebab}`).trim();
	if (isColor(direct)) return direct;
	const palette = styles.getPropertyValue(`--lo-${kebab}`).trim();
	return isColor(palette) ? palette : "";
};

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const FUNCTIONAL_COLOR = /^(rgb|rgba|hsl|hsla|color)\(/;

/**
 * Whether a computed custom-property value is a colour this module can hand to
 * xterm.
 *
 * The check is deliberately narrow rather than a full CSS parse: a custom
 * property's computed value is a token stream, so an unresolved chain can read
 * `var(--lo-sunken)` — which is truthy, is not a colour, and is exactly the
 * value that would end up in the theme if this only tested for a non-empty
 * string. Hex and the three functional notations are what the palettes and the
 * generated CSS can produce.
 */
const isColor = (value: string): boolean =>
	HEX_COLOR.test(value) || FUNCTIONAL_COLOR.test(value);

/** The font string xterm measures its cell with, and the stack it paints. */
export const terminalFontFamily = (
	root: HTMLElement = document.documentElement,
): string => {
	/*
	 * A DOM IS NOT THE SAME THING AS A GLOBAL, and that distinction cost seven
	 * desktop test files before it was written down here (measured: `pnpm test:desktop`
	 * failed in seven places, `working-line-clock`, `composer-tabs`, `chat-image-expand`,
	 * `chat-link-affordances`, `run-panel-navigation`, `settings-account-gate` and
	 * `backend-settings-tiers`, every one of them with `ReferenceError: getComputedStyle
	 * is not defined` out of this line).
	 *
	 * The shape is ordinary and worth naming: a Node test that bootstraps jsdom assigns
	 * `globalThis.document` and `globalThis.window` so React can be imported, and jsdom's
	 * `getComputedStyle` lives on the WINDOW it hands you — it is not a Node global. So
	 * `typeof document !== "undefined"` is not enough, and the caller's no-DOM guard
	 * (measureCell's, which exists for exactly this process shape) walked straight past
	 * it. `readTerminalTheme` and `missingTerminalRoles` take a `root` and are
	 * renderer-only, so this is the one call site on an import-time path.
	 *
	 * With no global `getComputedStyle` there is no rendered surface to read a face from,
	 * and "monospace" is the same answer the caller's ratio branch is written around.
	 */
	if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
		return "monospace";
	}
	const mono = getComputedStyle(root).getPropertyValue("--font-mono").trim();
	return mono || "monospace";
};

/**
 * One cell's advance and height, in CSS pixels, for the shipped face.
 *
 * WHY THIS IS MEASURED HERE RATHER THAN READ OFF THE TERMINAL: xterm exposes no
 * public cell metric, and the value main needs is a divisor for the pane's own
 * box. Canvas `measureText` with the same font string is what xterm's own
 * CharSizeService uses, so this is the same measurement rather than a second
 * opinion; it can differ from xterm's rounded-up device-pixel cell by under one
 * pixel, and the consequence of that is bounded and already designed: main owns
 * the grid (§8), and a mirror whose measure is a hair small crops horizontally
 * exactly as §8.5's mismatch rule says a narrow pane does.
 *
 * The width is measured with `W` (the widest common cell in a monospace face,
 * and what xterm measures with), and the height is the font box the renderer
 * allocates — `fontSize * 1.2`, which is the line box a shared terminal uses;
 * it is reported to main rather than used to size anything here.
 */
export const measureCell = (
	fontFamily?: string,
	fontSize: number = TERMINAL_FONT_SIZE,
): { cellWidth: number; cellHeight: number } => {
	const cellHeight = fontSize * 1.2;
	/*
	 * A process with no DOM — a Node test importing this module through the desktop
	 * suite, which bundles the real source — gets the ratio rather than an
	 * exception: 0.6em is the advance of every monospace face this app has shipped,
	 * and the width derived from it is a preference default rather than a
	 * measurement anyone reads. Nothing in a real render reaches this branch.
	 */
	if (typeof document === "undefined") {
		return { cellWidth: fontSize * 0.6, cellHeight };
	}
	/*
	 * THE FONT IS RESOLVED HERE, AFTER the no-DOM guard, rather than as a default
	 * argument — which is a correction: `fontFamily = terminalFontFamily()` evaluated
	 * its default BEFORE the guard ran, and `terminalFontFamily()` reads
	 * `document.documentElement`, so the branch below that exists to return a ratio
	 * "rather than an exception" threw a ReferenceError in every Node process. The
	 * ratio is now what a process without a document actually gets.
	 */
	const family = fontFamily ?? terminalFontFamily();
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	const font = `${fontSize}px ${family}`;
	let cellWidth = fontSize * 0.6;
	if (context) {
		context.font = font;
		const measured = context.measureText("W").width;
		if (Number.isFinite(measured) && measured > 0) cellWidth = measured;
	}
	return { cellWidth, cellHeight };
};
