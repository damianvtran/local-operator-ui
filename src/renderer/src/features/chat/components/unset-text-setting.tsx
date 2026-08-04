/**
 * Unset Text Setting Component
 *
 * Displays a "Not set" state with a button to set the value for text-based settings
 */

import { Button } from "@shared/components/ui";
import type { FC } from "react";
import {
	DescriptionText,
	LabelText,
	LabelWrapper,
	UnsetContainer,
} from "./chat-options-sidebar-styled";

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
		<UnsetContainer>
			<LabelWrapper>
				<LabelText>
					{icon && icon}
					{label}
				</LabelText>
				<DescriptionText>{description}</DescriptionText>
			</LabelWrapper>
			<div className="flex items-center justify-between">
				<span className="text-body-sm italic text-ink-muted">Not set yet</span>
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
		</UnsetContainer>
	);
};
