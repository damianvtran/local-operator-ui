import {
	type AgentAvatarSize,
	parseAgentAvatarSize,
} from "@features/chat/agent-avatar-size";
import { parseTranscriptDisplayMode } from "@features/chat/transcript-display-mode";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { Contrast } from "lucide-react";
import { useLayoutEffect } from "react";
import { AgentAvatarSizeSetting } from "./agent-avatar-size-setting";
import { SettingsSection } from "./settings-section";
import { TranscriptDisplayModeSetting } from "./transcript-display-mode-setting";

/**
 * Settings > Appearance > Agent picture size, beside the row it is a pair with.
 *
 * The control is bound to the REAL preferences store (the one the chat window and
 * header read), so pressing a step here is the same write the app makes. It is
 * rendered inside the shipped `SettingsSection` so the row's width and the
 * segmented control's place against its neighbour are the page's own.
 */
const Frame = ({ startAt }: { startAt?: AgentAvatarSize }) => {
	const size = useUiPreferencesStore((state) => state.agentAvatarSize);
	const setSize = useUiPreferencesStore((state) => state.setAgentAvatarSize);
	// The store persists, so a frame states its step instead of inheriting one.
	useLayoutEffect(() => {
		setSize(startAt ?? "small");
	}, [setSize, startAt]);
	const mode = useUiPreferencesStore((state) => state.transcriptDisplayMode);
	const setMode = useUiPreferencesStore(
		(state) => state.setTranscriptDisplayMode,
	);
	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
			<SettingsSection
				title="Appearance"
				icon={Contrast}
				description="Customize the look and feel of Local Operator"
				dataTourTag="settings-appearance-section"
			>
				<div data-agent-size-rows="" className="flex flex-col gap-4">
					<TranscriptDisplayModeSetting
						value={parseTranscriptDisplayMode(mode)}
						onChange={setMode}
					/>
					<AgentAvatarSizeSetting
						value={parseAgentAvatarSize(size)}
						onChange={setSize}
					/>
				</div>
			</SettingsSection>
		</div>
	);
};

const meta = {
	title: "Settings/Agent picture size",
	parameters: { layout: "fullscreen" },
	render: () => <Frame />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The row at its default step (small), directly under the transcript display row. */
export const Default: Story = {};

/** The same row at the largest step, so the live sample's growth is on a frame. */
export const Large: Story = {
	render: () => <Frame startAt="large" />,
};
