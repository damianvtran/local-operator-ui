import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
/**
 * Toggle Setting Component
 *
 * A labelled row for a boolean setting that takes effect immediately.
 *
 * The label is a `span` with `aria-labelledby` rather than a `label` with
 * `htmlFor`: the switch renders as a `button`, which is not a labelable
 * element, so `htmlFor` would associate with nothing at all.
 *
 * Borderless and margin-free for the same two reasons as `SliderSetting`: a
 * run of bordered rows inside a section that gave up its own boundary is the
 * chrome the settings rebuild removed everywhere else, and a component that
 * ships an outer margin stacks with every container that has a `gap`. The
 * container owns the gap.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Switch } from "@shared/components/ui";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FC } from "react";

type ToggleSettingProps = {
	/** Settings search's stable row id, when this control is a searchable row. */
	searchRow?: string;
	/**
	 * Extra words settings search matches this row by, that its label does not
	 * print (`data-search-terms`). Localized by the caller.
	 */
	searchTerms?: string;
	/**
	 * Current value of the setting
	 */
	value: boolean;

	/**
	 * Label for the setting
	 */
	label: string;

	/**
	 * Description of what the setting does
	 */
	description?: string;

	/**
	 * Callback function when the value is changed
	 * @param value - The new value
	 */
	onChange: (value: boolean) => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: LucideIcon;

	/**
	 * Whether the setting is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Renders the switch non-interactive. Used by a row whose capability gate is
	 * off: the row stays visible (so its reason can be read) instead of vanishing.
	 */
	disabled?: boolean;

	/**
	 * SAVE IN PLACE (opt-in). By default a save swaps the control for a spinner
	 * (toggle) or disables it (slider), and a focused control that is disabled
	 * or unmounted drops keyboard focus to <body>: the second arrow press or
	 * Space lands nowhere (notification-sound QA round 1, Q1 / UX U1). With this
	 * set, the control stays mounted, enabled and focused while saving; the row
	 * says so with `aria-busy` and a small spinner beside the control, and a
	 * change made mid-save is passed to `onChange` like any other, so the CALLER
	 * must order its writes (Notifications serializes per key). Off by default
	 * because the existing callers rely on the save being exclusive.
	 */
	savingInPlace?: boolean;
};

/**
 * Toggle Setting Component
 *
 * A component for toggling boolean settings with a clean, modern UI
 *
 * @param props - ToggleSettingProps
 */
export const ToggleSetting: FC<ToggleSettingProps> = ({
	searchRow,
	searchTerms,
	value,
	label,
	description,
	onChange,
	icon: Icon,
	isSaving = false,
	disabled = false,
	savingInPlace = false,
}) => {
	useI18nLocale();
	const [isOn, setIsOn] = useState(value);
	/*
	 * FOLLOW THE PROP. The local copy exists for the optimistic flip, but a
	 * value written by someone else (a second control for the same key, an
	 * agent, another surface) must reach the switch too; without this it kept
	 * showing the value it mounted with (QA round 1, Q2 / UX U3). Keyed on the
	 * prop, so an optimistic flip is only overwritten when the prop changes.
	 */
	/*
	 * ...EXCEPT WHILE ITS OWN PRESSES ARE IN FLIGHT (review round 2, m1). Two
	 * queued presses (on -> off -> on): the first write's refetch brings
	 * `false`, and syncing then flipped the focused switch back until the
	 * second landed. In place, the sync waits for the last press to settle;
	 * `settled` re-runs it then, so a failed write still shows the truth.
	 */
	const pendingPresses = useRef(0);
	const [settled, setSettled] = useState(0);
	useEffect(() => {
		void settled;
		if (savingInPlace && pendingPresses.current > 0) return;
		setIsOn(value);
	}, [value, savingInPlace, settled]);
	const fieldId = useId();
	const labelId = `${fieldId}-label`;
	const descriptionId = `${fieldId}-description`;

	/**
	 * Handles toggling the switch
	 */
	const handleToggle = async (checked: boolean) => {
		if ((isSaving && !savingInPlace) || disabled) return;

		setIsOn(checked);

		if (savingInPlace) {
			pendingPresses.current += 1;
			try {
				await onChange(checked);
			} catch (error) {
				console.error("Error toggling setting:", error);
			} finally {
				pendingPresses.current -= 1;
				if (pendingPresses.current === 0) setSettled((n) => n + 1);
			}
			return;
		}

		try {
			await onChange(checked);
		} catch (error) {
			// If there's an error, revert the UI state
			setIsOn(!checked);
			console.error("Error toggling setting:", error);
		}
	};

	return (
		<div
			data-search-row={searchRow}
			data-search-terms={searchRow ? searchTerms : undefined}
			data-search-control={searchRow ? "" : undefined}
			className="flex items-start justify-between gap-4"
			aria-busy={savingInPlace && isSaving ? true : undefined}
		>
			<div className="min-w-0 flex-1">
				<span
					id={labelId}
					data-search-label=""
					className="flex min-h-6 items-center gap-2 text-body text-ink"
				>
					{Icon && (
						<Icon
							size={14}
							aria-hidden="true"
							className="shrink-0 text-ink-dim"
						/>
					)}
					{label}
				</span>

				{description && (
					<p
						id={descriptionId}
						className="mt-0.5 max-w-2xl text-body-sm text-ink-muted"
					>
						{description}
					</p>
				)}
			</div>

			{/* Fixed height so swapping the switch for the saving spinner does not
			    reflow the row. */}
			<div className="flex h-6 shrink-0 items-center gap-2">
				{savingInPlace && isSaving && (
					<Spinner
						size="xs"
						label={t("ui.common.forms.toggle_setting.saving", { label: label })}
					/>
				)}
				{isSaving && !savingInPlace ? (
					<Spinner
						size="md"
						label={t("ui.common.forms.toggle_setting.saving", { label: label })}
					/>
				) : (
					<Switch
						checked={isOn}
						onCheckedChange={handleToggle}
						disabled={disabled}
						aria-labelledby={labelId}
						aria-describedby={description ? descriptionId : undefined}
					/>
				)}
			</div>
		</div>
	);
};
