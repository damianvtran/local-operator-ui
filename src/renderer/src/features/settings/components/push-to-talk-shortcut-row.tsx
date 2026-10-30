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
 * `primary` is Ctrl everywhere and also Command on macOS; off macOS the Meta
 * key (Win/Super) is not part of `primary`, so only a literal `meta` chord uses
 * it. `AltLeft`/`AltRight` bind on macOS only (see `pushToTalkTokenForCode`).
 */
export function holdModifierOverlapsChords(
	code: string,
	family: PlatformFamily,
	chords: readonly string[],
): boolean {
	const modifier = /^(Alt|Meta|Control)/.exec(code)?.[1];
	const uses = (tokens: readonly string[]): boolean => {
		if (modifier === "Control") {
			return tokens.includes("primary") || tokens.includes("ctrl");
		}
		if (modifier === "Meta") {
			return (
				tokens.includes("meta") ||
				(family === "darwin" && tokens.includes("primary"))
			);
		}
		return modifier === "Alt" && tokens.includes("alt");
	};
	return chords.some((chord) => uses(chord.split("+").slice(0, -1)));
}

/**
 * The SECONDARY speech-to-text shortcut: the bare modifier held to dictate.
 *
 * Its capture is the opposite of the primary's. A chord needs a key and ignores
 * a lone modifier; a hold IS a lone modifier, so the field accepts one modifier
 * press, identified by `event.code` (the six tokens are side-specific and
 * `event.key` cannot tell Left from Right), and refuses everything else by
 * naming the keys that work on this platform.
 */
export function PushToTalkShortcutRow({
	setting,
	refetch,
}: {
	setting: BackendSetting;
	refetch: () => Promise<unknown>;
}) {
	const recording = useRecordingShortcutState();
	const bindings = useUiPreferencesStore((state) => state.shortcutBindings);
	const fieldRef = useRef<HTMLInputElement>(null);
	const id = useId();
	const family = useMemo(() => platformFamily(), []);
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
	const overlaps =
		live !== null &&
		holdModifierOverlapsChords(live.code, family, [
			...KEYMAP_ACTIONS.flatMap((panel) => {
				const chord = effectiveChord(panel.id, bindings);
				return chord ? [chord] : [];
			}),
			...(recording.canonical ? [recording.canonical] : []),
		]);

	return (
		<SpeechShortcutRowFrame
			id={id}
			rank="secondary"
			action={action}
			settingKey={setting.key}
			help={setting.help}
			hint={t("ui.settings.shortcuts.speech.push_to_talk_hint")}
			ariaLabel={t(
				"ui.settings.configuration.setting_control.label_press_the_key_you_want",
				{ label: action },
			)}
			value={live?.label ?? ""}
			fieldRef={fieldRef}
			saving={saving}
			showReset={!isDefault}
			onReset={() => void write("settings.reset")}
			onBlur={() => setError(null)}
			onKeyDown={(event) => {
				if (saving) return;
				// Tab is how a keyboard user leaves the field; it is never a candidate.
				if (NAVIGATION_KEYS.has(event.key)) return;
				if (END_EDIT_KEYS.has(event.key)) {
					setError(null);
					event.preventDefault();
					return;
				}
				if (event.nativeEvent.isComposing) return;
				// Every press is the field's: a held Alt must not open a menu bar and a
				// letter must not type, whether or not it is a valid binding.
				event.preventDefault();
				if (event.repeat) return;
				const token = pushToTalkTokenForCode(event.code, family);
				if (token === null) {
					setError(
						t("ui.settings.shortcuts.speech.push_to_talk_refused", {
							platform: family,
						}),
					);
					return;
				}
				setError(null);
				// Off macOS `alt-*` and `meta-*` name one physical key, so a press of
				// the key already bound is a no-op however the stored token spells it.
				if (pushToTalkBindingForToken(token)?.code === live?.code) return;
				void write("settings.edit", token);
			}}
			notes={
				overlaps && (
					<p>{t("ui.settings.shortcuts.speech.push_to_talk_overlap")}</p>
				)
			}
			error={error}
		/>
	);
}
