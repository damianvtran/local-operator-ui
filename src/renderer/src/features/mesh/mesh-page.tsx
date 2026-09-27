/**
 * The Mesh tab: what shape is this device's mesh, and which device holds what.
 *
 * TWO PRESENTATIONS OF ONE READ, always one click apart (`Canvas | List` in the tab
 * header), because neither answers the other's question: the canvas shows shape and
 * finds the odd one out, and the list sorts, and works when there is nothing to
 * connect at all. The empty state says so rather than guessing at the reader's
 * intent.
 *
 * THE FOUR STATES, and what each one is allowed to claim:
 *
 *   - `loading` - no answer yet. A skeleton, not a spinner over a blank world: the
 *     tab has a known shape and the frame should not move when the data lands.
 *   - `ready` - a topology to draw. The LAST GOOD READ STAYS PAINTED while a new one
 *     is in flight, and a failed poll does NOT turn facts into zeros: "unreachable"
 *     and "unknown" are different claims, so a failure adds a sentence above the
 *     canvas and changes no node.
 *   - `empty` - the backend answered, and this device is in no network at all. This
 *     is the state a fresh install is met with, so it carries the action that fixes
 *     it rather than a shrug. The action is a COMMAND, not a button: creating a
 *     network is a two-sided admission on the backend, and this slice ships no
 *     create (an `Invite`/`Create` control here would be a control that 404s).
 *   - `error` - a read failed and there is nothing behind it. The backend's own
 *     sentence, verbatim, plus a retry.
 *
 * WHAT SLICE 2 ADDS, and where each piece lives: the canvas became interactive (pan
 * and zoom shipped in slice 1; the drag, the drop verdicts and the ghost are new -
 * `mesh-canvas.tsx`, `mesh-drop.ts`, `mesh-drag.ts`), a device's detail moved into a
 * panel (`mesh-card.tsx`), the conversations each device holds are drawn as chips
 * (`mesh-node.tsx`, `mesh-sessions.ts`), and the four writes behind this tab's
 * actions are dialogs whose consequences they state (`mesh-actions.tsx`).
 *
 * ONE THING THIS PAGE DECIDES, stated here because everything else follows from it:
 * **a drop is a REQUEST, and the panel is where it is confirmed.** The canvas never
 * sends anything: it resolves what the drop means and hands the plan up, and this
 * page asks. That is what makes every drag outcome reachable from the keyboard too -
 * the same plan is what the panel's menu produces.
 */

import {
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { PageHeader } from "@shared/components/common/page-header";
import { Alert, Button, Skeleton } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Network } from "lucide-react";
import { type FC, useCallback, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
	InviteDialog,
	MoveConfirmDialog,
	MoveNotice,
	RemoveMemberDialog,
} from "./mesh-actions";
import { MeshCanvas } from "./mesh-canvas";
import {
	DevicePanel,
	type MoveDestination,
	destinationsOnCanvas,
} from "./mesh-card";
import { type MovePlan, type Remedy, resolveDrop } from "./mesh-drop";
import type { MeshGraph } from "./mesh-graph";
import { meshSummary } from "./mesh-graph";
import { MeshList } from "./mesh-list";
import { deviceSessionTotal } from "./mesh-sessions";
import {
	type MeshReads,
	type MeshViewState,
	type MoveAsk,
	meshErrorMessage,
	meshReadState,
	useMeshGraph,
	useMeshNetworks,
	useMeshPeers,
	useMeshSessions,
	useMeshSessionsByDevice,
	useMeshSlots,
	useMeshTransfer,
	useNetworkInvite,
	useNetworkMemberRemove,
} from "./mesh-store";
import type { MeshRefusal, MeshSessionRow } from "./mesh-types";

const PRESENTATIONS = ["canvas", "list"] as const;
type Presentation = (typeof PRESENTATIONS)[number];

const PRESENTATION_LABEL: Record<Presentation, string> = {
	canvas: "Canvas",
	list: "List",
};

/** What a drop or a menu choice resolved to, held while the dialog asks. */
type PendingMove = {
	plan: MovePlan;
	alternatives: MovePlan[];
	risky: boolean;
};

/** What the last move answered, for the notice under the header. */
type MoveReport =
	| { kind: "moved"; verb: string; detail: string; undo: MovePlan | null }
	| { kind: "refused"; refusal: MeshRefusal };

/**
 * The tab's body, with everything it renders handed to it.
 *
 * A PRESENTATIONAL SPLIT, so the state matrix can be photographed from fixtures
 * (`mesh-page.stories.tsx`, captured into the evidence set) without a backend or a
 * second machine: the states a mesh tab is met with - no network, one device, two
 * devices, an unreachable peer, a failed read - are all fixtures, and a story that
 * could only be driven through a live mesh would leave the interesting ones
 * unphotographed.
 *
 * THE WRITES AND THEIR OUTCOMES ARE PROPS TOO, for the same reason: a story has to be
 * able to photograph the `busy` refusal without a session that is busy, and the
 * frames that matter most here are the ones that are hardest to reach live - a
 * refusal, an unconfirmed move, a copy's receipt.
 */
export const MeshSurface: FC<{
	state: MeshViewState;
	graph: MeshGraph | null;
	nowSeconds: number;
	/** A read is in flight over drawn data: the quiet header affordance. */
	checking: boolean;
	/** A poll failed over drawn data: a sentence, never a change to the nodes. */
	staleError: string | null;
	onRetry: () => void;
	/** The conversations the reads returned, and what each device holds. */
	sessions: readonly MeshSessionRow[];
	/** A failure of the sessions read alone: the graph still draws without chips. */
	sessionError: string | null;
	/** The reader's own device label, for "this device" in sentences. */
	selfLabel: string;
	/** The session whose move is in flight, from the mutation's own variables. */
	movingSessionId: string | null;
	/** `features.session_transfer`: whether a move may be offered at all. */
	canMove: boolean;
	/** Rolling state of the move dialog, when one is open. */
	pendingMove: PendingMove | null;
	onAskMove: (ask: PendingMove) => void;
	onDropRefused: (refusal: {
		code: string;
		sentence: string;
		remedy: Remedy | null;
	}) => void;
	onChooseMove: (plan: MovePlan) => void;
	onCancelMove: () => void;
	moveBusy: boolean;
	moveReport: MoveReport | null;
	onDismissReport: () => void;
	onWaitForIdle: () => void;
	onUndoCopy: () => void;
	/** The invite dialog's own state. */
	invite: {
		open: boolean;
		deviceId?: string;
		deviceLabel: string | null;
		options: { id: string; label: string }[];
	} | null;
	onOpenInvite: (ask: {
		deviceId?: string;
		deviceLabel: string | null;
	}) => void;
	onInvite: (ask: {
		networkId: string;
		role: "read" | "drive" | "admin";
	}) => void;
	onCloseInvite: () => void;
	inviteBusy: boolean;
	inviteReceipt: { token_path: string; expires_at: number | null } | null;
	inviteRefusal: MeshRefusal | null;
	/** The member-removal dialog's own state. */
	remove: {
		open: boolean;
		networkId: string;
		networkLabel: string;
		deviceId: string;
		deviceLabel: string;
	} | null;
	onOpenRemove: (ask: {
		networkId: string;
		networkLabel: string;
		deviceId: string;
		deviceLabel: string;
	}) => void;
	onRemove: (confirm: string) => void;
	onCloseRemove: () => void;
	removeBusy: boolean;
	removeRefusal: MeshRefusal | null;
	removed: { removed: string; epoch: number } | null;
}> = ({
	state,
	graph,
	nowSeconds,
	checking,
	staleError,
	onRetry,
	sessions,
	sessionError,
	selfLabel,
	movingSessionId,
	canMove,
	pendingMove,
	onAskMove,
	onDropRefused,
	onChooseMove,
	onCancelMove,
	moveBusy,
	moveReport,
	onDismissReport,
	onWaitForIdle,
	onUndoCopy,
	invite,
	onOpenInvite,
	onInvite,
	onCloseInvite,
	inviteBusy,
	inviteReceipt,
	inviteRefusal,
	remove,
	onOpenRemove,
	onRemove,
	onCloseRemove,
	removeBusy,
	removeRefusal,
	removed,
}) => {
	const [presentation, setPresentation] = useState<Presentation>("canvas");
	const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

	const summary = graph ? meshSummary(graph) : "";
	const summaryId = "mesh-summary";
	/*
	 * THE PINNED SLOT ASSIGNMENT, from the store's assign-once rule: this is what makes
	 * a poll unable to move a node, and the canvas reads the geometry rather than
	 * deciding it (`mesh-positions.ts`).
	 */
	const slots = useMeshSlots(graph);

	const held = useMeshSessionsByDevice(
		graph,
		sessions,
		graph?.selfDeviceId ?? null,
	);

	const totals = useMemo(() => {
		const map = new Map<string, number>();
		for (const device of graph?.devices ?? []) {
			const deviceHeld = held.byDevice.get(device.id);
			map.set(
				device.id,
				deviceHeld
					? deviceSessionTotal(deviceHeld, device.sessionCount)
					: (device.sessionCount ?? 0),
			);
		}
		return map;
	}, [graph, held]);

	/*
	 * FROM A NODE TO ITS PANEL, which is the one action a canvas node carries: the
	 * panel is where the numbers, the memberships and the actions are, and the list
	 * stays one click away inside it. Clicking a CHIP opens the same panel, because a
	 * chip's own menu would have to open on pointerdown and would then swallow the
	 * drag that shares its press.
	 */
	const openDevice = useCallback((deviceId: string) => {
		setSelectedDeviceId(deviceId);
	}, []);

	const selectedDevice = graph
		? (graph.devices.find((device) => device.id === selectedDeviceId) ?? null)
		: null;

	/*
	 * EVERY `⋯` MENU AND EVERY DROP RESOLVE THROUGH ONE FUNCTION. A menu choice is a
	 * drop that names its target (`resolveDrop`), so the verbs and the loss sentences
	 * cannot drift between the pointer and the keyboard paths - and the plan the page
	 * confirms is the same object the indicator would have shown.
	 */
	const moveFor = useCallback(
		(session: MeshSessionRow, destination: MoveDestination, keep: boolean) => {
			if (!graph) return null;
			const context = {
				selfDeviceId: graph.selfDeviceId,
				devices: new Map(graph.devices.map((device) => [device.id, device])),
				networks: new Map(
					graph.networks.map((network) => [network.id, network]),
				),
			};
			const ownerDeviceId =
				session.locality === "local"
					? (graph.selfDeviceId ?? "")
					: session.owner_device;
			const owner = context.devices.get(ownerDeviceId);
			const verdict = resolveDrop(
				{
					session,
					ownerDeviceId,
					ownerLabel: owner?.label ?? session.owner_device_name,
				},
				{ kind: "device", deviceId: destination.deviceId },
				context,
			);
			if (verdict.kind === "refused") {
				onDropRefused({
					code: verdict.code,
					sentence: verdict.sentence,
					remedy: verdict.remedy,
				});
				return null;
			}
			if (verdict.kind === "none") return null;
			const chosen = keep
				? (verdict.alternatives.find((option) => option.keep) ?? verdict.plan)
				: verdict.plan;
			const others = [verdict.plan, ...verdict.alternatives].filter(
				(option) => option.keep !== chosen.keep,
			);
			const ask: PendingMove = {
				plan: chosen,
				alternatives: others,
				risky: verdict.risky,
			};
			onAskMove(ask);
		},
		[graph, onAskMove, onDropRefused],
	);

	return (
		/*
		 * `gap-6`: this page's blocks are component-tier apart, and `PageHeader` no
		 * longer ships its own outer margin (branding § 5's "the container owns the
		 * gap").
		 */
		<div className="flex h-full min-h-0 flex-col gap-6 p-6">
			<PageHeader
				title="Mesh"
				icon={Network}
				subtitle="Devices this app is paired with, and the networks that hold them."
			>
				<div className="flex items-center gap-4">
					{/*
					 * `<output>` IS the semantic element for a status region (it carries
					 * the implicit `role="status"`), so the affordance announces itself as
					 * the refresh it is without a redundant role attribute.
					 */}
					{/*
					 * MOUNTED ONLY WHILE CHECKING (QA round 1, Q-2). This used to stay in the tree
					 * at `opacity-0` when settled, which hides it from the eye and not from a
					 * screen reader: Chrome's own tree still carried `StaticText "checking…"`
					 * with `ignored: false` in every settled state. Unmounting is the honest way
					 * to say "this region is not saying anything right now".
					 */}
					{checking && (
						<output className="text-meta text-ink-dim">checking…</output>
					)}
					{/*
					 * THE PRESENTATION CHOICE IS SHOWN ONLY WHEN THERE IS SOMETHING TO
					 * PRESENT. A control that switches between two views of nothing is a
					 * control that does nothing - and the empty and error states have nothing,
					 * so the header carries the sentence and no toggle (caught in the first
					 * capture, where the virgin frame offered `Canvas | List` over an empty
					 * panel).
					 *
					 * LOADING SHOWS IT DISABLED (design round 1, D3): the control used to appear
					 * only once data landed, so the header's right side changed IDENTITY when the
					 * first read resolved - a 59px dim word became a 120px control whose left
					 * edge appeared 60px further left. Disabled is the same width and the same
					 * place, so landing moves only the content below it.
					 * control that does nothing - and the empty and error states have
					 * nothing, so the header carries the sentence and no toggle (caught in
					 * the first capture, where the virgin frame offered `Canvas | List` over
					 * an empty panel).
					 */}
					{(state.kind === "ready" || state.kind === "loading") && (
						<fieldset className="m-0 w-fit border-0 p-0">
							<legend className="sr-only">Presentation</legend>
							<div className="flex gap-0.5 rounded-md bg-sunken p-0.5">
								{PRESENTATIONS.map((option) => (
									<button
										key={option}
										type="button"
										aria-pressed={presentation === option}
										disabled={state.kind !== "ready"}
										onClick={() => setPresentation(option)}
										className={cn(
											"h-6 rounded-sm px-3 text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart",
											"hover:text-ink",
											"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
											/*
											 * `disabled:` states are explicit rather than inherited: a disabled
											 * control keeps the `ink-dim` weight and loses the hover step, so the
											 * loading header reads as "not yours to press yet" instead of as a
											 * control that ignores the pointer.
											 */
											"disabled:text-ink-dim disabled:hover:text-ink-dim",
											presentation === option && "bg-surface text-ink",
										)}
									>
										{PRESENTATION_LABEL[option]}
									</button>
								))}
							</div>
						</fieldset>
					)}
				</div>
			</PageHeader>

			{state.kind === "loading" && (
				<div className="flex min-h-0 flex-1 flex-col gap-3">
					<Skeleton className="h-4 w-64" />
					<Skeleton className="min-h-40 w-full flex-1" />
				</div>
			)}

			{state.kind === "error" && (
				<Alert variant="warning" className="flex-col items-start gap-2">
					<p>{state.message}</p>
					{/*
					 * `w-fit`: the alert is a flex column, so its child would otherwise stretch
					 * to the alert's whole width - a full-width button for a one-word action,
					 * which is what the first capture of this state showed.
					 */}
					<Button
						variant="secondary"
						size="sm"
						onClick={onRetry}
						className="w-fit"
					>
						Ask again
					</Button>
				</Alert>
			)}

			{state.kind === "empty" && (
				/*
				 * CENTRED IN THE WELL (design round 1, D4). The well is the region the graph
				 * will occupy, so it stays; what changed is that the copy is centred in it
				 * rather than pinned to the top, which is what made a deliberate empty state
				 * read as a stalled render with 554px (77%) of blank panel below it. The
				 * copy and the chip stay a left-aligned block inside the centring, and the
				 * command's `here` is gone (D8): it pointed at nothing in the surface, since
				 * the command is the next line.
				 */
				<div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-hairline bg-surface p-6">
					<div className="flex flex-col items-start gap-3">
						<h2 className="text-heading text-ink">No network on this device</h2>
						<p className="max-w-140 text-body-sm text-ink-muted">
							This device is not in any network, so there is no mesh to draw.
							Create one on this machine:
						</p>
						{/* Machine voice, so monospace (`branding.md` § 8): the reader types
						    this, it is not prose. */}
						<code className="rounded-sm bg-sunken px-2 py-1 font-mono text-meta text-ink">
							lop network init &lt;name&gt;
						</code>
						<p className="text-meta text-ink-dim">
							A network appears here once this device has joined one.
						</p>
					</div>
				</div>
			)}

			{state.kind === "ready" && graph && (
				<div className="flex min-h-0 flex-1 gap-4">
					<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
						<p
							id={summaryId}
							className="text-meta text-ink-muted"
							data-mesh-summary=""
						>
							{summary}
						</p>
						{staleError && (
							<Alert variant="warning">
								<p>{staleError}</p>
							</Alert>
						)}
						{sessionError && (
							/*
							 * A FAILED SESSIONS READ DOES NOT TAKE THE GRAPH DOWN. The topology and
							 * the conversations are two reads with two failure modes, and a tab that
							 * blanked its canvas because the catalogue timed out would be asserting
							 * that there is no mesh - a claim this device never made. The sentence
							 * is the backend's own, and the chips are simply absent.
							 */
							<Alert variant="warning">
								<p>{sessionError}</p>
							</Alert>
						)}
						{moveReport && (
							<MoveNotice
								receipt={
									moveReport.kind === "moved"
										? {
												verb: moveReport.verb,
												detail: moveReport.detail,
												undo: moveReport.undo,
											}
										: null
								}
								refusal={
									moveReport.kind === "refused" ? moveReport.refusal : null
								}
								onWait={onWaitForIdle}
								onRecheck={onRetry}
								onUndo={onUndoCopy}
								onDismiss={onDismissReport}
								pending={moveBusy}
							/>
						)}
						{presentation === "canvas" ? (
							<MeshCanvas
								graph={graph}
								slots={slots}
								nowSeconds={nowSeconds}
								selectedDeviceId={selectedDeviceId}
								sessions={held.byDevice}
								sessionTotals={totals}
								movingSessionId={movingSessionId}
								canMove={canMove}
								onOpenDevice={openDevice}
								onAskMove={onAskMove}
								onDropRefused={onDropRefused}
								onShowAllSessions={openDevice}
								summaryId={summaryId}
							/>
						) : (
							<MeshList
								graph={graph}
								nowSeconds={nowSeconds}
								selectedDeviceId={selectedDeviceId}
								sessions={held.byDevice}
								selfLabel={selfLabel}
								canMove={canMove}
								onSelect={openDevice}
								onMove={moveFor}
								onInvite={onOpenInvite}
								onRemove={onOpenRemove}
							/>
						)}
					</div>
					{selectedDevice && (
						<DevicePanel
							device={selectedDevice}
							sessions={
								held.byDevice.get(selectedDevice.id) ?? {
									rows: [],
									shown: [],
									hidden: 0,
								}
							}
							sessionTotal={totals.get(selectedDevice.id) ?? 0}
							nowSeconds={nowSeconds}
							canMove={canMove}
							canInvite={state.kind === "ready"}
							movingSessionId={movingSessionId}
							destinationsFor={(session) =>
								destinationsOnCanvas(graph, session, selfLabel)
							}
							onClose={() => setSelectedDeviceId(null)}
							onMove={moveFor}
							onInvite={(device) =>
								onOpenInvite({
									deviceId: device.id,
									deviceLabel: device.label,
								})
							}
							onRemoveMember={(device, networkId) => {
								const network = graph.networks.find(
									(network) => network.id === networkId,
								);
								onOpenRemove({
									networkId,
									networkLabel: network?.label ?? networkId,
									deviceId: device.id,
									deviceLabel: device.label,
								});
							}}
							onShowInList={(deviceId) => {
								openDevice(deviceId);
								setPresentation("list");
							}}
						/>
					)}
				</div>
			)}

			<MoveConfirmDialog
				open={pendingMove !== null}
				plan={pendingMove?.plan ?? emptyPlan}
				alternatives={pendingMove?.alternatives ?? []}
				risky={pendingMove?.risky ?? false}
				busy={moveBusy}
				onCancel={onCancelMove}
				onChoose={onChooseMove}
			/>

			{invite && (
				<InviteDialog
					open={invite.open}
					options={invite.options}
					deviceId={invite.deviceId}
					deviceLabel={invite.deviceLabel}
					onClose={onCloseInvite}
					onInvite={onInvite}
					pending={inviteBusy}
					receipt={inviteReceipt}
					refusal={inviteRefusal}
				/>
			)}

			{remove && (
				<RemoveMemberDialog
					open={remove.open}
					networkLabel={remove.networkLabel}
					deviceLabel={remove.deviceLabel}
					onClose={onCloseRemove}
					onConfirm={onRemove}
					pending={removeBusy}
					refusal={removeRefusal}
					removed={removed}
				/>
			)}
		</div>
	);
};

/**
 * A placeholder plan for the dialog's closed state.
 *
 * The dialog is always MOUNTED so its transitions are the dialog's own (Radix runs an
 * exit animation, and a component that unmounted on close would cut it off). Nothing
 * in this shape reaches the wire: while it is closed, no button inside it is
 * reachable.
 */
const emptyPlan: MovePlan = {
	sessionId: "",
	to: "",
	keep: false,
	verb: "",
	waitS: 0,
	lost: null,
};

/**
 * The route: reads, then the surface.
 *
 * THE TRI-STATE GATE IS RE-READ HERE rather than assumed from the route's own mount,
 * because a capability answer can change under a mounted app (a daemon restart, an
 * update that removes the feature). When it closes, the page leaves for `/chat` -
 * the same destination the catch-all gives - rather than drawing a tab for a feature
 * the backend no longer advertises.
 */
export const MeshPage: FC = () => {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureState(capabilities.data, "peers") === "enabled";
	const canMove =
		desktopFeatureState(capabilities.data, "session_transfer") === "enabled";
	const peers = useMeshPeers(enabled);
	const networks = useMeshNetworks(enabled);
	const sessionRead = useMeshSessions(enabled);
	const reads: MeshReads = useMemo(
		() => ({ peers, networks }),
		[peers, networks],
	);
	const state = meshReadState(reads);
	const graph = useMeshGraph(reads);
	const transfer = useMeshTransfer();
	const invite = useNetworkInvite();
	const removeMember = useNetworkMemberRemove();

	const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
	const [moveReport, setMoveReport] = useState<MoveReport | null>(null);
	const [inviteAsk, setInviteAsk] = useState<{
		deviceId?: string;
		deviceLabel: string | null;
	} | null>(null);
	const [inviteReceipt, setInviteReceipt] = useState<{
		token_path: string;
		expires_at: number | null;
	} | null>(null);
	const [inviteRefusal, setInviteRefusal] = useState<MeshRefusal | null>(null);
	const [removeAsk, setRemoveAsk] = useState<{
		networkId: string;
		networkLabel: string;
		deviceId: string;
		deviceLabel: string;
	} | null>(null);
	const [removed, setRemoved] = useState<{
		removed: string;
		epoch: number;
	} | null>(null);

	/*
	 * The stamp the stat lines are computed against: the LAST READ's own time rather
	 * than a live ticker, because 30 s is the cadence the data arrives on and a
	 * "seen 4m ago" that updates every second would claim a precision the backend's
	 * stamps do not have.
	 */
	const nowSeconds = useMemo(() => {
		const stamp = Math.max(peers.dataUpdatedAt, networks.dataUpdatedAt);
		return Math.floor((stamp || Date.now()) / 1000);
	}, [peers.dataUpdatedAt, networks.dataUpdatedAt]);

	const retry = useCallback(() => {
		void peers.refetch();
		void networks.refetch();
		void sessionRead.refetch();
	}, [peers, networks, sessionRead]);

	/*
	 * THE MOVE, AND THE ONE THING IT MUST NOT DO. `run` sends the plan the dialog
	 * confirmed; the outcome is reported, never retried. An `unconfirmed` answer
	 * (a 503, or this app's own deadline, which is `deadline_exceeded`) means the
	 * request WAS sent and the outcome is unknown - so the reads are refreshed and the
	 * notice says so, and nothing here repeats the request. A retry into a second move
	 * is what the route's journal exists to prevent, and the client's job is not to
	 * need it.
	 */
	const run = useCallback(
		(plan: MovePlan, waitS?: number) => {
			setPendingMove(null);
			const ask: MoveAsk = {
				sessionId: plan.sessionId,
				to: plan.to,
				keep: plan.keep,
				waitS: waitS ?? plan.waitS,
			};
			transfer.mutate(ask, {
				onSuccess: (outcome) => {
					if (outcome.kind === "moved") {
						const { receipt } = outcome;
						const destination =
							receipt.locality === "local"
								? "this device"
								: (graph?.devices.find(
										(device) => device.id === receipt.owner_device,
									)?.label ?? receipt.owner_device);
						setMoveReport({
							kind: "moved",
							verb: receipt.mode === "keep" ? "Copied" : "Moved",
							detail:
								receipt.mode === "keep"
									? `${destination} holds a copy as ${receipt.new_session_id.slice(-6)}; the original is still here.`
									: `${destination} holds it now${receipt.source_retired ? "; the copy here is gone" : ""}.`,
							undo:
								receipt.mode === "keep"
									? {
											sessionId: receipt.new_session_id,
											to: "local",
											keep: false,
											verb: `Bring the copy back from ${destination}`,
											waitS: 0,
											lost: null,
										}
									: null,
						});
						return;
					}
					setMoveReport({ kind: "refused", refusal: outcome.refusal });
				},
				onError: () => {
					setMoveReport({
						kind: "refused",
						refusal: {
							code: "move_failed",
							sentence:
								"The move could not be sent. Nothing here changed; the list has been read again.",
							status: null,
							unconfirmed: false,
						},
					});
				},
			});
		},
		[graph, transfer],
	);

	const inviteOptions = useMemo(() => {
		if (!graph) return [];
		const deviceId = inviteAsk?.deviceId;
		const device = deviceId
			? graph.devices.find((candidate) => candidate.id === deviceId)
			: undefined;
		return graph.networks
			.filter((network) => {
				if (!device) return true;
				const membership = device.memberships.find(
					(candidate) => candidate.networkId === network.id,
				);
				return !membership || !membership.active;
			})
			.map((network) => ({ id: network.id, label: network.label }));
	}, [graph, inviteAsk]);

	if (!enabled) return <Navigate to="/chat" replace />;

	const staleError =
		state.kind === "ready"
			? peers.error
				? meshErrorMessage(peers.error)
				: networks.error
					? meshErrorMessage(networks.error)
					: null
			: null;

	return (
		<MeshSurface
			state={state}
			graph={graph}
			nowSeconds={nowSeconds}
			checking={peers.isFetching || networks.isFetching}
			staleError={staleError}
			onRetry={retry}
			sessions={sessionRead.data ?? []}
			movingSessionId={
				transfer.isPending ? (transfer.variables?.sessionId ?? null) : null
			}
			sessionError={
				sessionRead.isError ? meshErrorMessage(sessionRead.error) : null
			}
			selfLabel={
				graph?.devices.find((device) => device.state === "self")?.label ??
				"this device"
			}
			canMove={canMove}
			pendingMove={pendingMove}
			onAskMove={setPendingMove}
			onDropRefused={(refusal) =>
				setMoveReport({
					kind: "refused",
					refusal: {
						code: refusal.code,
						sentence: refusal.sentence,
						status: null,
						unconfirmed: false,
					},
				})
			}
			onChooseMove={(plan) => run(plan)}
			onCancelMove={() => setPendingMove(null)}
			moveBusy={transfer.isPending}
			moveReport={moveReport}
			onDismissReport={() => setMoveReport(null)}
			onWaitForIdle={() => {
				// The same move, re-asked with the route's own ceiling: the session is
				// busy, so the request waits for the turn to finish rather than
				// interrupting it.
				const plan = pendingMove?.plan;
				if (!plan) return;
				run(plan, WAIT_FOR_IDLE_S);
			}}
			onUndoCopy={() => {
				if (moveReport?.kind !== "moved" || !moveReport.undo) return;
				run(moveReport.undo);
			}}
			invite={
				inviteAsk === null
					? null
					: {
							open: true,
							deviceId: inviteAsk.deviceId,
							deviceLabel: inviteAsk.deviceLabel,
							options: inviteOptions,
						}
			}
			onOpenInvite={(ask) => {
				setInviteReceipt(null);
				setInviteRefusal(null);
				setInviteAsk(ask);
			}}
			onInvite={(ask) => {
				invite.mutate(ask, {
					onSuccess: (receipt) => setInviteReceipt(receipt),
					onError: (error) =>
						setInviteRefusal({
							code: "invite_refused",
							sentence: meshErrorMessage(error),
							status: null,
							unconfirmed: false,
						}),
				});
			}}
			onCloseInvite={() => setInviteAsk(null)}
			inviteBusy={invite.isPending}
			inviteReceipt={inviteReceipt}
			inviteRefusal={inviteRefusal}
			remove={
				removeAsk === null
					? null
					: {
							open: true,
							networkId: removeAsk.networkId,
							networkLabel: removeAsk.networkLabel,
							deviceId: removeAsk.deviceId,
							deviceLabel: removeAsk.deviceLabel,
						}
			}
			onOpenRemove={(ask) => {
				setRemoved(null);
				setRemoveAsk(ask);
			}}
			onRemove={(confirm) => {
				if (!removeAsk) return;
				removeMember.mutate(
					{
						networkId: removeAsk.networkId,
						deviceId: removeAsk.deviceId,
						confirm,
					},
					{ onSuccess: (answer) => setRemoved(answer) },
				);
			}}
			onCloseRemove={() => setRemoveAsk(null)}
			removeBusy={removeMember.isPending}
			removeRefusal={
				removeMember.isError
					? {
							code: "remove_refused",
							sentence: meshErrorMessage(removeMember.error),
							status: null,
							unconfirmed: false,
						}
					: null
			}
			removed={removed}
		/>
	);
};

/**
 * How long a refused-because-busy move waits inside its own request.
 *
 * THE ROUTE'S OWN CEILING (300 s, `TransferSession.wait_s`), not a client preference:
 * `wait_s` is a ceiling on waiting INSIDE the request, and the request returns as soon
 * as it has a definite outcome - so asking for the maximum is what "wait for the turn
 * to finish" honestly means. What it is NOT is an unbounded hold: the transport's
 * deadline for a transfer is derived from the same terms the route publishes
 * (`moveClientBoundMs`), so a turn that never finishes ends in `deadline_exceeded` -
 * which is an UNCONFIRMED answer, reported as one.
 */
const WAIT_FOR_IDLE_S = 300;

export default MeshPage;
