/**
 * Seamless window chrome: the facts main, the preload and the renderer all have
 * to agree on, and the pure decisions over them.
 *
 * WHY THIS FILE EXISTS IN `src/shared/`. The chrome decision is made in three
 * processes at three different times and all three have to reach the same
 * answer. Main picks the frame options BEFORE a window exists and so cannot ask
 * the renderer what theme is selected; the renderer owns the palette (it lives
 * in `localStorage`, `ui-preferences-store.ts`) and is the only thing that can
 * report a resolved colour; and the OS's own controls are drawn over the
 * renderer on Windows and Linux, so their glyph colour has to travel back the
 * other way. Three copies of "which mode are we in" is how one of them ends up
 * a release out of step, so the vocabulary, the flag names, the channel names
 * and the colour derivation live here once.
 *
 * WHAT IT DELIBERATELY IS NOT. It imports nothing from Electron and nothing from
 * the renderer's palette module. `chromeColorsFor` reads three roles off a value
 * it is handed, so `scripts/window-chrome.test.mjs` can run every one of the 59
 * palettes through it in milliseconds, and main can hold the DEFAULT palette's
 * three values as constants checked against the generated CSS - the
 * `INSTALL_WINDOW_CANVAS` pattern (`install-progress.ts`), which exists because
 * a hand-copied duplicate of a palette value drifted once.
 *
 * @see src/main/titlebar-options.ts - the frame decision, the only consumer that
 *   turns this vocabulary into `BrowserWindowConstructorOptions`.
 * @see src/main/window-chrome.ts - the state that outlives the window: the
 *   persisted file, the report channel and the state pushes.
 */

/**
 * The two chrome modes.
 *
 * `integrated` hides the OS title bar and keeps the OS's own window controls
 * drawn over the renderer: macOS keeps AppKit's traffic lights (shipped in #477,
 * unchanged here) and Windows/Linux get Electron's WCO caption buttons. The app
 * therefore owes the controls a lane or a reservation wherever it puts one of its
 * own controls at the window's edge.
 *
 * `native` is the escape hatch and it is exactly today's behaviour: the OS draws
 * the whole frame, every `--chrome-*` measurement is 0, and the drag rules are
 * off. It exists because the integrated path is two Electron releases old on
 * Linux (the frame view was rewritten in 43/44) and there is nothing in the API
 * to DETECT a session it goes wrong in - a tiling WM, a compositor that ignores
 * maximize, a theme mismatch are all invisible from here. So the user gets a
 * switch, the way VS Code's `window.titleBarStyle` gives them one. Main can also
 * be told at launch, which is the path a session where the window cannot be moved
 * or closed depends on, because the setting may be unreachable from inside it.
 */
export const WINDOW_CHROME_MODES = ["integrated", "native"] as const;

export type WindowChromeMode = (typeof WINDOW_CHROME_MODES)[number];

/** The launch switch, beside `--window-mode` and read the same way. */
export const WINDOW_CHROME_FLAG = "--window-chrome";
export const WINDOW_CHROME_ENV = "LOCAL_OPERATOR_UI_WINDOW_CHROME";

/**
 * The entry main writes into a renderer process's `argv`, and the only channel
 * the chrome facts have to the renderer.
 *
 * It is ALWAYS written, like the telemetry entry and unlike the dev driver's:
 * `data-chrome-platform` decides which of two incompatible layouts the shell
 * paints (a 32px lane at the top of every column, or nothing), so a renderer
 * that had to infer the fact from an absent entry would guess, and a guess in
 * the direction of "integrated" puts 32px of dead space under a native title
 * bar on every launch that forgot the entry. Spelling it out every time makes
 * the reader's default ("no entry, native") safe to hold.
 *
 * The value is `<platform>:<mode>`. The platform is the three-value vocabulary
 * the CSS gates on rather than `process.platform`'s eleven, because the CSS has
 * exactly three cases and `freebsd` must not be spelled as a fourth.
 */
export const WINDOW_CHROME_ARG = "--lo-window-chrome";

/**
 * The three chrome platforms, as the renderer's `data-chrome-platform` spells
 * them. `mac` is not `darwin` and `win` is not `win32` for the reason the
 * attribute is read by CSS: the values are the ones the stylesheet names.
 */
export const CHROME_PLATFORMS = ["mac", "win", "linux"] as const;

export type ChromePlatform = (typeof CHROME_PLATFORMS)[number];

/** Everything the renderer needs to know about the frame, synchronously. */
export type WindowChromeFacts = {
	platform: ChromePlatform;
	mode: WindowChromeMode;
};

/**
 * The caption row's height on every integrated platform, in DIP.
 *
 * 40 is the app's own toolbar step - the chat header, every pane toolbar and the
 * sidebar's brand row are all `h-10` - so the OS's buttons end exactly where the
 * row they sit in ends. It sits inside Microsoft's 32-48 guidance. On Windows a
 * custom height sets both the caption height and the WCO rect height, so the
 * renderer's `env(titlebar-area-*)` reads 40 too and the two measurements cannot
 * disagree.
 */
export const WINDOW_CHROME_HEIGHT = 40;

/**
 * Windows' overlay colour, and it is TRANSPARENT on purpose.
 *
 * The ground under the window's top-right corner is not one colour: `canvas`
 * under the chat header, `sunken` under an open pane's toolbar, a banner's wash
 * while a banner is up, and each non-chat route's own page ground. With alpha 0
 * Electron skips the button's background fill and leaves its container
 * non-opaque (`win_caption_button.cc:78-79`, `win_caption_button_container.cc:146-147`),
 * so the buttons always sit on whatever the app painted - no IPC round trip, and
 * therefore no frame in which the button box lags a pane opening.
 *
 * The known cost, recorded rather than hidden: the min/max hover wash comes from
 * the system colour provider rather than from `symbolColor`
 * (`win_caption_button.cc:88-99`), so it is the one part of the box we do not
 * choose. If it turns out illegible on a dark palette under a light system theme
 * the fallback is Linux's opaque mechanism below - a one-line change here.
 */
export const WINDOW_CHROME_TRANSPARENT = "#00000000";

/**
 * A palette's three chrome colours, derived from the palette's own roles.
 *
 * `ground` is `canvas`: the page ground, which is what `backgroundColor` gets on
 * every platform (this is what removes the white flash - `backgroundColor` was
 * unset, so Electron's default `#FFF` painted before the renderer did) and what
 * Linux uses as the overlay colour whenever the reported corner ground is
 * unavailable.
 *
 * `symbol` is `inkMuted`, not `ink`. It is the ink of the header's own icon
 * buttons at rest, so the OS's caption glyphs read as part of the cluster rather
 * than louder than it; `ink` would make the machine's three buttons the heaviest
 * thing in a row of quiet controls. Measured over all 59 palettes, `inkMuted` is
 * 6.23:1 at worst on `canvas` and 5.53:1 at worst on `sunken`, so the 3:1
 * non-text floor is clear by a factor of about two on both grounds.
 *
 * `symbolInactive` is `inkDim`, applied on `blur` and restored on `focus`: this
 * is Microsoft's own "dim the caption glyphs when the window is inactive", which
 * macOS's AppKit does for the traffic lights by itself. Reading focus is not
 * raising a window - no `focus()` call is involved - which is why the state
 * subscription is allowed to exist at all (ARCHITECTURE §9).
 */
export type WindowChromeColors = {
	ground: string;
	symbol: string;
	symbolInactive: string;
};

/** The three palette roles `chromeColorsFor` reads. A slice, not `ThemePalette`:
 * this module may not import the renderer's palette contract, and the three
 * names are the whole of what it needs. */
export type ChromeColorRoles = {
	canvas: string;
	inkMuted: string;
	inkDim: string;
};

export function chromeColorsFor(palette: ChromeColorRoles): WindowChromeColors {
	return {
		ground: palette.canvas,
		symbol: palette.inkMuted,
		symbolInactive: palette.inkDim,
	};
}

/**
 * The default palette's chrome colours, from the two `localOperator*` palettes
 * being the brand pair - `localOperatorDark` is the app's shipping default.
 *
 * THESE ARE HAND-COPIED AND THAT IS THE POINT OF THE TEST. Main needs a ground
 * before any window exists and cannot read the renderer's `localStorage`, so the
 * three values have to live here as literals; a literal that drifts from the
 * palette is a first launch in the wrong colour and nothing else would notice.
 * `scripts/window-chrome.test.mjs` derives the same three from the generated
 * `[data-theme="localOperatorDark"]` block in `styles/themes.generated.css` and
 * fails on a mismatch, which is exactly the guard `INSTALL_WINDOW_CANVAS` has for
 * the installer's own copy of `canvas`.
 */
export const DEFAULT_WINDOW_CHROME_COLORS: WindowChromeColors = {
	ground: "#22201c",
	symbol: "#c2bcaf",
	symbolInactive: "#a6a091",
};

/** `process.platform` reduced to the three cases the CSS has. Anything else is
 * `linux`, because the CSS must pick a branch and an unknown unix is not a Mac. */
export function chromePlatformFor(
	platform: NodeJS.Platform | string,
): ChromePlatform {
	if (platform === "darwin") return "mac";
	if (platform === "win32") return "win";
	return "linux";
}

/**
 * `integrated` | `native`, case- and whitespace-insensitively, or null when the
 * input is anything else. Null is the caller's problem, not a policy decision:
 * `resolveWindowChrome` decides what a typo falls back to.
 */
export function parseWindowChromeMode(
	value: string | undefined,
): WindowChromeMode | null {
	if (value === undefined) return null;
	const normalized = value.trim().toLowerCase();
	return (WINDOW_CHROME_MODES as readonly string[]).includes(normalized)
		? (normalized as WindowChromeMode)
		: null;
}

/**
 * Read `--name=value` or `--name value` from an argument vector, the last VALUED
 * occurrence winning, and a valueless occurrence never clearing a valued one.
 *
 * The rule and both of its halves are `window-mode.ts`'s (`readFlag`), copied
 * rather than imported because that module is private to the launch decision and
 * this one has to be importable from the renderer's preload path. Last-wins is
 * what makes an appended argument an override; the valueless half is what stops
 * `--window-chrome=integrated --window-chrome` from silently resolving to
 * `integrated` by accident - it would resolve to it here, but only because the
 * valued occurrence is the one that was read.
 */
export function readWindowChromeFlag(
	argv: readonly string[],
	name: string = WINDOW_CHROME_FLAG,
): { found: boolean; value: string | undefined; valueless: boolean } {
	let found = false;
	let valueless = false;
	let value: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === name) {
			const next = argv[index + 1];
			found = true;
			if (next === undefined || next.startsWith("--")) {
				valueless = true;
				continue;
			}
			value = next;
			continue;
		}
		if (argument.startsWith(`${name}=`)) {
			found = true;
			value = argument.slice(name.length + 1);
		}
	}
	return { found, value, valueless };
}

/**
 * Resolve the chrome mode from argv, the environment and the persisted file.
 *
 * THE ORDER IS ARGUMENT, ENV, PERSISTED, DEFAULT, and each rung is here for a
 * different launch. The ARGUMENT wins because it is the rescue path: the setting
 * is unreachable from inside a window that integrated chrome has broken, so the
 * flag has to be able to overrule what the setting wrote. The ENV is next so a
 * harness can set it without composing an argv. The PERSISTED value is the user's
 * own choice from Settings, and it is what a plain launch reads - the mode is
 * constructor-only (`titleBarStyle` has no setter in `electron.d.ts`), so this
 * file is the only place the choice can be kept between launches.
 *
 * A BLANK ENVIRONMENT VARIABLE NAMES NOTHING. Set-but-empty is how a shell
 * profile or a `.env` line ends up meaning "unset" without saying so, and reading
 * it as a typo would put a warning on every launch of an app nobody configured
 * wrongly. Same rule as `window-mode.ts`'s.
 *
 * AN UNRECOGNISED VALUE IS REPORTED AND FALLS BACK TO THE PERSISTED VALUE, which
 * is the direction `window-mode.ts` also takes: the fallback is the user's last
 * working choice, so a typo costs a relaunch rather than a window that cannot be
 * closed. The report is a returned problem rather than a `console` call, because
 * main is the only process that has a log and this module is also bundled for the
 * renderer's preload.
 */
export function resolveWindowChrome(input: {
	argv?: readonly string[];
	env?: Record<string, string | undefined>;
	/** The mode in `window-chrome.json`, or null when there is no usable file. */
	persisted?: WindowChromeMode | null;
}): {
	/** The mode the window will be created with. */
	mode: WindowChromeMode;
	/** The rung that decided it, so a log line can say which one. */
	source: "argument" | "environment" | "persisted" | "default";
	/** Empty when nothing was wrong. Non-empty means the value was refused. */
	problems: string[];
} {
	const problems: string[] = [];
	const argv = input.argv ?? [];
	const env = input.env ?? {};
	const persisted = input.persisted ?? null;

	const flag = readWindowChromeFlag(argv);
	if (flag.found) {
		const parsed = parseWindowChromeMode(flag.value);
		if (parsed !== null) return { mode: parsed, source: "argument", problems };
		if (flag.valueless) {
			problems.push(
				`${WINDOW_CHROME_FLAG} was given with no value and names nothing`,
			);
		} else {
			problems.push(
				`${WINDOW_CHROME_FLAG}=${flag.value} is not one of ${WINDOW_CHROME_MODES.join(", ")}`,
			);
		}
	}

	const fromEnv = env[WINDOW_CHROME_ENV];
	/*
	 * `undefined` and `""` both mean "this launch did not say", and whitespace is
	 * the same fact with a stray space in it. A name that WAS given and is wrong
	 * is reported, because that is a launch that tried to say something.
	 */
	if (fromEnv !== undefined && fromEnv.trim() !== "") {
		const parsed = parseWindowChromeMode(fromEnv);
		if (parsed !== null)
			return { mode: parsed, source: "environment", problems };
		problems.push(
			`${WINDOW_CHROME_ENV}=${fromEnv} is not one of ${WINDOW_CHROME_MODES.join(", ")}`,
		);
	}

	if (persisted !== null)
		return { mode: persisted, source: "persisted", problems };

	return { mode: "integrated", source: "default", problems };
}

/**
 * Encode and decode the `--lo-window-chrome` entry.
 *
 * A string rather than a second pair of argv entries, because the two facts are
 * one decision: a platform with `native` mode and a platform with `integrated`
 * mode lay out differently, and a reader that could see one and not the other
 * would have a state nothing can mean.
 *
 * The reader answers `null` for anything it cannot parse, and the renderer's
 * default is `native` - the mode that paints today's layout. Fail-closed here
 * means fail to the frame the OS owns, which is the one that cannot be 32px
 * wrong.
 */
export function windowChromeArgument(facts: WindowChromeFacts): string {
	return `${WINDOW_CHROME_ARG}=${facts.platform}:${facts.mode}`;
}

export function readWindowChromeArgument(
	argv: readonly string[],
): WindowChromeFacts | null {
	const flag = readWindowChromeFlag(argv, WINDOW_CHROME_ARG);
	if (!flag.found || flag.value === undefined) return null;
	const [platform, mode, ...rest] = flag.value.split(":");
	if (rest.length > 0) return null;
	if (!(CHROME_PLATFORMS as readonly string[]).includes(platform)) return null;
	const parsedMode = parseWindowChromeMode(mode);
	if (parsedMode === null) return null;
	return { platform: platform as ChromePlatform, mode: parsedMode };
}

/**
 * The default the renderer paints before main has said anything, and the value a
 * window that main did NOT create a renderer for (Storybook, a bare renderer)
 * inherits.
 *
 * `native` on every platform, because every `--chrome-*` measurement is 0 there
 * and the layout is the one the app shipped before this work: a renderer that
 * guessed `integrated` would reserve a macOS lane it has nothing to put in, or a
 * Windows trailing reservation that leaves 138px of the header empty.
 */
export const DEFAULT_WINDOW_CHROME_FACTS: WindowChromeFacts = {
	platform: "linux",
	mode: "native",
};

/* ---- the live path's vocabulary ----------------------------------------- */

/** renderer -> main: the palette's chrome colours, and the ground under the
 * controls' corner. */
export const WINDOW_CHROME_REPORT_CHANNEL = "window-chrome:report";

/** main -> renderer: full screen, maximized and focus, which the chrome lane and
 * the insets follow and which the CSS cannot read for itself. */
export const WINDOW_CHROME_STATE_CHANNEL = "window-chrome:state";

/** renderer -> main: pop the native application menu under the app-menu button.
 * Main refuses it in `headless`, where the renderer cannot receive a real click
 * and there is no window to hang a popup from. */
export const WINDOW_CHROME_MENU_CHANNEL = "window-chrome:popup-app-menu";

/** The file the theme's chrome colours and the mode are kept in, under
 * `app.getPath("userData")`. One window per process today, and the theme is
 * global, so one file is right for a future second window too. */
export const WINDOW_CHROME_FILE = "window-chrome.json";

export type WindowChromeState = {
	fullScreen: boolean;
	maximized: boolean;
	focused: boolean;
};

/** What main keeps in `window-chrome.json`: the mode, and the last known colours
 * so the next launch's first paint is the palette the user last had. */
export type PersistedWindowChrome = {
	mode: WindowChromeMode;
	colors?: WindowChromeColors;
	/** Recorded for the log and for a person reading the file; nothing branches
	 * on it, because main cannot look up a renderer palette by id. */
	themeId?: string;
};

/** The facts the renderer needs synchronously, from a platform and a mode. */
export function windowChromeFactsFor(
	platform: NodeJS.Platform | string,
	mode: WindowChromeMode,
): WindowChromeFacts {
	return { platform: chromePlatformFor(platform), mode };
}

/** The `--lo-window-chrome` entry for a launch, from the same two facts. */
export function windowChromeArgumentFor(
	platform: NodeJS.Platform | string,
	mode: WindowChromeMode,
): string {
	return windowChromeArgument(windowChromeFactsFor(platform, mode));
}

/** What a launch resolved to, for the log line, the renderer's argv and the file. */
export type ResolvedLaunchChrome = {
	mode: WindowChromeMode;
	colors: WindowChromeColors;
	/** Which input decided the mode, for the log line: `argument`, `environment`,
	 * `persisted` or `default`. */
	source: string;
	problems: readonly string[];
};

/**
 * Resolve the mode and the starting colours for a launch.
 *
 * PURE, AND THAT IS WHY IT LIVES HERE. The persisted state is PASSED IN rather than
 * read in this function, so the whole policy - the precedence, the typo rule and the
 * macOS rule below - is exercised by `scripts/titlebar-options.test.mjs` in
 * milliseconds instead of by booting an app. Main does the reading
 * (`resolveLaunchWindowChrome` in `src/main/window-chrome.ts`), because only main has
 * a `userData` path.
 *
 * THE PRECEDENCE IS `window-mode.ts`'S, deliberately: a caller who reached for the
 * flag wins, including with a typo, because the case that matters is a session where
 * integrated chrome has made the window impossible to move or close and the setting
 * is therefore unreachable from inside the app. A launch that says nothing gets the
 * persisted value; a first launch gets `integrated` with the default palette.
 *
 * MACOS HAS NO FALLBACK, AND THAT IS ENFORCED HERE RATHER THAN DESCRIBED. The frame
 * options for darwin are `{ titleBarStyle: "hidden" }` in EVERY mode (see
 * `titlebar-options.ts`: it is the shipped design, and #462's measured lane depends
 * on it), so a macOS launch that asks for `native` cannot have it - and if the
 * resolved mode stayed `native` the renderer would be told
 * `data-chrome-mode="native"`, which hides the lane in CSS, on a window whose frame
 * IS hidden. The traffic lights would land on the app's first row. The request is
 * REPORTED instead, so a launch that reached for the escape hatch is told.
 */
export function resolveWindowChromeForLaunch(input: {
	argv: readonly string[];
	env: Record<string, string | undefined>;
	persisted: PersistedWindowChrome | null;
	platform?: NodeJS.Platform | string;
}): ResolvedLaunchChrome {
	const resolved = resolveWindowChrome({
		argv: input.argv,
		env: input.env,
		persisted: input.persisted?.mode ?? null,
	});
	const problems = [...resolved.problems];
	const macRequestedNative =
		input.platform === "darwin" && resolved.mode === "native";
	if (macRequestedNative) {
		problems.push(
			"macOS has no native-frame fallback (the frame options are #462's shipped design and the renderer's 32px lane depends on them), so --window-chrome=native is ignored here: the app runs integrated",
		);
	}
	return {
		mode: macRequestedNative ? "integrated" : resolved.mode,
		colors: input.persisted?.colors ?? DEFAULT_WINDOW_CHROME_COLORS,
		source: input.persisted?.colors
			? `${resolved.source}+persisted-colors`
			: resolved.source,
		problems,
	};
}
