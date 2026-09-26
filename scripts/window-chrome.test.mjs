/**
 * The shared chrome module: the colours, the palette sweep, and the drift guard
 * between main's hand-copied defaults and the CSS the renderer actually paints.
 *
 * WHY THESE ARE HERE RATHER THAN IN `titlebar-options.test.mjs`. That file owns the
 * FRAME decision and the CSS pins that act on it; this one owns the pure module both
 * halves read. The split matters because the two have different failure modes: a
 * wrong frame shape loses every window control, while a wrong COLOUR is invisible
 * until somebody's system theme disagrees with ours - and the palette sweep below
 * is the only instrument that can see it across all fifty-nine.
 *
 * The module is bundled from the shipped source rather than re-implemented, the same
 * way `titlebar-options.test.mjs` and `sidebar-split.test.mjs` drive theirs. The
 * palettes are read by `palette-source.mjs`, which is the one parser
 * `contrast-contract.mjs` and `generate-theme-css.mjs` share - so the sweep here and
 * the emitted CSS cannot disagree about what a palette says.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = process.cwd();
const readSource = (path) => readFileSync(`${ROOT}/${path}`, "utf8");

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/shared/window-chrome";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const chrome = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/**
 * Whether a string is a CSS colour `setTitleBarOverlay` will accept.
 *
 * The method throws a `TypeError` on a colour it cannot parse, and that throw would
 * land in main at window construction - a launch that dies before it paints, from a
 * palette value. So the sweep asserts the PROPERTY rather than a regex shape: every
 * colour this module can emit must match what a CSS colour is, hex or functional.
 */
const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/;

test("every palette yields three parseable caption colours", () => {
	const palettes = loadPalettes();
	/*
	 * A count assertion as well as a per-palette one, because a sweep that silently
	 * reads nothing passes: this is the same guard `contrast-contract.mjs` keeps, and
	 * the fleet is 59 palettes today.
	 */
	assert.equal(palettes.length, 59, "the palette sweep must cover the fleet");
	let checked = 0;
	for (const { id, palette } of palettes) {
		const colors = chrome.chromeColorsFor(palette);
		for (const [role, value] of Object.entries(colors)) {
			assert.ok(
				CSS_COLOR.test(value),
				`${id}: ${role} is ${JSON.stringify(value)}, which is not a CSS colour - setTitleBarOverlay throws on one it cannot parse, and that throw lands in main before the window paints`,
			);
			checked += 1;
		}
		/*
		 * The ROLES, not just the shape. `canvas` is the ground because it is the page
		 * under whichever corner the controls take; `inkMuted` and `inkDim` are the
		 * glyphs because they are the ink of the header's own icon buttons at rest -
		 * so the OS's controls read as part of the cluster rather than louder than it.
		 * Asserted against the palette's own values, so a later "just use `ink`"
		 * edit fails here rather than shipping a set of caption glyphs heavier than
		 * every quiet control beside them.
		 */
		assert.deepEqual(colors, {
			ground: palette.canvas,
			symbol: palette.inkMuted,
			symbolInactive: palette.inkDim,
		});
	}
	assert.equal(checked, palettes.length * 3);
});

test("the default colours are the generated brand palette, not a copy that drifted", () => {
	/*
	 * THE `INSTALL_WINDOW_CANVAS` DRIFT GUARD, REUSED. Main cannot read the theme -
	 * it lives in the renderer's `localStorage` and main builds the window before a
	 * renderer exists - so it holds the default palette's three values as constants,
	 * and a hand-copied duplicate of a palette value is exactly what drifted once
	 * before (the installer's window canvas, `install-progress.ts`). The pair is
	 * tested here rather than trusted.
	 *
	 * Read from the GENERATED stylesheet rather than from the palette file, because
	 * the generated file is what the renderer actually paints - the palette is one
	 * step removed, and a generator bug would leave this assertion green while the
	 * app painted something else.
	 */
	const css = readSource("src/renderer/src/styles/themes.generated.css");
	const block = css.slice(css.indexOf('[data-theme="localOperatorDark"]'));
	const read = (name) => {
		const match = new RegExp(`--lo-${name}:\\s*([^;]+);`).exec(block);
		assert.ok(match, `the generated stylesheet has no --lo-${name}`);
		return match[1].trim();
	};
	assert.deepEqual(chrome.DEFAULT_WINDOW_CHROME_COLORS, {
		ground: read("canvas"),
		symbol: read("ink-muted"),
		symbolInactive: read("ink-dim"),
	});
});

test("the mode parser refuses a typo and the argument round-trips", () => {
	assert.equal(chrome.parseWindowChromeMode("integrated"), "integrated");
	assert.equal(chrome.parseWindowChromeMode("  NATIVE "), "native");
	assert.equal(chrome.parseWindowChromeMode("nativ"), null);
	assert.equal(chrome.parseWindowChromeMode(""), null);
	assert.equal(chrome.parseWindowChromeMode(undefined), null);

	for (const platform of chrome.CHROME_PLATFORMS) {
		for (const mode of chrome.WINDOW_CHROME_MODES) {
			const facts = { platform, mode };
			const argv = [chrome.windowChromeArgument(facts)];
			assert.deepEqual(chrome.readWindowChromeArgument(argv), facts);
		}
	}
	/*
	 * WHAT A BROKEN ENTRY RESOLVES TO, and why it is `null` rather than a guess: the
	 * preload falls back to `native`, which paints today's layout. An entry that
	 * cannot be parsed is a window main did not create, or a build whose two halves
	 * disagree about the format - and guessing `integrated` there is how a renderer
	 * reserves a lane for controls that are not over it.
	 */
	assert.equal(chrome.readWindowChromeArgument([]), null);
	assert.equal(
		chrome.readWindowChromeArgument(["--lo-window-chrome=win32"]),
		null,
	);
	assert.equal(
		chrome.readWindowChromeArgument(["--lo-window-chrome=win32:hidden"]),
		null,
	);
	assert.equal(
		chrome.readWindowChromeArgument(["--lo-window-chrome=solaris:integrated"]),
		null,
	);
});
