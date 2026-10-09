/**
 * The one-time "delegated sessions were cleaned up" notice, in its two honest
 * states and its long-message edge.
 *
 * The notice is the VIEW, rendered in the pane's own gutter (`shrink-0 px-6
 * py-1`) the way `backend-compatibility-banner.stories.tsx` renders its band.
 * `message` is the shape the backend actually sends
 * (`delegated_retention.format_delegated_notice`): the "so far" suffix is its
 * rendering of `in_progress`, so the two stories differ by the backend's own
 * sentence, not by anything this file made up.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { DelegatedCleanupNotice } from "../../../../../shared/desktop-contract";
import { DelegatedCleanupNoticeView } from "./delegated-cleanup-notice";

const RECORD = "~/.local-operator/sessions/cleanup.log";

const finished: DelegatedCleanupNotice = {
	message: [
		"Cleaned up 17579 delegated sessions (subagents and background runs) older than 48 hours to save disk space.",
		"Your own conversations were not touched.",
		"Change or turn this off in Settings > Delegated work.",
		`Record: ${RECORD}`,
	].join("\n"),
	removed: 17579,
	max_age_hours: 48,
	in_progress: false,
	first_removal_at: "2026-10-09T10:12:04-0400",
	freed_bytes_estimate: 64_000_000_000,
	record: RECORD,
};

const draining: DelegatedCleanupNotice = {
	...finished,
	message: finished.message.replace(
		"sessions (subagents",
		"sessions so far (subagents",
	),
	removed: 3100,
	in_progress: true,
	freed_bytes_estimate: null,
};

const meta: Meta<typeof DelegatedCleanupNoticeView> = {
	title: "Settings/Delegated cleanup notice",
	component: DelegatedCleanupNoticeView,
	parameters: { layout: "padded" },
	args: { onOpenSettings: () => {}, onDismiss: () => {} },
	decorators: [
		(Story) => (
			<div className="mx-auto flex w-full max-w-3xl flex-col bg-canvas py-4">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof DelegatedCleanupNoticeView>;

/** The backlog is cleared: a final tally. */
export const Finished: Story = { args: { notice: finished } };

/** The backlog is still draining: "so far", more removals on later launches. */
export const InProgress: Story = { args: { notice: draining } };

/** A narrow pane, where the actions must not push the sentence out of the band. */
export const Narrow: Story = {
	args: { notice: draining },
	decorators: [
		(Story) => (
			<div className="w-[420px] bg-canvas">
				<Story />
			</div>
		),
	],
};
