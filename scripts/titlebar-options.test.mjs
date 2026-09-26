/**
 * The window chrome: the pure frame decision, the style rules that act on it, the
 * lane and the reservation the renderer owes the OS's controls, and the launch
 * resolution that decides which of the two modes a run gets.
 *
 * WHAT THIS CANNOT SEE. The controls themselves, on any platform.
 * `Page.captureScreenshot` and `webContents.capturePage()` photograph the renderer
 * alone, so no frame this app can take contains the macOS traffic lights or the
 * Windows/Linux caption buttons - they are AppKit's and Electron's own views,
 * painted above the client view. The only instruments that can are a
 * `screencapture -l` window capture on macOS and a window capture on the other two,
 * and both need a window on somebody's screen. So the shapes, the resolution and the
 * rules are asserted here, and the pixels are the Tier-4 CI job's
 * (`.github/workflows/window-chrome-evidence.yml`), which runs where the display
 * belongs to nobody.
 *
 * The modules are bundled from the shipped source rather than re-implemented, the
 * same way `sidebar-split.test.mjs` drives its own module.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const readSource = (path) => readFileSync(`${ROOT}/${path}`, "utf8");

const bundleOf = async (entry) => {
	const bundle = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
};

const { titlebarOptions } = await bundleOf("./src/main/titlebar-options");
const chrome = await bundleOf("./src/shared/window-chrome");

const COLORS = {
	ground: "#22201c",
	symbol: "#c2bcaf",
	symbolInactive: "#a6a091",
};
const integrated = { mode: "integrated", colors: COLORS };
const native = { mode: "native", colors: COLORS };

test("U-1 macOS hides the titlebar while retaining the native traffic lights", () => {
	for (const input of [integrated, native]) {
		assert.deepEqual(
			titlebarOptions("darwin", input),
			{ titleBarStyle: "hidden" },
			"#462's decision is the shipped design and does not vary by mode: it has no fragile dependency to escape from, and the lane the renderer reserves is derived from the OS frame",
		);
	}
	const darwin = titlebarOptions("darwin", integrated);
	/*
	 * Each field is named because each is exactly the kind of thing a later "let us
	 * line the brand up with the lights" or "let us use the WCO geometry on mac too"
	 * edit adds. `trafficLightPosition` moved them for nothing once already (the note
	 * on the function records the withdrawal), and macOS WCO would add no pixels
	 * while handing the renderer a geometry main already reproduces from its own
	 * full-screen events.
	 */
	assert.equal("trafficLightPosition" in darwin, false);
	assert.equal("titleBarOverlay" in darwin, false);
	assert.equal("hiddenInset" in darwin, false);
});

test("U-2/U-3 Windows' overlay is transparent and Linux' is an opaque reported ground", () => {
	const win = titlebarOptions("win32", integrated);
	assert.equal(win.titleBarStyle, "hidden");
	assert.equal(
		win.titleBarOverlay.color,
		"#00000000",
		"the ground under Windows' top-right corner is not one colour, so the container is made non-opaque and each button skips its fill; a solid colour here would have to be kept in sync with four surfaces",
	);
	assert.equal(win.titleBarOverlay.symbolColor, COLORS.symbol);
	assert.equal(win.titleBarOverlay.height, 40);
	assert.equal(
		Number.isInteger(win.titleBarOverlay.height),
		true,
		"Electron takes an integer height; a fractional one is rejected",
	);

	const linux = titlebarOptions("linux", integrated);
	assert.equal(linux.titleBarStyle, "hidden");
	assert.equal(
		linux.titleBarOverlay.color,
		COLORS.ground,
		"Linux forces the overlay colour opaque before it draws the icons, so it takes the ground the renderer reports",
	);
	assert.notEqual(
		linux.titleBarOverlay.color,
		"#00000000",
		"a transparent value on Linux renders the glyphs against black while the container stays transparent - wrong hover and glyph contrast on every light palette",
	);
	assert.match(linux.titleBarOverlay.color, /^#[0-9a-fA-F]{6}$/);
	assert.equal(linux.titleBarOverlay.symbolColor, COLORS.symbol);
	assert.equal(linux.titleBarOverlay.height, 40);

	/*
	 * Wait: Windows is the one that takes the 40px toolbars' height. Both do, and the
	 * assertion above is that the app's own row is what the buttons end. Named here
	 * rather than left to the two literals, because the number is the same fact on
	 * both platforms and a drift would be invisible in a diff of two lines.
	 */
	assert.equal(win.titleBarOverlay.height, linux.titleBarOverlay.height);
	assert.equal(win.titleBarOverlay.height, chrome.WINDOW_CHROME_HEIGHT);
});

test("U-4 the hermes shape is impossible, over a fuzz set", () => {
	const platforms = ["darwin", "win32", "linux", "freebsd", "aix", "openbsd"];
	const fuzz = [
		COLORS,
		{ ground: "#00000000", symbol: "#ffffffff", symbolInactive: "#ffffff80" },
		{ ground: "#abc", symbol: "#000", symbolInactive: "#111" },
		{
			ground: "rgba(1, 2, 3, 1)",
			symbol: "rgb(4, 5, 6)",
			symbolInactive: "#abcdef",
		},
		{ ground: "#22201c", symbol: "", symbolInactive: "#a6a091" },
	];
	let hidden = 0;
	for (const platform of platforms) {
		for (const mode of chrome.WINDOW_CHROME_MODES) {
			for (const colors of fuzz) {
				const options = titlebarOptions(platform, { mode, colors });
				if (options.titleBarStyle === "hidden") {
					hidden += 1;
					const platformKey = chrome.chromePlatformFor(platform);
					if (platformKey === "mac") {
						assert.equal(
							"titleBarOverlay" in options,
							false,
							"macOS hides the frame and keeps AppKit's controls; an overlay there would add no pixels",
						);
						continue;
					}
					/*
					 * THE ASSERTION THIS TEST EXISTS FOR. `hidden` without an overlay on
					 * Windows or Linux is a window with no way to close, minimize or
					 * maximize it - Electron enables the caption buttons by the overlay's
					 * presence and by nothing else, and a public bug report describes the
					 * consequence. A control that loses every window control is worse than a
					 * control that looks wrong, so the shape is made unreachable rather than
					 * merely unlikely.
					 */
					assert.ok(
						"titleBarOverlay" in options,
						`${platform}/${mode} hides the frame with no overlay: this window would have no close, minimize or maximize control`,
					);
				} else {
					/*
					 * And the other direction: a platform whose frame is NOT hidden never
					 * carries an overlay, because an overlay is what turns the WCO on.
					 */
					assert.equal("titleBarOverlay" in options, false);
				}
			}
		}
	}
	assert.ok(hidden > 0, "the fuzz must reach the hidden shape at least once");
});

test("native mode is today's frame, on every platform but macOS", () => {
	for (const platform of ["win32", "linux", "freebsd", "aix"]) {
		assert.deepEqual(
			titlebarOptions(platform, native),
			{},
			"the fallback is the pre-redesign answer: the OS draws the whole frame, which is the rescue path for a session where the integrated one cannot be moved or closed",
		);
	}
	/*
	 * A platform the app does not ship a WCO frame view for keeps the OS frame even in
	 * integrated mode. Guessing `hidden` on a BSD is the hermes shape with no test able
	 * to see it, and there is no WCO code path there to enable the buttons.
	 */
	for (const platform of ["freebsd", "aix", "openbsd"]) {
		assert.deepEqual(titlebarOptions(platform, integrated), {});
	}
});

test("macOS has no native-frame fallback, and a launch that asks for one is told", () => {
	/*
	 * THE MODE THE RENDERER IS TOLD HAS TO BE THE MODE THE FRAME IS IN. macOS ignores
	 * the mode (U-1: `titlebarOptions("darwin", native)` is still `hidden`), so if the
	 * resolved mode stayed `native` the renderer would set
	 * `data-chrome-mode="native"` - which hides the lane in CSS - on a window whose
	 * frame IS hidden, drawing the traffic lights over the app's first row. The
	 * requested value is reported rather than silently dropped, so a launch that
	 * reached for the escape hatch learns that macOS has none.
	 */
	const mac = chrome.resolveWindowChromeForLaunch({
		argv: ["--window-chrome=native"],
		env: {},
		userDataDir: "/nonexistent-profile-directory",
		platform: "darwin",
	});
	assert.equal(mac.mode, "integrated");
	assert.equal(mac.problems.length, 1);
	assert.match(mac.problems[0], /native-frame fallback/);

	/* And the same request on a platform that HAS the fallback is honoured. */
	for (const platform of ["win32", "linux"]) {
		const other = chrome.resolveWindowChromeForLaunch({
			argv: ["--window-chrome=native"],
			env: {},
			userDataDir: "/nonexistent-profile-directory",
			platform,
		});
		assert.equal(other.mode, "native");
		assert.deepEqual(other.problems, []);
		/*
		 * A directory that does not exist is the missing-file case, which is the same
		 * answer as a corrupt one: no persisted state, and the default palette's
		 * colours. Asserted here because the resolver reads the file on EVERY launch
		 * and a throw here would be a launch that cannot start.
		 */
		assert.deepEqual(other.colors, chrome.DEFAULT_WINDOW_CHROME_COLORS);
	}
});

test("U-6 the launch resolution: argument, then environment, then the persisted value", () => {
	const resolve = (input) =>
		chrome.resolveWindowChrome({
			argv: [],
			env: {},
			persisted: null,
			...input,
		});

	assert.equal(resolve({}).mode, "integrated", "a first launch is integrated");
	assert.equal(resolve({}).source, "default");

	assert.equal(
		resolve({ persisted: "native" }).mode,
		"native",
		"a launch that says nothing gets what the user last chose",
	);
	assert.equal(
		resolve({ env: { [chrome.WINDOW_CHROME_ENV]: "native" } }).mode,
		"native",
	);
	assert.equal(
		resolve({
			env: { [chrome.WINDOW_CHROME_ENV]: "native" },
			persisted: "integrated",
		}).mode,
		"native",
		"the environment beats the persisted value",
	);
	assert.equal(
		resolve({
			argv: [`${chrome.WINDOW_CHROME_FLAG}=native`],
			env: { [chrome.WINDOW_CHROME_ENV]: "integrated" },
			persisted: "integrated",
		}).mode,
		"native",
		"and the argument beats the environment, which is what makes the rescue flag work from a launcher that cannot reach the setting",
	);
	assert.equal(
		resolve({
			argv: [`${chrome.WINDOW_CHROME_FLAG}=integrated`],
			persisted: "native",
		}).mode,
		"integrated",
	);

	/*
	 * A BLANK environment variable names nothing, and it is not the same case as a
	 * wrong one. `LOCAL_OPERATOR_UI_WINDOW_CHROME=` is what a shell with an unset
	 * variable in an exported position produces, and treating it as a value would make
	 * a script's typo decide the frame.
	 */
	const blank = resolve({
		env: { [chrome.WINDOW_CHROME_ENV]: "   " },
		persisted: "native",
	});
	assert.equal(blank.mode, "native");
	assert.deepEqual(blank.problems, []);

	/*
	 * A TYPO IS REPORTED AND FALLS BACK, the `window-mode.ts` rule - and the fallback
	 * here is the PERSISTED value rather than a constant, because the case that matters
	 * is a rescue flag typed wrong on a machine whose window is already in the mode the
	 * user chose. Refusing to start would be the worst answer available.
	 */
	const typo = resolve({
		argv: [`${chrome.WINDOW_CHROME_FLAG}=nativ`],
		persisted: "native",
	});
	assert.equal(typo.mode, "native");
	assert.equal(typo.problems.length, 1);
	assert.match(typo.problems[0], /nativ/);
	assert.match(typo.problems[0], /integrated, native/);

	/* The `--name value` spelling, the same reader `window-mode.ts` uses. */
	assert.equal(
		resolve({ argv: [chrome.WINDOW_CHROME_FLAG, "native"] }).mode,
		"native",
	);
	/* And a valueless occurrence never clears a valued one. */
	assert.equal(
		resolve({
			argv: [`${chrome.WINDOW_CHROME_FLAG}=native`, chrome.WINDOW_CHROME_FLAG],
		}).mode,
		"native",
	);
});

test("U-9 a CSS comment is prose, and the rules that act on the chrome are declarations", () => {
	const css = readSource("src/renderer/src/styles/index.css").replace(
		/\/\*[\s\S]*?\*\//g,
		"",
	);
	/*
	 * THE GATE MOVED, WHICH IS THE CHANGE. #477 keyed every rule on
	 * `[data-titlebar-platform="mac"]`, a two-value OS read from `navigator.platform`
	 * inside `App`. That source cannot express the native fallback (it knows the OS,
	 * not the mode), cannot know where a Linux WM put its buttons, and does not exist
	 * until React mounts - and root-level attributes are also the only thing that
	 * reaches a PORTALED element, which the sidebar's overlay sheet is.
	 */
	assert.doesNotMatch(
		css,
		/\[data-titlebar-platform/,
		"the old gate is gone; a rule left on it is dead CSS that still looks present",
	);
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\s+\[data-titlebar-drag\]\s*\{\s*-webkit-app-region:\s*drag;/,
	);
	assert.match(css, /-webkit-app-region:\s*no-drag;/);
	assert.match(
		css,
		/\[data-titlebar-no-drag\]/,
		"the no-drag selector list must name the explicit opt-out, which is what a control inside a drag region uses",
	);
	/*
	 * The no-drag list is kept BYTE-IDENTICAL to #477's. It was derived rather than
	 * guessed - every control type the app renders in a header, plus the explicit
	 * attribute - and a list that drifts is how a button inside a drag region stops
	 * being clickable on exactly one platform.
	 */
	assert.ok(
		css.includes(`:is(
		button,
		a,
		input,
		textarea,
		select,
		[role="button"],
		[role="menuitem"],
		[contenteditable="true"],
		[data-titlebar-no-drag]
	)`),
		"the no-drag list is #477's, unchanged",
	);

	/* The three geometry properties, and the env() reads confined to them. */
	assert.match(css, /--chrome-strip-h:\s*env\(titlebar-area-height/);
	assert.match(css, /--chrome-inset-start:\s*env\(titlebar-area-x/);
	assert.match(css, /--chrome-inset-end:\s*max\(/);
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\[data-chrome-platform="mac"\]\s*\{[\s\S]*?--chrome-strip-h:\s*32px;/,
		"#477's 32px lane is a constant on macOS, which deliberately does not enable WCO",
	);
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\[data-chrome-fullscreen="true"\]\s*\{[\s\S]*?--chrome-strip-h:\s*0px;/,
		"full screen collapses the lane and every inset, which is what the state push is for",
	);
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\[data-chrome-trailing="true"\]/,
	);
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\[data-chrome-leading="true"\]/,
	);
	/*
	 * THE WINDOWS/LINUX SPLIT, which is the part that looks like an oversight: the
	 * strip is 0 on Windows because `env(titlebar-area-height)` is the height of the
	 * WCO area, not a band above the content - applying it as a top inset would push
	 * every page's first row 40px down, away from the buttons.
	 */
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\[data-chrome-platform="win"\]\s+\[data-chrome-route-band\]/,
	);
	/*
	 * AND THE BAND STANDS DOWN WHERE THE LANE STANDS UP, which is the fix for the
	 * operator's 2026-09-26 report ("for sub-views like the settings page, the
	 * sidebar and view doesn't go all the way to the top"). The lane is drawn on
	 * `platform=mac` OR `leading=true`; a band that also applies there is a SECOND
	 * inset - measured on macOS at y 62.86 against the chat header's 32. The three
	 * pins below hold the pair apart in both directions: the leading case draws no box
	 * at all, the band's own height is the caption area (never the strip), and no band
	 * rule may read the strip variable.
	 */
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\[data-chrome-leading="true"\]\s+\[data-chrome-route-band\]\s*\{\s*display:\s*none;/,
		"where the lane is drawn the band must stand down entirely, out of the flow",
	);
	assert.match(
		css,
		/\[data-chrome-platform="win"\]\s+\[data-chrome-route-band\][\s\S]*?height:\s*env\(titlebar-area-height/,
		"the band's height is the caption area the OS draws into, which is the clearance it exists for",
	);
	assert.doesNotMatch(
		css,
		/\[data-chrome-route-band\][^{}]*\{[^}]*var\(--chrome-strip-h\)/,
		"the band must never be the strip's height again: under a lane that is 32px of nothing on every non-chat route",
	);

	/* The lane: invisible by default, shown only where the OS is drawing over us. */
	assert.match(css, /\[data-titlebar-lane\]\s*\{\s*display:\s*none;/);
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\[data-chrome-platform="mac"\]\s+\[data-titlebar-lane\],?\s*\[data-chrome-mode="integrated"\]\[data-chrome-leading="true"\]\s+\[data-titlebar-lane\]\s*\{[\s\S]*?height:\s*var\(--chrome-strip-h\);/,
	);

	/* The trailing reservation, as one utility both owners wear. */
	assert.match(css, /@utility\s+chrome-reserve-trailing\s*\{/);
	assert.match(css, /width:\s*var\(--chrome-inset-end\)/);
});

test("the shell carries the fact, and no chrome module raises a window", () => {
	const app = readSource("src/renderer/src/app.tsx");
	/*
	 * Compound on ONE element, which is the defect #477's own review caught on the
	 * rail: `data-titlebar-sidebar-collapsed` is set on the shell `<div>`, and the
	 * chrome attributes are on `<html>`, so a rule that spelled them as an ancestor
	 * pair is dead CSS that still looks present.
	 */
	assert.match(app, /data-titlebar-sidebar-collapsed=\{/);
	assert.doesNotMatch(app, /data-titlebar-platform=\{/);

	const main = readSource("src/renderer/src/main.tsx");
	assert.match(
		main,
		/dataset\.chromePlatform\s*=/,
		"the platform fact must be written before the first render, or every launch jumps 32px when it arrives",
	);
	assert.match(main, /dataset\.chromeMode\s*=/);

	/*
	 * NO CHROME MODULE RAISES A WINDOW. This is the narrow, named half of the scan
	 * `window-mode.test.mjs` runs over all of `src/main`; it is repeated here because
	 * these two files are the ones a future "restore the window when the overlay
	 * changes" edit would land in, and the failure mode is a window on the operator's
	 * screen rather than a wrong colour.
	 */
	for (const path of [
		"src/main/window-chrome.ts",
		"src/shared/window-chrome.ts",
	]) {
		const source = readSource(path);
		for (const call of [
			"show(",
			"showInactive(",
			"focus(",
			"maximize(",
			"restore(",
			"setFullScreen(",
		]) {
			assert.ok(
				!source.includes(`.${call}`),
				`${path} contains .${call} - every call in the chrome path must be a style call or a read, because maximize() SHOWS a hidden window and the app is usually launched headless on the operator's own desktop`,
			);
		}
	}
});

test("the main window takes the frame and the ground from the closed decision", () => {
	const main = readSource("src/main/index.ts");
	assert.match(main, /\.\.\.titlebarOptions\(process\.platform,\s*\{/);
	/*
	 * `backgroundColor` is not decoration: without it Electron's default is `#FFF`, so
	 * every launch on a dark palette opened with a white flash before the renderer's
	 * first frame. It is the same defect `INSTALL_WINDOW_CANVAS` fixed for the
	 * installer window.
	 */
	assert.match(main, /backgroundColor:\s*chrome\.colors\.ground/);
	/*
	 * THE ASSERTION HAS TO SEE THE CALL, NOT THE PARAMETER (agent review round 1, R2).
	 *
	 * This was `/chromeMode:\s*WindowChromeMode/`, which matches the PARAMETER DECLARATION at
	 * `src/main/index.ts:1261` (`chromeMode: WindowChromeMode,` inside `rendererArgumentFlags`)
	 * and not the argv entry composed forty lines below it. PROVED, not inferred: deleting the
	 * `windowChromeArgumentFor(process.platform, chromeMode)` line still matched, so the check
	 * could not fail for the reason it states. What that leaves load-bearing: with the entry
	 * gone, `readWindowChromeArgument` answers `DEFAULT_WINDOW_CHROME_FACTS` (`linux`/`native`)
	 * - which is the guess-towards-native the comment above the entry exists about - so the
	 * lane rule never matches, `[data-titlebar-lane]{display:none}` holds, and macOS gets no
	 * 32px lane with the traffic lights landing on the sidebar's brand row.
	 *
	 * So the check is about the CALL: the resolved mode has to be what is composed into the
	 * argument, and the argument has to reach `additionalArguments`. Both halves are asserted,
	 * because the composition is worthless if its result is dropped.
	 */
	assert.match(
		main,
		/windowChromeArgumentFor\(process\.platform,\s*chromeMode\)/,
		"the renderer's argv entry must be composed from the resolved mode, not re-read from the environment",
	);
	assert.match(
		main,
		/const flags = \[[\s\S]{0,400}?windowChromeArgumentFor\(process\.platform,\s*chromeMode\)[\s\S]{0,400}?\];\s*\n\s*return flags\.length > 0 \? \{ additionalArguments: flags \} : \{\};/,
		"the composed chrome argument must reach the renderer's `additionalArguments`",
	);
});

test("the shell renders the lane above the columns, and exactly one of it", () => {
	const shell = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	/*
	 * ORDER, not a count: the lane has to be ABOVE the columns, because that is what
	 * makes the sidebar's brand row and the conversation title share one line (a lane
	 * between them, or below them, is 32px of misalignment). The shell renders ONE
	 * tree for all three sidebar modes (docked, strip, and the sheet over the pane),
	 * so there is exactly one lane and it precedes the row wrapper.
	 */
	const lane = shell.indexOf('data-titlebar-lane=""');
	assert.notEqual(lane, -1, "the shell renders no lane");
	const rowAfterLane = shell.indexOf(
		'className="flex min-h-0 flex-1 overflow-hidden"',
	);
	assert.notEqual(rowAfterLane, -1);
	assert.ok(
		lane < rowAfterLane,
		"the lane must be the first child of the shell column, above the columns it insets",
	);
	assert.equal(
		shell.split('data-titlebar-lane=""').length - 1,
		1,
		"one shell tree, one lane - a second branch is how the overlay once dropped the pane",
	);
});
