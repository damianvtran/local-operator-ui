import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { type RefObject, useEffect, useState } from "react";

type KeymapWriteOp = "settings.edit" | "settings.reset";

/**
 * The save/reset path both Speech to text rows share: one in-flight write,
 * one refusal sentence, focus returned to the field afterwards.
 *
 * Shared rather than copied because the two rows must refuse and recover
 * identically, and a second copy is how they would stop doing so. What differs
 * is passed in: the primary row tells main about the pending chord
 * (`onPending`), the hold row tells the speech manager what was saved
 * (`onSaved`).
 */
export function useKeymapSettingWrite({
	settingKey,
	refetch,
	fieldRef,
	onPending,
	onSaved,
}: {
	/** `undefined` while the backend has not served the row: nothing is writable. */
	settingKey: string | undefined;
	refetch: () => Promise<unknown>;
	fieldRef: RefObject<HTMLInputElement>;
	/** Called with the value about to be written, then with nothing once settled. */
	onPending?: (value?: string) => void;
	/** Called once the backend ACCEPTED a write, before the row is re-read. */
	onSaved?: (op: KeymapWriteOp, value?: string) => void;
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [restoreFocus, setRestoreFocus] = useState(false);

	useEffect(() => {
		if (!restoreFocus || saving) return;
		fieldRef.current?.focus();
		setRestoreFocus(false);
	}, [restoreFocus, saving, fieldRef]);

	const write = async (op: KeymapWriteOp, value?: string) => {
		if (
			settingKey === undefined ||
			saving ||
			(op === "settings.edit" && value === undefined)
		) {
			return;
		}
		setSaving(true);
		setError(null);
		onPending?.(value);
		try {
			await desktopResult(
				op === "settings.edit"
					? { op, key: settingKey, value: value ?? "" }
					: { op, key: settingKey },
			);
			onSaved?.(op, value);
			await refetch();
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
					refusal = t("ui.settings.shortcuts.capture.already_assigned", {
						label: detail.label,
					});
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
			onPending?.();
			setSaving(false);
			// Reset may remove the button that held focus. An effect restores the
			// field after this saving-state commit, without relying on a rAF clock.
			setRestoreFocus(true);
		}
	};

	return { saving, error, setError, write };
}
