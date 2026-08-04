/**
 * Unset Text Setting Component
 *
 * Displays a "Not set" state with a button to set the value for text-based settings
 */

import { Button } from "@shared/components/ui";
import type { FC } from "react";

type UnsetTextSettingProps = {
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
	defaultValue: string | string[] | number;

	/**
	 * Display text for the default value
	 */
	defaultDisplayText: string;

	/**
	 * Callback when the value is set
	 */
	onSetValue: () => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: React.ReactNode;
};

/**
 * Unset Text Setting Component
 *
 * Displays a "Not set" state with a button to set the value for text-based settings
 */
export const UnsetTextSetting: FC<UnsetTextSettingProps> = ({
	label,
	description,
	defaultDisplayText,
	onSetValue,
	icon,
}) => {
	return (
		<div className="mb-4 flex flex-col rounded-md border border-control bg-surface p-4">
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
						await onSetValue();
					}}
				>
					Set to default ({defaultDisplayText})
				</Button>
			</div>
		</div>
	);
};
