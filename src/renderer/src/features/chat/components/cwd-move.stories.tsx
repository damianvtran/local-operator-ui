/**
 * The composer's working-directory chip, in every state its CONTRACT can be in -
 * and the receipt lines a move leaves in the transcript.
 *
 * Why this file exists. The chip's states are the whole user-visible surface of
 * moving a live session, and three of the four cannot be reached by hand in a
 * reasonable time: the capability-absent state needs an OLD backend underneath
 * the app, the pending state lasts until the successor runtime has bound (1-3 s
 * of a real spawn, and a 600 ms copy change inside it), and the unset state
 * needs a staged cwd that is empty, which no normal interaction produces. So the
 * story drives the PRODUCTION `DirectoryIndicator` - not a story-shaped copy -
 * with the two Electron calls it makes stubbed, which is the part that cannot
 * exist in a browser.
 *
 * What is real in these frames: the component, its prop contract, the chip's
 * own classes and container queries, the tooltip, the accessible name and the
 * description node, and the live region. What is stubbed:
 * `window.api.getHomeDirectory` (so `~/` renders the way it does in the app
 * rather than as an absolute path the harness happens to have) and
 * `window.api.directoryExists` (an IPC round trip, answered "yes" here).
 *
 * THE WRAPPER IS THE COMPOSER'S OWN SHAPE, deliberately: the chip reads a
 * CONTAINER QUERY (`@min-[750px]/chatcol`), so a story that mounted it in a bare
 * div would photograph the 240px-column variant - the icon-only floor - and
 * every reviewer would be looking at a state the composer does not show at this
 * width. The container, its width and the `border-control bg-surface` ground are
 * copied from `message-input.tsx`'s own root for that reason.
 *
 * The RECEIPTS group at the bottom of this file renders the production
 * `CanonicalTranscript` with the notice rows a move writes. It lives here rather
 * than in `canonical-notice.stories.tsx` because it is this feature's copy: the
 * four sentences the user reads to learn what happened to their session, one of
 * which says the runtime restarted and the eval state is gone. They used to be
 * asserted only in source (design review D5), and the live-app pair a real move
 * produces is QA's independent pass - a rendered story is what keeps the copy's
 * own weight, wrapping and tone reviewable without a backend.
 *
 * Two limits, stated rather than hidden:
 *
 *   - `Pending` photographs the SECOND of the chip's two pending sentences,
 *     because the capture happens well past the 600 ms escalation. The first
 *     ("Moving to `~/x`…") is a 600 ms window; the state's PIXEL difference -
 *     the spinner in the glyph's box - is in this frame, so what the sweep shows
 *     is the in-flight appearance rather than a particular sentence.
 *   - No story mounts the composed composer ROW (chip beside the readings
 *     cluster). That is a limit of this file, not a claim: the chip's width is
 *     pinned by container query as of the fixed path column, so the shift the
 *     design round measured (D7) is a property of the chip's own geometry, which
 *     these frames pin by differencing two paths at the same width.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import { type FC, useRef } from "react";
import { CanonicalTranscript } from "../canonical/canonical-transcript";
import type {
	TranscriptRecord,
	TranscriptState,
} from "../canonical/transcript-reducer";
import {
	MOVE_NOT_READY_REASON,
	MOVE_UNAVAILABLE_REASON,
} from "../move-session";
import {
	DirectoryIndicator,
	type DirectoryWritePath,
} from "./directory-indicator";

/*
 * The two Electron calls the chip makes, stubbed at module scope.
 *
 * `getHomeDirectory` is what turns `/Users/you/src/project` into
 * `~/src/project` in the frame, and the home the app uses on this machine is
 * `/Users/you` - a value that exists only in this story, so a frame cannot be
 * mistaken for a capture of the operator's own paths. `directoryExists` is an
 * IPC round trip; the chip commits BEFORE it validates (a path may name a
 * directory the user is about to create), so answering it is what keeps the
 * danger marking out of frames that are not about the danger marking.
 */
const HOME = "/Users/you";
if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: Record<string, unknown>;
	};
	const api = page.api ?? {};
	page.api = api;
	api.getHomeDirectory = async () => HOME;
	api.directoryExists = async () => true;
	api.selectDirectory = async () => null;
	api.showSaveDialog = async () => null;
}

/** A directory under the stub home, so every frame prints a `~/` path. */
const PROJECT = `${HOME}/src/project`;

/** A live session's move, as the composer wires it: it resolves when it settles. */
const MOVING: DirectoryWritePath = {
	kind: "move",
	commit: async () => ({
		kind: "settled",
		receipt: {
			cwd: `${HOME}/Downloads`,
			label: "~/Downloads",
			outcome: "cold",
			will_wait: false,
		},
		sentence: "moved to ~/Downloads",
	}),
};

/** A draft's staged cwd: the write path the chip's `unset` state belongs to. */
const STAGING: DirectoryWritePath = { kind: "stage", commit: () => {} };

type FrameProps = {
	/** The chip's props, minus the wrapper's own. */
	currentWorkingDirectory?: string;
	writePath?: DirectoryWritePath;
	pending?: boolean;
	readOnlyReason?: string;
	/** The chat column's width, in px. 880 is the composer's own. */
	column?: number;
};

/**
 * One frame: the chip inside the composer's own container, on its ground.
 *
 * Two load-bearing details, both learned from a failed first capture of these
 * frames rather than reasoned out:
 *
 *   - `@container/chatcol` on the OUTER element, because the chip's wide form is
 *     behind `@min-[750px]/chatcol`. Without the container the chip renders at
 *     its icon-only floor, and the first capture photographed a 20px box with a
 *     folder glyph in it and called it the editable state.
 *   - a column that fills the viewport with the chip row at its BOTTOM, which is
 *     where the composer sits. A hugging wrapper put ~99.5% of the frame on the
 *     ground, which `check-evidence` refuses (a frame that shows the ground and
 *     nothing else is not evidence), and the widths are the chat column's own so
 *     the chip is laid out as it is in the app rather than at a story-only size.
 */
const Frame: FC<FrameProps> = ({ column = 880, ...props }) => (
	<div
		className={cn(
			"@container/chatcol",
			"flex min-h-screen w-full justify-center bg-canvas",
		)}
	>
		<div
			className={cn(
				"flex h-screen flex-col justify-end border-x border-hairline bg-surface p-3",
			)}
			style={{ width: `${column}px` }}
		>
			<div className={cn("flex min-w-0 items-center gap-2")}>
				<DirectoryIndicator
					currentWorkingDirectory={props.currentWorkingDirectory}
					writePath={props.writePath}
					pending={props.pending}
					readOnlyReason={props.readOnlyReason}
				/>
			</div>
		</div>
	</div>
);

const meta: Meta<typeof DirectoryIndicator> = {
	title: "chat-cwd-move",
	component: DirectoryIndicator,
	// Fullscreen rather than centered: the wrapper above fills the viewport, and a
	// centering layout would size it to its content - which is the collapsed chip
	// the first capture of these frames came back with.
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof DirectoryIndicator>;

/* ------------------------------------------------------------- states */

/**
 * The editable chip, which is the state a live session gets when the backend
 * advertises `session_move`. At rest, with the pointer off it.
 *
 * This is also the BEFORE frame for the copy change: the chip's read-only branch
 * is untouched by this feature, and only its sentence moved.
 */
export const Editable: Story = {
	render: () => <Frame currentWorkingDirectory={PROJECT} writePath={MOVING} />,
};

/**
 * The same chip with a SHORT path, at the same width as `Editable`.
 *
 * A pair, and the reason is a measurement rather than a preference: the design
 * round found the chip resizing with its content (260px against 245.9px), so a
 * move would shift every control to its right at the same moment the runtime
 * restarted (D7). The chip now reserves a fixed path column, and these two
 * frames are what says so without an argument - differenced, the only pixels
 * that move are the characters inside the column.
 */
export const EditableShortPath: Story = {
	render: () => (
		<Frame currentWorkingDirectory={`${HOME}/Downloads`} writePath={MOVING} />
	),
};

/**
 * The same chip with the menu open, which is the affordance a user actually
 * uses: choosing is the chip's own custom-path field, native browser, recents
 * and defaults - the move does not get a second directory picker, and since the
 * bare `/move` form focuses this chip it is not one of two choosers either.
 */
export const MenuOpen: Story = {
	render: () => <Frame currentWorkingDirectory={PROJECT} writePath={MOVING} />,
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Working directory:/ }),
		);
		await expect(await screen.findByText("Custom directory")).toBeTruthy();
	},
};

/**
 * The menu at the tightest column the composer renders, where the bare `/move`
 * form now lands.
 *
 * The dialog that used to host this chip put the menu 620px tall at `y=-192`
 * with `overflow-y: hidden` - two of the three ways to choose unreachable by
 * pointer, and no scrollbar to say rows were missing (UX U2). The dialog is
 * gone; this frame is the evidence that the one remaining route to the menu is
 * reachable and scrollable where the composer is at its narrowest, and the
 * content consumes Radix's available height so a short window scrolls rather
 * than clips.
 */
export const MenuOpenNarrow: Story = {
	render: () => (
		<Frame currentWorkingDirectory={PROJECT} writePath={MOVING} column={360} />
	),
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Working directory:/ }),
		);
		await expect(await screen.findByText("Custom directory")).toBeTruthy();
	},
};

/**
 * A move in flight: the recomposed directory is on screen and nothing has
 * confirmed it yet.
 *
 * Two things carry the state, and both are deliberate. The folder glyph is the
 * app's own `Spinner` - the same affordance the model reading and the picker
 * footers use while an owner confirms a change - in the glyph's own box, so the
 * row does not move. And the tooltip and the live region carry the sentence.
 *
 * The spinner exists because a tooltip is not a state: the design round measured
 * the pending and settled chips as byte-identical apart from the path and a
 * hover, on the one surface the user is looking at, with the pointer already
 * gone (D2). The value painted during flight is still the UNCONFIRMED one, which
 * is the design's rule 1 - the chip's optimistic value comes from the prop
 * (`pending ?? canonical.frontend?.cwd`) - and the spinner is what keeps it from
 * reading as settled.
 */
export const Pending: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={`${HOME}/Downloads`}
			writePath={MOVING}
			pending
		/>
	),
	play: async () => {
		await userEvent.hover(
			await screen.findByRole("button", { name: /^Working directory:/ }),
		);
		// The escalated sentence, because a mounted story is photographed well
		// past the 600 ms escalation. Asserted rather than assumed: a play that
		// silently does nothing photographs a resting chip and calls it pending.
		await waitFor(() =>
			expect(
				screen.getByText(/Restarting this session's runtime/),
			).toBeTruthy(),
		);
	},
};

/**
 * THE DEGRADATION PATH, and the only frame a user on an older backend ever sees
 * of this feature.
 *
 * The chip is read-only, exactly as it has always been - same classes, same
 * `aria-disabled`, same focusable button, and now the only branch without the
 * chevron - and the sentence in its tooltip and its `aria-describedby` node is
 * the whole story: this backend cannot move a live session, and here is what to
 * do about it. The old sentence ("set when the session starts and cannot be
 * changed afterwards") became false the moment a backend with the route existed,
 * and it is gone from the renderer: every call site that used to state it now
 * states either this or its own, true, constraint.
 */
export const ReadonlyOlderBackend: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={PROJECT}
			readOnlyReason={MOVE_UNAVAILABLE_REASON}
		/>
	),
	play: async () => {
		await userEvent.hover(
			await screen.findByRole("button", { name: /^Working directory:/ }),
		);
		await waitFor(() =>
			expect(
				screen.getByText(/This backend cannot move a live session/),
			).toBeTruthy(),
		);
	},
};

/**
 * The chip while its session is still being created - the OTHER reason a chip
 * with a live session is read-only.
 *
 * `MOVE_NOT_READY_REASON` says so, and the frame exists because the sentence
 * only exists for this window: before it, a pane between "sent" and "live" read
 * the capability sentence, which was false in all three of its clauses for a
 * backend that can move sessions (agent review m1).
 */
export const ReadonlyStarting: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={PROJECT}
			readOnlyReason={MOVE_NOT_READY_REASON}
		/>
	),
	play: async () => {
		await userEvent.hover(
			await screen.findByRole("button", { name: /^Working directory:/ }),
		);
		await waitFor(() =>
			expect(screen.getByText(/still starting/)).toBeTruthy(),
		);
	},
};

/**
 * No directory known for the conversation: the affordance a user lands on when
 * the staged cwd is empty, and the branch that makes an empty cwd recoverable
 * from inside the app rather than a dead end.
 *
 * It is a DRAFT state (its write path stages), and it carries the same chevron
 * the editable chip does: with no path to read and no cue, this branch's
 * sentence read as status text while it is in fact the only way out of the
 * state - and the last resort for discovering that is a hover (design review
 * D8).
 */
export const Unset: Story = {
	render: () => <Frame currentWorkingDirectory="" writePath={STAGING} />,
};

/**
 * The chip's own detail under the pointer: the full path, revealed because the
 * span actually overflows.
 *
 * Whether to show the value instead of the generic hint is now a question about
 * pixels rather than about `shown.length`: the design round measured a
 * thirteen-character path ellipsised at the roomiest width with a tooltip that
 * said "Click to change the working directory" (D6), and the reverse case - a
 * 27-character path truncated with a tooltip that revealed nothing (UX U8) -
 * cannot happen once the decision is read off the rendered span.
 */
export const TruncatedPath: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={`${HOME}/src/a-project-with-a-long-name`}
			writePath={MOVING}
		/>
	),
	play: async () => {
		await userEvent.hover(
			await screen.findByRole("button", { name: /^Working directory:/ }),
		);
		await waitFor(() =>
			expect(
				screen.getByText(`${HOME}/src/a-project-with-a-long-name`),
			).toBeTruthy(),
		);
	},
};

/* ----------------------------------------------------------- receipts */

/**
 * The four sentences a move leaves in the transcript, plus the one refusal a
 * user is most likely to meet.
 *
 * Rendered through the production `CanonicalTranscript` so the frame judges what
 * ships - the notice row's own tone, wrapping and weight - rather than a
 * hand-built row. Design round D5: these lines are what tells the user their
 * runtime restarted and their eval state is gone, and they had no frame anywhere
 * in the PR (the live-app pair is the other half, and QA's).
 */
const notice = (
	id: string,
	text: string,
	level: "info" | "warning" | "error",
): TranscriptRecord => ({
	kind: "notice",
	id,
	ts: 1_760_000_000_000,
	text,
	level,
});

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
	} as TranscriptState;
}

const ReceiptFrame: FC<{ records: TranscriptRecord[] }> = ({ records }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="h-[600px] overflow-y-auto p-6" ref={containerRef}>
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				gate={null}
				waiting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				failure={null}
				hydrated={true}
				// The Receipts group photographs the move's own transcript notes on a
				// live, already-started session, so the admission band is not what these
				// frames are about - the prop is the merge's requirement, not this
				// feature's state.
				starting={false}
				onReconnect={() => {}}
			/>
		</div>
	);
};

/**
 * `already in ~/x` is first because it is the one a user meets without moving
 * anything: the backend answers `unchanged` when the chosen directory IS the
 * current one, including when a typed path only spelled it differently, and the
 * design gives that case its own sentence rather than the silence that used to
 * stand for both "nothing happened" and "already there".
 */
export const Receipts: Story = {
	render: () => (
		<ReceiptFrame
			records={[
				notice("unchanged", "already in ~/src/project", "info"),
				notice("cold", "moved to ~/src/project", "info"),
				notice(
					"rebound",
					"moved to ~/src/project — this session's runtime is restarting there",
					"info",
				),
				notice(
					"rebound-eval",
					"moved to ~/src/project — this session's runtime is restarting there, so everything you set up in eval was lost",
					"info",
				),
				notice(
					"busy",
					"this session is working right now — /move again when the turn finishes",
					"error",
				),
			]}
		/>
	),
};
