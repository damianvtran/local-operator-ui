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
import { useId, useState } from "react";
import type { FC } from "react";

type ToggleSettingProps = {
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
};

/**
 * Toggle Setting Component
 *
 * A component for toggling boolean settings with a clean, modern UI
 *
 * @param props - ToggleSettingProps
 */
export const ToggleSetting: FC<ToggleSettingProps> = ({
	value,
	label,
	description,
	onChange,
	icon: Icon,
	isSaving = false,
}) => {
	const [isOn, setIsOn] = useState(value);
	const fieldId = useId();
	const labelId = `${fieldId}-label`;
	const descriptionId = `${fieldId}-description`;

	/**
	 * Handles toggling the switch
	 */
	const handleToggle = async (checked: boolean) => {
		if (isSaving) return;

		setIsOn(checked);

		try {
			await onChange(checked);
		} catch (error) {
			// If there's an error, revert the UI state
			setIsOn(!checked);
			console.error("Error toggling setting:", error);
		}
	};

	return (
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0 flex-1">
				<span
					id={labelId}
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
			<div className="flex h-6 shrink-0 items-center">
				{isSaving ? (
					<Spinner size="md" label={`Saving ${label}`} />
				) : (
					<Switch
						checked={isOn}
						onCheckedChange={handleToggle}
						aria-labelledby={labelId}
						aria-describedby={description ? descriptionId : undefined}
					/>
				)}
			</div>
		</div>
	);
};
