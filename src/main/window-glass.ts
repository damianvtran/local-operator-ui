import { join } from "node:path";
import {
	type BrowserWindow,
	type IpcMainInvokeEvent,
	app,
	ipcMain,
	nativeTheme,
} from "electron";
import {
	GLASS_FILE_VERSION,
	GLASS_SETTINGS_FIELDS,
	GLASS_TRANSPARENT,
	type GlassCapability,
	type GlassEnvironmentFacts,
	type GlassScheme,
	type GlassSettings,
	type GlassSettingsField,
	WINDOW_GLASS_FILE,
	WINDOW_GLASS_GET_CHANNEL,
	WINDOW_GLASS_RENDERER_CHANNEL,
	WINDOW_GLASS_SCHEME_CHANNEL,
	WINDOW_GLASS_SET_CHANNEL,
	WINDOW_GLASS_STATE_CHANNEL,
	type WindowGlassState,
	defaultGlassSettings,
	glassCapabilityFor,
	glassIsActive,
	macVibrancyFor,
	resolveStoredGlass,
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
 * launch whose glass is inactive - the shipped opaque path is unchanged.
 *
 * THE DEFAULT IS CAPABILITY-AWARE (criterion: default flip, unset-only). A launch
 * with no stored choice gets `defaultGlassSettings(capability)` - enabled at 80%
 * on a Mac that can composite it, off everywhere the gate says no. A stored file
 * records WHICH fields the user chose (`explicit`); only fields absent from that
 * list are filled by today's default, so an explicit off or an explicit 50 is
 * never rewritten by a later default change.
 */

export function windowGlassFilePath(userDataDir: string): string {
	return join(userDataDir, WINDOW_GLASS_FILE);
}

type PersistedGlass = {
	settings: GlassSettings;
	explicit: GlassSettingsField[];
	scheme: GlassScheme;
};

/**
 * Whether the GPU process has reported at least once.
 *
 * MEASURED, AND LOAD-BEARING: before the first `gpu-info-update`, Electron's
 * feature status reads `disabled_software` on a perfectly capable Mac (probe on
 * Electron 44.3.0 / macOS 27.0: pre-ready and ready both `disabled_software`;
 * the event then reads `enabled`). Reading it at launch therefore cannot tell
 * "this machine cannot composite" from "the GPU has not answered yet", and the
 * default-on flip would open opaque and turn glass on a moment later. Until the
 * event, the status is UNKNOWN and the gate stays optimistic; the event itself
 * re-decides (`attachWindowGlass` listens).
 */
let gpuInfoReported = false;
app.on("gpu-info-update", () => {
	gpuInfoReported = true;
});

/**
 * The live facts Electron reports at one instant. `getGPUFeatureStatus()` and
 * `isHardwareAccelerationEnabled()` are documented as usable only after the first
 * `gpu-info-update`; read earlier they can throw or report the placeholder status
 * above. "Not reported yet" must not be read as "disabled", so every unreadable
 * fact is `null`, `glassCapabilityFor` treats it as undecided, and the controller
 * asks again on the next GPU event.
 */
export function readGlassEnvironmentFacts(): GlassEnvironmentFacts {
	const facts: GlassEnvironmentFacts = {};
	/*
	 * `hasSwitch` reports the flag this PROCESS launched with, which is the case
	 * `app.isHardwareAccelerationEnabled()` cannot distinguish from a blocklisted
	 * GPU: both are "no compositor", but only one has a flag the tooltip can name.
	 */
	try {
		facts.accelerationDisabledByLaunch =
			app.commandLine.hasSwitch("disable-gpu");
	} catch {
		facts.accelerationDisabledByLaunch = false;
	}
	try {
		facts.hardwareAcceleration = app.isHardwareAccelerationEnabled();
	} catch {
		facts.hardwareAcceleration = null;
	}
	try {
		/*
		 * Only once the GPU has answered. A pre-report read is `disabled_software`
		 * (see `gpuInfoReported`), which is a statement about the read's timing, not
		 * about the machine - and treating it as a refusal would contradict
		 * criteria 1 and 2 on every launch of a capable Mac.
		 */
		const status = gpuInfoReported ? app.getGPUFeatureStatus() : null;
		facts.gpu = status
			? {
					compositing: status.gpu_compositing,
					rasterization: status.rasterization,
				}
			: null;
	} catch {
		facts.gpu = null;
	}
	return facts;
}

/** The persisted file, or null; a missing and a corrupt file are one answer. */
export function readPersistedWindowGlass(
	userDataDir: string,
	capability: GlassCapability,
): PersistedGlass | null {
	const raw = readJson<Record<string, unknown>>(
		windowGlassFilePath(userDataDir),
	);
	return resolveStoredGlass(raw, capability);
}

export type ResolvedLaunchGlass = {
	capability: GlassCapability;
	settings: GlassSettings;
	/** The fields the stored file carries as the user's own; today's defaults fill
	 * the rest and a later default change must not overturn them. */
	explicit: GlassSettingsField[];
	scheme: GlassScheme;
	state: WindowGlassState;
	/** The environment facts this launch decided on, kept so a live re-check can
	 * merge the renderer's report into them rather than reading them afresh. */
	environment: GlassEnvironmentFacts;
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
	/** Injected by tests; the real read is `readGlassEnvironmentFacts`. */
	environment?: GlassEnvironmentFacts;
}): ResolvedLaunchGlass {
	const environment = input.environment ?? readGlassEnvironmentFacts();
	const capability = glassCapabilityFor({
		platform: input.platform ?? process.platform,
		osVersion: input.osVersion ?? process.getSystemVersion(),
		reducedTransparency:
			input.reducedTransparency ?? nativeTheme.prefersReducedTransparency,
		environment,
	});
	let persisted: PersistedGlass | null = null;
	try {
		persisted = readPersistedWindowGlass(input.userDataDir, capability);
	} catch {
		persisted = null;
	}
	const settings = persisted?.settings ?? defaultGlassSettings(capability);
	const explicit = persisted?.explicit ?? [];
	const scheme = persisted?.scheme ?? "dark";
	return {
		capability,
		settings,
		explicit,
		scheme,
		state: stateFor(settings, capability),
		environment,
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
		/*
		 * A RESTART IS ONLY PENDING WHEN THE EFFECT IS AVAILABLE AND NOT LIVE.
		 * `liveToggle: false` is also true of `mechanism: "none"`, so a capability
		 * DROP (GPU software fallback, backdrop-filter report, Reduce transparency)
		 * satisfied the old expression and told the user to restart while the window
		 * had already fallen back to opaque. The unsupported state has its own
		 * cause line; this notice is only for a supported change that needs a new
		 * window (QA Q-1 / design D2).
		 */
		restartRequired:
			capability.supported &&
			!capability.liveToggle &&
			active !== launchedActive,
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
	/*
	 * WHAT THE USER ACTUALLY CHOSE. Held here because every write is what extends
	 * it: the launch resolution has already filled the rest from today's defaults,
	 * and this set is what the next launch is allowed to keep. A patch's own keys
	 * are the explicit claim (`set` below); nothing else joins it implicitly.
	 */
	const explicit = new Set<GlassSettingsField>(options.initial.explicit);
	/*
	 * The live facts, merged over a fresh read on every re-check so the renderer's
	 * report (the one fact main cannot read) survives a GPU event.
	 */
	let environment: GlassEnvironmentFacts = { ...options.initial.environment };
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
			!writeJsonAtomic(windowGlassFilePath(userDataDir), {
				/*
				 * Versioned and per-field: the next launch fills only what this list does
				 * not name from its own defaults. Writing the full `settings` object alone
				 * is what made an untouched OFF indistinguishable from a chosen one.
				 */
				version: GLASS_FILE_VERSION,
				settings,
				explicit: GLASS_SETTINGS_FIELDS.filter((field) => explicit.has(field)),
				scheme,
			})
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
			/*
			 * A PATCH IS THE CHOICE. Only the fields the renderer actually sent join
			 * the explicit set: the sanitised result carries defaults for everything
			 * else, and copying those in would turn today's default into tomorrow's
			 * explicit value on the very first slider move.
			 */
			if (patch !== null && typeof patch === "object")
				for (const field of Object.keys(patch))
					if ((GLASS_SETTINGS_FIELDS as readonly string[]).includes(field))
						explicit.add(field as GlassSettingsField);
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
	 * The renderer's one gate fact: whether this Chromium can paint a backdrop
	 * blur at all. Reported once at boot by `subscribeGlassPaint`; main does not
	 * trust a launch to wait for it (the first frame must not be blocked by our
	 * own message), so it starts undecided and drops the effect when the answer is
	 * no - the gate lives below the UI, exactly like `enable` does.
	 */
	ipcMain.handle(WINDOW_GLASS_RENDERER_CHANNEL, (event, report: unknown) => {
		if (!fromOwnWindow(event)) return null;
		if (report !== null && typeof report === "object") {
			const value = (report as { backdropFilter?: unknown }).backdropFilter;
			if (typeof value === "boolean")
				environment = { ...environment, backdropFilter: value };
		}
		reevaluate();
		return current();
	});

	/*
	 * EVERY RE-CHECK goes through here: the OS accessibility switch, a GPU update
	 * (driver change, acceleration lost or regained, a remote session), and the
	 * renderer's report. It is idempotent when nothing material changed, so a burst
	 * of GPU events cannot repaint the window repeatedly.
	 */
	function reevaluate(): void {
		environment = {
			...readGlassEnvironmentFacts(),
			...(environment.backdropFilter === undefined
				? {}
				: { backdropFilter: environment.backdropFilter }),
		};
		const next = glassCapabilityFor({
			platform: process.platform,
			osVersion: process.getSystemVersion(),
			reducedTransparency: nativeTheme.prefersReducedTransparency,
			environment,
		});
		if (
			next.supported === capability.supported &&
			next.reason === capability.reason &&
			next.mechanism === capability.mechanism
		)
			return;
		const wasSupported = capability.supported;
		capability = next;
		settings = sanitizeGlassSettings(settings, capability, settings);
		/*
		 * A DEFAULT RESOLVED AT LAUNCH IS NOT A CHOICE. If the gate returns and
		 * `enabled` was never explicit, re-derive it from today's default: without
		 * this, a user who launched under Reduce transparency (or with the GPU
		 * unavailable) and then turned it off mid-session sees the row enable while
		 * the window stays opaque until the next launch. The next launch resolves the
		 * same value again because `explicit` still does not name `enabled`
		 * (review R1-3).
		 */
		if (next.supported && !wasSupported && !explicit.has("enabled"))
			settings.enabled = defaultGlassSettings(next).enabled;
		applyToWindow();
		push();
		log(
			`[window-glass] capability changed supported=${next.supported} reason=${next.reason}`,
		);
	}

	const onNativeThemeUpdated = (): void => reevaluate();
	nativeTheme.on("updated", onNativeThemeUpdated);
	/*
	 * A GPU process that died is re-launched by Electron and its status may come
	 * back software-only (the crash fallback the criteria name). `gpu-info-update`
	 * is the documented signal; the child-process-gone hook asks again in case the
	 * status object settles after the event.
	 */
	app.on("gpu-info-update", reevaluate);
	const onChildProcessGone = (
		_event: unknown,
		details: { type?: string } | undefined,
	): void => {
		if (details?.type === "GPU") setTimeout(reevaluate, 0);
	};
	app.on("child-process-gone", onChildProcessGone);

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
			ipcMain.removeHandler(WINDOW_GLASS_RENDERER_CHANNEL);
			nativeTheme.removeListener("updated", onNativeThemeUpdated);
			app.removeListener("gpu-info-update", reevaluate);
			app.removeListener("child-process-gone", onChildProcessGone);
			if (pinnedTheme) nativeTheme.themeSource = "system";
		},
	};
}
