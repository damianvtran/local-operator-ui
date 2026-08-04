/**
 * Unset Slider Setting Component
 *
 * Displays a "Not set" state with a button to set the value
 */

import { Button } from "@shared/components/ui";
import type { FC } from "react";
import {
	DescriptionText,
	LabelText,
	LabelWrapper,
	UnsetContainer,
} from "./chat-options-sidebar-styled";

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
		<UnsetContainer>
			<LabelWrapper>
				<LabelText>
					{icon && icon}
					{label}
				</LabelText>
				<DescriptionText>{description}</DescriptionText>
			</LabelWrapper>
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
		</UnsetContainer>
	);
};
