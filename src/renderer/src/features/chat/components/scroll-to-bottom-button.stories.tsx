/**
 * The jump-to-latest control in the two states its label distinguishes.
 *
 * WHY THIS FILE EXISTS. The control gained a producer for its "new activity"
 * label (the chip used to read the same whether or not anything had arrived
 * while the reader was scrolled up), and the label itself now names the action -
 * "Jump to latest" - instead of the fact ("New activity"). Both are claims about
 * pixels, and the real chat page needs a daemon-backed conversation to reach
 * either state. The story renders the SHIPPED component at its real anchor: the
 * composer's top edge, which is where `message-input.tsx` mounts it.
 *
 * The ground is skeleton rows rather than a transcript: this story is about one
 * control's label and placement, and copying message text into a story would
 * add product copy the scanner has to account for while telling a reviewer
 * nothing about the control. The and-before/after pair is taken by the same
 * story on the base tree (`docs/pr-evidence/jump-to-latest/`), where the base
 * catalogue renders the base label.
 */
import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentProps } from "react";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";

const meta = {
	title: "Chat/Scroll to bottom",
	component: ScrollToBottomButton,
	parameters: {
		// One picture, at the size the sweep names - not a padded story frame.
		layout: "fullscreen",
	},
} satisfies Meta<typeof ScrollToBottomButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The conversation ground: rows at rest, and the only thing the chip floats over. */
const TranscriptGround = () => (
	<div className="flex-1 space-y-6 overflow-hidden px-10 py-8">
		{[72, 88, 54, 96, 61, 84, 47, 90].map((width, index) => (
			<div
				// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are positional
				key={index}
				className={
					index % 3 === 0
						? "ms-auto h-9 rounded-xl bg-surface"
						: "h-4 rounded-full bg-surface"
				}
				style={{ width: `${width}%` }}
			/>
		))}
	</div>
);

const Frame = ({
	visible,
	hasNewActivity,
}: Pick<
	ComponentProps<typeof ScrollToBottomButton>,
	"visible" | "hasNewActivity"
>) => (
	<div className="relative flex h-full w-full flex-col bg-canvas">
		<TranscriptGround />
		{/*
		 * The composer's own anchoring wrapper: the chip is `bottom-full end-3`
		 * against this box, which is the placement `message-input.tsx` gives it.
		 * The box itself is the band the real composer paints.
		 */}
		<div className="relative border-t border-hairline p-4">
			<div className="flex h-[104px] items-start rounded-xl border border-control bg-sunken px-4 py-3">
				<div className="h-4 w-1/3 rounded-full bg-surface" />
			</div>
			<ScrollToBottomButton
				visible={visible}
				hasNewActivity={hasNewActivity}
				onClick={() => undefined}
			/>
		</div>
	</div>
);

/** Scrolled up with nothing new below: the quiet disc. */
export const Idle: Story = {
	args: { visible: true, hasNewActivity: false, onClick: () => undefined },
	render: (args) => (
		<Frame visible={args.visible} hasNewActivity={args.hasNewActivity} />
	),
};

/** Scrolled up while output arrived: the disc grows the action's own name. */
export const NewActivity: Story = {
	args: { visible: true, hasNewActivity: true, onClick: () => undefined },
	render: (args) => (
		<Frame visible={args.visible} hasNewActivity={args.hasNewActivity} />
	),
};
