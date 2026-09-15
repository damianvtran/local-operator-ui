import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect } from "react";
import type { Message } from "../types/message";
import { DEFAULT_MESSAGE_SUGGESTIONS } from "./composer-suggestions";
import { MessageInput } from "./message-input";

/*
 * THE COMPOSER BAND'S EMPTY-CHAT STATE, which is what the suggestion and tip
 * change is about.
 *
 * The band, not the window, is the subject: every claim here is about the
 * greeting, the composer box, the tip row and the chips, and the rest of the
 * app around them contributes nothing but ground. So each story renders the
 * PRODUCTION `MessageInput` inside a column of a stated width, which is the
 * only input the band's own container queries resolve against -
 * `CHAT_COLUMN_CONTAINER` is applied on the band's root (`message-input.tsx`),
 * so a story that set the width on an outer frame would be photographing a
 * different column than the one it names.
 *
 * WHY THE COLUMN IS THE VIEWPORT at the wide sizes and a fixed width at the
 * narrow one. With the canvas and the run panel shut - the default layout -
 * the chat column IS the window less its chrome, so a 1380px viewport gives
 * the band's shared measure (`CHAT_MEASURE`, capped at 900px) the width it has
 * in the app. With the canvas OPEN the column collapses to 550px inside an
 * 830px window, which is the app's minimum and the case the band's height cap
 * exists for (`suggestion-stack.ts`); there the band is rendered at 550px
 * inside an 830x572 viewport, so the frame carries the app's real geometry
 * without pretending the window is 550px wide.
 *
 * WHAT EACH FRAME IS FOR:
 *
 * - `EmptyChat` is the state the operator asked about: the pinned opening
 *   sample of four, the tip row under the box, at the app's default width.
 * - `ColumnFloor` is the same band at the narrowest column it renders in at
 *   all. This is the frame that answers the design record's prediction 2 - the
 *   band's height, and whether the row cap still clamps anything.
 * - `SmallView` is one step below that column, where the whole prompt is
 *   absent: greeting, tip row and chips go together, because the gate is the
 *   COLUMN and not the tip's own length. A frame showing the tip at a width the
 *   app drops it at would be a claim the product does not make.
 * - `LongLabels` is four of the pool's longest labels at a 620px column, which
 *   is what a LATER sample can draw. The sample is drawn once per mount, so
 *   this is the worst wrap the pool can produce rather than a mid-read reflow.
 * - `DraftHeld` is the same band with a draft in the box. The clock is
 *   suspended there and the ROW STAYS PAINTED - a still cannot show a clock, so
 *   what this frame proves is its own precondition: the row is still on screen,
 *   at its usual place, with text in the composer beside it.
 * - `ReducedMotion` is `EmptyChat` with the media feature EMULATED by the
 *   capture rig (`{ reducedMotion: true }` in `scripts/capture-evidence.mjs`),
 *   which is the only honest way to photograph this state: the app's own cap is
 *   a media block, so a story that faked the style would be evidence about the
 *   fake. The frame shows the OPENING entry held, which is also what one
 *   rotation frame of the other stories shows - and that is the point: under
 *   this preference it stays that entry for the life of the mount.
 */

/*
 * The desktop bridge, installed at MODULE SCOPE for the reason the sibling
 * `message-input.stories.tsx` records: the composer reaches the bridge from a
 * passive effect on mount, and React runs a CHILD's effects before its
 * parent's, so a mock installed by the frame around `MessageInput` arrives one
 * commit too late. `window.electron` is a renderer global only the app's
 * preload writes, so there is no other owner to restore it for.
 */
window.electron = {
	...(window.electron ?? {}),
	ipcRenderer: {
		...(window.electron?.ipcRenderer ?? {}),
		on: () => () => {},
		removeListener: () => window.electron.ipcRenderer,
		send: () => {},
		invoke: async (channel: string) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
} as typeof window.electron;

const STORY_CONVERSATION = "composer-band-story";

/**
 * A conversation id per story, and it is load-bearing rather than tidy.
 *
 * The draft store is PERSISTED (zustand `persist`, key `conversation-input-store`),
 * and every story in one capture run shares the run's Chrome profile - so a
 * story that seeds a draft under the same id as its neighbours hands that draft
 * to every story captured after it. Measured, on this surface's first capture:
 * the `reduced-motion` frame came back with the `draft-held` story's sentence in
 * the box and its send button lit, i.e. a picture of a different state wearing
 * this one's name. Distinct ids make the store's per-conversation map the
 * isolation, rather than an ordering assumption about the STORIES list.
 */
const conversationFor = (story: string) => `${STORY_CONVERSATION}-${story}`;

/** An empty transcript: the band claims the column and the prompt renders. */
const EMPTY: Message[] = [];

/**
 * The pool's own longest four labels, in the pool's order.
 *
 * A LEGAL pool rather than a fabricated one: a pool no larger than the sample
 * is returned whole and in order (`composer-suggestions.ts`), so passing these
 * four is exactly what the sampler would hand the stack if a later draw picked
 * them. The frame is therefore the real worst case for the label-length budget
 * rather than a set of strings invented to overflow.
 */
const LONGEST_FOUR = [...DEFAULT_MESSAGE_SUGGESTIONS]
	.sort((a, b) => b.length - a.length)
	.slice(0, 4);

/**
 * Seeds the composer's own draft store.
 *
 * The draft is the composer's, not a prop - there is no `draft` input on
 * `MessageInput`, deliberately, because in the app the box's text belongs to
 * the store (`useMessageInput`). So the honest way to render "the band with a
 * draft" is to write that store the way the app writes it. An effect rather
 * than a module-scope seed: the store is persisted, so a write made before
 * rehydration can be merged away by it, and the effect runs after.
 */
const WithDraft = ({
	conversation,
	text,
	children,
}: {
	conversation: string;
	text: string;
	children: ReactNode;
}) => {
	useEffect(() => {
		useConversationInputStore.getState().setCurrentInput(conversation, text);
	}, [conversation, text]);
	return <>{children}</>;
};

/**
 * The column the band is rendered in.
 *
 * `h-screen` and `flex-col` so the band's own `grow` resolves the way it does
 * in the app, where the band claims the height of the chat column rather than
 * its content. `w-full` on the inner column is load-bearing rather than
 * tidiness: the outer frame centres with `justify-center`, and a flex item with
 * an auto width in a centring row shrinks to its CONTENT - which made the whole
 * band as wide as this label the first time these stories were captured, and
 * would have photographed a 466px column while claiming the app's 1380. The
 * label occupies the slot the app's header would, which is what keeps the
 * band's top edge off y=0 and stops the frame reading as a full-window
 * screenshot it is not.
 */
const Column = ({
	label,
	width,
	children,
}: {
	label: string;
	width?: number;
	children: ReactNode;
}) => (
	<div className="flex h-screen w-screen justify-center bg-canvas">
		<div
			className="flex h-full w-full flex-col"
			style={width ? { width } : undefined}
			data-story-column={width ?? "viewport"}
		>
			<span className="border-hairline border-b bg-canvas px-6 py-2 font-mono text-ink-dim text-mono-sm">
				{label}
			</span>
			{children}
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat/Composer band",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

type BandProps = {
	/** Which state this frame is, used to key the conversation id. */
	story: string;
	isSmallView?: boolean;
	pool?: readonly string[];
	draft?: string;
};

const composerBand = ({ story, isSmallView, pool, draft }: BandProps) => {
	const conversation = conversationFor(story);
	const input = (
		<MessageInput
			isLoading={false}
			messages={EMPTY}
			conversationId={conversation}
			initialSuggestions={pool ?? DEFAULT_MESSAGE_SUGGESTIONS}
			isSmallView={isSmallView ?? false}
			onSendMessage={async () => true}
		/>
	);
	return draft ? (
		<WithDraft conversation={conversation} text={draft}>
			{input}
		</WithDraft>
	) : (
		input
	);
};

/** The pinned opening sample of four and the tip row, at the app's default width. */
export const EmptyChat: Story = {
	render: () => (
		<Column label="empty chat / opening sample: the pool's first four + the tip row">
			{composerBand({ story: "empty-chat" })}
		</Column>
	),
};

/** The narrowest column the whole prompt renders in: 550px, from an 830px window with the canvas open. */
export const ColumnFloor: Story = {
	render: () => (
		<Column
			label="column floor (550px): the band's height cap is measured here"
			width={550}
		>
			{composerBand({ story: "column-floor" })}
		</Column>
	),
};

/** One step below the floor: the prompt is gone, tip row included. */
export const SmallView: Story = {
	render: () => (
		<Column
			label="small view (below the column floor): the prompt is absent, tip row included"
			width={520}
		>
			{composerBand({ story: "small-view", isSmallView: true })}
		</Column>
	),
};

/** A later sample's worst wrap: the pool's longest four at a 620px column. */
export const LongLabels: Story = {
	render: () => (
		<Column
			label="the pool's longest four labels at a 620px column: the worst wrap a sample can draw"
			width={620}
		>
			{composerBand({ story: "long-labels", pool: LONGEST_FOUR })}
		</Column>
	),
};

/** A draft in the box: the tip's clock is suspended and the row keeps painting. */
export const DraftHeld: Story = {
	render: () => (
		<Column label="a draft is held: the tip's clock is suspended, the row stays">
			{composerBand({
				story: "draft-held",
				draft: "Check the failing test in the parser and",
			})}
		</Column>
	),
};

/**
 * The reduced-motion state.
 *
 * The story is `EmptyChat`; the media feature comes from the capture rig's own
 * `{ reducedMotion: true }` entry, because a media query cannot be set from
 * inside the page it is being asked about.
 */
export const ReducedMotion: Story = {
	render: () => (
		<Column label="reduced motion: one entry is held instead of rotating">
			{composerBand({ story: "reduced-motion" })}
		</Column>
	),
};
