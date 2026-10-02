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
import { Settings } from "lucide-react";
import { type FC, type ReactNode, useLayoutEffect } from "react";
import { UpdateFootIcon } from "./update-foot-icon";

/**
 * The foot row the icon lives in, at the shipping shape (review round 1's D3).
 *
 * It mirrors `sidebar-navigation.tsx`'s expanded foot: the `min-h-10 px-2 pb-2`
 * row, the account row at its leading edge, and the trailing cluster
 * (`flex items-center gap-1`) holding the icon immediately left of the gear -
 * so a frame made here can verify the two claims the story exists for (the
 * icon's slot, and the gear still being the row's last stop), which the old
 * `justify-end gap-1` shape with no gear could not. The gear is a locally
 * drawn stand-in with the shipping classes rather than an import: the real one
 * lives inside the sidebar's router-bound component, and a story that pulls
 * the whole sidebar in to draw one 16px glyph is how evidence rigs grow roots.
 * Only the gear's geometry and ink matter to these frames.
 */
const GearStandIn: FC = () => (
	<button
		type="button"
		className="flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted"
		aria-hidden="true"
		tabIndex={-1}
	>
		<Settings size={16} aria-hidden="true" />
	</button>
);

/** The account row's stand-in, sized like the real avatar block. */
const AccountStandIn: FC = () => (
	<div className="flex items-center gap-2" aria-hidden="true">
		<div className="size-7 shrink-0 rounded-full bg-row-hover" />
		<div className="flex flex-col gap-1">
			<div className="h-2 w-16 rounded-sm bg-row-hover" />
			<div className="h-2 w-10 rounded-sm bg-row-hover" />
		</div>
	</div>
);

const FootRow: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex h-24 w-70 flex-col justify-end bg-canvas">
		<div className="flex min-h-10 items-center justify-between gap-1 border-t border-hairline bg-surface px-2 pb-2">
			<AccountStandIn />
			<div className="flex items-center gap-1">
				{children}
				<GearStandIn />
			</div>
		</div>
	</div>
);

/**
 * The 56px strip's foot (review round 1's D4), where the icon is a THIRD CHILD
 * of the vertical column (icon, gear, avatar) rather than half of a horizontal
 * cluster. Same draw, different geometry - and the one arrangement where the
 * tooltip's `collisionPadding` matters, because the column sits at the
 * window's left edge.
 */
const StripFrame: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex h-40 w-14 flex-col items-center justify-end gap-1 border-r border-hairline bg-surface pb-2">
		{children}
		<GearStandIn />
		<div className="size-7 rounded-full bg-row-hover" aria-hidden="true" />
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
	strip?: boolean;
}> = ({
	ui,
	backend,
	uiSummary,
	backendSummary,
	inflightUi,
	inflightBackend,
	downloadPercent,
	strip,
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
		<>
			{strip ? (
				<StripFrame>
					<UpdateFootIcon />
				</StripFrame>
			) : (
				<FootRow>
					<UpdateFootIcon />
				</FootRow>
			)}
		</>
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

/**
 * The 56px strip's arrangement (review round 1's D4): the same icon as the
 * column's third child - icon, gear, avatar - so a frame covers the geometry
 * where the tooltip's edge padding matters.
 */
export const StripVariant: Story = {
	args: { backend: "0.55.10", strip: true },
};
