import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useState } from "react";
import {
	DEFAULT_GLASS_SETTINGS,
	type GlassSettings,
	type WindowGlassState,
	glassCapabilityFor,
} from "../../../../../shared/window-glass";
import { WindowGlassSetting } from "./window-glass-setting";

/**
 * Settings > Appearance > Window glass, in every state the control can be in.
 *
 * WHY A STORY. The control is presentational (state in, patch out), so each branch
 * of the capability decision - supported on macOS, on Windows 11 with its restart
 * note, and each reason a platform cannot do it - is reachable here without an
 * Electron window. The frames of the LIVE window (OS material behind the app) need
 * the compositor and come from the PR's native rig; a story cannot show a blur and
 * does not pretend to.
 */
const Harness: FC<{
	platform: string;
	osVersion: string;
	reducedTransparency?: boolean;
	initial?: Partial<GlassSettings>;
	/** Windows only: the master switch was flipped and needs a restart (the window
	 * was built without its material), which no other state makes visible. */
	restartRequired?: boolean;
}> = ({
	platform,
	osVersion,
	reducedTransparency = false,
	initial,
	restartRequired = false,
}) => {
	const capability = glassCapabilityFor({
		platform,
		osVersion,
		reducedTransparency,
	});
	const [settings, setSettings] = useState<GlassSettings>({
		...DEFAULT_GLASS_SETTINGS,
		...initial,
	});
	const state: WindowGlassState = {
		capability,
		settings,
		active: capability.supported && settings.enabled,
		restartRequired,
	};
	return (
		<div className="max-w-3xl bg-canvas p-6 text-ink">
			<WindowGlassSetting
				state={state}
				onChange={async (patch) => setSettings((s) => ({ ...s, ...patch }))}
			/>
		</div>
	);
};

const meta: Meta<typeof Harness> = {
	title: "Settings/Window glass",
	component: Harness,
	parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof Harness>;

export const MacOffByDefault: Story = {
	args: { platform: "darwin", osVersion: "26.0.0" },
};
export const MacOnFullApp: Story = {
	args: {
		platform: "darwin",
		osVersion: "26.0.0",
		initial: { enabled: true, coverage: "full", intensity: 60 },
	},
};
export const MacOnSidebarsOnly: Story = {
	args: {
		platform: "darwin",
		osVersion: "15.0.0",
		initial: { enabled: true, coverage: "sidebars", intensity: 30 },
	},
};
export const Windows11: Story = {
	args: {
		platform: "win32",
		osVersion: "10.0.22631",
		initial: { enabled: true },
	},
};
/** The one Windows-specific visible state (design review D4). */
export const Windows11RestartNeeded: Story = {
	args: {
		platform: "win32",
		osVersion: "10.0.22631",
		initial: { enabled: true },
		restartRequired: true,
	},
};
export const Windows10Unsupported: Story = {
	args: { platform: "win32", osVersion: "10.0.19045" },
};
export const LinuxUnsupported: Story = {
	args: { platform: "linux", osVersion: "6.8.0" },
};
export const ReducedTransparency: Story = {
	args: { platform: "darwin", osVersion: "26.0.0", reducedTransparency: true },
};
