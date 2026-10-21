/**
 * The paused-live-updates band, in the three states the reader can meet it in.
 *
 * WHY A FRAME AND NOT ONLY A TEST. The claim this banner makes is about REGISTER
 * and PLACEMENT: it must read as a warning about freshness, not as the failure
 * notice that says the conversation cannot be read at all; it must sit on the
 * composer band so it stays visible while a long transcript scrolls; and its
 * control must name what it does. None of that is visible in an assertion, and
 * the copy is translated per locale - what a designer reviews is the rendered
 * band beside a real composer edge, the same reading register the compatibility
 * banner and the status strip share (`NOTICE_BAND`).
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import {
	LiveUpdatesPausedBannerView,
	type LiveUpdatesPausedBannerViewProps,
} from "./live-updates-paused-banner";

const meta: Meta = {
	title: "Chat/Live updates paused",
	parameters: { layout: "fullscreen" },
};

export default meta;

/**
 * The band in place: a bounded column with the composer band's own ground below
 * it, so the capture shows the seam the banner is attached to rather than a
 * floating alert on an empty page.
 */
const Stage = (props: LiveUpdatesPausedBannerViewProps) => (
	<div className="flex min-h-[420px] w-full flex-col bg-canvas">
		<div className="flex min-h-0 grow items-end px-6">
			<p className="pb-4 text-body-sm text-ink-muted">
				The conversation stays readable while the stream is paused.
			</p>
		</div>
		<LiveUpdatesPausedBannerView {...props} />
		<div className="shrink-0 border-t border-hairline bg-elevated px-6 py-4">
			<p className="text-body-sm text-ink-dim">
				Message composer band (neighbour, not part of this component)
			</p>
		</div>
	</div>
);

export const Paused: StoryObj = {
	name: "Paused",
	render: () => <Stage paused reloading={false} onReload={() => {}} />,
};

export const Reloading: StoryObj = {
	name: "Reloading",
	render: () => <Stage paused reloading onReload={() => {}} />,
};

/**
 * The state the banner must not paint: a healthy stream renders NOTHING, and the
 * frame proves that by being the same stage with the band's slot empty.
 */
export const Clear: StoryObj = {
	name: "Clear",
	render: () => <Stage paused={false} reloading={false} onReload={() => {}} />,
};
