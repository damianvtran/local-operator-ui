/**
 * The optional onboarding telemetry checkbox, unchecked (the default) and
 * checked, plus the Settings → Privacy section off/on/launch-off — the frames a
 * design round reads. Nothing here persists or sends: stories hold the value in
 * local state.
 */

import { PrivacySectionView } from "@features/settings/components/privacy-section";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useState } from "react";
import { TelemetryConsentCheckbox } from "./telemetry-consent-checkbox";

const CheckboxHarness: FC<{ initial: boolean }> = ({ initial }) => {
	const [checked, setChecked] = useState(initial);
	return (
		<div className="p-8">
			<TelemetryConsentCheckbox checked={checked} onChange={setChecked} />
		</div>
	);
};

const SectionHarness: FC<{ initial: boolean; launchAllows: boolean }> = ({
	initial,
	launchAllows,
}) => {
	const [optedIn, setOptedIn] = useState(initial);
	return (
		<div className="max-w-3xl p-8">
			<PrivacySectionView
				optedIn={optedIn}
				launchAllows={launchAllows}
				onChange={async (next) => setOptedIn(next)}
			/>
		</div>
	);
};

const meta: Meta = { title: "Privacy/Telemetry consent" };
export default meta;

export const CheckboxUnchecked: StoryObj = {
	render: () => <CheckboxHarness initial={false} />,
};
export const CheckboxChecked: StoryObj = {
	render: () => <CheckboxHarness initial={true} />,
};
export const SettingsOff: StoryObj = {
	render: () => <SectionHarness initial={false} launchAllows />,
};
export const SettingsOn: StoryObj = {
	render: () => <SectionHarness initial={true} launchAllows />,
};
export const SettingsLaunchOff: StoryObj = {
	render: () => <SectionHarness initial={false} launchAllows={false} />,
};
