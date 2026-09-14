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
 * The states that are here, and what each one is for:
 *
 *   - `Idle` - the resting picker: one editable chip, no result. This is the
 *     state a bare `/move` opens in.
 *   - `Unavailable` - a backend without `session_move`: the chooser is mounted
 *     read-only with the reason, and the dialog's description says the same
 *     thing. A picker whose every commit would 404 is the control the negotiation
 *     exists to avoid offering.
 *
 * TWO STATES THAT ARE STORIES BUT NOT SWEPT FRAMES, and the reason is a
 * measurement rather than a preference: the in-flight picker (`Busy` - the footer
 * saying `Moving this session…`) and the refusal (`Refused` - the backend's own
 * sentence in the strip) both need the chip's directory menu to be chosen from,
 * and a `play` cannot drive that menu in a BUILT preview. The trigger is a Radix
 * `DropdownMenu` inside a modal `Dialog`, and in the built preview the dialog
 * takes focus back after `trigger.focus()` - the menu never opens, the play
 * throws, and the rig photographs the RESTING state under the name `refused`
 * regardless (all three attempts - `userEvent.click`, a bare
 * `fireEvent.pointerDown`, and a keyboard-driven `ArrowDown` with the focus
 * asserted - produced a frame byte-identical to `idle`). Both are therefore
 * hand-drivable in Storybook and deliberately absent from the swept set, because
 * a frame that silently shows the resting state under a refusal's name is worse
 * than no frame at all; `docs/evidence/chat-move-picker/README.md` records what
 * reaching them takes, with the readback a real interaction produced, and
 * `scripts/move-session.test.mjs` pins the refusal sentence itself.
 *
 * The success state is deliberately absent for a different reason: a successful
 * move closes this dialog (the receipt goes to the transcript), so a still frame
 * of "success" would be a picture of a closed dialog.
 */

import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "@storybook/test";
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
 * The page, which is what these plays must query.
 *
 * `screen` is NOT it: Testing Library's `screen` resolves to the canvas element
 * Storybook hands a play, and Radix renders a menu's rows into a PORTAL on
 * `document.body` - outside that canvas. A `screen.findByRole("menuitem")`
 * therefore never matches, the play throws, and the story is photographed in its
 * untouched resting state while the file claims to show something else (measured:
 * `Unable to find role="menuitem"`). `within(document.body)` is the query scope
 * that includes the portal, and it is what the removed menu-driven plays needed
 * too - see the file docstring for why they are gone.
 */
const page = () => within(document.body);

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
 * A directory chosen, the move unanswered: the footer names what is happening to
 * the SESSION ("Moving this session…", not "Waiting for the backend…") and the
 * chip is already painting the directory that was chosen while nothing has
 * confirmed it.
 *
 * REACH IT BY HAND, not by a play. Click the chip, choose `~/Downloads`, and the
 * transport never answers - so the state stays up for as long as you look at it.
 * A play cannot do that here: the menu is a Radix `DropdownMenu` inside this
 * modal `Dialog`, and in a BUILT preview the dialog re-takes focus so the menu
 * never opens, which makes a `play` photograph the RESTING state under this
 * story's name (measured three ways - see the file docstring). It is therefore
 * not in the swept set, and `docs/evidence/chat-move-picker/README.md` carries
 * the readback a real interaction produced.
 */
export const Busy: Story = {
	render: () => <Frame bridge={moveBridge(true, () => pending())} />,
};

/**
 * The refusal a user actually meets: a session that is mid-turn. The sentence is
 * the BACKEND's, quoted rather than re-worded, and the dialog stays open so the
 * next directory is one click away instead of a re-typed command.
 *
 * REACH IT BY HAND, the same way as `Busy`: click the chip and choose a
 * directory. (With the mock transport it needs a refusal - a real backend that
 * is mid-turn refuses on its own, which is what `scripts/move-session.test.mjs`
 * pins and what QA exercises live.) Not in the swept set, for the reason above.
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
				page().getAllByText(/This backend cannot move a live session/).length,
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
