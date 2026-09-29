/**
 * The global hotkey registrar: a pure module that decides WHICH accelerator a
 * stored keymap value means, and one state machine around the `globalShortcut`
 * object it is handed.
 *
 * WHY IT IS PURE AND ELECTRON-FREE (the same discipline as `window-mode.ts`):
 * every decision here — the token mapping, the structural refusals, the
 * registered/taken/invalid/unavailable transitions — is exercised in process
 * by the desktop suite against a fake `shortcut`, so the behaviour does not
 * need a booted app or a real keyboard grab to be tested. `index.ts` is the
 * only caller that passes Electron's own `globalShortcut` in.
 *
 * THE STORED VALUE IS USER DATA, SO THIS MODULE DOES NOT TRUST IT. The write
 * boundary (`settings_io.validate_key` with the row's scope) refuses the shapes
 * this module also refuses — no modifier, a bare typable key, comma alternates
 * — but the value is read from `config.yml`, which is a file a person can edit
 * by hand, and this is the LAST step before the operating system is asked to
 * hand the chord over. So the structural rules are enforced a second time
 * here, deliberately: a hand-edited `space` must never become a global binding
 * that steals the space bar from every app on the machine.
 *
 * THE OFFICIAL MAPPING IS §A.3 OF THE DESIGN. `primary` is Electron's own
 * `CommandOrControl` spelling rather than an expansion into `Command`/`Control`
 * per platform, so one stored value registers correctly on all three and the
 * mapping stays one legible table. `meta` is the literal Command/Win/Super key.
 */

import type { MiniViewRegistrationState } from "../shared/mini-view";
import { isFunctionKeyToken } from "../shared/mini-view";

/**
 * The shipped default lives in `src/shared/mini-view.ts` (one literal for the
 * registrar, the settings surfaces and the mini header — see that file's
 * comment); re-exported here because this module is where the registration
 * vocabulary is read from.
 */
export { DEFAULT_QUICK_SEND_VALUE } from "../shared/mini-view";

/** The value `primary` registers as. Electron's own spelling of the concept. */
export const COMMAND_OR_CONTROL = "CommandOrControl";

/** The stored modifier tokens, in the canonical order the file uses. */
export const MODIFIER_TOKENS = [
	"primary",
	"ctrl",
	"alt",
	"shift",
	"meta",
] as const;

/**
 * The key token -> accelerator name table.
 *
 * Refusals live in the comments rather than the table: `escape`, `tab` and
 * `enter` are deliberately absent (every app depends on them; a global binding
 * steals them system-wide — the design's §A.3 rule, joined by the same reasons
 * in the backend's `DESKTOP_RESERVED_COMBOS`), and so are punctuation keys and
 * comma alternates (Electron has no such concept).
 */
const KEY_TOKENS: Record<string, string> = {
	space: "Space",
	backspace: "Backspace",
	delete: "Delete",
	insert: "Insert",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
};

/** A single letter token, at module scope for the same reason as the table above. */
const LETTER_KEY = /^[a-z]$/;
/** A single digit token. */
const DIGIT_KEY = /^[0-9]$/;

/** A modifier token's accelerator name, per platform. */
function modifierAccelerator(
	token: string,
	platform: NodeJS.Platform | string,
): string | null {
	switch (token) {
		case "primary":
			return COMMAND_OR_CONTROL;
		case "ctrl":
			return "Control";
		case "alt":
			return "Alt";
		case "shift":
			return "Shift";
		case "meta":
			if (platform === "darwin") return "Command";
			// Windows' Super key and Linux's Super key share Electron's own
			// spelling for the OS modifier, so they map the same way.
			return "Super";
		default:
			return null;
	}
}

/**
 * What `primary` registers as ON THIS PLATFORM, for display and log lines.
 *
 * `CommandOrControl` is right for `register()` — it is the one spelling that
 * resolves per platform — but a log line that says "registered
 * CommandOrControl+Alt+Shift+Space" tells a reader nothing about the key under
 * their finger. This is the mapping the log line and the settings copy use.
 */
export function commandOrControlTarget(
	platform: NodeJS.Platform | string,
): "Command" | "Control" {
	return platform === "darwin" ? "Command" : "Control";
}

type Resolution = { accelerator: string } | { problem: string };

/**
 * The stored value as an Electron accelerator, or the reason it is not one.
 *
 * Structural rules, all refusals rather than guesses: at least one modifier,
 * exactly one non-modifier key token, no duplicates after lower-casing, no
 * unknown tokens. Order is accepted as it comes (the canonical order is the
 * file's convention, not a validity rule) — the stored form is normalized at
 * every write, so an out-of-order value can only be a hand edit, and mapping
 * it is the friendly reading rather than a refusal.
 */
function resolveWithProblem(
	value: string,
	platform: NodeJS.Platform | string,
): Resolution {
	const raw = value.trim();
	if (raw === "") return { problem: "the value is empty" };
	if (raw.includes(",")) {
		/*
		 * Textual's comma means alternates; Electron has no such concept, and a
		 * value the registrar cannot express must not be storable — nor
		 * registrable if it got in by hand.
		 */
		return {
			problem: "comma alternates are not expressible as one global shortcut",
		};
	}
	const tokens = raw
		.split("+")
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return { problem: "the value is empty" };

	const parts: string[] = [];
	let keyParts = 0;
	let modifiers = 0;
	const seen = new Set<string>();
	for (const token of tokens) {
		if (seen.has(token)) {
			return { problem: `the modifier \`${token}\` appears twice` };
		}
		seen.add(token);
		const modifier = modifierAccelerator(token, platform);
		if (modifier !== null) {
			modifiers += 1;
			parts.push(modifier);
			continue;
		}
		const key = keyTokenAccelerator(token);
		if (key === null) {
			return {
				problem: `\`${token}\` is not a key this app can bind globally`,
			};
		}
		keyParts += 1;
		parts.push(key);
	}
	if (modifiers === 0) {
		/*
		 * THE bare carve-out is F1–F24 ONLY — design §A.5 ("Bare function keys
		 * are allowed (they are not typable)"), mirrored from the backend's
		 * `validate_desktop_key` after its own review round 1: every other
		 * modifier-less token is refused, because a letter or `space` fires
		 * while the user types and a NAMED key (`pageup`, an arrow, `delete`)
		 * is consumed by every editing app all the same — a global binding on
		 * one steals it system-wide. A value the backend refuses to store must
		 * not register here either; the two rules are one rule, and a stored
		 * bare `f8` (accepted in-field, storable by the backend) must reach
		 * the OS rather than dead-ending as `invalid` (review round 1, R1).
		 */
		const bareFunctionKey =
			tokens.length === 1 && isFunctionKeyToken(tokens[0]);
		if (!bareFunctionKey) {
			return {
				problem:
					"a global shortcut needs a modifier — it would otherwise fire while you type",
			};
		}
	}
	if (keyParts !== 1)
		return { problem: "a global shortcut sets exactly one chord" };
	return { accelerator: parts.join("+") };
}

/** A key token's accelerator name, or null when it is not one. */
function keyTokenAccelerator(token: string): string | null {
	if (token in KEY_TOKENS) return KEY_TOKENS[token];
	if (isFunctionKeyToken(token)) return token.toUpperCase();
	if (LETTER_KEY.test(token)) return token.toUpperCase();
	if (DIGIT_KEY.test(token)) return token;
	/*
	 * `escape`, `tab` and `enter` land here on purpose — see the table's own
	 * comment. So does everything Electron could not register.
	 */
	return null;
}

/**
 * The §A.3 mapping: a stored value to the accelerator to register, or null
 * when the value is not a chord this app can register on this platform.
 */
export function resolveAccelerator(
	value: string,
	platform: NodeJS.Platform | string,
): string | null {
	const resolved = resolveWithProblem(value, platform);
	return "accelerator" in resolved ? resolved.accelerator : null;
}

/**
 * Whether an ALREADY-RESOLVED accelerator string is one this app is willing to
 * hand to the OS.
 *
 * The structural half only, and it exists so a caller can never register a
 * string the mapping did not produce (a typo in a future call site, a value
 * that skipped `resolveAccelerator`). What it cannot answer — whether the OS
 * will actually grant the chord — is the registration call's own answer, and
 * that split is the design's: the validator is structural, the OS is the
 * authority on what registers.
 */
export function isRegistrable(accelerator: string): boolean {
	if (accelerator.trim() === "") return false;
	return accelerator
		.split("+")
		.every(
			(token) =>
				[
					COMMAND_OR_CONTROL,
					"Command",
					"Control",
					"Alt",
					"Shift",
					"Super",
				].includes(token) || keyTokenAccelerator(token.toLowerCase()) !== null,
		);
}

/**
 * The shape of `globalShortcut` this registrar uses — injectable so tests run
 * the whole state machine in process, with no Electron and no real chord.
 */
export interface ShortcutLike {
	register(accelerator: string, callback: () => void): boolean;
	unregister(accelerator: string): void;
}

export interface RegistrarOptions {
	shortcut: ShortcutLike;
	platform: NodeJS.Platform | string;
	/**
	 * The launch environment, read ONLY for the session type: a Wayland
	 * session's compositor owns the global shortcut space, so `register()` can
	 * succeed and the chord never fire — the silent dead key this design
	 * forbids. Such a session reports `unavailable` instead.
	 */
	env?: Record<string, string | undefined>;
	/** What a successful press runs. One callback, one chord. */
	onTrigger: () => void;
	/**
	 * Every state CHANGE is reported. An idempotent re-apply of an unchanged,
	 * already-registered value reports nothing, so a settings page that
	 * re-reads on every write does not spam the push channel.
	 */
	onState: (state: MiniViewRegistrationState) => void;
}

export interface MiniViewRegistrar {
	apply(value: string): MiniViewRegistrationState;
	getState(): MiniViewRegistrationState | null;
	dispose(): void;
}

/**
 * The registrar, and the three rules that make it a state machine rather than a
 * wrapper around `register`.
 *
 * 1. ONE CHORD AT A TIME. `globalShortcut` is process-global; registering the
 *    new chord before unregistering the old would make the app briefly hold
 *    two, and a failed new registration would leave the old one live while the
 *    config says otherwise. So the order is always unregister-old, then
 *    register-new, then report what actually happened.
 * 2. AN UNCHANGED, REGISTERED VALUE IS A NO-OP. Without that, every watcher
 *    tick and every settings write would unregister and re-register the live
 *    chord — a window in which the hotkey does not work, for no change at all.
 * 3. SERIALISED BY CONSTRUCTION. `apply` is synchronous and single-threaded
 *    JS; two callers can interleave only between calls, never inside one, so
 *    unregister+register is one critical section without a queue.
 */
export function createRegistrar(options: RegistrarOptions): MiniViewRegistrar {
	const { shortcut, platform, onTrigger, onState } = options;
	const env = options.env ?? {};
	const wayland = env.XDG_SESSION_TYPE === "wayland";
	/** The accelerator this registrar successfully registered, if any. */
	let held: string | null = null;
	let last: MiniViewRegistrationState | null = null;
	let disposed = false;

	function report(next: MiniViewRegistrationState): MiniViewRegistrationState {
		const changed =
			last === null ||
			last.status !== next.status ||
			last.value !== next.value ||
			last.accelerator !== next.accelerator ||
			last.reason !== next.reason;
		last = next;
		if (changed) onState(next);
		return next;
	}

	function release(): void {
		if (held === null) return;
		try {
			shortcut.unregister(held);
		} catch {
			/*
			 * Electron's unregister throws for an accelerator it does not know;
			 * that can only mean the string was never ours to release, and the
			 * next registration decides everything that matters. Swallowing it
			 * keeps a dead bookkeeping entry from wedging live re-registration.
			 */
		}
		held = null;
	}

	function apply(value: string): MiniViewRegistrationState {
		if (disposed) {
			/*
			 * After dispose the app is going away; a late watcher tick must not
			 * resurrect a chord. The previous state is returned unchanged so a
			 * caller comparing states sees nothing to act on.
			 */
			return (
				last ?? {
					value,
					accelerator: "",
					status: "invalid",
					reason: "disposed",
				}
			);
		}
		if (wayland) {
			release();
			return report({
				value,
				accelerator: "",
				status: "unavailable",
				reason: "global shortcuts are not supported on Wayland sessions",
			});
		}
		const resolved = resolveWithProblem(value, platform);
		if (!("accelerator" in resolved)) {
			release();
			return report({
				value,
				accelerator: "",
				status: "invalid",
				reason: resolved.problem,
			});
		}
		const accelerator = resolved.accelerator;
		if (held === accelerator) {
			// Rule 2: the live chord is already the one being asked for.
			return last as MiniViewRegistrationState;
		}
		release();
		let ok = false;
		try {
			ok = shortcut.register(accelerator, onTrigger);
		} catch (error) {
			/*
			 * `register` throws when the accelerator is malformed past this
			 * module's own checks — a shape only a future Electron could
			 * produce. It is an `invalid` state rather than a crash: the caller
			 * has a live app to keep serving, and the settings row has a state
			 * to render.
			 */
			return report({
				value,
				accelerator,
				status: "invalid",
				reason: `the system refused the accelerator: ${String(error)}`,
			});
		}
		if (!ok) {
			/*
			 * `taken` IS THE SYSTEM'S ANSWER, NOT THIS MODULE'S, and on macOS that
			 * answer is NARROWER than the word suggests (QA round 1, Q2; measured on
			 * this machine, Electron 44.3.0): a chord another PROCESS or the system
			 * itself owns still registers TRUE — `Command+Space` (Spotlight) and
			 * `Command+Tab` both returned true — while false was reachable only for a
			 * duplicate inside this process. Windows and Linux do refuse a chord
			 * another process holds. So this state can say "the system refused"
			 * wherever it fires, but on macOS it must not be read — or rendered — as
			 * "another app's conflict was detected": a conflict there is a silent
			 * dead key, and the honest surface is the settings row's macOS boundary
			 * sentence (`mini-copy.ts`'s `platformDetectionBoundaryCopy`), which
			 * states the practical path instead of promising detection the platform
			 * cannot deliver.
			 */
			return report({
				value,
				accelerator,
				status: "taken",
				reason:
					"register() returned false — the chord is held by the OS or another application",
			});
		}
		held = accelerator;
		return report({ value, accelerator, status: "registered" });
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		release();
	}

	return {
		apply,
		getState: () => last,
		dispose,
	};
}
