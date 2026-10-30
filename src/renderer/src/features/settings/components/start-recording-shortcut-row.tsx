import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import {
	END_EDIT_KEYS,
	MODIFIER_ONLY_KEYS,
	chordFromEvent,
} from "@shared/keymap/chord-capture";
import { captureRefusal, chordGlyph } from "@shared/keymap/keymap-chord";
import { KEYMAP_ACTIONS } from "@shared/keymap/keymap-registry";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useId, useMemo, useRef } from "react";
import {
	DEFAULT_START_RECORDING_VALUE,
	canonicalRecordingChord,
} from "../../../../../shared/recording-shortcut";
import { rendererPlatform } from "../../../mini-view/renderer-platform";
import {
	recordingExternalClaims,
	useRecordingShortcutState,
} from "../../../shared/hooks/use-recording-shortcut";
import { SpeechShortcutRowFrame } from "./speech-shortcut-row-frame";
import { useKeymapSettingWrite } from "./use-keymap-setting-write";

/**
 * The PRIMARY speech-to-text shortcut: the chord that starts a recording.
 *
 * The heading and the settings read live in `SpeechShortcutsGroup`, which owns
 * both rows; this row owns only the chord capture and its conflict rules.
 */
export function StartRecordingShortcutRow({
	setting,
	refetch,
}: {
	setting: BackendSetting;
	refetch: () => Promise<unknown>;
}) {
	const recording = useRecordingShortcutState();
	const fieldRef = useRef<HTMLInputElement>(null);
	const id = useId();
	const platform = useMemo(() => rendererPlatform(), []);
	const { saving, error, setError, write } = useKeymapSettingWrite({
		settingKey: setting.key,
		refetch,
		fieldRef,
		// Main learns the chord before the backend does, so the claim table
		// refuses a panel assignment made while the save is still in flight.
		onPending: (value) =>
			window.electron?.recordingShortcut?.markPending(value),
	});
	const action = t("ui.settings.shortcuts.speech.start_recording_press");
	const stored =
		typeof setting.value === "string" ? setting.value : recording.value;
	// A malformed hand-edit is still displayed as the last good live binding;
	// naming the raw token would advertise a shortcut the main process rejected.
	const saved = recording.problem ? recording.value : stored;
	const defaultChord =
		typeof setting.default === "string"
			? setting.default
			: DEFAULT_START_RECORDING_VALUE;
	const isDefault =
		canonicalRecordingChord(stored) === canonicalRecordingChord(defaultChord);
	const assignedTo = (label: string) =>
		t("ui.settings.shortcuts.capture.already_assigned", { label });
	// The name the panel rows already use when THEY refuse against this chord, so
	// both directions of a conflict name the action the same way.
	const claimLabel = t("ui.chat.composer.start_recording");
	const hint = t(
		"ui.settings.shortcuts.keyboard_shortcuts_section.press_the_keys_you_want_esc_cancels",
	);

	return (
		<SpeechShortcutRowFrame
			id={id}
			rank="primary"
			action={action}
			settingKey={setting.key}
			help={setting.help}
			hint={hint}
			ariaLabel={t(
				"ui.settings.shortcuts.keyboard_shortcuts_section.label_press_the_keys_you_want",
				{ label: action },
			)}
			value={chordGlyph(saved, platform)}
			fieldRef={fieldRef}
			saving={saving}
			showReset={!isDefault}
			onReset={() => void write("settings.reset")}
			onKeyDown={(event) => {
				if (saving) return;
				if (END_EDIT_KEYS.has(event.key) || MODIFIER_ONLY_KEYS.has(event.key)) {
					if (END_EDIT_KEYS.has(event.key)) setError(null);
					event.preventDefault();
					return;
				}
				const candidate = chordFromEvent(event);
				if (candidate === null) return;
				event.preventDefault();
				if (
					canonicalRecordingChord(candidate) === canonicalRecordingChord(stored)
				) {
					setError(null);
					return;
				}
				const bindings = useUiPreferencesStore.getState().shortcutBindings;
				const claims = recordingExternalClaims(
					recording,
					assignedTo(claimLabel),
				);
				for (const panel of KEYMAP_ACTIONS) {
					const effective = bindings[panel.id] ?? panel.defaultChord;
					if (effective) claims.set(effective, panel.label);
				}
				const refusal = captureRefusal(
					candidate,
					"panel.console",
					{},
					platform,
					claims,
				);
				if (refusal !== null) {
					setError(refusal);
					return;
				}
				void write("settings.edit", candidate);
			}}
			notes={
				<>
					{recording.shadowedBy && !error && (
						<output className="block text-danger">
							{t("ui.settings.shortcuts.recording.inactive_claimed", {
								label: recording.shadowedBy,
							})}
						</output>
					)}
					{recording.problem && !error && (
						<output className="block text-danger">
							{t("ui.settings.shortcuts.recording.invalid_stored_value")}
						</output>
					)}
				</>
			}
			error={error}
		/>
	);
}
