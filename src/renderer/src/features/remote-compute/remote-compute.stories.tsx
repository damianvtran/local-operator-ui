/**
 * Remote compute, in every state a reviewer has to look at.
 *
 * THE COMPONENTS ARE THE SHIPPED ONES: `ChatHeader` is the real header, the device
 * control is `ChatDeviceSlot`, and the Radient group is `RemoteComputePicker` reading
 * `remote_compute.read` over the story bridge. What is invented is the WIRE DATA,
 * whose field names are the API's (`remote-compute-types.ts`) and whose values are
 * not.
 *
 * HOW THE PICKER GETS OPEN, since a story cannot press: the control's own store door
 * (`useChatDeviceStore.requestPicker`), the same one the header's overflow item uses,
 * so a frame that needs the menu on screen asks through that door and gets the real
 * popover through the real path rather than a panel re-created here. Exactly one frame
 * asks (`PaneCwdWithoutRowCwd`); the rest photograph the control at rest.
 *
 * THE STATE EACH STORY IS NAMED FOR IS THE STATE ITS READ ANSWERS: A (flag off) is
 * `{enabled: false}`, B is a signed-out account, and so on. Nothing here fakes a
 * disabled row by passing a prop - if the model's resolver changed, the frames would
 * change with it.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useLayoutEffect } from "react";
import "../../styles/index.css";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { ChatHeader } from "../chat/components/chat-header";
import { ChatDeviceSlot } from "../chat/device/chat-device-slot";
import { useChatDeviceStore } from "../chat/device/chat-device-store";
import { remoteSheetDirectory } from "./remote-compute-model";
import { RemoteComputeSheet } from "./remote-compute-sheet";
import { remoteComputeRead } from "./remote-compute-types";
import { RemoteRunCard } from "./remote-run-card";
import { RemoteRunsDialog } from "./remote-runs-list";

const meta = {
	title: "Chat/Remote compute",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

const SESSION = "8c1d2f4a9b73";
const SELF = "d_9f3ac1e0b7d2aa41";
const PEER = "d_4b2a91c4e0b87f3a";
const RUN_ID = "9f2c1a04e7b3";
/** The path a pane's cwd chip paints, where the canonical row carries no cwd. */
const PANE_CWD = "~/src/hello-world";
const PROMPT = "Fix the failing test in the importer and open a pull request.";

/* ---------------------------------------------------------------- the bridge */

type Answer = { status: number; body: unknown };

/**
 * The capability read, as the picker receives it.
 *
 * ANSWERED FOR ITS OWN OP ONLY: a story's `remote` hook is consulted before the
 * shared bridge, so a function that answered every op would hand the header's teams
 * and sessions reads this family's body - which is how the first version of these
 * stories rendered an error boundary instead of a picker.
 */
const readOnly = (over: Record<string, unknown>) => (request: { op: string }) =>
	request.op === "remote_compute.read" ? read(over) : null;

/** A remote-compute read; `over` is the wire's own shape, never a component prop. */
const read = (over: Record<string, unknown>): Answer => ({
	status: 200,
	body: {
		result: remoteComputeRead({
			enabled: true,
			account: { state: "signed-in", label: "operator@example.com" },
			networks: [{ network_id: "n_4a1c", name: "devmesh", role: "admin" }],
			capacity: [{ tier: "cloud_run", ready: true, detail: {} }],
			pricing: null,
			active: [],
			offered: true,
			...over,
		}),
	},
});

const RUN = {
	id: RUN_ID,
	name: "Fix the failing importer test",
	tier: "cloud_run",
	status: "running",
	started_at: Date.now() - 252_000,
	deadline_at: Date.now() + 6_948_000,
	metered_seconds: 252,
	charged_usd: 0,
	hold_usd: 5.09,
	network_id: null,
};

/**
 * `pending` is a read that has NOT answered: the row's `checking…` state is only
 * photographable while the promise is outstanding, so the bridge is asked for one.
 */
type Reply = Answer | null | Promise<never>;

const installBridge = (remote: (request: { op: string }) => Reply) => {
	const ok = <T,>(result: T): Answer => ({ status: 200, body: { result } });
	const bridge = async (request: { op: string }) => {
		const answered = remote(request);
		if (answered) return answered;
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_available: true,
					features: { peers: 1, session_transfer: 1 },
				});
			case "peers.list":
				return ok({
					self_device_id: SELF,
					peers: [
						{
							device_id: PEER,
							name: "build-box",
							reachable: true,
							session_count: 2,
						},
					],
				});
			case "networks.list":
				return ok({
					self_device_id: SELF,
					networks: [
						{
							network_id: "n_4a1c",
							name: "devmesh",
							epoch: 7,
							trust: "operator",
							members: [
								{
									device_id: SELF,
									name: "operator-mbp",
									role: "admin",
									capabilities: ["list", "view", "prompt", "steer", "stop"],
									active: true,
									suspect: false,
									endpoints: [],
									last_seen_at: 1789400000,
									reachable: true,
									reason: "",
								},
								{
									device_id: PEER,
									name: "build-box",
									role: "drive",
									capabilities: ["list", "view", "prompt", "steer", "stop"],
									active: true,
									suspect: false,
									endpoints: ["10.88.0.4:4097"],
									last_seen_at: 1789400000,
									reachable: true,
									reason: "",
								},
							],
						},
					],
				});
			case "teams.list":
				return ok({ teams: [] });
			case "commands.entities":
				return ok({ command: "", entities: [], current: null });
			case "sessions.list":
			case "sessions.command":
				return ok({ sessions: [] });
			/*
			 * THE ARTIFACT ROUTES ARE 404 ON PURPOSE: that is the state v1 ships in (the
			 * two routes land later), so the run card's Logs/Results controls must NOT be
			 * drawn in these frames. A story that answered them would photograph a
			 * capability this release does not have.
			 */
			case "remote_compute.logs":
			case "remote_compute.results":
				return { status: 404, body: { detail: "not found" } };
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (r: { op: string }) => Promise<Answer>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

/** The pane the control is composed for, with a prompt in its composer. */
const seed = () => {
	useCanonicalSessionsStore.setState({
		drafts: {},
		cwd: "~/src/importer",
		sessions: [],
	});
	useConversationInputStore.setState({
		inputByConversation: {
			[SESSION]: {
				currentInput: PROMPT,
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
			},
		},
	});
	useChatDeviceStore.setState({ moves: {}, pickerRequests: {} });
};

const Band = ({
	width = 1080,
	children,
}: { width?: number; children: ReactNode }) => (
	<div className="flex shrink-0 flex-col bg-canvas" style={{ width }}>
		{children}
	</div>
);

/** The header, with its picker OPEN when a frame asks for it, through the door above. */
const Pickers = ({
	remote,
	width = 1080,
	paneCwd,
	row,
	open = false,
}: {
	remote: Parameters<typeof installBridge>[0];
	width?: number;
	/** The directory this pane's cwd chip paints, as the chat page hands it down. */
	paneCwd?: string;
	/**
	 * A canonical row for the pane. `cwd` ABSENT is the interesting case, not a
	 * shorthand: that is what a conversation another client of the daemon created
	 * carries, and the reason the sheet reads the pane before the row (Q-2).
	 */
	row?: { session_id: string; title: string; cwd?: string };
	/** Asks the control's own door to open the picker on this frame's first paint. */
	open?: boolean;
}) => {
	useLayoutEffect(() => {
		/*
		 * THE TOKEN THE CONTROL WILL HAVE SEEDED ITSELF WITH. `ChatHeaderDevice` compares
		 * a request against the value the store held when IT mounted - which is this
		 * effect's `now`, since a child mounts before its parent's layout effect - and
		 * opens only on a DIFFERENT number. `seed()` clears the counter, so the request
		 * below has to be checked against that pre-seed value rather than assumed new: a
		 * frame re-mounted over one that already asked at 1 would otherwise be served the
		 * same 1 and stay shut.
		 */
		const served = useChatDeviceStore.getState().pickerRequests[SESSION];
		installBridge(remote);
		seed();
		if (row) useCanonicalSessionsStore.setState({ sessions: [row] });
		if (open) {
			const request = useChatDeviceStore.getState().requestPicker;
			request(SESSION);
			if (useChatDeviceStore.getState().pickerRequests[SESSION] === served) {
				request(SESSION);
			}
		}
	}, [remote, row, open]);
	return (
		<div className="flex flex-col bg-canvas">
			<Band width={width}>
				<ChatHeader
					agentName="local-operator-ui"
					identity={{
						sessionId: SESSION,
						activeAgent: "lopdev",
						activeTeam: "manager",
						boundAgent: null,
						boundTeam: null,
					}}
					onOpenOptions={() => undefined}
					onToggleBrowser={() => undefined}
					onOpenConsole={() => undefined}
					deviceSlot={<ChatDeviceSlot sessionId={SESSION} paneCwd={paneCwd} />}
				/>
			</Band>
		</div>
	);
};

/* ------------------------------------------------------- the picker's states */

/** A: the family is off. The group does not exist; the picker is today's. */
export const RowFlagOff: Story = {
	render: () => <Pickers remote={readOnly({ enabled: false })} />,
};

/** B: enabled, not signed in. The row is an on-ramp, not an error. */
export const RowSignedOut: Story = {
	render: () => (
		<Pickers
			remote={readOnly({ account: { state: "signed-out", label: "" } })}
		/>
	),
};

/** C: ready, no run live. */
export const RowReady: Story = {
	render: () => <Pickers remote={readOnly({})} />,
};

/** D: a run in flight. The aggregate is on the row. */
export const RowRunning: Story = {
	render: () => <Pickers remote={readOnly({ active: [RUN] })} />,
};

/** E: capacity cannot be provisioned. Not "offline" - nothing went away. */
export const RowCapacity: Story = {
	render: () => (
		<Pickers
			remote={readOnly({ capacity: [{ tier: "cloud_run", ready: false }] })}
		/>
	),
};

/** F: no network to bind a run to. */
export const RowNeedsNetwork: Story = {
	render: () => <Pickers remote={readOnly({ networks: [] })} />,
};

/** G: the deployment does not offer the family. The group stays, disabled. */
export const RowNotOffered: Story = {
	render: () => <Pickers remote={readOnly({ offered: false, capacity: [] })} />,
};

/**
 * THE PANE Q-2 WAS ABOUT: its canonical row carries NO `cwd`, and its cwd chip paints
 * a path.
 *
 * The row is what a conversation created by another client of the daemon looks like,
 * and this is the pair the old row-first read got wrong. This frame mounts the REAL
 * slot for it - the control must draw, and a row read is the first thing that could
 * fall over on a row with no `cwd`.
 *
 * WHAT IT CANNOT SHOW IS THE SHEET'S DIRECTORY: the sheet is a second level that a
 * press on the picker row opens, and this frame stops at the menu - which `open`
 * genuinely puts on screen, where the first cut of this file photographed the closed
 * chip and said the menu was open. `SheetPaneCwdWithoutRowCwd` photographs the
 * directory the same resolver gives this pair by mounting that second level directly,
 * and the call site is pinned as source by `scripts/chat-device-model.test.mjs`.
 */
export const PaneCwdWithoutRowCwd: Story = {
	render: () => (
		<Pickers
			remote={readOnly({})}
			paneCwd={PANE_CWD}
			row={{ session_id: SESSION, title: "hello world" }}
			open
		/>
	),
};

/** The read is still in flight: the row says so rather than guessing. */
export const RowChecking: Story = {
	render: () => (
		<Pickers
			remote={(request) =>
				request.op === "remote_compute.read" ? new Promise(() => {}) : null
			}
		/>
	),
};

/**
 * The read the sheet needs, and a start the route refuses.
 *
 * `insufficient_credits` rather than `run_limit` because its remedy is a BUTTON
 * (`Add credits`): the layout finding is about a remedy that sat off screen, and a
 * countdown-only remedy would show less of the thing that was missing.
 */
const refuseStart =
	(over: Record<string, unknown> = {}): Parameters<typeof installBridge>[0] =>
	(request) => {
		if (request.op === "remote_compute.read") return read(over);
		if (request.op === "remote_compute.start")
			return {
				status: 402,
				body: {
					error: {
						code: "insufficient_credits",
						message:
							"This account has no credit left for another run. Add credits, then start this run again.",
					},
				},
			};
		return null;
	};

/* ------------------------------------------------------------------ the sheet */

const Sheet = ({
	remote,
	prompt = PROMPT,
	directory = "~/src/importer",
}: {
	remote: Parameters<typeof installBridge>[0];
	/** The composer's text: empty is a state the sheet must answer for. */
	prompt?: string;
	/** The directory the run would start in; a slide of the pane's own value. */
	directory?: string;
}) => {
	useLayoutEffect(() => {
		installBridge(remote);
	}, [remote]);
	const value = remote({ op: "remote_compute.read" });
	const parsed = remoteComputeRead(
		value !== null && !(value instanceof Promise)
			? (value.body as { result?: unknown }).result
			: undefined,
	);
	return (
		<div className="flex min-h-[34rem] items-center justify-center bg-canvas p-8">
			<RemoteComputeSheet
				open
				onOpenChange={() => undefined}
				read={parsed}
				prompt={prompt}
				directory={directory}
				onSubmitted={() => undefined}
				onViewRuns={() => undefined}
			/>
		</div>
	);
};

/** The sheet with one network: the line is a statement, and Cloud run is live. */
export const SheetReady: Story = {
	render: () => <Sheet remote={readOnly({})} />,
};

/**
 * A CANONICAL ROW WITH NO CWD, AND A PANE THAT KNOWS THREE: Q-2's frame.
 *
 * The row's `cwd` is written only by this app's own `createSession`, so a
 * conversation another client of the daemon created carries none. The sheet's
 * directory is the pane's own value with the row behind it, so this frame paints the
 * chip's path and leaves the primary enabled - where the row-first read stood the
 * sheet down with "this conversation has no directory yet" a few pixels under a chip
 * that printed the path.
 *
 * THE PATH COMES FROM THE RESOLVER, not from a literal: a story that typed the
 * directory in would photograph a value the app never computes, and would keep
 * showing it after the resolver changed. The call site itself is pinned by
 * `scripts/chat-device-model.test.mjs`'s source anchor, because this frame mounts the
 * sheet directly instead of pressing the picker row that opens it (see
 * `PaneCwdWithoutRowCwd`).
 */
export const SheetPaneCwdWithoutRowCwd: Story = {
	render: () => (
		<Sheet
			remote={readOnly({})}
			directory={remoteSheetDirectory({ paneCwd: PANE_CWD, rowCwd: undefined })}
		/>
	),
};

/** Two networks and no default: the tiers stand down until one is chosen. */
export const SheetAmbiguousNetwork: Story = {
	render: () => (
		<Sheet
			remote={readOnly({
				networks: [
					{ network_id: "n_4a1c", name: "devmesh", role: "admin" },
					{ network_id: "n_91cc", name: "homelab", role: "read" },
				],
			})}
		/>
	),
};

/** An empty composer: the submit stands down with its own reason. */
export const SheetNoPrompt: Story = {
	render: () => <Sheet remote={readOnly({})} prompt="" />,
};

/**
 * A pressed `Start run` that the route refused.
 *
 * THE PRESS IS REAL AND THE SENTENCE IS THE STORY'S. The bridge answers
 * `remote_compute.start` with this family's own refusal envelope - a non-2xx body
 * carrying `error.code` and `error.message` - so `remoteCall` raises the
 * `RemoteRefusal` the sheet paints. The money and the sentence are invented (a live
 * daemon's codes and wording are QA's rig); what the frame answers is the LAYOUT
 * question agent review round 3's MAJOR-1 raised: whether the refusal and the remedy
 * that goes with it are on screen after the press, at the sizes where the body
 * scrolls, without scrolling to them.
 */
export const SheetRefused: Story = {
	render: () => <Sheet remote={refuseStart()} />,
};

/* ------------------------------------------------------------------ the card */

const Card = ({ remote }: { remote: Parameters<typeof installBridge>[0] }) => {
	useLayoutEffect(() => {
		installBridge(remote);
	}, [remote]);
	return (
		<div className="bg-canvas p-6" style={{ width: 560 }}>
			<RemoteRunCard
				runId={RUN_ID}
				networkName={() => "devmesh"}
				onForgotten={() => undefined}
			/>
		</div>
	);
};

const runAnswer =
	(over: Record<string, unknown>): Parameters<typeof installBridge>[0] =>
	(request) =>
		request.op === "remote_compute.run"
			? { status: 200, body: { result: { run: { ...RUN, ...over } } } }
			: request.op === "remote_compute.read"
				? read({
						networks: [
							{ network_id: "n_4a1c", name: "devmesh", role: "admin" },
						],
					})
				: null;

/** A run that is spending: held amount, elapsed from the server's start. */
export const CardRunning: Story = {
	render: () => <Card remote={runAnswer({ status: "running" })} />,
};

/** Settled with its charge, and the controls that a settled run offers. */
export const CardFinished: Story = {
	render: () => (
		<Card
			remote={runAnswer({
				status: "succeeded",
				started_at: Date.now() - 3_600_000,
				metered_seconds: 511,
				charged_usd: 0.62,
				hold_usd: 5.09,
				network_id: "n_4a1c",
			})}
		/>
	),
};

/** A run the provider reports as failed. */
export const CardFailed: Story = {
	render: () => (
		<Card
			remote={runAnswer({
				status: "failed",
				started_at: Date.now() - 600_000,
				charged_usd: 0.11,
				hold_usd: null,
			})}
		/>
	),
};

/* ------------------------------------------------------------------ the list */

const List = ({
	remote,
	open = true,
}: {
	remote: Parameters<typeof installBridge>[0];
	open?: boolean;
}) => {
	useLayoutEffect(() => {
		installBridge(remote);
	}, [remote]);
	return (
		<div className="flex min-h-[30rem] items-center justify-center bg-canvas p-8">
			<RemoteRunsDialog
				open={open}
				onOpenChange={() => undefined}
				enabled
				networkName={() => "devmesh"}
			/>
		</div>
	);
};

const runsList =
	(runs: unknown[], server: string): Parameters<typeof installBridge>[0] =>
	(request) =>
		request.op === "remote_compute.runs"
			? { status: 200, body: { result: { runs, server } } }
			: null;

/** Three runs, two of them still spending. */
export const RunsPopulated: Story = {
	render: () => (
		<List
			remote={runsList(
				[
					{ ...RUN, network_id: "n_4a1c" },
					{
						...RUN,
						id: "aa12bc77f001",
						name: "Rewrite the parser tests",
						status: "queued",
						started_at: Date.now() - 40_000,
					},
					{
						...RUN,
						id: "cc90de11a2b4",
						name: "Lint the docs tree",
						status: "succeeded",
						charged_usd: 0.34,
						hold_usd: null,
						metered_seconds: 210,
					},
				],
				"ok",
			)}
		/>
	),
};

/** Signed out: these are this device's record, and the banner says so. */
export const RunsRecordOnly: Story = {
	render: () => (
		<List remote={runsList([{ ...RUN, status: "succeeded" }], "signed-out")} />
	),
};

/** Nothing has been run yet. */
export const RunsEmpty: Story = {
	render: () => <List remote={runsList([], "ok")} />,
};
