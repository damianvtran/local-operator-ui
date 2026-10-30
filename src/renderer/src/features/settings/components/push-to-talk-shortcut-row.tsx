import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { END_EDIT_KEYS, NAVIGATION_KEYS } from "@shared/keymap/chord-capture";
import { effectiveChord } from "@shared/keymap/keymap-chord";
import { KEYMAP_ACTIONS } from "@shared/keymap/keymap-registry";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useId, useMemo, useRef } from "react";
import { DEFAULT_PUSH_TO_TALK_VALUE } from "../../../../../shared/recording-shortcut";
import { useRecordingShortcutState } from "../../../shared/hooks/use-recording-shortcut";
import {
	type PlatformFamily,
	platformFamily,
	pushToTalkBindingForToken,
	pushToTalkTokenForCode,
	setPushToTalkBinding,
} from "../../../shared/hooks/use-speech-to-text-manager";
import { SpeechShortcutRowFrame } from "./speech-shortcut-row-frame";
import { useKeymapSettingWrite } from "./use-keymap-setting-write";

/**
 * Whether any of these chords is typed WITH the modifier a hold sits on.
 *
 * This is not a collision in the ownership sense: a bare modifier is not a
 * chord, so no chord can claim the same input, and the hold already yields to a
 * combination (a second key aborts it). It is a cost, though: the hold engages
 * on the modifier's own keydown, so every chord that begins with that modifier
 * starts a push to talk that the next key cancels. The row says so instead of
 * refusing, because the cost is the user's to weigh and the backend accepts the
 * pairing.
 *
 * WHICH KEY `primary` IS DEPENDS ON WHO MATCHES THE CHORD. A panel chord is
 * matched by the renderer, where `primary` is Command on macOS and Ctrl
 * elsewhere. The Start recording chord is matched in main, where `primary`
 * accepts Ctrl on every platform and Command too on macOS (`recordingChords`).
 * Off macOS the Meta key (Win/Super) is not `primary`, so only a literal `meta`
 * chord uses it. `AltLeft`/`AltRight` bind on macOS only (see
 * `pushToTalkTokenForCode`).
 */
export function overlappingChord(
	code: string,
	family: PlatformFamily,
	chords: readonly string[],
	/**
	 * Chords main matches itself (the Start recording chord). Its `primary`
	 * accepts Ctrl on every platform and Command too on macOS, whereas a panel
	 * chord's `primary` is only the app modifier (Command on macOS).
	 */
	recordingChords: readonly string[] = [],
): string | null {
	const modifier = /^(Alt|Meta|Control)/.exec(code)?.[1];
	const uses = (tokens: readonly string[], recording: boolean): boolean => {
		if (modifier === "Control") {
			return (
				tokens.includes("ctrl") ||
				(tokens.includes("primary") && (recording || family !== "darwin"))
			);
		}
		if (modifier === "Meta") {
			return (
				tokens.includes("meta") ||
				(family === "darwin" && tokens.includes("primary"))
			);
		}
		return modifier === "Alt" && tokens.includes("alt");
	};
	const modifiers = (chord: string) => chord.split("+").slice(0, -1);
	return (
		chords.find((chord) => uses(modifiers(chord), false)) ??
		recordingChords.find((chord) => uses(modifiers(chord), true)) ??
		null
	);
}

/** Whether any of these chords is typed with the modifier `code` names. */
export const holdModifierOverlapsChords = (
	code: string,
	family: PlatformFamily,
	chords: readonly string[],
	recordingChords: readonly string[] = [],
): boolean => overlappingChord(code, family, chords, recordingChords) !== null;

const MODIFIER_CODE = /^(Alt|Meta|Control|Shift)(Left|Right)$/;

/** The key name without its side: "Right-Command" -> "Command". */
const keyName = (label: string): string => label.split("-").slice(1).join("-");

/**
 * The SECONDARY speech-to-text shortcut: the bare modifier held to dictate.
 *
 * Its capture is the opposite of the primary's. A chord needs a key and ignores
 * a lone modifier; a hold IS a lone modifier, so the field accepts one modifier
 * press, identified by `event.code` (the six tokens are side-specific and
 * `event.key` cannot tell Left from Right), and refuses everything else by
 * naming the keys that work on this platform.
 *
 * A MODIFIER IS COMMITTED ON ITS RELEASE, and only if nothing else went down
 * while it was held (UX round 1, U1). Saving on the keydown rewrote the stored
 * hold key on the first half of Cmd+Shift+S, Ctrl+Tab or Cmd+Tab, and then
 * showed a refusal beside the value it had just saved. A press that grows into
 * a chord was never a hold, so it saves nothing and says why. Leaving the field
 * (window blur included) or Esc drops the press, which is what makes "Esc
 * cancels" true.
 */
export function PushToTalkShortcutRow({
	setting,
	refetch,
	focusKey,
}: {
	setting: BackendSetting;
	refetch: () => Promise<unknown>;
	focusKey?: string | null;
}) {
	const recording = useRecordingShortcutState();
	const bindings = useUiPreferencesStore((state) => state.shortcutBindings);
	const fieldRef = useRef<HTMLInputElement>(null);
	const id = useId();
	const family = useMemo(() => platformFamily(), []);
	/** The modifier now held in the field, and whether anything joined it. */
	const press = useRef<{ code: string; tainted: boolean } | null>(null);
	const defaultToken =
		typeof setting.default === "string"
			? setting.default
			: DEFAULT_PUSH_TO_TALK_VALUE;
	const { saving, error, setError, write } = useKeymapSettingWrite({
		settingKey: setting.key,
		refetch,
		fieldRef,
		// The speech manager reads the row once per composer registration, so a
		// save is handed to it directly: the next keydown holds the new key
		// without a reload.
		onSaved: (op, value) =>
			setPushToTalkBinding(op === "settings.edit" ? value : defaultToken),
	});
	const action = t("ui.settings.shortcuts.speech.push_to_talk_hold");
	const stored = typeof setting.value === "string" ? setting.value : "";
	// An unrecognised stored value is displayed as the binding the manager will
	// actually use (its fallback), never as the raw token.
	const live =
		pushToTalkBindingForToken(stored) ??
		pushToTalkBindingForToken(defaultToken) ??
		pushToTalkBindingForToken(DEFAULT_PUSH_TO_TALK_VALUE);
	// By physical key: off macOS the default token and `meta-right-hold` name
	// one key, and offering Reset for a key that is already the default's is noise.
	const isDefault =
		pushToTalkBindingForToken(stored)?.code ===
		pushToTalkBindingForToken(defaultToken)?.code;
	const claimed = KEYMAP_ACTIONS.flatMap((panel) => {
		const chord = effectiveChord(panel.id, bindings);
		return chord ? [chord] : [];
	});
	const recordingChords = recording.canonical ? [recording.canonical] : [];
	const overlap =
		live === null
			? null
			: overlappingChord(live.code, family, claimed, recordingChords);
	/*
	 * The key to suggest instead: the first one this platform can hold that no
	 * claimed chord begins with. Off macOS there is no Option to offer (see
	 * `pushToTalkTokenForCode`).
	 */
	const alternative =
		overlap === null
			? null
			: (["AltRight", "ControlRight", "MetaRight"]
					.filter((code) => pushToTalkTokenForCode(code, family) !== null)
					.filter(
						(code) => !overlappingChord(code, family, claimed, recordingChords),
					)
					.map((code) =>
						pushToTalkBindingForToken(pushToTalkTokenForCode(code, family)),
					)
					.find((binding) => binding && binding.code !== live?.code)?.label ??
				null);
	// A letter belongs to the primary box: say so where the user is stuck.
	const pointer = t("ui.settings.shortcuts.speech.push_to_talk_letter_pointer");
	const refuse = () =>
		setError(
			`${t("ui.settings.shortcuts.speech.push_to_talk_refused", {
				platform: family,
			})} ${pointer}`,
		);

	return (
		<SpeechShortcutRowFrame
			id={id}
			rank="secondary"
			action={action}
			settingKey={setting.key}
			focusKey={focusKey}
			help={setting.help}
			hint={`${t("ui.settings.shortcuts.speech.push_to_talk_hint")} ${pointer}`}
			ariaLabel={t(
				"ui.settings.configuration.setting_control.label_press_the_key_you_want",
				{ label: action },
			)}
			value={live?.label ?? ""}
			fieldRef={fieldRef}
			saving={saving}
			showReset={!isDefault}
			onReset={() => void write("settings.reset")}
			onBlur={() => {
				// Focus (or the window) left mid-press: the release will arrive
				// somewhere else, so nothing is committed.
				press.current = null;
				setError(null);
			}}
			onKeyDown={(event) => {
				if (saving) return;
				// Whatever goes down while a modifier is held makes that press a chord.
				const tainting = press.current !== null;
				if (press.current) press.current.tainted = true;
				// Tab is how a keyboard user leaves the field; it is never a candidate.
				if (NAVIGATION_KEYS.has(event.key)) {
					if (tainting) refuse();
					return;
				}
				if (END_EDIT_KEYS.has(event.key)) {
					press.current = null;
					setError(null);
					event.preventDefault();
					return;
				}
				if (event.nativeEvent.isComposing) return;
				// Every press is the field's: a held Alt must not open a menu bar and a
				// letter must not type, whether or not it is a valid binding.
				event.preventDefault();
				if (event.repeat) return;
				if (tainting || !MODIFIER_CODE.test(event.code)) {
					if (!tainting) press.current = null;
					refuse();
					return;
				}
				setError(null);
				press.current = { code: event.code, tainted: false };
			}}
			onKeyUp={(event) => {
				const held = press.current;
				if (!held || event.code !== held.code) return;
				press.current = null;
				if (held.tainted || saving) return;
				const token = pushToTalkTokenForCode(held.code, family);
				if (token === null) {
					refuse();
					return;
				}
				// Off macOS `alt-*` and `meta-*` name one physical key, so a press of
				// the key already bound is a no-op however the stored token spells it.
				if (pushToTalkBindingForToken(token)?.code === live?.code) return;
				void write("settings.edit", token);
			}}
			notes={
				overlap !== null &&
				live !== null && (
					<p>
						{t("ui.settings.shortcuts.speech.push_to_talk_overlap", {
							modifier: keyName(live.label),
							example: `${keyName(live.label)}+${(overlap.split("+").at(-1) ?? "").toUpperCase()}`,
							alternative: alternative ? keyName(alternative) : "none",
						})}
					</p>
				)
			}
			error={error}
		/>
	);
}
