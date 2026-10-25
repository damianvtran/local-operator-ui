import {
	type BackendSettings,
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { Button, Input, Label } from "@shared/components/ui";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import {
	END_EDIT_KEYS,
	MODIFIER_ONLY_KEYS,
	chordFromEvent,
} from "@shared/keymap/chord-capture";
import { captureRefusal, chordGlyph } from "@shared/keymap/keymap-chord";
import { KEYMAP_ACTIONS } from "@shared/keymap/keymap-registry";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
	DEFAULT_START_RECORDING_VALUE,
	START_RECORDING_SETTING_KEY,
	canonicalRecordingChord,
} from "../../../../../shared/recording-shortcut";
import { rendererPlatform } from "../../../mini-view/renderer-platform";
import {
	recordingExternalClaims,
	useRecordingShortcutState,
} from "../../../shared/hooks/use-recording-shortcut";

/** Speech-to-text owns its heading so an older backend leaves no empty group. */
export function StartRecordingShortcutRow() {
	const { client, provided } = useOptionalQueryClient();
	const settings = useQuery(
		{
			queryKey: desktopKeys.settings,
			queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
			enabled: provided,
			staleTime: 10_000,
		},
		client,
	);
	const setting = settings.data?.settings.find(
		(row) => row.key === START_RECORDING_SETTING_KEY,
	);
	const recording = useRecordingShortcutState();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [restoreFocus, setRestoreFocus] = useState(false);
	const fieldRef = useRef<HTMLInputElement>(null);
	const id = useId();
	const platform = useMemo(() => rendererPlatform(), []);
	const stored =
		typeof setting?.value === "string" ? setting.value : recording.value;
	// A malformed hand-edit is still displayed as the last good live binding;
	// naming the raw token would advertise a shortcut the main process rejected.
	const saved = recording.problem ? recording.value : stored;
	const defaultChord =
		typeof setting?.default === "string"
			? setting.default
			: DEFAULT_START_RECORDING_VALUE;
	const isDefault =
		canonicalRecordingChord(stored) === canonicalRecordingChord(defaultChord);
	const assignedTo = (label: string) =>
		t("ui.settings.shortcuts.capture.already_assigned", { label });

	useEffect(() => {
		if (!restoreFocus || saving) return;
		fieldRef.current?.focus();
		setRestoreFocus(false);
	}, [restoreFocus, saving]);

	const write = async (
		op: "settings.edit" | "settings.reset",
		value?: string,
	) => {
		if (!setting || saving || (op === "settings.edit" && value === undefined))
			return;
		setSaving(true);
		setError(null);
		window.electron?.recordingShortcut?.markPending(value);
		try {
			await desktopResult(
				op === "settings.edit"
					? { op, key: setting.key, value: value ?? "" }
					: { op, key: setting.key },
			);
			await settings.refetch();
		} catch (cause) {
			let refusal: string | undefined;
			if (cause instanceof DesktopControlError) {
				const detail = cause.detail;
				if (
					typeof detail === "object" &&
					detail !== null &&
					"code" in detail &&
					detail.code === "keymap.conflict" &&
					"label" in detail &&
					typeof detail.label === "string"
				) {
					refusal = assignedTo(detail.label);
				}
			}
			// The structured conflict above never displays main's diagnostic
			// sentence, which would nest one refusal inside another. Other
			// backend sentences already follow the server's localization contract.
			setError(
				refusal ??
					(cause instanceof Error
						? cause.message
						: t(
								op === "settings.edit"
									? "ui.settings.configuration.backend_settings_section.the_setting_could_not_be_saved"
									: "ui.settings.configuration.backend_settings_section.the_setting_could_not_be_reset",
							)),
			);
		} finally {
			window.electron?.recordingShortcut?.markPending();
			setSaving(false);
			// Reset may remove the button that held focus. An effect restores the
			// field after this saving-state commit, without relying on a rAF clock.
			setRestoreFocus(true);
		}
	};

	if (!provided) return null;
	if (!setting) {
		return settings.isPending ? (
			<div className="min-h-24 space-y-3" aria-busy="true">
				<h3 className="pt-1 text-body-sm font-medium text-ink">
					{t("ui.settings.shortcuts.category.speech_to_text")}
				</h3>
			</div>
		) : null;
	}
	return (
		<div className="space-y-3" data-shortcut-recording>
			<h3 className="pt-1 text-body-sm font-medium text-ink">
				{t("ui.settings.shortcuts.category.speech_to_text")}
			</h3>
			<div className="group flex min-w-0 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<Label htmlFor={id} className="w-32 text-body-sm text-ink">
						{setting.label}
					</Label>
					<Input
						ref={fieldRef}
						id={id}
						aria-label={t(
							"ui.settings.shortcuts.keyboard_shortcuts_section.label_press_the_keys_you_want",
							{ label: setting.label },
						)}
						aria-describedby={`${id}-hint`}
						aria-busy={saving}
						data-shortcut-action={setting.key}
						className="w-52 text-left font-mono text-body-sm"
						value={chordGlyph(saved, platform)}
						placeholder={t(
							"ui.settings.shortcuts.keyboard_shortcuts_section.press_the_keys_you_want_esc_cancels",
						)}
						readOnly
						onKeyDown={(event) => {
							if (saving) return;
							if (
								END_EDIT_KEYS.has(event.key) ||
								MODIFIER_ONLY_KEYS.has(event.key)
							) {
								if (END_EDIT_KEYS.has(event.key)) setError(null);
								event.preventDefault();
								return;
							}
							const candidate = chordFromEvent(event);
							if (candidate === null) return;
							event.preventDefault();
							if (
								canonicalRecordingChord(candidate) ===
								canonicalRecordingChord(stored)
							) {
								setError(null);
								return;
							}
							const bindings =
								useUiPreferencesStore.getState().shortcutBindings;
							const claims = recordingExternalClaims(
								recording,
								assignedTo(setting.label),
							);
							for (const action of KEYMAP_ACTIONS) {
								const effective = bindings[action.id] ?? action.defaultChord;
								if (effective) claims.set(effective, action.label);
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
					/>
					{!isDefault && (
						<Button
							variant="secondary"
							size="sm"
							disabled={saving}
							aria-label={t(
								"ui.settings.shortcuts.keyboard_shortcuts_section.reset_label_to_its_default",
								{ label: setting.label },
							)}
							onClick={() => void write("settings.reset")}
						>
							{t("ui.settings.shortcuts.keyboard_shortcuts_section.reset")}
						</Button>
					)}
				</div>
				<div className="ml-0 max-w-88 text-meta text-ink-muted sm:ml-34">
					<p>{setting.help}</p>
					<p id={`${id}-hint`} className="hidden group-focus-within:block">
						{t(
							"ui.settings.shortcuts.keyboard_shortcuts_section.press_the_keys_you_want_esc_cancels",
						)}
					</p>
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
					{saving && (
						<output className="block">
							{t("ui.settings.configuration.backend_setting_row.saving")}
						</output>
					)}
					{error && <output className="block text-danger">{error}</output>}
				</div>
			</div>
		</div>
	);
}
