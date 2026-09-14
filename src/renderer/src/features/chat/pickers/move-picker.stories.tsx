/**
 * `/move` - the desktop destination that moves a live session's directory.
 *
 * Why this file exists. The picker's own states are the ones a reviewer needs to
 * see but cannot reach on demand: a backend that answers in 40 ms (so the strip
 * is never caught), a session mid-turn (the refusal), and a backend that does
 * not carry the route at all (the degradation path, which needs an OLD backend
 * installed underneath the app). So the story drives the PRODUCTION `MovePicker`
 * with the desktop transport stubbed, which is the only part that cannot exist
 * in a browser: `window.api.desktop.request`.
 *
 * What that buys, and its limits. Everything under test is real - the picker, the
 * composer's own `DirectoryIndicator` hosted inside it, the chip's commit path,
 * `runMoveSession`, the copy table, `PickerHost`'s footer and result strip. The
 * stub answers `capabilities` (the negotiation that decides whether the chooser
 * is editable at all) and `sessions.move`. Two consequences stated rather than
 * hidden: the canonical session frame is a fixture (`frontend.cwd`, and an empty
 * transcript, so no frame claims an eval clause it did not earn), and the LOOSE
 * `~` spelling in a receipt is the fixture's own, since only a real backend
 * knows how to spell the home directory of the machine it runs on.
 *
 * The states, and what each one is for:
 *
 *   - `Idle` - the resting picker: one editable chip, no result. This is the
 *     state a bare `/move` opens in.
 *   - `Busy` - a directory has been chosen and the move has not answered: the
 *     footer names the CHANGE ("Moving this session…") and the chip carries its
 *     pending copy. The transport never resolves, which is the only way to hold
 *     this state still for a camera.
 *   - `Refused` - the backend refused (a mid-turn session is the case a user hits
 *     most), so the dialog STAYS OPEN with the backend's own sentence in the
 *     strip and the chip still showing what the session actually works in.
 *   - `Unavailable` - a backend without `session_move`: the chooser is mounted
 *     read-only with the reason, and the strip says the same thing. A picker
 *     whose every commit would 404 is the control the negotiation exists to
 *     avoid offering.
 *
 * The success state is deliberately NOT here: a successful move closes this
 * dialog (the receipt goes to the transcript, which is where the live-app pair
 * on the PR photographs it), so a still frame of "success" would be a picture of
 * a closed dialog.
 */

import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import type { FC } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { NativeDesktopAction } from "../../../../../shared/desktop-control-contract";
import type { SlashCommandMeta } from "../components/slash-commands";
import { MovePicker, type PickerContext } from "./destination-pickers";

const noop = () => {};

const MOVE_SPEC: SlashCommandMeta = {
	name: "move",
	description: "Move this session to another working directory",
	aliases: [],
	arguments: "optional",
	echo: false,
	consumes_prompt: false,
	destination: "session.move",
	execution: "native",
};

/**
 * The presentation request the backend answers a bare `/move` with.
 *
 * `fields: []` and `data: {}` are the real shape: a native action REQUESTS
 * presentation and claims nothing ran, which is why the destination is answered
 * by the renderer's own table rather than by the command endpoint.
 */
const MOVE_ACTION: NativeDesktopAction = {
	kind: "native_action",
	destination: "session.move",
	session_id: "sess",
	args: "",
	fields: [],
	data: {},
};

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string; live?: boolean };

const ok = <T,>(result: T): DesktopResponse => ({
	status: 200,
	body: { result },
});

const refuse = (status: number, detail: string): DesktopResponse => ({
	status,
	body: { detail },
});

/** A promise that never settles: the frame IS the state while it is pending. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => {});

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

/** Install the transport a story needs. Called from `render`, before mount. */
const installBridge = (
	next: (request: BridgeRequest) => Promise<DesktopResponse>,
) => {
	bridge = next;
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: Record<string, unknown> & {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: (request: BridgeRequest) =>
			bridge
				? bridge(request)
				: Promise.reject(new Error("no bridge installed for this story")),
	};
	// The chip's own Electron calls. The home is a story-only value so a frame
	// cannot be mistaken for a capture of the operator's real paths, and
	// `directoryExists` answers "yes" because the chip commits before it
	// validates - a refusal frame is about the BACKEND's answer, not about a path
	// this harness happens to have on disk.
	api.getHomeDirectory = async () => "/Users/you";
	api.directoryExists = async () => true;
	api.selectDirectory = async () => null;
}

/** The session the picker addresses, as the canonical stream would report it. */
const CURRENT = "/Users/you/src/project";

/**
 * The capability answer, with or without the move route.
 *
 * `desktop_available` is true in both: what the stories vary is `session_move`,
 * because that one key is the whole difference between an editable chooser and
 * the read-only degradation path.
 */
const capabilities = (sessionMove: boolean): DesktopResponse =>
	ok({
		desktop_available: true,
		features: { commands: 1, session_move: sessionMove ? 1 : undefined },
	});

/** A bridge that answers capabilities and the move, and nothing else. */
const moveBridge =
	(
		sessionMove: boolean,
		move: (r: BridgeRequest) => Promise<DesktopResponse>,
	) =>
	(request: BridgeRequest): Promise<DesktopResponse> => {
		if (request.op === "capabilities")
			return Promise.resolve(capabilities(sessionMove));
		if (request.op === "sessions.move") return move(request);
		return Promise.resolve(refuse(400, `unexpected ${request.op}`));
	};

/* ------------------------------------------------------------- harness */

type FrameProps = {
	bridge: (request: BridgeRequest) => Promise<DesktopResponse>;
	/** The directory the session currently works in. */
	cwd?: string;
};

/**
 * One frame: installs the transport, then renders the PRODUCTION `MovePicker`.
 *
 * `PickerContext` carries nine fields and this adapter reads four
 * (`sessionId`, `canonical`, `note`, `onClose`); the rest are the dispatcher's,
 * so they are filled with no-ops rather than pretended into meaningful values.
 */
const Frame: FC<FrameProps> = ({ bridge: storyBridge, cwd = CURRENT }) => {
	installBridge(storyBridge);
	const ctx: PickerContext = {
		action: MOVE_ACTION,
		spec: MOVE_SPEC,
		sessionId: "sess",
		canonical: {
			frontend: { cwd },
			// Empty on purpose: the eval clause is earned by an `eval` tool row, and
			// no frame in this file should claim one it did not receive.
			transcript: { records: [] },
			addNote: noop,
		} as unknown as CanonicalSessionHandle,
		commands: [MOVE_SPEC],
		onClose: noop,
		note: noop,
		dispatch: noop,
		rebind: noop,
	};
	return <MovePicker {...ctx} />;
};

/**
 * Choose a directory the way a user does: the chip's own menu, then a row.
 *
 * The chip inside the picker is the composer's control, so this is the same
 * three-step path a live user takes - and it is what makes the pending and
 * refusal frames real rather than posed. The row is a DEFAULT directory
 * (`~/Downloads`), which exists on every machine this app ships to; typing a
 * custom path would exercise the same commit with more keystrokes and more to go
 * wrong in a play.
 */
const chooseDownloads = async () => {
	await userEvent.click(
		await screen.findByRole("button", { name: /^Working directory:/ }),
	);
	await userEvent.click(
		await screen.findByRole("menuitem", { name: /~\/Downloads/ }),
	);
};

const meta: Meta<typeof MovePicker> = {
	title: "chat-move-picker",
	component: MovePicker,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof MovePicker>;

/* ------------------------------------------------------------- states */

/** The resting picker: one editable chip, no result, nothing in flight. */
export const Idle: Story = {
	render: () => <Frame bridge={moveBridge(true, () => pending())} />,
};

/**
 * A directory chosen, the move unanswered.
 *
 * The transport never settles, so the frame holds the state a fast backend hides:
 * the footer says what is happening to the SESSION ("Moving this session…", not
 * "Waiting for the backend…"), and the chip is already painting the directory the
 * user chose while nothing has confirmed it.
 */
export const Busy: Story = {
	render: () => <Frame bridge={moveBridge(true, () => pending())} />,
	play: async () => {
		await chooseDownloads();
		await waitFor(() =>
			expect(screen.getByText(/Moving this session/)).toBeTruthy(),
		);
		// The chip is showing what was CHOSEN, and its own commit has already
		// recorded it as a recent directory.
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /~\/Downloads/ })).toBeTruthy(),
		);
	},
};

/**
 * The refusal a user actually meets: a session that is mid-turn.
 *
 * Two things this frame is evidence of. The sentence is the BACKEND's, quoted
 * rather than re-worded ("this session is working right now — /move again when
 * the turn finishes"), and the dialog stays open so the next directory is one
 * click away instead of a re-typed command.
 */
export const Refused: Story = {
	render: () => (
		<Frame
			bridge={moveBridge(true, () =>
				Promise.resolve(
					refuse(
						409,
						"this session is working right now — /move again when the turn finishes",
					),
				),
			)}
		/>
	),
	play: async () => {
		await chooseDownloads();
		await waitFor(() =>
			expect(
				screen.getByText(
					/this session is working right now — \/move again when the turn finishes/,
				),
			).toBeTruthy(),
		);
	},
};

/**
 * A backend without the route: the degradation path, in full.
 *
 * The chooser is mounted READ-ONLY - the same read-only chip the composer renders
 * - with the reason as its tooltip and its description, and the dialog's own
 * description states the same thing. Nothing here fires a request, which is what
 * the capability key is for: `sessions.move` is never sent to a backend that
 * cannot answer it.
 */
export const Unavailable: Story = {
	render: () => <Frame bridge={moveBridge(false, () => pending())} />,
	play: async () => {
		await waitFor(() =>
			expect(
				screen.getAllByText(/This backend cannot move a live session/).length,
			).toBeGreaterThan(0),
		);
		// And the chooser is INERT rather than merely explained: the chip is the
		// read-only branch, which has no menu to open at all.
		await expect(
			document.querySelector('[data-lo-cwd-chip="readonly"]'),
		).not.toBeNull();
		expect(document.querySelector('[data-lo-cwd-chip="editable"]')).toBeNull();
	},
};
