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
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Skeleton } from "@shared/components/ui";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { FolderKanban, Plus, RefreshCw } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
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
import { projectStatusMeta, refusalCopy } from "../project-model";

/**
 * The loading skeleton's row keys. A literal list rather than `Array.from`:
 * an index used as a key is exactly what `noArrayIndexKey` exists to refuse,
 * and the skeleton is six identical rows whose only identity is their slot.
 */
const LOADING_SKELETON_ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;
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
	const [editing, setEditing] = useState<DesktopProject | null>(null);
	const [deleting, setDeleting] = useState<DesktopProject | null>(null);
	/* The caret's hand-back after a status move; see `moveTo` and the hook. */
	const handOffFocus = useMoveFocusHandoff();
	const projects = list.data ?? [];
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
			<div className="flex h-full min-h-0 flex-col gap-8 p-6">
				<ProjectDetailScreen projectKey={projectId} nowMs={nowMs} />
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col gap-8 p-6">
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
			</div>

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
					<output className="px-3 py-2 text-meta text-ink-dim">
						Loading projects…
					</output>
					{LOADING_SKELETON_ROWS.map((key) => (
						<div
							key={key}
							className="flex items-center gap-3 px-3 py-2"
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
				<div className="flex flex-col items-start gap-2">
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
				/>
			)}

			{list.isSuccess && list.data.length > 0 && view === "board" && (
				<ProjectBoard
					projects={projects}
					nowMs={nowMs}
					onOpen={(project) => void navigate(`/projects/${project.id}`)}
					onEdit={setEditing}
					onDelete={setDeleting}
					onMove={moveTo}
					movingKeys={
						update.isPending && update.variables ? [update.variables.key] : []
					}
				/>
			)}

			{list.isSuccess && list.data.length > 0 && view === "timeline" && (
				<ProjectTimeline
					items={timelineItems}
					nowMs={nowMs}
					onOpen={(item) => void navigate(`/projects/${item.project.id}`)}
					pendingDetails={pendingDetails}
					failedDetails={failedDetails}
					onRetryDetails={retryDetails}
				/>
			)}

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
					 * The follow-up patch carries what the create route cannot (title,
					 * owner/team, the dates, the estimate). It runs ONLY after the create
					 * landed, and a refusal here means the project EXISTS and only the
					 * extras were lost — so it leaves as an error toast naming exactly
					 * that, rather than the dialog's in-place sentence, which would read
					 * as "the create failed" while a resubmit would name-conflict.
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
								`Project ${created.name} was created, but the extra fields were not saved: ${refusalCopy(message) || "the server refused them."}`,
							);
							return;
						}
					}
					showSuccessToast(`Project ${payload.fields.name} created`);
				}}
			/>
		</div>
	);
};
