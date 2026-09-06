/**
 * The conversation pane while it hydrates (design D22).
 *
 * `isHydrating` correctly stops the app asserting "What can I help you with
 * today?" over a conversation that may turn out to have messages -- but nothing
 * replaced it, so the pane was simply blank. Local hydration is too fast to see
 * that; a slow or remote backend makes it the first impression.
 *
 * These two stories are the same region in its two states, so the placeholder
 * can be judged against the heading it stands in for: it must occupy that slot
 * rather than collapsing the layout, and must not look like a real answer.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { Skeleton } from "@shared/components/ui";

/** The greeting slot, exactly as `message-input.tsx` lays it out. */
const Slot = ({ children }: { children: React.ReactNode }) => (
	<div className="flex h-[280px] w-full flex-col items-center justify-center bg-canvas px-4 pb-4 pt-2">
		<div className="flex w-full flex-col items-center justify-center gap-6 p-4">
			{children}
			<div className="h-24 w-full max-w-[900px] rounded-md border border-subtle bg-surface" />
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat/Hydration placeholder",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Settled and empty: the app may state the greeting. */
export const SettledEmpty: Story = {
	render: () => (
		<Slot>
			<h2 className="text-center text-ink text-title">
				What can I help you with today?
			</h2>
		</Slot>
	),
};

/** Hydrating: the same slot, holding a placeholder instead of a claim. */
export const Hydrating: Story = {
	render: () => (
		<Slot>
			<output
				className="flex w-full flex-col items-center gap-3"
				aria-label="Loading conversation"
			>
				<Skeleton className="h-7 w-64" />
				<span className="sr-only">Loading conversation…</span>
			</output>
		</Slot>
	),
};
