/**
 * Unset Slider Setting Component
 *
 * Displays a "Not set" state with a button to set the value
 */

import { Button } from "@shared/components/ui";
import type { FC } from "react";

type UnsetSliderSettingProps = {
	/**
	 * Label for the setting
	 */
	label: string;

	/**
	 * Description of the setting
	 */
	description: string;

	/**
	 * Default value to set when button is clicked
	 */
	defaultValue: number;

	/**
	 * Callback when the value is set
	 */
	onSetValue: (value: number) => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: React.ReactNode;
};

/**
 * Unset Slider Setting Component
 *
 * Displays a "Not set" state with a button to set the value
 */
export const UnsetSliderSetting: FC<UnsetSliderSettingProps> = ({
	label,
	description,
	defaultValue,
	onSetValue,
	icon,
}) => {
	return (
		/* No outer margin: the container owns the gap between rows. */
		<div className="flex flex-col rounded-md border border-control bg-surface p-4">
			<div className="mb-2">
				<span className="mb-1 flex items-center font-medium text-body-sm text-ink">
					{icon}
					{label}
				</span>
				<span className="mb-3 text-body-sm text-ink-muted">{description}</span>
			</div>
			<div className="flex items-center justify-between">
				<span className="text-meta text-ink-dim">Not set yet</span>
				<Button
					variant="outline"
					size="sm"
					onClick={async () => {
						await onSetValue(defaultValue);
					}}
				>
					Set to default ({defaultValue})
				</Button>
			</div>
		</div>
	);
};
