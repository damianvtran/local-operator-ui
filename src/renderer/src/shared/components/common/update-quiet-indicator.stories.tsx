/**
 * The quiet update indicator, in every state it can be in.
 *
 * WHY THIS FILE EXISTS. The indicator is the whole answer to #672's first half,
 * and its states are not reachable on demand in a running app: what it draws
 * depends on the updater's own events, on what the app believes it is running,
 * and on the followed-segment preference - three facts a story can arrange and a
 * live session cannot ("release a patch to see this" is not a step). So each
 * state is a story, and the evidence rig photographs them
 * (`docs/evidence/update-reload-ux/`).
 *
 * THE COMPONENT IS THE SHIPPED ONE, and so are the stores: the stories set the
 * real `update-notice-store` rather than passing props, so a frame shows what the
 * app would draw for that state and not what a fixture remembered to replicate.
 * `UpdateQuietIndicatorView` is rendered directly by the states that are about
 * the DRAWING rather than about the gate.
 *
 * `AtRest` is a frame OF THE ABSENCE, which is the claim: a user who is not being
 * offered anything sees no band, no reserved row and no pixels at all.
 */

import { UpdateType } from "@shared/store/deferred-updates-store";
import {
	NOTICE_SURFACES,
	quietOfferShown,
	useUpdateNoticeStore,
} from "@shared/store/update-notice-store";
import {
	DEFAULT_FOLLOWED_SEGMENT,
	FollowedSegment,
} from "@shared/utils/update-segment";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, type ReactNode, useLayoutEffect } from "react";
import {
	type QuietIndicatorOffer,
	UpdateQuietIndicator,
	UpdateQuietIndicatorView,
} from "./update-quiet-indicator";

/**
 * One state, arranged through the shipped store before the band is read.
 *
 * `resetNotices` first, because Storybook reuses the module instance across
 * stories: a state that only added an offer would inherit the previous story's.
 */
const Stage: FC<{
	ui?: string;
	backend?: string;
	runningUi?: string;
	runningBackend?: string;
	followedUi?: FollowedSegment;
	/** Rendered directly, bypassing the gate, for the DRAWING states. */
	viewOffers?: QuietIndicatorOffer[];
}> = ({ ui, backend, runningUi, runningBackend, followedUi, viewOffers }) => {
	useLayoutEffect(() => {
		const store = useUpdateNoticeStore.getState();
		store.resetNotices();
		store.setFollowedSegment(
			UpdateType.UI,
			followedUi ?? DEFAULT_FOLLOWED_SEGMENT,
		);
		store.setFollowedSegment(UpdateType.BACKEND, DEFAULT_FOLLOWED_SEGMENT);
		store.noteRunningVersion(UpdateType.UI, runningUi ?? "0.30.0");
		store.noteRunningVersion(UpdateType.BACKEND, runningBackend ?? "0.55.9");
		if (ui) store.noteQuietOffer(UpdateType.UI, { version: ui });
		if (backend) store.noteQuietOffer(UpdateType.BACKEND, { version: backend });
	}, [ui, backend, runningUi, runningBackend, followedUi]);
	/*
	 * The gate itself, asked the way the component asks it - so a story whose
	 * offer should stay quiet draws nothing, and the frame is evidence about the
	 * rule rather than about the fixture.
	 */
	const state = useUpdateNoticeStore((s) => s);
	const shown = NOTICE_SURFACES.filter((type) =>
		quietOfferShown(state, type),
	).map((type) => ({ type, version: state.offers[type]?.version ?? "" }));
	return (
		<UpdateQuietIndicatorView
			offers={viewOffers ?? shown}
			onOpen={() => undefined}
		/>
	);
};

/**
 * The window edge the band lives on.
 *
 * A ground and a width rather than a bare component: the band's whole claim is
 * that it costs one row at the bottom of the window and paints over nothing, and
 * neither of those can be seen against a transparent canvas.
 */
const Frame: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex h-40 w-180 flex-col justify-end bg-canvas">
		<div className="h-12 bg-surface" />
		{children}
	</div>
);

const meta = {
	title: "Common/UpdateQuietIndicator",
	component: UpdateQuietIndicator,
	parameters: { layout: "centered" },
	render: (args) => (
		<Frame>
			<Stage {...args} />
		</Frame>
	),
	tags: ["autodocs"],
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is waiting: no band, no height, no pixels. */
export const AtRest: Story = { args: {} };

/** One app release, at the default (patch) following. */
export const AppUpdate: Story = { args: { ui: "0.30.1" } };

/** Both surfaces, because they ship independently and often disagree. */
export const BothSurfaces: Story = {
	args: { ui: "0.30.1", backend: "0.55.10" },
};

/**
 * A patch release to a surface that follows majors only: the offer exists, the
 * band does not. This is the state the preference is FOR.
 */
export const BelowFollowedSegment: Story = {
	args: { ui: "0.30.1", followedUi: FollowedSegment.MAJOR },
};

/**
 * A long version, to show the band's own behaviour at its widest: the copy does
 * not wrap the row taller, because a band whose height followed its text would
 * move the layout whenever a version string grew.
 */
export const LongVersion: Story = {
	args: { ui: "2026.10.1-nightly.20261112" },
};

/**
 * The drawing state itself, with the gate bypassed: both surfaces' controls and
 * their order, for a reviewer who wants to look at the band rather than at the
 * rule that raises it.
 */
export const DrawingBothControls: Story = {
	args: {
		viewOffers: [
			{ type: UpdateType.UI, version: "0.30.1" },
			{ type: UpdateType.BACKEND, version: "0.55.10" },
		],
	},
};
