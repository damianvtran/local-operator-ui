/**
 * The update foot icon, in every state the consult defines.
 *
 * WHY THIS FILE EXISTS. The icon is the standing "a release is waiting" notice
 * since 2026-09-30, and its states are not reachable on demand in a running app:
 * each one depends on the updater's own events, on what the app believes it is
 * running, and on the followed-segment preference - facts a story can arrange
 * and a live session cannot. The states are the consult's five (`hidden`,
 * `available`, hover, pressed, in flight); hover is the primitive's own
 * behaviour and is not photographable here, so the tooltip's CONTENT is the
 * drawing state under `Available`/`BothSurfaces` and the interactive check is
 * `update-indicator-segments.test.mjs`'s.
 *
 * THE STORE IS THE SHIPPED ONE, arranged before the icon reads it - the same
 * approach as the band's stories, so a frame shows what the app would draw for
 * that state and not what a fixture remembered to replicate. `resetNotices`
 * first, because Storybook reuses the module instance across stories.
 */

import { UpdateType } from "@shared/store/deferred-updates-store";
import { useUpdateNoticeStore } from "@shared/store/update-notice-store";
import { DEFAULT_FOLLOWED_SEGMENT } from "@shared/utils/update-segment";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, type ReactNode, useLayoutEffect } from "react";
import { UpdateFootIcon } from "./update-foot-icon";

/**
 * The foot row the icon lives in, at the measured geometry: the sidebar's own
 * `min-h-10 px-2 pb-2` row with the cluster's `gap-1`, right-anchored the way
 * the expanded foot is. The gear is NOT drawn (the story is about the icon's
 * slot, and a stand-in glyph would be a second drawing of the gear to keep in
 * sync); the row's trailing edge is where the cluster ends.
 */
const FootRow: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex h-24 w-70 flex-col justify-end bg-canvas">
		<div className="flex min-h-10 items-center justify-end gap-1 border-t border-hairline bg-surface px-2 py-1.5">
			{children}
		</div>
	</div>
);

const Stage: FC<{
	ui?: string;
	backend?: string;
	uiSummary?: string;
	backendSummary?: string;
	inflightUi?: boolean;
	inflightBackend?: boolean;
	downloadPercent?: number;
}> = ({
	ui,
	backend,
	uiSummary,
	backendSummary,
	inflightUi,
	inflightBackend,
	downloadPercent,
}) => {
	useLayoutEffect(() => {
		const store = useUpdateNoticeStore.getState();
		store.resetNotices();
		store.setFollowedSegment(UpdateType.UI, DEFAULT_FOLLOWED_SEGMENT);
		store.setFollowedSegment(UpdateType.BACKEND, DEFAULT_FOLLOWED_SEGMENT);
		/* Running versions below the offered ones, so the segment gate lets both
		   offers through - the same arrangement the band's stories use. */
		store.noteRunningVersion(UpdateType.UI, "0.30.0");
		store.noteRunningVersion(UpdateType.BACKEND, "0.55.9");
		if (ui)
			store.noteQuietOffer(UpdateType.UI, {
				version: ui,
				summary: uiSummary ?? null,
			});
		if (backend)
			store.noteQuietOffer(UpdateType.BACKEND, {
				version: backend,
				summary: backendSummary ?? null,
			});
		store.noteInFlight(UpdateType.UI, inflightUi === true);
		store.noteInFlight(UpdateType.BACKEND, inflightBackend === true);
		store.noteDownloadPercent(
			UpdateType.UI,
			typeof downloadPercent === "number" ? downloadPercent : null,
		);
	}, [
		ui,
		backend,
		uiSummary,
		backendSummary,
		inflightUi,
		inflightBackend,
		downloadPercent,
	]);
	return (
		<FootRow>
			<UpdateFootIcon />
		</FootRow>
	);
};

const meta = {
	title: "Common/UpdateFootIcon",
	component: UpdateFootIcon,
	parameters: { layout: "centered" },
	render: (args) => <Stage {...args} />,
	tags: ["autodocs"],
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing waiting, nothing running: zero pixels, exactly the BEFORE row. */
export const Hidden: Story = { args: {} };

/** One server release, and the tooltip's summary line when the lookup read it. */
export const ServerUpdate: Story = {
	args: {
		backend: "0.55.10",
		backendSummary: "Fixes the rollover notice.",
	},
};

/** Both surfaces waiting: still ONE icon; both versions live in the tooltip. */
export const BothSurfaces: Story = {
	args: { ui: "0.30.1", backend: "0.55.10" },
};

/** The in-flight arm the server update shows: an arc, non-interactive. */
export const ServerInFlight: Story = {
	args: { ui: "0.30.1", backend: "0.55.10", inflightBackend: true },
};

/** The app download's arm, with the one measured percent this app has. */
export const Downloading: Story = {
	args: { ui: "0.30.1", inflightUi: true, downloadPercent: 42 },
};
