/**
 * The backend-owned speech-to-text action, shared by all three processes.
 * Main caches the one config value; this module only translates its grammar.
 */
import { type MiniViewPlatform, formatQuickSendDisplay } from "./mini-view";

export const START_RECORDING_SETTING_KEY = "keymap.start_recording";
export const DEFAULT_START_RECORDING_VALUE = "primary+shift+s";
/** The bare-modifier hold beside it; the renderer's own keydown/keyup pair matches it. */
export const PUSH_TO_TALK_SETTING_KEY = "keymap.push_to_talk";
export const DEFAULT_PUSH_TO_TALK_VALUE = "alt-right-hold";

/**
 * The cleared state for a clearable hotkey row. The backend registry cannot
 * store an empty/null value for these rows (validate refuses it, and `''` on
 * edit means reset), so a cleared row stores this string sentinel. It is
 * accepted ONLY by the two desktop-scope dictation rows that opt in
 * (`keymap.start_recording`, `keymap.push_to_talk`); everywhere else it is an
 * invalid value that falls back to the default. Cleared is distinct from
 * invalid in every resolver: invalid keeps the last-good/default, while this
 * means no door.
 */
export const CLEARED_SHORTCUT_VALUE = "none";

export function isClearedShortcut(value: unknown): boolean {
	// Case-insensitive and trimmed: the backend's resolvers read `NONE`,
	// `None` and ` none ` as cleared too, so a hand-edit into config.yml must
	// agree here rather than read as invalid (QA Q-1). `''` is not cleared:
	// it stays an invalid value that keeps last-good (the main read reports
	// it before this check, and the renderer falls back to the default).
	return (
		typeof value === "string" &&
		value.trim().toLowerCase() === CLEARED_SHORTCUT_VALUE
	);
}

export type RecordingShortcutInput = {
	key: string;
	code?: string;
	control?: boolean;
	meta?: boolean;
	alt?: boolean;
	shift?: boolean;
	type?: string;
	isAutoRepeat?: boolean;
};

export type ChordClaim = { chord: string; label: string };
export type RecordingShortcutState = {
	value: string;
	canonical: string | null;
	/** The row was explicitly cleared (`"none"`): no door, distinct from invalid. */
	cleared?: boolean;
	problem?: string;
	pending?: string;
	shadowedBy?: string;
};

const NAMED_KEYS: Readonly<Record<string, string[] | undefined>> = {
	space: [" ", "spacebar"],
	backspace: ["backspace"],
	delete: ["delete", "del"],
	insert: ["insert"],
	home: ["home"],
	end: ["end"],
	pageup: ["pageup"],
	pagedown: ["pagedown"],
	up: ["arrowup"],
	down: ["arrowdown"],
	left: ["arrowleft"],
	right: ["arrowright"],
};
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
	primary: "primary",
	ctrl: "ctrl",
	control: "ctrl",
	alt: "alt", // i18n: ignore persisted accelerator grammar token, never displayed
	option: "alt",
	shift: "shift",
	meta: "meta",
	cmd: "meta",
	command: "meta",
	super: "meta",
};
const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/;
const SINGLE_KEY = /^[a-z0-9]$/;
const MODIFIER_ORDER = ["primary", "ctrl", "meta", "alt", "shift"];

/** Shared modules also execute in Storybook/browser hosts without Node globals. */
function defaultPlatform(): NodeJS.Platform | string {
	if (typeof process !== "undefined" && process.platform)
		return process.platform;
	return /Mac/i.test(globalThis.navigator?.platform ?? "") ? "darwin" : "linux";
}

/**
 * Option changes `event.key` on macOS (R becomes ®). Recover the physical key
 * only for that transformed case: using `code` unconditionally would break
 * AZERTY and Dvorak, whose unmodified `key` already names the intended letter.
 */
export function physicalKey(input: {
	key: string;
	code?: string;
	alt?: boolean;
}): string {
	if (input.alt === true && !/^[a-z0-9]$/i.test(input.key)) {
		const code = input.code ?? "";
		if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
		if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	}
	return input.key;
}

/** Backend accelerator grammar, canonicalized for comparison and safe caching. */
export function canonicalRecordingChord(
	value: string,
	_platform: NodeJS.Platform | string = defaultPlatform(),
): string | null {
	if (value.includes(",")) return null;
	const tokens = value
		.trim()
		.toLowerCase()
		.split("+")
		.map((token) => MODIFIER_ALIASES[token] ?? token)
		.filter(Boolean);
	if (tokens.length === 0) return null;
	const key = tokens.at(-1) ?? "";
	if (MODIFIER_ALIASES[key] !== undefined) return null;
	const named = Object.entries(NAMED_KEYS).some(
		([name, aliases]) => key === name || aliases?.includes(key) === true,
	);
	if (!named && !FUNCTION_KEY.test(key) && !SINGLE_KEY.test(key)) return null;
	const modifiers = new Set(tokens.slice(0, -1));
	if (
		modifiers.size !== tokens.length - 1 ||
		[...modifiers].some((token) => MODIFIER_ALIASES[token] !== token)
	) {
		return null;
	}
	const ordered = MODIFIER_ORDER.filter((token) => modifiers.has(token));
	return [...ordered, key].join("+");
}

/**
 * Canonical spellings whose physical presses can collide with a renderer claim.
 * Stored recording values stay exact for dispatch; only conflict identity uses
 * this equivalence, because a renderer `primary` binding accepts Ctrl or Command
 * on macOS (Ctrl elsewhere), including when recording names one literally.
 */
export function recordingConflictVariants(
	value: string,
	platform: NodeJS.Platform | string = defaultPlatform(),
): string[] {
	const canonical = canonicalRecordingChord(value, platform);
	if (canonical === null) return [];
	const tokens = canonical.split("+");
	const key = tokens.at(-1) as string;
	const modifiers = tokens.slice(0, -1);
	const primaryTokens = platform === "darwin" ? ["ctrl", "meta"] : ["ctrl"];
	const variants = new Set<string>([canonical]);
	const withPrimary = (replacement: string): void => {
		if (modifiers.includes(replacement)) return;
		const next = new Set(
			modifiers.map((token) => (token === "primary" ? replacement : token)),
		);
		variants.add(
			[...MODIFIER_ORDER.filter((token) => next.has(token)), key].join("+"),
		);
	};
	if (modifiers.includes("primary")) {
		for (const token of primaryTokens) withPrimary(token);
	} else {
		for (const token of primaryTokens) {
			if (!modifiers.includes(token)) continue;
			const next = new Set(
				modifiers.map((modifier) =>
					modifier === token ? "primary" : modifier,
				),
			);
			variants.add(
				[...MODIFIER_ORDER.filter((modifier) => next.has(modifier)), key].join(
					"+",
				),
			);
		}
	}
	return [...variants];
}

function keyTokenMatches(
	token: string,
	input: RecordingShortcutInput,
): boolean {
	const key = physicalKey(input).toLowerCase();
	if (NAMED_KEYS[token]?.includes(key)) return true;
	if (FUNCTION_KEY.test(token)) return token === key;
	return SINGLE_KEY.test(token) && token === key;
}

/** Exact, non-repeating keyDown matching; `primary` keeps its platform semantics. */
export function recordingShortcutMatches(
	value: string,
	input: RecordingShortcutInput,
	platform: NodeJS.Platform | string = defaultPlatform(),
): boolean {
	if (input.type !== "keyDown" || input.isAutoRepeat === true) return false;
	const canonical = canonicalRecordingChord(value, platform);
	if (canonical === null) return false;
	const tokens = canonical.split("+");
	const key = tokens.at(-1) ?? "";
	if (!keyTokenMatches(key, input)) return false;
	const modifiers = new Set(tokens.slice(0, -1));
	// On macOS `primary` deliberately preserves the legacy fixed door: either
	// Control OR Command alone fires. Literal `ctrl`/`meta` bindings stay exact.
	// `primary+meta` requires Meta but not Control; `primary+ctrl` explicitly
	// names both physical modifiers. Elsewhere primary remains Control only.
	const primary = modifiers.has("primary");
	const explicitCtrl = modifiers.has("ctrl");
	const explicitMeta = modifiers.has("meta");
	let control: boolean;
	let meta: boolean;
	if (platform !== "darwin") {
		control = (input.control === true) === (explicitCtrl || primary);
		meta = (input.meta === true) === explicitMeta;
	} else if (primary && explicitCtrl && !explicitMeta) {
		// `primary+ctrl` explicitly names both physical modifiers.
		control = input.control === true;
		meta = input.meta === true;
	} else if (primary && explicitMeta && !explicitCtrl) {
		// `primary+meta` names Command, with Control explicitly excluded.
		control = input.control !== true;
		meta = input.meta === true;
	} else if (primary && !explicitCtrl && !explicitMeta) {
		// The legacy collapsed primary accepts either modifier, never both.
		control = input.control === true ? input.meta !== true : true;
		meta =
			input.meta === true ? input.control !== true : input.control === true;
	} else {
		control = (input.control === true) === explicitCtrl;
		meta = (input.meta === true) === explicitMeta;
	}
	return (
		control &&
		meta &&
		(input.alt === true) === modifiers.has("alt") &&
		(input.shift === true) === modifiers.has("shift")
	);
}

export function recordingShortcutLabel(
	value: unknown,
	platform: MiniViewPlatform,
): string {
	const chord =
		typeof value === "string" && value.trim() !== ""
			? value.trim()
			: DEFAULT_START_RECORDING_VALUE;
	return formatQuickSendDisplay(chord, platform);
}

/**
 * The mic-button tooltip's two arms, as one pure choice shared by the three
 * surfaces that teach both doors (composer, Team Bridge, canvas inline edit).
 * Either door cleared means the plain "Start recording" arm: the composed
 * "… (X or hold Y)" string is returned only when BOTH labels exist, so an
 * empty half can never render as "or hold " followed by nothing. The caller
 * still owns the i18n key (it differs per surface); it receives the labels
 * this helper vouched for and interpolates them with `isolateLtr` as before.
 */
export function recordingHintParts(
	shortcut: string | null,
	pushToTalk: string | null,
): { shortcut: string; pushToTalk: string } | null {
	if (shortcut === null || pushToTalk === null) return null;
	if (shortcut === "" || pushToTalk === "") return null;
	return { shortcut, pushToTalk };
}
