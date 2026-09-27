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
 *     mutation (an `Invite`/`Create` control here would be a control that 404s).
 *   - `error` - a read failed and there is nothing behind it. The backend's own
 *     sentence, verbatim, plus a retry.
 *
 * WHAT THIS SLICE DOES NOT DO, so a reviewer does not read the absence as an
 * oversight: no invite, no member removal, no move, no session chips. The Mesh tab
 * ships dark - it is mounted only when the backend advertises `features.peers` -
 * and it is READ-ONLY in this slice, which is why every node's one action is a
 * navigation within the tab.
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
import { MeshCanvas } from "./mesh-canvas";
import type { MeshGraph } from "./mesh-graph";
import { meshSummary } from "./mesh-graph";
import { MeshList } from "./mesh-list";
import {
	type MeshReads,
	type MeshViewState,
	meshErrorMessage,
	meshReadState,
	useMeshGraph,
	useMeshNetworks,
	useMeshPeers,
	useMeshSlots,
} from "./mesh-store";

const PRESENTATIONS = ["canvas", "list"] as const;
type Presentation = (typeof PRESENTATIONS)[number];

const PRESENTATION_LABEL: Record<Presentation, string> = {
	canvas: "Canvas",
	list: "List",
};

/**
 * The tab's body, with everything it renders handed to it.
 *
 * A PRESENTATIONAL SPLIT, so the state matrix can be photographed from fixtures
 * (`mesh-page.stories.tsx`, captured into `docs/evidence/mesh-tab/`) without a
 * backend or a second machine: the states a mesh tab is met with - no network, one
 * device, two devices, an unreachable peer, a failed read - are all fixtures, and a
 * story that could only be driven through a live mesh would leave the interesting
 * ones unphotographed.
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
}> = ({ state, graph, nowSeconds, checking, staleError, onRetry }) => {
	const [presentation, setPresentation] = useState<Presentation>("canvas");
	const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
	const slots = useMeshSlots(graph);
	const summary = graph ? meshSummary(graph) : "";
	const summaryId = "mesh-summary";
	/*
	 * FROM A NODE TO ITS ROW, which is the one action a canvas node carries in a
	 * read-only slice: the list is where the numbers are, so a click lands the reader
	 * there with that device marked. Not a mutation, not a mode - and the same act is
	 * reachable from the keyboard, because the node IS a button.
	 */
	const openDevice = useCallback((deviceId: string) => {
		setSelectedDeviceId(deviceId);
		setPresentation("list");
	}, []);

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
					 * `<output>` IS the semantic element for a status region (it carries the
					 * implicit `role="status"`), so the affordance announces itself as the
					 * refresh it is without a redundant role attribute.
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
				<div className="flex min-h-0 flex-1 flex-col gap-3">
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
					{presentation === "canvas" ? (
						<MeshCanvas
							graph={graph}
							slots={slots}
							nowSeconds={nowSeconds}
							selectedDeviceId={selectedDeviceId}
							onOpenDevice={openDevice}
							summaryId={summaryId}
						/>
					) : (
						<MeshList
							graph={graph}
							nowSeconds={nowSeconds}
							selectedDeviceId={selectedDeviceId}
						/>
					)}
				</div>
			)}
		</div>
	);
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
	const peers = useMeshPeers(enabled);
	const networks = useMeshNetworks(enabled);
	const reads: MeshReads = useMemo(
		() => ({ peers, networks }),
		[peers, networks],
	);
	const state = meshReadState(reads);
	const graph = useMeshGraph(reads);

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
	}, [peers, networks]);

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
		/>
	);
};

export default MeshPage;
