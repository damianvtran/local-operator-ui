/**
 * Window glass: the OS-drawn translucent window background, as pure decisions.
 *
 * WHAT THIS IS. An appearance setting that lets the desktop show through the app
 * window, blurred by the operating system: ON BY DEFAULT where the machine can
 * composite it (macOS, verified here), off and greyed everywhere else. AppKit vibrancy on
 * macOS (which already renders with the new Liquid Glass materials on macOS 26+) and
 * Windows 11's `backgroundMaterial` (mica / acrylic / tabbed). It is the same split
 * `window-chrome.ts` makes, for the same reason: MAIN has to know the answer BEFORE
 * the window exists (a vibrancy option, a transparent first-paint background) and
 * only the RENDERER knows the palette, so the decisions live here, in a file that
 * imports neither Electron nor React, and every process reaches the same answer.
 *
 * WHY THERE IS NO NATIVE ADDON. `electron-liquid-glass` and similar packages wrap
 * `NSGlassEffectView` (macOS 26) in a native module. They would buy the exact Apple
 * lensing/specular look instead of the vibrancy material, at the price of a
 * per-arch native build, signing and notarisation of one more binary, a universal
 * build story, a dependency this repository's "dependency weight is a commons" rule
 * has no room for, and a private-ish AppKit surface that Electron's own
 * `setVibrancy` already tracks release by release. Measured on macOS 27.0.1 /
 * Electron 44.3.0: `setVibrancy("under-window")` composites the live desktop behind
 * the window (see the PR's evidence), so the cheaper door gets the feature. The
 * limit is stated rather than hidden: there is no lensing, and the blur radius is
 * the OS's, not ours.
 *
 * WHAT IS NOT FAKED. Linux has no OS-level blur for a window an Electron app owns
 * (it depends on the compositor and on a per-desktop protocol), so `supported` is
 * false there and the reason is shown; a translucent window with no blur behind it
 * is a window with the desktop's own text showing through the app's, which is a
 * defect rather than a feature.
 *
 * THE ALPHA FLOORS. A translucent role is the palette's colour at alpha A over a
 * backdrop nobody here controls, and `scripts/contrast-contract.mjs` measures flat
 * hexes, so it cannot see it. `window-glass-floors.json` carries the smallest alpha
 * at which AA ink still holds over the worst MEASURED backdrop of each material,
 * derived by `scripts/derive-glass-floors.mjs` and re-asserted by the contract on
 * every palette. `glassAlphas` never goes below it: the slider's far end is "as
 * see-through as the text can survive", not "as see-through as CSS allows".
 */

import GLASS_FLOORS from "./window-glass-floors.json";

/**
 * Which surfaces the glass covers. `full` includes `sidebars`.
 *
 * TWO TIERS, NOT THREE. A middle "sidebars and chrome" tier shipped in the first
 * round and was removed after design review D1 / QA Q5: its only extra element was
 * the window-foot status band, 0 px tall except while an update offer shows, so the
 * option painted zero differing pixels from "sidebars" (measured: byte-identical
 * frames) under a jargon label. A header or toolbar tier cannot be made real
 * cheaply either - a glass strip over the opaque canvas backing would show the
 * canvas, not the desktop - so the band folds into `sidebars` (it is the sidebars'
 * surface rung along the window's foot) and `chrome` is read back as `sidebars`
 * from a profile written by that build (`migrateCoverage`).
 */
export const GLASS_COVERAGES = ["sidebars", "full"] as const;
export type GlassCoverage = (typeof GLASS_COVERAGES)[number];

/** `(typeof ...)[number]` rather than a hand list so the tuple is the one source. */
export const GLASS_MAC_MATERIALS = ["window", "menu", "popover"] as const;
export const GLASS_WIN_MATERIALS = ["mica", "acrylic", "tabbed"] as const;
export type GlassMaterial =
	| (typeof GLASS_MAC_MATERIALS)[number]
	| (typeof GLASS_WIN_MATERIALS)[number];

/** The scheme the OS material is pinned to, so its tone matches the palette's. */
export type GlassScheme = "dark" | "light";

export type GlassSettings = {
	/** The master switch. The EFFECTIVE launch default is capability-aware
	 * (`defaultGlassSettings`): on where the machine can composite it, off where it
	 * cannot. An unset value must never be read as an explicit OFF. */
	enabled: boolean;
	coverage: GlassCoverage;
	/** 0 = frosted (most opaque), 100 = see-through (down to the alpha floor). */
	intensity: number;
	material: GlassMaterial;
};

/**
 * The intensity a launch that never chose one gets. 80 is the operator's chosen
 * out-of-box look: far enough toward see-through to be the feature people asked
 * for, short of the floors where text begins to suffer on any one theme.
 */
export const DEFAULT_GLASS_INTENSITY = 80;

/**
 * The UNSET BASELINE, and deliberately not the launch default: `enabled` is false
 * here because any path that cannot establish a capability must fail to the
 * shipped opaque window, never to a transparent one nobody asked for. A launch
 * resolves `defaultGlassSettings(capability)` instead; this object is only the
 * floor under `sanitizeGlassSettings` (a corrupt field keeps the opaque look) and
 * the shape stories/tests compare against.
 */
export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
	enabled: false,
	coverage: "full",
	intensity: DEFAULT_GLASS_INTENSITY,
	material: "window",
};

export type GlassMechanism = "vibrancy" | "background-material" | "none";

/** Why a platform can or cannot do glass, as a token the UI maps to copy. */
export type GlassReason =
	| "ok"
	| "reduced-transparency"
	| "windows-too-old"
	| "windows-unverified"
	| "linux-compositor-dependent"
	| "gpu-unavailable"
	| "hardware-acceleration-disabled"
	| "backdrop-filter-unavailable"
	| "unsupported-platform";

export type GlassCapability = {
	supported: boolean;
	mechanism: GlassMechanism;
	reason: GlassReason;
	/** The materials the control may offer; empty when unsupported. */
	materials: readonly GlassMaterial[];
	defaultMaterial: GlassMaterial;
	/** macOS 26+: vibrancy renders with the Liquid Glass materials. A label only. */
	liquid: boolean;
	/**
	 * Whether a launch with NO stored choice turns the effect on. True only where
	 * the platform mechanism is both available and verified by this project:
	 * macOS. Windows and Linux stay off until they are verified (see
	 * `glassCapabilityFor`), so the default flip cannot be an unverified claim.
	 */
	defaultEnabled: boolean;
	/**
	 * Whether the MASTER switch can flip on a running window. macOS: yes, measured
	 * (`setBackgroundColor("#00000000")` + `setVibrancy` on a window built opaque
	 * composites the desktop, and `setVibrancy(null)` + the ground colour restores
	 * it). Windows: no - Electron documents an alpha `backgroundColor` as honoured
	 * only for a `transparent` window, which cannot be resized or maximised, so the
	 * window is built with the material at launch and the toggle waits for a restart.
	 * Coverage, intensity and material are live on both.
	 */
	liveToggle: boolean;
};

/**
 * The subset of Electron's `GPUFeatureStatus` the gate reads. Both keys are
 * required by Electron's own type; a missing/empty field in a status object that
 * DID report is therefore a shape change (a renamed key), and the gate fails
 * closed on it rather than reading it as "fine".
 */
export type GlassGpuFeatureStatus = {
	compositing?: string;
	rasterization?: string;
};

/**
 * The live environment the capability gate needs, as facts MAIN reads and the
 * renderer reports. Every field is optional on purpose: an unreadable fact is
 * UNKNOWN, not "unsupported". `app.getGPUFeatureStatus()` is documented as
 * usable only after the first `gpu-info-update`, so a launch that read it too
 * early must not turn the default off - the next update decides.
 */
export type GlassEnvironmentFacts = {
	/** `app.isHardwareAccelerationEnabled()`; null when it could not be read. */
	hardwareAcceleration?: boolean | null;
	/** The launch asked for no GPU (`--disable-gpu` / disableHardwareAcceleration). */
	accelerationDisabledByLaunch?: boolean;
	/** `app.getGPUFeatureStatus()`; null when it could not be read. */
	gpu?: GlassGpuFeatureStatus | null;
	/** The renderer's `CSS.supports("backdrop-filter: blur(1px)")`; null until it reports. */
	backdropFilter?: boolean | null;
};

/** Windows 11 22H2: the first build where Electron's `backgroundMaterial` works. */
export const WIN_BACKGROUND_MATERIAL_MIN_BUILD = 22621;

const parseVersion = (version: string): number[] =>
	version
		.split(".")
		.map((part) => Number.parseInt(part, 10))
		.map((n) => (Number.isFinite(n) ? n : 0));

/**
 * A Chromium GPU feature is usable only when it is on the hardware path. The
 * statuses are `enabled`, `enabled_readback`, `enabled_force*` for a working
 * compositor and `disabled_*` / `unavailable_*` for software or off, so the
 * prefix is the test: a readback or forced-on compositor still composites.
 *
 * AN ABSENT FIELD IS NOT USABLE. "Not reported yet" is represented one level up
 * as `gpu: null` (readiness in `readGlassEnvironmentFacts`); a status object that
 * exists but lacks a key is a shape change, and passing it would let a renamed
 * Electron field silently open the gate (review R1-7).
 */
const gpuFeatureUsable = (status: string | undefined): boolean =>
	typeof status === "string" && status.startsWith("enabled");

/**
 * The first environment fact that makes a translucent window dishonest, or null.
 * Order is the order the tooltip should name: a launch flag the user chose, then
 * the machine's live GPU state, then the renderer's own ability to blur.
 */
function glassEnvironmentObjection(
	environment: GlassEnvironmentFacts | undefined,
): GlassReason | null {
	if (!environment) return null;
	if (
		environment.accelerationDisabledByLaunch ||
		environment.hardwareAcceleration === false
	)
		return "hardware-acceleration-disabled";
	if (
		environment.gpu &&
		(!gpuFeatureUsable(environment.gpu.compositing) ||
			!gpuFeatureUsable(environment.gpu.rasterization))
	)
		return "gpu-unavailable";
	if (environment.backdropFilter === false)
		return "backdrop-filter-unavailable";
	return null;
}

/**
 * What this machine can do, from facts main reads once. PURE: the platform matrix
 * is exercised on any host by `scripts/window-glass.test.mjs`, which is the only
 * way Windows and Linux are covered here - no CI job owns a display on either.
 *
 * `reducedTransparency` is the OS accessibility switch. It wins over everything
 * because a user who asked the OS for less transparency has asked this app for it
 * too, and the fallback (opaque ground, no vibrancy) is the shipped look.
 *
 * `osVersion` is `process.getSystemVersion()`: the macOS product version on
 * darwin, `10.0.<build>` on Windows. Unparseable input is treated as "too old"
 * on Windows and as "not liquid" on macOS, so a bad read fails to the shipped look.
 *
 * `environment` is the LIVE half of the gate (criterion: detect-then-decide). It
 * is why macOS is not unconditionally supported: a Mac launched with
 * `--disable-gpu`, with Reduce Motion's compositor fallback, or under a
 * remote-desktop session is a machine that cannot draw a blurred material, and a
 * `defaultEnabled` there would paint a see-through window with nothing behind it.
 * Every unknown fact is treated as "keep looking", never "unsupported": the
 * caller re-evaluates on `gpu-info-update` and on the renderer's report.
 */
export function glassCapabilityFor(input: {
	platform: NodeJS.Platform | string;
	osVersion: string;
	reducedTransparency: boolean;
	environment?: GlassEnvironmentFacts;
}): GlassCapability {
	const none = (
		reason: GlassReason,
		defaultMaterial: GlassMaterial = DEFAULT_GLASS_SETTINGS.material,
	): GlassCapability => ({
		supported: false,
		mechanism: "none",
		reason,
		materials: [],
		defaultMaterial,
		liquid: false,
		defaultEnabled: false,
		liveToggle: false,
	});
	const version = parseVersion(input.osVersion);
	if (input.platform === "darwin") {
		if (input.reducedTransparency) return none("reduced-transparency");
		const objection = glassEnvironmentObjection(input.environment);
		if (objection) return none(objection);
		return {
			supported: true,
			mechanism: "vibrancy",
			reason: "ok",
			materials: GLASS_MAC_MATERIALS,
			defaultMaterial: "window",
			liquid: (version[0] ?? 0) >= 26,
			defaultEnabled: true,
			liveToggle: true,
		};
	}
	if (input.platform === "win32") {
		if ((version[2] ?? 0) < WIN_BACKGROUND_MATERIAL_MIN_BUILD)
			return none("windows-too-old", "mica");
		/*
		 * UNVERIFIED, SO NOT SUPPORTED. The `backgroundMaterial` code below is real
		 * and stays (a Windows build can be driven by tests with a synthetic
		 * capability), but no Windows machine has ever run this app's glass, and the
		 * operator's rule is that an unverified effect is not switched on - nor
		 * offered as if it were known to work. The row remains, greyed, naming that
		 * reason; the value in a stale profile is ignored at render time
		 * (`glassIsActive`), which is the enforcement below the UI.
		 */
		return none("windows-unverified", "mica");
	}
	/*
	 * Linux has no OS-drawn blur an app can request (X11/Wayland compositors differ
	 * and a see-through window without blur shows the desktop's own text through the
	 * app's). It is not an opt-in here: nothing would be drawn, so offering a switch
	 * would be the dead control the operator asked us not to have.
	 */
	if (input.platform === "linux") return none("linux-compositor-dependent");
	return none("unsupported-platform");
}

/**
 * What a launch with no stored choice gets. This is the default flip's ONLY
 * entry point, so "unsupported means off" cannot be bypassed by a caller that
 * reads `DEFAULT_GLASS_SETTINGS` directly.
 */
export function defaultGlassSettings(
	capability: GlassCapability,
): GlassSettings {
	return {
		enabled: capability.defaultEnabled,
		coverage: "full",
		intensity: DEFAULT_GLASS_INTENSITY,
		material: capability.defaultMaterial,
	};
}

const isCoverage = (value: unknown): value is GlassCoverage =>
	(GLASS_COVERAGES as readonly unknown[]).includes(value);

/** A stored coverage from any build: the retired `chrome` tier becomes `sidebars`. */
export const migrateCoverage = (value: unknown): unknown =>
	value === "chrome" ? "sidebars" : value;

/**
 * A settings value from an untrusted source (the persisted file, an IPC payload),
 * merged over `base`. Every field is judged on its own, so one bad field keeps its
 * previous value rather than discarding the rest, and a material that this
 * platform does not offer falls back to the platform's default instead of reaching
 * `setVibrancy` / `setBackgroundMaterial`, which throw on an unknown name.
 */
export function sanitizeGlassSettings(
	raw: unknown,
	capability: GlassCapability,
	base: GlassSettings = DEFAULT_GLASS_SETTINGS,
): GlassSettings {
	const record =
		raw !== null && typeof raw === "object"
			? (raw as Record<string, unknown>)
			: {};
	const intensity =
		typeof record.intensity === "number" && Number.isFinite(record.intensity)
			? Math.min(100, Math.max(0, Math.round(record.intensity)))
			: base.intensity;
	const requested =
		typeof record.material === "string" ? record.material : base.material;
	/*
	 * An UNSUPPORTED capability offers no materials, which is a fact about this
	 * moment (Reduce transparency is on), not about the user's choice: falling to
	 * the default there rewrote a stored `menu` as `window` across a round trip
	 * (review R4 / QA Q2). So when nothing is offered the stored value is kept if it
	 * is a material at all; only the APPLIED one degrades, and that is `none`.
	 */
	const offered = capability.materials as readonly string[];
	const known = [
		...GLASS_MAC_MATERIALS,
		...GLASS_WIN_MATERIALS,
	] as readonly string[];
	const material: GlassMaterial =
		offered.length === 0
			? known.includes(requested)
				? (requested as GlassMaterial)
				: base.material
			: offered.includes(requested)
				? (requested as GlassMaterial)
				: capability.defaultMaterial;
	return {
		enabled:
			typeof record.enabled === "boolean" ? record.enabled : base.enabled,
		coverage: isCoverage(migrateCoverage(record.coverage))
			? (migrateCoverage(record.coverage) as GlassCoverage)
			: base.coverage,
		intensity,
		material,
	};
}

/**
 * The persisted file's schema version. Version 2 records WHICH fields the user
 * chose, which is the fact a default flip must not overwrite: before it, every
 * write stored a complete settings object, so an OFF a user never picked and an
 * OFF they picked read identically. A file without this marker is treated as
 * entirely explicit - the conservative reading, because the one thing the flip
 * must never do is overturn a real choice.
 */
export const GLASS_FILE_VERSION = 2;

export const GLASS_SETTINGS_FIELDS = [
	"enabled",
	"coverage",
	"intensity",
	"material",
] as const;
export type GlassSettingsField = (typeof GLASS_SETTINGS_FIELDS)[number];

export type ResolvedStoredGlass = {
	settings: GlassSettings;
	/** The fields the stored file carries as chosen; defaults fill the rest. */
	explicit: GlassSettingsField[];
	scheme: GlassScheme;
};

/**
 * Resolve a persisted file against today's defaults, keeping the user's choices
 * and only filling what they never made. PURE, so the unset-vs-explicit contract
 * is testable without a profile directory; the file I/O is
 * `src/main/window-glass.ts`.
 *
 * A RECORDED FIELD IS TAKEN AS WRITTEN (after sanitising), even when the current
 * capability disagrees: `sanitizeGlassSettings` already keeps a stored material
 * through an unsupported moment (Reduce transparency), and dropping an explicit
 * `enabled: true` here would make the setting reappear the user chose to lose.
 * The RENDER gate (`glassIsActive`) is what makes an unsupported value inert.
 */
export function resolveStoredGlass(
	raw: unknown,
	capability: GlassCapability,
): ResolvedStoredGlass | null {
	if (raw === null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	/*
	 * A file with no settings object is not a choice record: every writer this app
	 * has shipped stored one, so its absence is corruption. It must resolve to
	 * "unset" (today's defaults), not to "all fields chosen from nothing".
	 */
	if (record.settings === null || typeof record.settings !== "object")
		return null;
	const defaults = defaultGlassSettings(capability);
	/*
	 * SANITISE AGAINST THE OPAQUE BASELINE, not today's default. A corrupt
	 * explicit value must fall to the shipped opaque look - the sentence on
	 * `DEFAULT_GLASS_SETTINGS` - instead of inheriting `enabled: true` just
	 * because this machine is capable. Unclaimed fields are replaced by `defaults`
	 * immediately below, so this base only decides corrupt/missing values inside a
	 * field the file claims (review R1-1).
	 */
	const stored = sanitizeGlassSettings(
		record.settings,
		capability,
		DEFAULT_GLASS_SETTINGS,
	);
	/*
	 * The version is LOAD-BEARING, not decoration: a v2 file carries the list and
	 * an older one cannot, so a missing or older marker is the legacy treatment -
	 * every field treated as chosen - rather than silently making every field
	 * "unset" (which would re-enable glass over an explicit off). A v2 file that
	 * lost its list is corruption, and gets the same conservative answer.
	 */
	const legacy =
		record.version !== GLASS_FILE_VERSION || !Array.isArray(record.explicit);
	const explicit: GlassSettingsField[] = legacy
		? [...GLASS_SETTINGS_FIELDS]
		: GLASS_SETTINGS_FIELDS.filter((field) =>
				(record.explicit as readonly unknown[]).includes(field),
			);
	const settings = { ...defaults };
	for (const field of explicit)
		(settings as Record<GlassSettingsField, unknown>)[field] = stored[field];
	return {
		settings,
		explicit,
		scheme: record.scheme === "light" ? "light" : "dark",
	};
}

/**
 * The once-per-launch gate line for the existing diagnostics. Main appends it to
 * the backend log; a bug report can then be bucketed without asking the user to
 * run anything. PURE so the format is asserted by a unit test rather than only
 * observed in a built app.
 */
export function glassGateLine(
	capability: GlassCapability,
	settings: GlassSettings,
	platform: NodeJS.Platform | string,
): string {
	return `[window-glass] launch gate platform=${platform} supported=${capability.supported} default=${capability.defaultEnabled} enabled=${settings.enabled} intensity=${settings.intensity} reason=${capability.reason} mechanism=${capability.mechanism}`;
}

/** Glass is active only when asked for AND the platform can do it. */
export const glassIsActive = (
	settings: GlassSettings,
	capability: GlassCapability,
): boolean => settings.enabled && capability.supported;

/** The transparent window background, spelled once (`#AARRGGBB`). */
export const GLASS_TRANSPARENT = "#00000000";

/**
 * The constructor options glass contributes. OFF contributes `{}` on win32/linux
 * and, on darwin, only its inert `visualEffectState: "active"`; the palette ground
 * is the caller's on every platform.
 *
 * AN INACTIVE GLASS IS STILL THE GUARANTEE, with ONE inert exception on macOS. The caller
 * spreads this AFTER its own `backgroundColor`, so an inactive glass must not add
 * `vibrancy`, `backgroundMaterial` or a transparent background - or the shipped
 * window changes for the people who never touched the setting. On darwin,
 * `visualEffectState: "active"` is contributed EVEN WHEN GLASS IS OFF: it is inert
 * without a vibrancy view, but it is what a LATER `setVibrancy` uses for the view it
 * creates. Electron 44 has no setter for it (`setVibrancy` takes only
 * `animationDuration`), and the default (`followWindow`) renders the material
 * inactive whenever the window is not key - which is why a live-enabled window went
 * flat on focus loss while a launch-enabled one did not. Constructing every darwin
 * window with it makes both paths the same material. win32 and linux get `{}` when
 * off (Windows' material is construction-time anyway, and Linux has none).
 *
 * `visualEffectState: "active"` keeps the material blurred while the window is not
 * key. The macOS default (`followWindow`) dims an inactive window's material, which
 * is native behaviour for a document window but makes an app that is glanced at
 * from another window flicker between two looks; it also is what a never-focused
 * agent-driven run (`headless`/`inactive`) would otherwise show: no blur at all
 * (measured: the same window reads the opaque tone until it is key).
 */
export function glassWindowOptions(
	settings: GlassSettings,
	capability: GlassCapability,
	platform: NodeJS.Platform | string,
): {
	backgroundColor?: string;
	vibrancy?: MacVibrancy;
	visualEffectState?: "active";
	backgroundMaterial?: WinMaterial;
} {
	const inactive =
		platform === "darwin" ? { visualEffectState: "active" as const } : {};
	if (!glassIsActive(settings, capability)) return inactive;
	if (capability.mechanism === "vibrancy") {
		return {
			backgroundColor: GLASS_TRANSPARENT,
			vibrancy: macVibrancyFor(settings.material),
			visualEffectState: "active",
		};
	}
	if (capability.mechanism === "background-material") {
		return {
			backgroundColor: GLASS_TRANSPARENT,
			backgroundMaterial: winMaterialFor(settings.material),
		};
	}
	return inactive;
}

/**
 * The window's first-paint ground WITH the glass applied over it, in the one
 * order that keeps the default path stable.
 *
 * WHY A FUNCTION. The order is the guarantee: the palette ground first, the glass
 * options after, so only an ACTIVE glass can override `backgroundColor` and an
 * inactive one contributes at most darwin's inert `visualEffectState` (above). That
 * used to be pinned by a regex over `index.ts`'s source text (review R7), which
 * proves a spelling; this is what `index.ts` actually spreads, so the test drives
 * the behaviour. Key order of the result is part of the contract (`JSON.stringify`
 * equality in the tests).
 */
export function groundWithGlass(
	ground: string,
	settings: GlassSettings,
	capability: GlassCapability,
	platform: NodeJS.Platform | string,
): ReturnType<typeof glassWindowOptions> & { backgroundColor: string } {
	return {
		backgroundColor: ground,
		...glassWindowOptions(settings, capability, platform),
	};
}

/** The subset of Electron's vibrancy names this feature uses, spelled out so the
 * options object type-checks against `BrowserWindowConstructorOptions` without
 * this file importing Electron. */
export type MacVibrancy = "under-window" | "menu" | "popover";
export type WinMaterial = "mica" | "acrylic" | "tabbed";

/** The AppKit material for a UI material id. `under-window` is Apple's own
 * material for "the window's background"; `sidebar` measured identical. */
export function macVibrancyFor(material: GlassMaterial): MacVibrancy {
	return material === "menu"
		? "menu"
		: material === "popover"
			? "popover"
			: "under-window";
}

export function winMaterialFor(material: GlassMaterial): WinMaterial {
	return material === "acrylic" || material === "tabbed" ? material : "mica";
}

/** The floors tier a material is held to. Windows' materials were not measurable
 * here, so they borrow the most demanding measured tier: conservative, and said so
 * in `derive-glass-floors.mjs`. */
type FloorTier = "under-window" | "menu" | "popover";
const floorTierFor = (
	mechanism: GlassMechanism,
	material: GlassMaterial,
): FloorTier => {
	if (mechanism !== "vibrancy") return "popover";
	return material === "menu"
		? "menu"
		: material === "popover"
			? "popover"
			: "under-window";
};

/** The most opaque a glass role is ever painted: "frosted" is veiled, not solid. */
export const GLASS_ALPHA_CEILING = 0.96;

/** The three grounds. States are `GLASS_FLOORS.stateAlpha`, a fixed ink overlay. */
export type GlassAlphas = { canvas: number; surface: number; elevated: number };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The smallest alpha each role may take for this material and scheme. */
export function glassAlphaFloors(
	mechanism: GlassMechanism,
	material: GlassMaterial,
	scheme: GlassScheme,
): GlassAlphas {
	const tier =
		GLASS_FLOORS.alphaFloor[floorTierFor(mechanism, material)][scheme];
	return {
		canvas: tier.canvas,
		surface: tier.surface,
		elevated: tier.elevated,
	};
}

/**
 * The per-role alphas the renderer paints for a slider position.
 *
 * Linear from `GLASS_ALPHA_CEILING` at intensity 0 down to each role's own floor at
 * 100. Each role has its own floor (the more elevated a ground is, the further its
 * flat colour sits from the tone the material gives it), so at the same intensity
 * the roles keep their lightness ORDER - which is what the design system's
 * elevation ladder is, and what a single shared alpha would flatten.
 */
export function glassAlphas(input: {
	intensity: number;
	mechanism: GlassMechanism;
	material: GlassMaterial;
	scheme: GlassScheme;
}): GlassAlphas {
	const t = Math.min(100, Math.max(0, input.intensity)) / 100;
	const floors = glassAlphaFloors(
		input.mechanism,
		input.material,
		input.scheme,
	);
	const at = (floor: number): number => {
		/* A role whose floor is ABOVE the veil ceiling (dark `elevated` on the
		 * densest material: 0.97) is held at its floor for the whole slider: the
		 * floor is the contract, the ceiling only a default. Clamping the top
		 * DOWN to the ceiling would paint it below its own floor at "frosted". */
		const top = Math.max(GLASS_ALPHA_CEILING, floor);
		return round2(top - t * (top - floor));
	};
	return {
		canvas: at(floors.canvas),
		surface: at(floors.surface),
		elevated: at(floors.elevated),
	};
}

/** What main tells the renderer. `active` is the one the CSS keys on. */
export type WindowGlassState = {
	capability: GlassCapability;
	settings: GlassSettings;
	active: boolean;
	/** The master switch was flipped on a platform that cannot do it live: the
	 * window keeps the look it was built with until the next launch. */
	restartRequired: boolean;
};

export const WINDOW_GLASS_ARG = "--lo-window-glass";
export const WINDOW_GLASS_GET_CHANNEL = "window-glass:get";
export const WINDOW_GLASS_SET_CHANNEL = "window-glass:set";
export const WINDOW_GLASS_SCHEME_CHANNEL = "window-glass:scheme";
export const WINDOW_GLASS_STATE_CHANNEL = "window-glass:state";
/** The renderer's one-time capability report (`backdrop-filter` support). */
export const WINDOW_GLASS_RENDERER_CHANNEL = "window-glass:renderer";
export const WINDOW_GLASS_FILE = "window-glass.json";

/**
 * The first-frame fact, as one argv entry the preload reads synchronously:
 * `--lo-window-glass=<mechanism>:<coverage>:<intensity>:<material>:<scheme>`, or
 * `off`. Synchronous for `window-chrome.ts`'s reason: attributes that arrive after
 * the first paint are a visible jump on every launch - here, a window that opens
 * opaque and then turns see-through.
 */
export function windowGlassArgument(
	state: WindowGlassState,
	scheme: GlassScheme,
): string {
	if (!state.active) return `${WINDOW_GLASS_ARG}=off`;
	const { settings, capability } = state;
	return `${WINDOW_GLASS_ARG}=${capability.mechanism}:${settings.coverage}:${settings.intensity}:${settings.material}:${scheme}`;
}

export type WindowGlassFacts = {
	mechanism: Exclude<GlassMechanism, "none">;
	coverage: GlassCoverage;
	intensity: number;
	material: GlassMaterial;
	scheme: GlassScheme;
} | null;

/** The reader. `null` (off) for anything it cannot parse: fail to the shipped look. */
export function readWindowGlassArgument(
	argv: readonly string[],
): WindowGlassFacts {
	const entry = argv.find((arg) => arg.startsWith(`${WINDOW_GLASS_ARG}=`));
	if (!entry) return null;
	const [mechanism, coverage, intensity, material, scheme, ...rest] = entry
		.slice(WINDOW_GLASS_ARG.length + 1)
		.split(":");
	if (rest.length > 0) return null;
	if (mechanism !== "vibrancy" && mechanism !== "background-material")
		return null;
	if (!isCoverage(coverage)) return null;
	const n = Number(intensity);
	if (!Number.isInteger(n) || n < 0 || n > 100) return null;
	const known: readonly string[] = [
		...GLASS_MAC_MATERIALS,
		...GLASS_WIN_MATERIALS,
	];
	if (!known.includes(material)) return null;
	if (scheme !== "dark" && scheme !== "light") return null;
	return {
		mechanism,
		coverage,
		intensity: n,
		material: material as GlassMaterial,
		scheme,
	};
}

/**
 * WHICH SURFACES EACH COVERAGE PAINTS, as the kinds `data-glass-region` names.
 *
 *  - `sidebar` - the navigation columns (chat, settings and agents sidebars, the
 *    collapsed strip, the right-hand panel rail) and the top lane's `surface` stops.
 *  - `canvas`  - the ground the conversation and every page read on: `<main>` is the
 *    BACKING, and the page grounds inside it go transparent so one alpha applies.
 *    The worst case for contrast (hours of prose), which is why it is last.
 *  - `pane`    - the `elevated` side panes (canvas, browser, asks, run details).
 *    Document viewers inside them (PDF, image, video, audio) keep their own opaque
 *    ground: media is not text over a veil, and an embedded page paints its own.
 *
 * Each coverage includes the one before it. A kind that is not covered keeps its
 * ordinary opaque role class, so a partial coverage is the shipped look plus some
 * translucent regions - never a different layout.
 */
export const GLASS_KINDS_BY_COVERAGE: Record<GlassCoverage, readonly string[]> =
	{
		sidebars: ["sidebar"],
		full: ["sidebar", "canvas", "pane"],
	};

export type GlassPaint = {
	/** The space-separated kinds for `html[data-glass]`. */
	kinds: string;
	/** The custom properties for `<html>`, each a bare number 0..1. */
	vars: Record<string, string>;
};

/** The border->ink mix (0..1) that holds the 3:1 structural edge on glass. */
export function glassControlMix(
	mechanism: GlassMechanism,
	material: GlassMaterial,
	scheme: GlassScheme,
): number {
	return GLASS_FLOORS.controlMix[floorTierFor(mechanism, material)][scheme];
}

/**
 * The renderer's paint: the kinds that go translucent and every alpha they use.
 *
 * TWO SETS OF ALPHAS, because one region stacks. `<main>` is the canvas BACKING for
 * the whole content column (a route that paints no ground of its own would
 * otherwise be raw text on the desktop), so a surface or pane painted INSIDE it
 * composites over the backing, and its own alpha is the NET one:
 * `1 - (1 - target) / (1 - backing)`, which lands the pair on the target. Where the
 * target is already below the backing's the net is clamped to 0 - the leaf adds
 * nothing and the region is MORE opaque than its floor, never less. Regions outside
 * `<main>` (the sidebars, the rail, the fleet asks drawer) paint the raw target.
 *
 * The raw targets are `glassAlphas`, which never go below the measured floors.
 */
export function glassPaintFor(input: {
	coverage: GlassCoverage;
	intensity: number;
	mechanism: GlassMechanism;
	material: GlassMaterial;
	scheme: GlassScheme;
}): GlassPaint {
	const raw = glassAlphas(input);
	const net = (target: number): number =>
		round2(Math.min(1, Math.max(0, 1 - (1 - target) / (1 - raw.canvas))));
	const vars: Record<string, string> = {
		"--lo-glass-a-canvas": String(raw.canvas),
		"--lo-glass-a-surface": String(raw.surface),
		"--lo-glass-a-elevated": String(raw.elevated),
		"--lo-glass-a-row-hover": String(GLASS_FLOORS.stateAlpha.hover),
		"--lo-glass-a-row-selected": String(GLASS_FLOORS.stateAlpha.selected),
		/*
		 * A RUNNING ROW is the row that is the subject right now, the same claim a
		 * selected row makes (and the two cannot co-occur), so the overlay is the
		 * same derived alpha under its own name: the CSS says "work" where the
		 * meaning is "in flight", and a future split is one derivation away.
		 */
		"--lo-glass-a-row-work": String(GLASS_FLOORS.stateAlpha.work),
		"--lo-glass-a-field": String(GLASS_FLOORS.stateAlpha.field),
		/*
		 * The block veil: a text-bearing block whose fill is its only boundary on
		 * the flat system (a user message bubble, a project card) takes this ink
		 * overlay so the fill stays a RELATIVE step off the glass rather than an
		 * opaque island. Derivation and the failed `messageSurface`-floor
		 * alternative: `scripts/derive-glass-floors.mjs`.
		 */
		"--lo-glass-a-block-veil": String(GLASS_FLOORS.blockVeil[input.scheme]),
		/*
		 * THE ISOLATING BAND'S OWN ALPHA FLOOR, per scheme.
		 *
		 * A band over MOVING content - a sticky section header that rows scroll
		 * under - has a ground that is whatever happens to be passing beneath it,
		 * so its alpha is a contract rather than a style choice: the count beside
		 * the label has to clear the 4.5 text floor against it, whatever scrolls
		 * under. The floor is the smallest alpha at which that holds over the
		 * worst content colour, derived over every palette by
		 * `scripts/derive-glass-floors.mjs` and asserted by
		 * `scripts/contrast-contract.mjs`.
		 *
		 * The ordinary bands do not need it: they sit on the pane's own static
		 * ground, where the published alpha is right.
		 */
		"--lo-glass-a-band-floor": String(GLASS_FLOORS.bandFloor[input.scheme]),
		/*
		 * The LANE wash: a well behind veiled blocks cannot be an ink overlay (the
		 * veil is already the one ink layer under the card's text), so it is a
		 * palette role at an alpha that TRACKS the slider. The page's own alpha is
		 * the tracker: as the page approaches its opaque end the lane converges on
		 * its flat role fill, and as the page clears the lane keeps the same share
		 * of the ground's translucency. A FIXED lane alpha is what failed review
		 * round 1 (F2): the page moved `0.66 -> 0.96` with intensity while the wash
		 * stayed put, and the step fell to ΔE00 0.59 at the opaque end.
		 *
		 * The ROLE is derived with the scale (`laneWash[scheme].role`): on dark
		 * palettes the lift (`surface`) is too close to `canvas` to step at all at
		 * the opaque end, so the recess (`sunken`) carries it; on light palettes the
		 * reverse. The contract asserts the pair at every slider position.
		 */
		"--lo-glass-a-lane": String(
			Math.round(raw.canvas * GLASS_FLOORS.laneWash[input.scheme].scale * 100) /
				100,
		),
		/* The palette role that lane alpha is painted in, as a CSS reference: the
		 * role is scheme-dependent and the stylesheet must not carry a second copy
		 * of that decision. */
		"--lo-glass-lane-tone":
			GLASS_FLOORS.laneWash[input.scheme].role === "sunken"
				? "var(--lo-sunken)"
				: "var(--lo-surface)",
		"--lo-glass-control-mix": String(
			glassControlMix(input.mechanism, input.material, input.scheme),
		),
		"--lo-glass-in-surface": String(net(raw.surface)),
		"--lo-glass-in-elevated": String(net(raw.elevated)),
	};
	return { kinds: GLASS_KINDS_BY_COVERAGE[input.coverage].join(" "), vars };
}
