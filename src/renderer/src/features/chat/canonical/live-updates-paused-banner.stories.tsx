/**
 * The paused-live-updates band, in the four states the reader can meet it in.
 *
 * WHY A FRAME AND NOT ONLY A TEST. The claim this banner makes is about REGISTER
 * and PLACEMENT: it must read as a warning about freshness, not as the failure
 * notice that says the conversation cannot be read at all; it must sit on the
 * composer's measured column so it stays visible while a long transcript scrolls;
 * and its control must name what it does. None of that is visible in an assertion,
 * and the copy is translated per locale - what a designer reviews is the rendered
 * band beside a real composer edge, the same reading register the compatibility
 * banner and the status strip share (`NOTICE_BAND`).
 *
 * THE STAGE IS THE REAL COLUMN CONTRACT, not a padded approximation. Like
 * `chat-content`, it puts `CHAT_COLUMN_CONTAINER` + `CHAT_COLUMN_INSET` on the
 * OUTER element and hands `CHAT_MEASURE` to the band itself; the composer-shaped
 * box below takes the same measure inside its own inset wrapper. Putting the
 * inset and the measure on one element charged the gutter to the 810px cap (the
 * 762px defect of design round 2, D1), and the earlier stage's own `px-6` hid
 * it. `width` narrows the whole column so a 390px frame is a real narrow column
 * rather than a wide page with a squeezed child.
 *
 * No English furniture copy: the composer below is a shape, not a sentence, so a
 * non-en capture contains only translated product copy.
 */

import {
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "@features/chat/chat-measure";
// Side effect, and it must stay above the composer import: React runs a child's
// effects before its parent's, so a shim installed by a frame is one commit late.
import "../components/story-electron-shim";
import { MessageInput } from "@shared/components/composer/message-input";
import { cn } from "@shared/lib/utils";
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
 * The band in place: the app's own column classes, the band, and a composer-
 * shaped block on the same measure so the shared edge is visible in the frame.
 */
const Stage = ({
	width,
	...props
}: LiveUpdatesPausedBannerViewProps & { width?: number }) => (
	<div
		className={cn(
			CHAT_COLUMN_CONTAINER,
			"mx-auto flex min-h-[560px] w-full flex-col bg-canvas",
		)}
		style={width ? { width } : undefined}
	>
		<div className="flex min-h-0 grow" />
		<div
			className={cn(
				CHAT_COLUMN_CONTAINER,
				CHAT_COLUMN_INSET,
				"w-full shrink-0 pt-2",
			)}
		>
			<LiveUpdatesPausedBannerView className={CHAT_MEASURE} {...props} />
		</div>
		<div
			className={cn(
				CHAT_COLUMN_CONTAINER,
				CHAT_COLUMN_INSET,
				"w-full shrink-0 pb-8 pt-2",
			)}
		>
			<div
				data-story-composer
				className={cn(
					CHAT_MEASURE,
					"min-h-24 rounded-lg border border-control bg-elevated",
				)}
			/>
		</div>
	</div>
);

export const Paused: StoryObj = {
	name: "Paused",
	render: () => (
		<Stage paused reloading={false} reloadFailed={false} onReload={() => {}} />
	),
};

export const Reloading: StoryObj = {
	name: "Reloading",
	render: () => (
		<Stage paused reloading reloadFailed={false} onReload={() => {}} />
	),
};

export const ReloadFailed: StoryObj = {
	name: "Reload failed",
	render: () => (
		<Stage paused reloading={false} reloadFailed onReload={() => {}} />
	),
};

/**
 * The state the banner must not paint: a healthy stream renders NOTHING, and the
 * frame proves that by being the same stage with the band's slot empty.
 */
export const ReloadingNarrow: StoryObj = {
	name: "Reloading, narrow column",
	render: () => (
		<Stage
			width={390}
			paused
			reloading
			reloadFailed={false}
			onReload={() => {}}
		/>
	),
};

export const PausedMid: StoryObj = {
	name: "Paused, 700px column",
	render: () => (
		<Stage
			width={700}
			paused
			reloading={false}
			reloadFailed={false}
			onReload={() => {}}
		/>
	),
};

export const PausedWide: StoryObj = {
	name: "Paused, 1400px column",
	render: () => (
		<Stage
			width={1400}
			paused
			reloading={false}
			reloadFailed={false}
			onReload={() => {}}
		/>
	),
};

export const Clear: StoryObj = {
	name: "Clear",
	render: () => (
		<Stage
			paused={false}
			reloading={false}
			reloadFailed={false}
			onReload={() => {}}
		/>
	),
};

/**
 * THE REAL COMPOSITION FRAME the design round asked for (D4): the band above the
 * shipped `MessageInput`, not a stand-in box. This is the only frame in which the
 * band's bottom edge, the composer's top edge and their shared 24px inset are
 * photographed together; the stand-in above proves geometry, this proves the host.
 */
export const InContext: StoryObj = {
	name: "In context, real composer",
	render: () => (
		<div
			className={cn(
				CHAT_COLUMN_CONTAINER,
				"mx-auto flex min-h-[560px] w-full flex-col bg-canvas",
			)}
			style={{ width: 1024 }}
		>
			<div className="flex min-h-0 grow" />
			<div
				className={cn(
					CHAT_COLUMN_CONTAINER,
					CHAT_COLUMN_INSET,
					"w-full shrink-0 pt-2",
				)}
			>
				<LiveUpdatesPausedBannerView
					className={CHAT_MEASURE}
					paused
					reloading={false}
					reloadFailed={false}
					onReload={() => {}}
				/>
			</div>
			<MessageInput
				isLoading={false}
				messages={[]}
				conversationId="story"
				onSendMessage={async () => true}
			/>
		</div>
	),
};

/**
 * The narrow-column state the design round measured: 390px of column, the band's
 * action wrapping under the sentence rather than collapsing it. This is a
 * layout frame, not a new state.
 */
export const PausedNarrow: StoryObj = {
	name: "Paused, narrow column",
	render: () => (
		<Stage
			width={390}
			paused
			reloading={false}
			reloadFailed={false}
			onReload={() => {}}
		/>
	),
};
