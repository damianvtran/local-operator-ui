/**
 * The Projects route: the tab's gate, the List view, and the two-screen shape
 * (`/projects` and `/projects/:projectId`).
 *
 * THE GATE IS THIS SURFACE'S FIRST JOB, because a destination can be reached
 * by URL and by a bookmark as well as by its nav row: a backend that does not
 * advertise `projects` (or a plane this app holds no credential for) must draw
 * an honest sentence rather than a list that 404s on its first read. The
 * sidebar row and the palette entry are hidden on the SAME predicate
 * (`desktopFeatureEnabled`), so the three surfaces cannot disagree about
 * whether Projects exist — see `sidebar-navigation.tsx` and
 * `use-palette-sources.ts` for the two that hide themselves.
 *
 * WHY THE GATE IS A SENTENCE AND NOT A REDIRECT: "Projects is not available"
 * with its cause is a fact the user can act on (update the server, or pair the
 * app), while a silent bounce to another route is the class of dead end this
 * repository's gates exist to remove.
 *
 * THE TWO SCREENS ARE ONE ROUTE ELEMENT on purpose: the list and the detail
 * share the page's own container and the feature's capability gate, and a
 * second route element would duplicate both. The detail's own reads start only
 * once the gate opens, which is what keeps a below-version backend from
 * answering with the 404 the list already knows not to ask for.
 */

import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useTeamLabelFor } from "@shared/api/local-operator/profile-hooks";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Skeleton } from "@shared/components/ui";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { FolderKanban, Plus, RefreshCw } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
	DesktopProject,
	DesktopProjectStatus,
} from "../../../../../shared/desktop-control-contract";
import {
	useCreateProject,
	useDeleteProject,
	useProjectMilestones,
	useProjectsList,
	useUpdateProject,
} from "../hooks/use-projects-queries";
import {
	type BoardWindow,
	boardWindowEmptyHeading,
	boardWindowProjects,
	projectStatusMeta,
	readBoardWindow,
	refusalCopy,
	writeBoardWindow,
} from "../project-model";

/**
 * The loading skeleton's row keys. A literal list rather than `Array.from`:
 * an index used as a key is exactly what `noArrayIndexKey` exists to refuse,
 * and the skeleton is six identical rows whose only identity is their slot.
 */
const LOADING_SKELETON_ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;
import { BoardWindowSelect } from "./board-window-select";
import { ProjectBoard, useMoveFocusHandoff } from "./project-board";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectDetailScreen } from "./project-detail";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectList } from "./project-list";
import { ProjectTimeline } from "./project-timeline";
import {
	type ProjectsView,
	ProjectsViewSwitcher,
	readProjectsView,
	writeProjectsView,
} from "./projects-view-switcher";

const GATE_COPY: Record<string, string> = {
	unpaired:
		"This app is not paired with the Local Operator server, so Projects are unavailable.",
	"below-version":
		"The Local Operator server is older than this app expects, so Projects are unavailable. Update the server and try again.",
	unknown:
		"The server's capabilities could not be read, so Projects are unavailable.",
};

export const ProjectsPage: FC<{ nowMs?: number }> = ({
	nowMs = Date.now(),
}) => {
	const { projectId } = useParams<{ projectId?: string }>();
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const gate = desktopFeatureState(capabilities.data, "projects", 1);
	const enabled = gate === "enabled";
	/*
	 * The team names the list's group headings draw (round 1, D5). The page owns
	 * the read and hands the resolver down, the same rule `nowMs` follows; the
	 * catalogue query is the one the chat sidebar already populates, so this
	 * costs a cache hit at most.
	 */
	const teamLabelFor = useTeamLabelFor(
		desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	const list = useProjectsList(enabled);
	const create = useCreateProject();
	const update = useUpdateProject();
	const remove = useDeleteProject();
	const [createOpen, setCreateOpen] = useState(false);
	/*
	 * The view, the board's edit/delete targets, and the timeline's fan-out are
	 * declared BEFORE the gate's early returns: a hook cannot sit behind a
	 * branch, and the timeline's reads are gated by their own `enabled` flag
	 * (the same fail-closed rule the list states).
	 */
	const [view, setView] = useState<ProjectsView>(() => readProjectsView());
	/*
	 * The board's time window, read once at mount like the view above: the
	 * board's own preference (the List and the Timeline stay whole - their job
	 * is the sweep of everything). The session holds it after the first read,
	 * so a locked store cannot unset a choice the reader just made.
	 */
	const [boardWindow, setBoardWindow] = useState<BoardWindow>(() =>
		readBoardWindow(),
	);
	const [editing, setEditing] = useState<DesktopProject | null>(null);
	const [deleting, setDeleting] = useState<DesktopProject | null>(null);
	/* The caret's hand-back after a status move; see `moveTo` and the hook. */
	const handOffFocus = useMoveFocusHandoff();
	const projects = list.data ?? [];
	/*
	 * THE WINDOW NARROWS THE BOARD ALONE (design memo §4). `projects` above
	 * also feeds the List's rows and the timeline's fan-out, so the filtered
	 * set is a SEPARATE derivation rather than an in-place filter - a shared
	 * narrowed array would quietly shrink three surfaces from one preference.
	 * The arithmetic is `updated_at` against the page's one clock, the same
	 * `nowMs` the age labels read; `all` is the absence of a predicate, and a
	 * window change writes nothing else (the stored column order and the
	 * cards' own order are untouched).
	 */
	const boardProjects = useMemo(
		() => boardWindowProjects(projects, boardWindow, nowMs),
		[projects, boardWindow, nowMs],
	);
	/* The empty-window heading; `null` at `all`, where the state is unreachable. */
	const boardWindowHeading = boardWindowEmptyHeading(boardWindow);
	/*
	 * THE RECOVERY HANDS THE CARET BACK (UX round 1, U3). "Show all time"
	 * unmounts the button the press came from, so focus falls to the body - a
	 * keyboard reader is dropped at the top of the document with the state they
	 * just changed behind them. This is `useMoveFocusHandoff`'s shape in this
	 * same feature (it waits for the commit that mounts the target rather than
	 * reaching across renders, and retries on the next render), pointed at the
	 * window control the press just changed.
	 */
	const [handBackToWindow, setHandBackToWindow] = useState(false);
	useEffect(() => {
		if (!handBackToWindow) return;
		const node = document.querySelector<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		if (!node) return; // the next render retries
		node.focus();
		setHandBackToWindow(false);
	});
	const details = useProjectMilestones(
		view === "timeline" ? projects.map((project) => project.id) : [],
		enabled,
	);
	const timelineItems = projects.map((project, index) => ({
		project,
		milestones: details[index]?.data?.project.milestones ?? [],
	}));
	const pendingDetails =
		view === "timeline" ? details.filter((query) => query.isLoading).length : 0;
	const failedDetails =
		view === "timeline" ? details.filter((query) => query.isError).length : 0;
	/* The retry the timeline's toolbar offers: only the reads that failed. */
	const retryDetails = () => {
		for (const query of details) {
			if (query.isError) void query.refetch();
		}
	};
	const moveTo = (project: DesktopProject, status: string) => {
		update.mutate(
			{
				key: project.id,
				fields: { status: status as DesktopProjectStatus },
			},
			{
				onSuccess: () => {
					showSuccessToast(`Moved to ${projectStatusMeta(status).label}`);
					/*
					 * THE CARET COMES BACK AFTER THE LIST SETTLES, from here rather than
					 * from the card: the refetch re-parents the card into its new column,
					 * which DETACHES the trigger the user pressed (UX round 2, Q-2/U2 -
					 * the card-local effect restored focus to a detached node and the
					 * caret fell to `<body>`). The refetch's resolution is the settle
					 * signal, and `useMoveFocusHandoff` focuses the trigger wherever the
					 * card now lives.
					 */
					void list.refetch().then(() => handOffFocus(project.id));
				},
			},
		);
	};

	/*
	 * One clock per render, read HERE (or handed in by a story's fixture): a
	 * row's age label ("2h ago") is true of the moment it is drawn, and the
	 * listing's own refetch is what moves it on — the `schedules-page.tsx` rule
	 * for its due labels. `nowMs` is a parameter for the same reason that page
	 * states: an unpinned clock makes every committed frame churn.
	 */

	if (!enabled) {
		return (
			<div className="flex h-full flex-col gap-8 p-6">
				<PageHeader title="Projects" icon={FolderKanban} />
				{capabilities.isLoading ? (
					<div className="flex justify-center py-16">
						<Spinner label="Checking the server's Projects support" />
					</div>
				) : (
					<Alert variant="warning">
						{GATE_COPY[gate] ?? GATE_COPY.unknown}
					</Alert>
				)}
			</div>
		);
	}

	if (projectId) {
		return (
			/*
			 * THE DETAIL'S SCROLL REGION IS THE VIEW, NOT THE COLUMN (operator,
			 * 2026-09-30): the scroller used to be the 800px column itself, so its
			 * bar rode the column's edge; the mechanism this matches is chat's
			 * transcript (`canonical-transcript.tsx`) - one full-width scroller
			 * whose content is centred inside it. The gutter is reserved on BOTH
			 * edges for the same reason chat reserves it there: the column is
			 * `mx-auto`, and a one-sided reservation would centre it 4px left of
			 * the view (that file's own measurement).
			 */
			<div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden p-6 [scrollbar-gutter:stable_both-edges]">
				<ProjectDetailScreen projectKey={projectId} nowMs={nowMs} />
			</div>
		);
	}

	return (
		/*
		 * THE PAGE'S BODY IS FULL-BLEED AND THE GUTTER MOVED INSIDE THE VIEWS
		 * (operator, 2026-09-30): the root used to inset everything by 24px, so
		 * every scroll region's bar rode that inset instead of the view's own
		 * edge. The reference mechanism is chat's transcript - one full-width
		 * scroller whose content carries the padding - so here the header keeps
		 * the old gutter (`px-6 pt-6`), and each view's scroller below spans the
		 * body carrying its own padding. Strips that are NOT scrollers but align
		 * with a scrolled row restate the sum (24 + the row's own 12).
		 */
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-8 px-6 pt-6">
				<PageHeader
					title="Projects"
					icon={FolderKanban}
					subtitle="Workstreams you and your agents track across sessions."
				>
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							size="icon"
							aria-label="Refresh projects"
							title="Refresh projects"
							disabled={list.isFetching}
							onClick={() => void list.refetch()}
							data-tour-tag="refresh-projects-button"
						>
							<RefreshCw />
						</Button>
						<Button
							variant="secondary"
							onClick={() => setCreateOpen(true)}
							data-tour-tag="create-project-button"
						>
							<Plus />
							New project
						</Button>
					</div>
				</PageHeader>

				{/*
				 * THE VIEW SWITCHER sits under the header rather than inside it: the
				 * header's actions are the page's commands (refresh, new), while the
				 * switcher is a mode of the BODY — and at the app's narrowest window the
				 * two in one row would squeeze the subtitle to a stub.
				 */}
				<div className="flex shrink-0 items-center justify-between gap-3">
					<ProjectsViewSwitcher
						value={view}
						onChange={(next) => {
							setView(next);
							writeProjectsView(next);
						}}
					/>
					{/*
					 * The window control is the BOARD's, so it appears only where the
					 * board does: not in List/Timeline, and not over the store-empty
					 * state (whose message already sends the reader to create a project
					 * - a window over nothing has nothing to widen). It is otherwise
					 * not data-gated, so a loading or failed read still shows the
					 * reader's stored choice.
					 */}
					{view === "board" && !(list.isSuccess && list.data.length === 0) && (
						<BoardWindowSelect
							value={boardWindow}
							onChange={(next) => {
								setBoardWindow(next);
								writeBoardWindow(next);
							}}
						/>
					)}
				</div>
			</div>

			<div className="mt-8 flex min-h-0 flex-1 flex-col">
				{list.isLoading && (
					/*
					 * THE LOADING STATE WEARS THE LIST'S OWN GEOMETRY (design round 1, D1):
					 * skeleton rows in the list's column plan over the canvas - the panel
					 * the spinner sat in retired with the views' (slice 3), and a spinner
					 * cannot promise the height a row can, so the frame does not jump when
					 * rows arrive. `<output>` is the semantic status region (the mesh
					 * page's own rule), and the bars take `elevated` because on canvas the
					 * skeleton is the raised stand-in for content, not a recessed well.
					 */
					<div className="flex min-h-0 flex-1 flex-col">
						<output className="px-9 py-2 text-meta text-ink-dim">
							Loading projects…
						</output>
						{LOADING_SKELETON_ROWS.map((key) => (
							<div
								key={key}
								className="flex items-center gap-3 px-9 py-2"
								aria-hidden="true"
							>
								<Skeleton className="h-4 min-w-0 flex-1 bg-elevated" />
								<Skeleton className="h-4 w-20 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-32 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-16 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-20 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-40 shrink-0 bg-elevated" />
							</div>
						))}
					</div>
				)}

				{list.isError && (
					/*
					 * THE FAILURE OFFERS ITS OWN WAY BACK (design round 1, D5): the alert is
					 * the page's statement, and the recovery the schedules page pairs with
					 * each of its failure alerts is the same `refetch` this route already
					 * wires — the header's icon-only refresh was one tooltip away from being
					 * findable.
					 */
					<div className="flex flex-col items-start gap-2 px-6">
						<Alert variant="danger">
							{list.error instanceof Error && list.error.message
								? list.error.message
								: "The projects could not be read."}
						</Alert>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void list.refetch()}
						>
							Try again
						</Button>
					</div>
				)}

				{list.isSuccess && list.data.length === 0 && (
					/*
					 * THE EMPTY STATE IS A MESSAGE BLOCK ON THE CANVAS (design round 1, D1):
					 * the panel retired with the views' - an empty store should not keep a
					 * framed ground forever while every populated state is borderless. The
					 * height promise D3 set stays: this container is still the page's one
					 * body (`flex-1`), so nothing collapses under the message.
					 */
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
						<p className="text-heading text-ink">No projects yet.</p>
						<p className="max-w-140 text-center text-body-sm text-ink-muted">
							Create one here, or ask an agent to create one and link this
							session.
						</p>
						<Button
							variant="primary"
							onClick={() => setCreateOpen(true)}
							data-tour-tag="create-project-empty-button"
						>
							<Plus />
							New project
						</Button>
					</div>
				)}

				{list.isSuccess && list.data.length > 0 && view === "list" && (
					<ProjectList
						projects={list.data}
						nowMs={nowMs}
						onOpen={(project) => void navigate(`/projects/${project.id}`)}
						teamLabelFor={teamLabelFor}
					/>
				)}

				{list.isSuccess &&
					list.data.length > 0 &&
					view === "board" &&
					boardProjects.length > 0 && (
						<ProjectBoard
							projects={boardProjects}
							nowMs={nowMs}
							onOpen={(project) => void navigate(`/projects/${project.id}`)}
							onEdit={setEditing}
							onDelete={setDeleting}
							onMove={moveTo}
							teamLabelFor={teamLabelFor}
							movingKeys={
								update.isPending && update.variables
									? [update.variables.key]
									: []
							}
						/>
					)}

				{list.isSuccess &&
					list.data.length > 0 &&
					view === "board" &&
					boardProjects.length === 0 &&
					boardWindowHeading !== null && (
						/*
						 * THE EMPTY WINDOW IS NOT "NO PROJECTS": the store holds rows; the
						 * window just excludes all of them. So the copy names the window (the
						 * heading's phrase comes from the ladder itself), the recovery
						 * widens to `all` - the next rung can be empty too, while at this
						 * state `all` is guaranteed to fill - and the action persists like
						 * any other window change. Unreachable at `all` itself: no predicate
						 * can narrow a non-empty listing to nothing, which is why the heading
						 * is null there and this branch cannot render. It mirrors the
						 * store-empty block's idiom class for class - same container, same
						 * heading and body steps, one secondary action.
						 */
						<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
							<p className="text-heading text-ink">{boardWindowHeading}</p>
							<p className="max-w-140 text-center text-body-sm text-ink-muted">
								Older projects are hidden by the window.
							</p>
							<Button
								variant="secondary"
								onClick={() => {
									setBoardWindow("all");
									writeBoardWindow("all");
									setHandBackToWindow(true);
								}}
							>
								Show all time
							</Button>
						</div>
					)}

				{list.isSuccess && list.data.length > 0 && view === "timeline" && (
					<ProjectTimeline
						items={timelineItems}
						nowMs={nowMs}
						onOpen={(item) => void navigate(`/projects/${item.project.id}`)}
						pendingDetails={pendingDetails}
						failedDetails={failedDetails}
						onRetryDetails={retryDetails}
						teamLabelFor={teamLabelFor}
					/>
				)}
			</div>

			<ProjectFormDialog
				open={editing !== null}
				mode="edit"
				initial={
					editing
						? {
								key: editing.id,
								name: editing.name,
								title: editing.title,
								owner: editing.owner,
								team: editing.team,
								description: editing.description,
								status: editing.status,
								tags: editing.tags,
								start_date: editing.start_date,
								target_date: editing.target_date,
								estimate: editing.estimate,
								estimate_unit: editing.estimate_unit,
							}
						: null
				}
				onClose={() => setEditing(null)}
				onSubmit={async (payload) => {
					if (payload.mode !== "edit") return;
					await update.mutateAsync({
						key: payload.key,
						fields: payload.fields,
					});
					showSuccessToast("Project saved");
					setEditing(null);
				}}
			/>

			<ProjectDeleteDialog
				open={deleting !== null}
				projectName={deleting?.name ?? ""}
				onClose={() => setDeleting(null)}
				onConfirm={async (typedName) => {
					if (!deleting) return;
					await remove.mutateAsync({
						key: deleting.id,
						confirmedName: typedName,
					});
					showSuccessToast("Project deleted");
					setDeleting(null);
				}}
			/>

			<ProjectFormDialog
				open={createOpen}
				mode="create"
				onClose={() => setCreateOpen(false)}
				onSubmit={async (payload) => {
					if (payload.mode !== "create") return;
					const created = await create.mutateAsync(payload.fields);
					/*
					 * The toasts name the TITLE when the author gave one (UX round 1,
					 * U4): the machine key is the route's identity, not the author's —
					 * "Project S6d-ii part 2 created" reads back what was typed.
					 */
					const label = payload.followUp?.title ?? payload.fields.name;
					/*
					 * The follow-up patch carries what the create route cannot (title,
					 * owner/team, the dates, the estimate). It runs ONLY after the create
					 * landed, and a refusal here means the project EXISTS and only the
					 * extras were lost — so it leaves as an error toast naming exactly
					 * that and the way back in (UX round 1, U6), rather than the
					 * dialog's in-place sentence, which would read as "the create
					 * failed" while a resubmit would name-conflict.
					 */
					if (payload.followUp) {
						try {
							await update.mutateAsync({
								key: created.id,
								fields: payload.followUp,
							});
						} catch (error) {
							const message =
								error instanceof Error && error.message ? error.message : "";
							showErrorToast(
								`Project ${label} was created, but the extra fields were not saved: ${refusalCopy(message) || "the server refused them."} Open the project and use Edit to set them.`,
							);
							return;
						}
					}
					showSuccessToast(`Project ${label} created`);
				}}
			/>
		</div>
	);
};
