/**
 * The composer's working-directory chip, in every state its CONTRACT can be in.
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
 * Two limits, stated rather than hidden:
 *
 *   - The transcript receipt that accompanies a move is not here. It is a
 *     `canonical.addNote` line in the session's own transcript, and its frames
 *     are the live-app pair on the PR, where a real move produces them.
 *   - `Pending` photographs the SECOND of the chip's two pending sentences,
 *     because the capture happens well past the 600 ms escalation. The first
 *     ("Moving to `~/x`…") is photographed in the live app, where the shutter can
 *     be inside that window; reproducing it here would mean photographing a
 *     timer, and the honest way to show a 600 ms state is to catch it live.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import type { FC } from "react";
import { DirectoryIndicator } from "./directory-indicator";

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

type FrameProps = {
	/** The chip's props, minus the wrapper's own. */
	currentWorkingDirectory?: string;
	onChangeDirectory?: (path: string) => void;
	pending?: boolean;
	readOnlyReason?: string;
};

/**
 * One frame: the chip inside the composer's own container, on its ground.
 *
 * The `@container/chatcol` class is load-bearing rather than cosmetic - see the
 * file docstring. `w-full` puts the container at the frame's own width, which is
 * the 1000px these stories are captured at - well above the chip's 750px
 * threshold, which is where the composer shows the label, the path and the
 * `border-control` frame together.
 */
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
const Frame: FC<FrameProps> = (props) => (
	<div
		className={cn(
			"@container/chatcol",
			"flex min-h-screen w-full justify-center bg-canvas",
		)}
	>
		<div
			className={cn(
				"flex h-screen w-[880px] flex-col justify-end border-x border-hairline bg-surface p-3",
			)}
		>
			<div className={cn("flex min-w-0 items-center gap-2")}>
				<DirectoryIndicator
					currentWorkingDirectory={props.currentWorkingDirectory}
					onChangeDirectory={props.onChangeDirectory}
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
 * This is also the BEFORE frame for the copy change: the chip's markup and
 * classes are untouched by this feature, and only the read-only branch's
 * sentence moved.
 */
export const Editable: Story = {
	render: () => (
		<Frame currentWorkingDirectory={PROJECT} onChangeDirectory={() => {}} />
	),
};

/**
 * The same chip with the menu open, which is the affordance a user actually
 * uses: choosing is the chip's own custom-path field, native browser, recents
 * and defaults - the move does not get a second directory picker.
 */
export const MenuOpen: Story = {
	render: () => (
		<Frame currentWorkingDirectory={PROJECT} onChangeDirectory={() => {}} />
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
 * The tooltip is the whole visual difference this state has, and that is a
 * deliberate decision rather than an omission: the transcript receipt is the
 * primary feedback, the chip repaints from the canonical stream within a couple
 * of seconds, and a spinner would be a new visual treatment owing its own design
 * round. What the state does add is HONEST COPY, and a screen-reader user gets
 * it from the live region whether or not a pointer is over the chip.
 */
export const Pending: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={`${HOME}/Downloads`}
			onChangeDirectory={() => {}}
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
 * `aria-disabled`, same focusable button - and the sentence in its tooltip and
 * its `aria-describedby` node is the whole story: this backend cannot move a
 * live session, and here is what to do about it. The old sentence ("set when the
 * session starts and cannot be changed afterwards") is gone from every branch,
 * because it became false the moment a backend with the route existed.
 */
export const ReadonlyOlderBackend: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={PROJECT}
			readOnlyReason="This backend cannot move a live session. Start a new chat to use a different folder, or update the backend."
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
 * No directory known for the conversation: the affordance a user lands on when
 * the staged cwd is empty, and the branch that makes an empty cwd recoverable
 * from inside the app rather than a dead end.
 */
export const Unset: Story = {
	render: () => (
		<Frame currentWorkingDirectory="" onChangeDirectory={() => {}} />
	),
};

/**
 * The chip's own detail under the pointer: the full path, which the chip
 * truncates at 28 characters. The state exists on the live surface too, and it
 * matters here because a move is a path-shaped decision - a user confirming
 * `~/src/pro...` needs the rest of it before they click.
 */
export const TruncatedPath: Story = {
	render: () => (
		<Frame
			currentWorkingDirectory={`${HOME}/src/a-project-with-a-long-name`}
			onChangeDirectory={() => {}}
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
