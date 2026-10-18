import { join } from "node:path";
import {
	type BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	nativeTheme,
} from "electron";
import {
	DEFAULT_GLASS_SETTINGS,
	GLASS_TRANSPARENT,
	type GlassCapability,
	type GlassScheme,
	type GlassSettings,
	WINDOW_GLASS_FILE,
	WINDOW_GLASS_GET_CHANNEL,
	WINDOW_GLASS_SCHEME_CHANNEL,
	WINDOW_GLASS_SET_CHANNEL,
	WINDOW_GLASS_STATE_CHANNEL,
	type WindowGlassState,
	glassCapabilityFor,
	glassIsActive,
	macVibrancyFor,
	sanitizeGlassSettings,
	winMaterialFor,
} from "../shared/window-glass";
import { readJson, writeJsonAtomic } from "./browser/atomic-json";

/**
 * The window glass's state that outlives a window: the persisted file, the IPC the
 * Settings row talks to, and the live application of a change.
 *
 * WHY MAIN OWNS THE SETTING AND NOT THE RENDERER'S `localStorage` (where
 * `showAgentReasoning` lives). The window's construction options (a transparent
 * first-paint ground, a vibrancy material) are decided BEFORE a renderer exists,
 * so a setting kept in the renderer's storage could only ever apply to the SECOND
 * launch's second frame: a window that opens opaque and then turns see-through.
 * `window-chrome.ts` is the same shape for the same reason, and this file copies
 * its persistence rather than inventing a second way.
 *
 * NOTHING HERE SHOWS, FOCUSES OR RAISES A WINDOW. Every call is a style call
 * (`setVibrancy`, `setBackgroundMaterial`, `setBackgroundColor`) or a read - the
 * rule `window-chrome.ts` states and `scripts/window-mode.test.mjs` scans for.
 *
 * THE ONE PROCESS-WIDE SIDE EFFECT, and why it is accepted: while glass is active
 * `nativeTheme.themeSource` is pinned to the palette's scheme. The OS material's
 * TONE follows the window's appearance, and a dark palette over a light-appearance
 * material (a light system with a dark app theme) puts light ink on a pale veil -
 * measured: the same `under-window` window reads grey 81 over a white desktop with
 * a dark source and 224 with a light one. The contrast floors in
 * `window-glass-floors.json` assume the scheme matches, so the pin is what makes
 * them true. It is released the moment glass goes inactive, and never touched by a
 * launch that never enabled glass - the default-off path is unchanged.
 */

export function windowGlassFilePath(userDataDir: string): string {
	return join(userDataDir, WINDOW_GLASS_FILE);
}

type PersistedGlass = { settings: GlassSettings; scheme: GlassScheme };

/** The persisted file, or null; a missing and a corrupt file are one answer. */
export function readPersistedWindowGlass(
	userDataDir: string,
	capability: GlassCapability,
): PersistedGlass | null {
	const raw = readJson<{ settings?: unknown; scheme?: unknown }>(
		windowGlassFilePath(userDataDir),
	);
	if (raw === null || typeof raw !== "object") return null;
	return {
		settings: sanitizeGlassSettings(raw.settings, capability),
		scheme: raw.scheme === "light" ? "light" : "dark",
	};
}

export type ResolvedLaunchGlass = {
	capability: GlassCapability;
	settings: GlassSettings;
	scheme: GlassScheme;
	state: WindowGlassState;
};

/**
 * The launch resolution. The platform facts are PASSED IN (defaulting to the real
 * ones) so a test can ask what a Windows 10 or a reduced-transparency launch gets.
 */
export function resolveLaunchWindowGlass(input: {
	userDataDir: string;
	platform?: NodeJS.Platform | string;
	osVersion?: string;
	reducedTransparency?: boolean;
}): ResolvedLaunchGlass {
	const capability = glassCapabilityFor({
		platform: input.platform ?? process.platform,
		osVersion: input.osVersion ?? process.getSystemVersion(),
		reducedTransparency:
			input.reducedTransparency ?? nativeTheme.prefersReducedTransparency,
	});
	let persisted: PersistedGlass | null = null;
	try {
		persisted = readPersistedWindowGlass(input.userDataDir, capability);
	} catch {
		persisted = null;
	}
	const settings = persisted?.settings ?? DEFAULT_GLASS_SETTINGS;
	const scheme = persisted?.scheme ?? "dark";
	return {
		capability,
		settings,
		scheme,
		state: stateFor(settings, capability),
	};
}

const stateFor = (
	settings: GlassSettings,
	capability: GlassCapability,
	launchedActive = glassIsActive(settings, capability),
): WindowGlassState => {
	const active = glassIsActive(settings, capability);
	return {
		capability,
		settings,
		active,
		restartRequired: !capability.liveToggle && active !== launchedActive,
	};
};

export type WindowGlassOptions = {
	window: BrowserWindow;
	initial: ResolvedLaunchGlass;
	userDataDir: string;
	/** Called after glass goes inactive so the chrome controller can put the
	 * palette ground back (it owns that colour). */
	restoreGround: () => void;
	log: (line: string) => void;
	/**
	 * Every state this window would paint, for the OTHER window of the app: the
	 * quick-send popout is a second BrowserWindow with the same material, and
	 * main otherwise pushes only to the window that owns the setting (its
	 * document would sit on a stale paint after a Settings change or the OS
	 * reduce-transparency switch). Optional so a caller with one window (the
	 * tests) is unchanged.
	 */
	onState?: (state: WindowGlassState) => void;
};

export type WindowGlassController = {
	/** Whether the window is currently painted transparent: the chrome controller
	 * asks, so a theme change cannot repaint an opaque ground over live glass. */
	isActive: () => boolean;
	dispose: () => void;
};

export function attachWindowGlass(
	options: WindowGlassOptions,
): WindowGlassController {
	const { window, userDataDir, restoreGround, log } = options;
	let capability = options.initial.capability;
	let settings = options.initial.settings;
	let scheme = options.initial.scheme;
	const launchedActive = glassIsActive(settings, capability);
	let pinnedTheme = false;
	/*
	 * WHAT IS ON THE WINDOW RIGHT NOW, which is not what the current capability
	 * says. The capability can drop to `none` while a material is showing (the OS
	 * "Reduce transparency" switch), and a teardown keyed on the CURRENT mechanism
	 * has no branch for `none`: the vibrancy view and the transparent ground stayed
	 * while the renderer went opaque (review R1). Teardown follows what was applied.
	 */
	let appliedMechanism: GlassCapability["mechanism"] = launchedActive
		? capability.mechanism
		: "none";

	const current = (): WindowGlassState =>
		stateFor(settings, capability, launchedActive);

	/*
	 * Apply the material to the live window. macOS can flip the WHOLE thing (see
	 * `GlassCapability.liveToggle`); Windows can only change the material of a
	 * window that was built with one, so a Windows toggle is recorded and applied
	 * by the next launch, and the state says so (`restartRequired`).
	 */
	const applyToWindow = (): void => {
		if (window.isDestroyed()) return;
		const active = glassIsActive(settings, capability);
		try {
			if (active) {
				if (capability.mechanism === "vibrancy") {
					window.setBackgroundColor(GLASS_TRANSPARENT);
					/*
					 * `visualEffectState` is a CONSTRUCTOR option only (Electron 44:
					 * `setVibrancy` takes just `animationDuration`), so the VIEW CREATED HERE
					 * can only inherit the window's construction value. Every darwin window is
					 * built with `"active"` (`glassWindowOptions`, inert without vibrancy) for
					 * exactly this call: otherwise the live-enabled view used Electron's
					 * `followWindow` default and rendered inactive whenever the window was not
					 * key, while a launch-enabled window (constructed `active`) did not. The
					 * two paths now create the same material (operator-confirmed on 0.34.53:
					 * the material appeared on a focus change before this fix).
					 */
					window.setVibrancy(macVibrancyFor(settings.material));
					appliedMechanism = "vibrancy";
				} else if (
					capability.mechanism === "background-material" &&
					launchedActive
				) {
					/*
					 * The ground goes transparent BEFORE the material, exactly as the
					 * constructor options build it: a live OFF restored the opaque palette
					 * ground (below), and a material behind an opaque ground is invisible.
					 * Without this a Windows off -> on in one session came back opaque
					 * (review round 2, R2-2).
					 */
					window.setBackgroundColor(GLASS_TRANSPARENT);
					window.setBackgroundMaterial(winMaterialFor(settings.material));
					appliedMechanism = "background-material";
				}
			} else if (appliedMechanism === "vibrancy") {
				window.setVibrancy(null);
				restoreGround();
				appliedMechanism = "none";
			} else if (appliedMechanism === "background-material") {
				window.setBackgroundMaterial("none");
				restoreGround();
				appliedMechanism = "none";
			}
		} catch (error) {
			log(
				`[window-glass] applying the material was refused (${String(error)}) - the window keeps its previous look`,
			);
		}
		/* The tone pin: held exactly while the material is on screen. */
		if (active && !pinnedTheme) {
			nativeTheme.themeSource = scheme;
			pinnedTheme = true;
		} else if (active) {
			nativeTheme.themeSource = scheme;
		} else if (pinnedTheme) {
			nativeTheme.themeSource = "system";
			pinnedTheme = false;
		}
	};

	const persist = (): void => {
		/*
		 * `writeJsonAtomic` reports failure by return value. A read-only profile would
		 * otherwise lose the setting at the next launch with nothing said; the
		 * in-memory state stays authoritative for this run (review R9).
		 */
		if (
			!writeJsonAtomic(windowGlassFilePath(userDataDir), { settings, scheme })
		)
			log(
				"[window-glass] the setting could not be saved - it applies to this run and will not survive a restart",
			);
	};

	const push = (): void => {
		const state = current();
		if (!window.isDestroyed())
			window.webContents.send(WINDOW_GLASS_STATE_CHANNEL, state);
		options.onState?.(state);
	};

	const fromOwnWindow = (event: IpcMainInvokeEvent): boolean =>
		event.sender === window.webContents;

	ipcMain.handle(WINDOW_GLASS_GET_CHANNEL, (event) =>
		fromOwnWindow(event) ? current() : null,
	);
	ipcMain.handle(
		WINDOW_GLASS_SET_CHANNEL,
		(event, patch: unknown): WindowGlassState | null => {
			if (!fromOwnWindow(event)) return null;
			settings = sanitizeGlassSettings(patch, capability, settings);
			applyToWindow();
			persist();
			push();
			log(
				`[window-glass] applied enabled=${settings.enabled} active=${glassIsActive(settings, capability)} coverage=${settings.coverage} intensity=${settings.intensity} material=${settings.material} mechanism=${capability.mechanism}`,
			);
			return current();
		},
	);
	/* The renderer's palette scheme: the one fact main cannot derive. */
	ipcMain.handle(WINDOW_GLASS_SCHEME_CHANNEL, (event, next: unknown) => {
		if (!fromOwnWindow(event)) return false;
		if (next !== "dark" && next !== "light") return false;
		if (next === scheme) return true;
		scheme = next;
		if (glassIsActive(settings, capability)) nativeTheme.themeSource = scheme;
		persist();
		return true;
	});

	/*
	 * The OS accessibility switch is live: turning "Reduce transparency" on while
	 * glass is showing must drop the window to the opaque ground at once, and
	 * turning it off again brings the user's own setting back.
	 */
	const onNativeThemeUpdated = (): void => {
		const next = glassCapabilityFor({
			platform: process.platform,
			osVersion: process.getSystemVersion(),
			reducedTransparency: nativeTheme.prefersReducedTransparency,
		});
		if (
			next.supported === capability.supported &&
			next.reason === capability.reason
		)
			return;
		capability = next;
		settings = sanitizeGlassSettings(settings, capability, settings);
		applyToWindow();
		push();
		log(
			`[window-glass] capability changed supported=${next.supported} reason=${next.reason}`,
		);
	};
	nativeTheme.on("updated", onNativeThemeUpdated);

	/* A launch with glass on already has the construction options; this brings
	 * the process-wide tone pin in line without touching the window twice. */
	if (glassIsActive(settings, capability)) {
		nativeTheme.themeSource = scheme;
		pinnedTheme = true;
	}

	return {
		isActive: () => glassIsActive(settings, capability),
		dispose: () => {
			ipcMain.removeHandler(WINDOW_GLASS_GET_CHANNEL);
			ipcMain.removeHandler(WINDOW_GLASS_SET_CHANNEL);
			ipcMain.removeHandler(WINDOW_GLASS_SCHEME_CHANNEL);
			nativeTheme.removeListener("updated", onNativeThemeUpdated);
			if (pinnedTheme) nativeTheme.themeSource = "system";
		},
	};
}
