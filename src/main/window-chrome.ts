import { join } from "node:path";
import {
	type BrowserWindow,
	type IpcMainInvokeEvent,
	Menu,
	ipcMain,
} from "electron";
import {
	type PersistedWindowChrome,
	type ResolvedLaunchChrome,
	WINDOW_CHROME_FILE,
	WINDOW_CHROME_HEIGHT,
	WINDOW_CHROME_MENU_CHANNEL,
	WINDOW_CHROME_REPORT_CHANNEL,
	WINDOW_CHROME_STATE_CHANNEL,
	type WindowChromeColors,
	type WindowChromeMode,
	chromePlatformFor,
	resolveWindowChromeForLaunch,
} from "../shared/window-chrome";
import { readJson, writeJsonAtomic } from "./browser/atomic-json";

/**
 * The window's chrome state: what the frame was built from, and what the
 * renderer reports about the palette afterwards.
 *
 * WHAT THIS MODULE IS FOR. Two facts about the chrome outlive a single frame and
 * neither can be derived from the other's side of the process boundary. Main
 * chooses `titleBarStyle` and `titleBarOverlay` in the `BrowserWindow`
 * constructor, which runs before a renderer exists - and the theme the user
 * selected lives in the renderer's `localStorage`, so main cannot ask for it. So
 * main keeps its own copy of the last known colours on disk and builds the next
 * window from it, and the renderer reports the live values on every theme change.
 * Without the file a dark palette gets a white first paint on every launch, which
 * is the same class of defect `INSTALL_WINDOW_CANVAS` fixed for the installer.
 *
 * NOTHING HERE SHOWS, FOCUSES OR MAXIMIZES A WINDOW, and that is a hard rule
 * rather than a convention: every call in this file is a STYLE call
 * (`setTitleBarOverlay`, `setBackgroundColor`) or a read (`isFullScreen`,
 * `isMaximized`, `isFocused`), plus subscriptions to events the OS emits. The
 * app is driven by agents on the operator's own desktop, where a launch is
 * usually `headless`, and `maximize()` on a hidden window SHOWS it
 * (`browser-window.md`: "will also show (but not focus) the window if it isn't
 * shown already"). `scripts/window-mode.test.mjs` scans `src/main/` for exactly
 * that family of calls, `maximize` included, and `window-raise.ts` is the only
 * module allowed to contain one. The one interactive thing here - the app menu's
 * popup - is refused outright in `headless`, the way the About panel gate does it,
 * because a popup hung off a window nobody can see is a menu nobody can close.
 *
 * The app menu popup exists because a FRAMELESS window never shows the menu BAR
 * on Windows or Linux (`root_view.cc`: in a frameless window the menu bar is
 * never shown, while its accelerators stay registered). Alt therefore no longer
 * reveals File/Edit/View/Window/Help on those platforms, so the sidebar's brand
 * row carries a button that asks for it, and F10 and a bare Alt tap do the same.
 */

/** Where the persisted chrome state lives for a given profile. */
export function windowChromeFilePath(userDataDir: string): string {
	return join(userDataDir, WINDOW_CHROME_FILE);
}

/**
 * The persisted state, or null.
 *
 * A missing file and an unparseable one are the same answer on purpose - "no
 * persisted state" - and the caller reports which by whether it warned. This is
 * the `readJson` contract: a corrupt file must never block startup, and the
 * direction it fails in here is the safe one (the default palette's colours,
 * which are a real palette rather than a blank).
 */
export function readPersistedWindowChrome(
	userDataDir: string,
): PersistedWindowChrome | null {
	const raw = readJson<PersistedWindowChrome>(
		windowChromeFilePath(userDataDir),
	);
	if (raw === null || typeof raw !== "object") return null;
	const mode =
		raw.mode === "native" || raw.mode === "integrated" ? raw.mode : null;
	if (mode === null) return null;
	const colors = parseChromeColors(raw.colors);
	return {
		mode,
		...(colors ? { colors } : {}),
		...(typeof raw.themeId === "string" ? { themeId: raw.themeId } : {}),
	};
}

export function writePersistedWindowChrome(
	userDataDir: string,
	value: PersistedWindowChrome,
): boolean {
	return writeJsonAtomic(windowChromeFilePath(userDataDir), value);
}

/**
 * A CSS colour, as narrowly as `setTitleBarOverlay` needs it.
 *
 * Electron throws a `TypeError` on a colour it cannot parse
 * (`native_window_views.cc`), and that throw would happen inside an IPC handler
 * where the renderer's consequences are invisible. So every value crossing that
 * boundary is checked here first and a bad one is refused with a line rather than
 * thrown. The accepted forms are the ones this app can actually produce - the
 * palettes are all six-digit hex - plus the eight-digit hex and `rgb()`/`rgba()`
 * forms a future palette or a computed style might hand over.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNCTIONAL_COLOR =
	/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;

export function isValidChromeColor(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	return HEX_COLOR.test(trimmed) || FUNCTIONAL_COLOR.test(trimmed);
}

function mergeChromeColors(
	current: WindowChromeColors,
	reported: unknown,
): WindowChromeColors | null {
	if (reported === undefined || reported === null) return current;
	if (typeof reported !== "object") return null;
	const record = reported as Record<string, unknown>;
	const next: WindowChromeColors = { ...current };
	let sawOne = false;
	for (const key of [
		"ground",
		"symbol",
		"symbolInactive",
	] as (keyof WindowChromeColors)[]) {
		if (!(key in record)) continue;
		const value = record[key];
		if (!isValidChromeColor(value)) return null;
		sawOne = true;
		next[key] = value.trim();
	}
	/*
	 * An object that named no key at all is refused rather than read as a
	 * corner-only report: `{ colors: {} }` is a caller that meant to say something
	 * about the palette and built the object wrong, while reporting no `colors` key at
	 * all is a caller that only had a corner to report. Those two must not resolve the
	 * same way, or a typo in a colour name silently becomes "keep the old colour".
	 */
	return sawOne ? next : null;
}

/**
 * A complete colour triple from an untrusted value, or null.
 *
 * The strict form, used for the PERSISTED file and for the full triple a theme
 * change sends: a file that has lost a key is a file written by an older or a
 * broken build, and rebuilding its chrome from the default palette is better than
 * guessing at the missing one.
 */
function parseChromeColors(value: unknown): WindowChromeColors | null {
	if (value === null || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const ground = record.ground;
	const symbol = record.symbol;
	const symbolInactive = record.symbolInactive;
	if (
		!isValidChromeColor(ground) ||
		!isValidChromeColor(symbol) ||
		!isValidChromeColor(symbolInactive)
	) {
		return null;
	}
	return { ground, symbol, symbolInactive };
}

/** What the renderer sends: the palette's three chrome values, the ground under
 * the controls' corner, and the id for the file. */
export type WindowChromeReport = {
	themeId?: string;
	colors: unknown;
	/** The resolved background of the element holding the controls' corner - the
	 * `reserveTrailingChrome` owner, or a leading lane. Linux paints the overlay
	 * with it; Windows ignores it, because its overlay is transparent. */
	cornerGround?: unknown;
};

/**
 * The launch resolution, with the one thing this process adds: a `userData` path.
 *
 * The POLICY is in `src/shared/window-chrome.ts` (`resolveWindowChromeForLaunch`),
 * which is pure and unit-tested without booting an app; this function only reads the
 * persisted file and hands it over. A missing file and a corrupt one are the same
 * answer - no persisted state - because `readJson` swallows both by design and the
 * direction it fails in here is the safe one: the default palette's real colours
 * rather than a blank.
 */
export function resolveLaunchWindowChrome(input: {
	argv: readonly string[];
	env: Record<string, string | undefined>;
	userDataDir: string;
	platform?: NodeJS.Platform | string;
}): ResolvedLaunchChrome {
	let persisted: PersistedWindowChrome | null = null;
	try {
		persisted = readPersistedWindowChrome(input.userDataDir);
	} catch {
		persisted = null;
	}
	return resolveWindowChromeForLaunch({
		argv: input.argv,
		env: input.env,
		persisted,
		platform: input.platform,
	});
}

/**
 * What a live window's chrome needs: a logger, the mode, the starting colours and
 * the profile directory the state is kept in.
 */
export type WindowChromeOptions = {
	window: BrowserWindow;
	mode: WindowChromeMode;
	colors: WindowChromeColors;
	userDataDir: string;
	/** `windowLaunch.mode === "headless"`, which is the only reason the app-menu
	 * popup is refused. */
	headless: boolean;
	log: (line: string) => void;
};

/**
 * A window whose chrome this module owns.
 *
 * Deliberately NOT a free function per event: the mode, the current colours and
 * the corner ground are three pieces of state that only make sense together, and
 * `setTitleBarOverlay` on Windows takes its `color` from none of them while Linux
 * takes it from the corner. One place that holds all three is what keeps the two
 * platforms' rules from being spelled out twice.
 */
export type WindowChromeController = {
	/** Send the current chrome state to the renderer, and report the applied
	 * values. Idempotent, so a caller may re-send after a reload. */
	sync: () => void;
	dispose: () => void;
};

export function attachWindowChrome(
	options: WindowChromeOptions,
): WindowChromeController {
	const { window, mode, userDataDir, headless, log } = options;
	let colors = options.colors;
	let cornerGround: string | undefined;
	let themeId: string | undefined;

	const platform = chromePlatformFor(process.platform);

	/*
	 * The overlay is applied on EVERY platform this runs on, so a report that
	 * arrives on macOS is a no-op rather than an error: macOS has no overlay to
	 * re-colour (see `titlebar-options.ts`), and `setTitleBarOverlay` is a win32
	 * and linux method that throws elsewhere. Reading the platform once here keeps
	 * the two branches out of each handler.
	 */
	const hasOverlay = platform !== "mac" && mode === "integrated";

	const applyOverlay = (focused: boolean): void => {
		if (!hasOverlay) return;
		/*
		 * Microsoft's "dim when inactive" guidance, which macOS does to the lights
		 * by itself. The symbol follows focus; Linux' colour follows the ground under
		 * the controls, and Windows' stays transparent so the app's own paint shows
		 * through. Reading focus is not raising: no `focus()` call is involved, and
		 * `isFocused()` is a plain getter.
		 */
		/*
		 * A FOCUSED WINDOW THAT HAS BEEN DESTROYED IS NOT FOCUSED (agent review round 1,
		 * R5). This read `focused && !window.isDestroyed() ? true : focused`, whose two
		 * arms both return `focused` - so `focusedNow === focused` and the `isDestroyed()`
		 * test changed nothing at all. It read as protection against calling
		 * `setTitleBarOverlay` on a destroyed window and provided none (the `try/catch`
		 * below is what absorbs that). A guard that cannot guard is how the next reader
		 * concludes the case is handled, so it is spelled as the conjunction it meant.
		 */
		const focusedNow = focused && !window.isDestroyed();
		try {
			window.setTitleBarOverlay({
				...(platform === "linux"
					? { color: cornerGround ?? colors.ground }
					: {}),
				symbolColor: focusedNow ? colors.symbol : colors.symbolInactive,
			});
		} catch (error) {
			/* A refused overlay is a cosmetic loss, and it must not take a theme
			 * switch down with it. Named rather than swallowed: the throw this guards
			 * against is `setTitleBarOverlay` on a window whose WCO is off, which is
			 * a state a future edit can create. */
			log(
				`[window-chrome] setTitleBarOverlay refused (${String(error)}) — the window keeps its previous caption colours`,
			);
		}
	};

	const currentState = () => ({
		fullScreen: window.isDestroyed() ? false : window.isFullScreen(),
		maximized: window.isDestroyed() ? false : window.isMaximized(),
		focused: window.isDestroyed() ? false : window.isFocused(),
	});

	const pushState = (): void => {
		if (window.isDestroyed()) return;
		window.webContents.send(WINDOW_CHROME_STATE_CHANNEL, currentState());
	};

	const persist = (): void => {
		writePersistedWindowChrome(userDataDir, {
			mode,
			colors,
			...(themeId ? { themeId } : {}),
		});
	};

	const onReport = (
		event: IpcMainInvokeEvent,
		report: WindowChromeReport,
	): boolean => {
		/*
		 * Only the window that owns the chrome may re-colour it. A second window
		 * (the auth popup is one) shares this process and would otherwise be able to
		 * repaint the main window's caption glyphs; it also shares the persisted
		 * file, where the theme is global and the last writer wins by design.
		 */
		if (event.sender !== window.webContents) return false;
		const next = mergeChromeColors(colors, report?.colors);
		if (next === null) {
			log(
				"[window-chrome] refused a report whose colours did not parse — the caption colours are unchanged",
			);
			return false;
		}
		colors = next;
		const nextCorner = isValidChromeColor(report?.cornerGround)
			? report.cornerGround.trim()
			: undefined;
		cornerGround = nextCorner;
		if (typeof report?.themeId === "string") themeId = report.themeId;
		window.setBackgroundColor(colors.ground);
		applyOverlay(!window.isDestroyed() && window.isFocused());
		persist();
		log(
			`[window-chrome] applied themeId=${themeId ?? "(none)"} ground=${colors.ground} symbol=${colors.symbol}${cornerGround ? ` cornerGround=${cornerGround}` : ""}`,
		);
		return true;
	};

	const onPopupAppMenu = (event: IpcMainInvokeEvent): boolean => {
		if (event.sender !== window.webContents) return false;
		/*
		 * Refused in `headless`, mirroring the About panel gate. A popup needs a
		 * visible window to hang from and a person to dismiss it; a headless run has
		 * neither, and a menu left open on a window nobody can see is a state nothing
		 * can reach to close. One line, so a rig that tried can tell this from a
		 * window that simply did not show one.
		 */
		if (headless) {
			log(
				"[window-chrome] app menu popup refused: this launch is headless, so there is no window to hang it from",
			);
			return false;
		}
		if (window.isDestroyed()) return false;
		const menu = Menu.getApplicationMenu();
		if (menu === null) {
			log("[window-chrome] app menu popup refused: no application menu is set");
			return false;
		}
		const [x, y] = window.getPosition();
		/*
		 * THE POPUP'S OFFSET IS THE CAPTION HEIGHT, IMPORTED RATHER THAN RESTATED (agent
		 * review round 1, R6). It was the literal `40`, which is `WINDOW_CHROME_HEIGHT` -
		 * and the neighbouring `titlebar-options.ts` imports that constant for exactly this
		 * reason. One edit to the caption height would otherwise leave the app menu popping
		 * at the old offset, under the lane it is supposed to clear.
		 */
		menu.popup({ window, x, y: y + WINDOW_CHROME_HEIGHT });
		return true;
	};

	ipcMain.handle(WINDOW_CHROME_REPORT_CHANNEL, onReport);
	ipcMain.handle(WINDOW_CHROME_MENU_CHANNEL, onPopupAppMenu);

	/* The state pushes. Every listener below is an event the OS emits; none of
	 * them asks for the state to change. */
	const onFullScreen = (): void => {
		pushState();
		/* The lane collapses on full screen; the renderer reads it from the state,
		 * and the insets fall to 0 with it. No call is needed here - the WCO rect
		 * goes empty by itself on Linux, and Windows hides the buttons. */
	};
	const onFocus = (): void => {
		applyOverlay(true);
		pushState();
	};
	const onBlur = (): void => {
		applyOverlay(false);
		pushState();
	};
	const onResizeState = (): void => {
		pushState();
	};

	window.on("enter-full-screen", onFullScreen);
	window.on("leave-full-screen", onFullScreen);
	window.on("maximize", onResizeState);
	window.on("unmaximize", onResizeState);
	window.on("focus", onFocus);
	window.on("blur", onBlur);

	/* The first frame's colours, before any report can arrive. `backgroundColor` is
	 * what the OS paints before the renderer's first frame, and leaving it at
	 * Electron's default `#FFF` is the white flash this file exists to remove for a
	 * dark palette. */
	window.setBackgroundColor(colors.ground);

	const sync = (): void => {
		applyOverlay(!window.isDestroyed() && window.isFocused());
		window.setBackgroundColor(colors.ground);
		pushState();
	};

	const dispose = (): void => {
		ipcMain.removeHandler(WINDOW_CHROME_REPORT_CHANNEL);
		ipcMain.removeHandler(WINDOW_CHROME_MENU_CHANNEL);
		window.removeListener("enter-full-screen", onFullScreen);
		window.removeListener("leave-full-screen", onFullScreen);
		window.removeListener("maximize", onResizeState);
		window.removeListener("unmaximize", onResizeState);
		window.removeListener("focus", onFocus);
		window.removeListener("blur", onBlur);
	};

	return { sync, dispose };
}
