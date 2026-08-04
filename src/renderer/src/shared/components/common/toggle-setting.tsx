/**
 * Toggle Setting Component
 *
 * A labelled row for a boolean setting that takes effect immediately.
 *
 * The label is a `span` with `aria-labelledby` rather than a `label` with
 * `htmlFor`: the switch renders as a `button`, which is not a labelable
 * element, so `htmlFor` would associate with nothing at all.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Card, Switch } from "@shared/components/ui";
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
		<Card className="mb-4 flex-row items-center justify-between">
			<div className="flex-1">
				<span id={labelId} className="flex items-center gap-2 text-ink">
					{Icon && <Icon size={16} aria-hidden="true" />}
					{label}
				</span>

				{description && (
					<p id={descriptionId} className="mt-1 text-body-sm text-ink-muted">
						{description}
					</p>
				)}
			</div>

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
		</Card>
	);
};
