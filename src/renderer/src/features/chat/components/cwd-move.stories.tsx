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
 * Two limits, stated rather than hidden, and both of them restated here after
 * round-3 review found the old pair describing mechanisms this branch removed
 * (design review round 3, D21):
 *
 *   - `Pending` photographs the chip AFTER the receipt, so the tooltip carries the
 *     second of the move's two sentences ("Restarting this session's runtime…");
 *     `PendingMoving` is the same chip before the backend answered. The difference
 *     between them is a PROP (`pendingAccepted`), not elapsed time: the 600 ms
 *     escalation has been deleted (`PENDING_RESTART_AFTER_MS` exists nowhere), so
 *     a story that wants the pre-receipt sentence has to say so rather than wait.
 *   - No story in THIS FILE mounts the composed composer ROW (chip beside the
 *     readings cluster) - that frame is `message-input.stories.tsx`'s
 *     `CwdChipInRow` (design review round 2, D13). What stays here is the chip's
 *     own geometry, which these frames pin by differencing two paths at one width.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import { type FC, useEffect, useRef, useState } from "react";
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
	/** Whether the pending move has the backend's acceptance; see `pendingAccepted`. */
	pendingAccepted?: boolean;
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
 *   - `@container/chatcol` on the element that CARRIES the column width, because
 *     the chip's wide form is behind `@min-[750px]/chatcol` and a named
 *     container query resolves against the nearest ancestor holding that name
 *     (design review round 2, D12). It used to sit on the outer
 *     `min-h-screen w-full` box, so `@min-[900px]/chatcol` was answered by the
 *     VIEWPORT: `MenuOpenNarrow` rendered the >=900px chip and could not
 *     photograph the case it is titled for. Without any container the chip
 *     renders at its icon-only floor - the first capture photographed a 20px box
 *     with a folder glyph in it and called it the editable state.
 *   - a column that fills the viewport with the chip row at its BOTTOM, which is
 *     where the composer sits. A hugging wrapper put ~99.5% of the frame on the
 *     ground, which `check-evidence` refuses (a frame that shows the ground and
 *     nothing else is not evidence), and the widths are the chat column's own so
 *     the chip is laid out as it is in the app rather than at a story-only size.
 */
const Frame: FC<FrameProps> = ({ column = 880, ...props }) => (
	<div className={cn("flex min-h-screen w-full justify-center bg-canvas")}>
		<div
			className={cn(
				"@container/chatcol",
				"flex h-screen flex-col justify-end border-x border-hairline bg-surface p-3",
			)}
			style={{ width: `${column}px` }}
		>
			<div className={cn("flex min-w-0 items-center gap-2")}>
				<DirectoryIndicator
					currentWorkingDirectory={props.currentWorkingDirectory}
					writePath={props.writePath}
					pending={props.pending}
					pendingAccepted={props.pendingAccepted}
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
 * row does not move. And the label slot, the tooltip and the live region carry
 * the sentence.
 *
 * The spinner exists because a tooltip is not a state: the design round measured
 * the pending and settled chips as byte-identical apart from the path and a
 * hover, on the one surface the user is looking at, with the pointer already
 * gone (D2). The value painted during flight is still the UNCONFIRMED one, which
 * is the design's rule 1 - the chip's optimistic value comes from the prop
 * (`pending ?? canonical.frontend?.cwd`) - and the spinner is what keeps it from
 * reading as settled.
 *
 * The spinner is also not ENOUGH on its own, which is why the label slot now
 * carries the sentence too: `styles/index.css` caps `animation-duration` to
 * 0.01ms under `prefers-reduced-motion: reduce`, so the ring lands frozen and a
 * reduced-motion user would otherwise get a still glyph with no words anywhere
 * on the surface (design review round 2, D11).
 *
 * `pendingAccepted` is the backend's acceptance, so this story is the state AFTER
 * the receipt: the sentence is the one that claims a restart. `PendingMoving` is
 * the same chip before it.
 */
export const Pending: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={`${HOME}/Downloads`}
			writePath={MOVING}
			pending
			pendingAccepted
		/>
	),
	play: async () => {
		await userEvent.hover(
			await screen.findByRole("button", { name: /^Moving session:/ }),
		);
		// The escalated sentence, which is now the RECEIPT's arrival rather than a
		// clock. Asserted rather than assumed: a play that silently does nothing
		// photographs a resting chip and calls it pending.
		await waitFor(() =>
			expect(
				screen.getAllByText(/Restarting this session's runtime/).length,
			).toBeGreaterThan(0),
		);
	},
};

/**
 * The same move BEFORE the backend answered: "Moving…", no claim about a restart.
 *
 * The two sentences make different claims and this is the one that is true from
 * the commit - the user has asked, nothing has come back. A 600 ms timer used to
 * escalate between them on elapsed time, which on a slow refusal (the busy 409 is
 * authored AFTER the runtime answers) announced a restart that never happened
 * (UX review round 2, U3). Their difference is in the pixels and it is capturable
 * because it is now a prop rather than a delay.
 */
export const PendingMoving: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={`${HOME}/Downloads`}
			writePath={MOVING}
			pending
		/>
	),
	play: async () => {
		await userEvent.hover(
			await screen.findByRole("button", { name: /^Moving session:/ }),
		);
		await waitFor(() =>
			expect(screen.getAllByText(/Moving to/).length).toBeGreaterThan(0),
		);
		// And NOT the escalated sentence: the assertion above would pass on a chip
		// that painted both, which is the state this story exists to distinguish.
		expect(screen.queryByText(/Restarting this session's runtime/)).toBeNull();
	},
};

/**
 * The chip the moment after a REFUSAL revoked the value it was painting (D14).
 *
 * There is no frame of this state anywhere, and it is the one where the optimistic
 * value painted during flight is disproved: the path is back to the directory the
 * session is actually in, the spinner is gone, and the row is the settled chip
 * again. What the user is left with is the transcript's refusal note, which is the
 * other half of this pair (`Receipts`) - so what this frame can answer is the
 * narrow question "does the composer itself leave anything proximate", and the
 * answer it shows is "no, and that is the intended shape": the chip cannot invent
 * a second failure surface when the backend's sentence is already in the
 * transcript's own history.
 *
 * Not `Editable` with a different name: the assertion below is the point of the
 * story, and it fails if the chip ever starts painting a residue of the refusal.
 */
export const RefusedSettled: Story = {
	render: () => (
		<Frame currentWorkingDirectory={`${HOME}/project`} writePath={MOVING} />
	),
	play: async () => {
		const trigger = await screen.findByRole("button", {
			name: /^Working directory:/,
		});
		// The settled chip's marks: no in-flight sentence and no spinner ring. The
		// ring is `span.animate-spin` inside the chip's glyph box (the app's one
		// indeterminate-progress affordance, unlabelled here because the live region
		// carries the sentence).
		expect(screen.queryByText(/Moving to|Restarting this session/)).toBeNull();
		expect(trigger.querySelector(".animate-spin")).toBeNull();
	},
};

/**
 * A path that GROWS after mount, which is the state the measured tooltip had to
 * survive and did not (agent review round 2, R-1).
 *
 * Above a 900px chat column the path span is a fixed `16ch` column, so a path
 * change moves `scrollWidth` and leaves `clientWidth` alone - and a
 * `ResizeObserver` reports BOX size, so nothing re-measured: the chip ellipsised
 * the new directory while the tooltip went on offering the previous path's
 * answer. The story mounts at `~/src/project` (13 characters, fits) and then
 * grows to a path longer than the column, which is reachable by hand through the
 * feature's own primary action (move to a longer directory) and by no story
 * before this one.
 *
 * The play asserts the OBSERVABLE end of it rather than the mechanism: the
 * tooltip must reveal the path the chip is hiding. With the effect's dependency
 * list back at `[]`, this assertion fails - the regression is falsifiable here
 * instead of only photographable.
 */
const GrownPathFrame: FC = () => {
	const [path, setPath] = useState(PROJECT);
	useEffect(() => {
		// Mount, then move: the mount-time short path is what the old effect
		// measured, and the growth is what it never saw.
		setPath(`${HOME}/project-with-a-considerably-longer-name`);
	}, []);
	// `column={1000}` is load-bearing: below 900px the path span hugs its content
	// and cannot overflow, so the fixed column this regression lives in only exists
	// above the threshold.
	return (
		<Frame currentWorkingDirectory={path} writePath={MOVING} column={1000} />
	);
};

export const GrownPath: Story = {
	render: () => <GrownPathFrame />,
	play: async () => {
		await userEvent.hover(
			await screen.findByRole("button", { name: /^Working directory:/ }),
		);
		/*
		 * The TOOLTIP, not the chip's own span: the span's text content is the whole
		 * path whatever CSS does to it, so asserting on it would pass on the broken
		 * build. The hovered tooltip showing the path AND the cost sentence is the
		 * observable end of both R-1 and U2(r2).
		 */
		const tooltip = await screen.findByRole("tooltip");
		await waitFor(() =>
			expect(tooltip.textContent).toMatch(
				/project-with-a-considerably-longer-name/,
			),
		);
		expect(tooltip.textContent).toMatch(/runtime restarts there/);
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
		/*
		 * The tooltip's own content, in the spelling the chip paints: the span shows
		 * `~/` rather than the absolute path because it renders through the home
		 * directory the story stubs, so asserting `${HOME}/src/...` here (the shape
		 * this play shipped with) could never match and never did - a play nobody ran,
		 * because this story's swept entry was withdrawn with the frames. Found while
		 * re-capturing this state with the browser tool.
		 *
		 * Both facts are asserted, because that is what U2(r2) changed: the hidden path
		 * AND the cost sentence, which used to be suppressed in exactly this case.
		 */
		const tooltip = await screen.findByRole("tooltip");
		await waitFor(() =>
			expect(tooltip.textContent).toMatch(/a-project-with-a-long-name/),
		);
		expect(tooltip.textContent).toMatch(/runtime restarts there/);
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
				// No page is owed here: the story photographs a live, already-read
				// session, so the composed question is false (`!hydrated`).
				awaitingHydration={false}
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
