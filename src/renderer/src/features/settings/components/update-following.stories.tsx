/**
 * The notification preference, in the settings card it ships in.
 *
 * Small enough to look trivial and not: the control's whole job is to be
 * legible, because "every release / minor and major only / major versions only"
 * is a choice a person makes once and then forgets - so a frame where the three
 * values cannot be told apart is a frame where the setting silently does the
 * wrong thing for a year.
 *
 * The states are the two that differ in SHAPE rather than in text - the shipped
 * default (both surfaces on every release) and a mixed card, where the app
 * follows majors while the server follows everything - plus `MinorsOnly`, which
 * exists for one reason: the MIDDLE option's label (`Minor and major only`) was
 * in no frame of either take, so one of the three strings this control forms had
 * never been looked at as rendered (design round 2, D11). The listbox itself is a
 * portal-rendered popper that no committed frame can photograph, which is why
 * each option's explanation rides the item's `title` rather than a second line.
 */

import { UpdateType } from "@shared/store/deferred-updates-store";
import { useUpdateNoticeStore } from "@shared/store/update-notice-store";
import {
	DEFAULT_FOLLOWED_SEGMENT,
	FollowedSegment,
} from "@shared/utils/update-segment";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useLayoutEffect } from "react";
import { UpdateFollowing } from "./update-following";

/**
 * One state, arranged through the shipped store before the controls read it.
 *
 * A settings card with no state of its own is easy to story as static markup -
 * and that is exactly the trap: the component reads and writes the real store,
 * so a story that drew a fixture would photograph a card the app cannot produce.
 */
const Stage: FC<{
	followedUi?: FollowedSegment;
	followedBackend?: FollowedSegment;
}> = ({ followedUi, followedBackend }) => {
	useLayoutEffect(() => {
		const store = useUpdateNoticeStore.getState();
		store.setFollowedSegment(
			UpdateType.UI,
			followedUi ?? DEFAULT_FOLLOWED_SEGMENT,
		);
		store.setFollowedSegment(
			UpdateType.BACKEND,
			followedBackend ?? DEFAULT_FOLLOWED_SEGMENT,
		);
	}, [followedUi, followedBackend]);
	return <UpdateFollowing />;
};

const meta = {
	title: "Settings/UpdateFollowing",
	component: UpdateFollowing,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-150 bg-canvas p-6">
				<Story />
			</div>
		),
	],
	tags: ["autodocs"],
	/*
	 * The card reads the store rather than props, so the args are the STATE to
	 * arrange. `render` is where that happens; `component` is still the shipped
	 * control, so the docs panel and the a11y checks describe the real card.
	 */
	render: (args) => <Stage {...args} />,
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shipped default: every release of either surface is announced. */
export const Default: Story = { args: {} };

/** The mixed card: the app follows majors, the server follows everything. */
export const MixedSegments: Story = {
	args: {
		followedUi: FollowedSegment.MAJOR,
		followedBackend: FollowedSegment.PATCH,
	},
};

/**
 * Both surfaces on the MIDDLE step - the option between "every release" and
 * majors only, and the one label no earlier frame carried (design D11).
 */
export const MinorsOnly: Story = {
	args: {
		followedUi: FollowedSegment.MINOR,
		followedBackend: FollowedSegment.MINOR,
	},
};

/** Both surfaces following majors only - the quietest card the control forms. */
export const MajorsOnly: Story = {
	args: {
		followedUi: FollowedSegment.MAJOR,
		followedBackend: FollowedSegment.MAJOR,
	},
};
