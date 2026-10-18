import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useState } from "react";
import {
	type GlassEnvironmentFacts,
	type GlassSettings,
	type WindowGlassState,
	defaultGlassSettings,
	glassCapabilityFor,
} from "../../../../../shared/window-glass";
import { WindowGlassSetting } from "./window-glass-setting";

/**
 * Settings > Appearance > Window glass, in every state the control can be in.
 *
 * WHY A STORY. The control is presentational (state in, patch out), so each branch
 * of the capability decision is reachable here without an Electron window: the
 * macOS default-on state, each environment fact that greys it (GPU off, no
 * backdrop filter), and each platform reason (Windows unverified, Linux, Reduce
 * transparency). The frames of the LIVE window (OS material behind the app) need
 * the compositor and come from the PR's native rig; a story cannot show a blur and
 * does not pretend to.
 */
const Harness: FC<{
	platform: string;
	osVersion: string;
	reducedTransparency?: boolean;
	environment?: GlassEnvironmentFacts;
	initial?: Partial<GlassSettings>;
	/** The master switch was flipped and needs a restart (Windows): reachable only
	 * with a supported Windows capability, which the shipped gate does not produce
	 * until Windows is verified. Kept for that day. */
	restartRequired?: boolean;
}> = ({
	platform,
	osVersion,
	reducedTransparency = false,
	environment,
	initial,
	restartRequired = false,
}) => {
	const capability = glassCapabilityFor({
		platform,
		osVersion,
		reducedTransparency,
		environment,
	});
	const [settings, setSettings] = useState<GlassSettings>({
		...defaultGlassSettings(capability),
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

/** The out-of-box state: on at 80% where the machine can composite it. */
export const MacDefaultOn: Story = {
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
/** Hardware acceleration off (a launch flag or a crash fallback): greyed. */
export const MacAccelerationDisabled: Story = {
	args: {
		platform: "darwin",
		osVersion: "26.0.0",
		environment: { hardwareAcceleration: false },
	},
};
/** The GPU reports compositing/rasterisation off or software-only: greyed. */
export const MacGpuUnavailable: Story = {
	args: {
		platform: "darwin",
		osVersion: "26.0.0",
		environment: { gpu: { compositing: "unavailable_software" } },
	},
};
/** The renderer cannot draw a backdrop blur: greyed. */
export const MacNoBackdropFilter: Story = {
	args: {
		platform: "darwin",
		osVersion: "26.0.0",
		environment: { backdropFilter: false },
	},
};
/** Windows 11: implemented, unverified on a real machine - off and greyed. */
export const Windows11Unverified: Story = {
	args: { platform: "win32", osVersion: "10.0.22631" },
};
export const Windows10Unsupported: Story = {
	args: { platform: "win32", osVersion: "10.0.19045" },
};
export const LinuxCompositorDependent: Story = {
	args: { platform: "linux", osVersion: "6.8.0" },
};
export const ReducedTransparency: Story = {
	args: { platform: "darwin", osVersion: "26.0.0", reducedTransparency: true },
};
