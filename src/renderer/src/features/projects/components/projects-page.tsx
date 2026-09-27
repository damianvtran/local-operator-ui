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
import { Alert, Button } from "@shared/components/ui";
import { showSuccessToast } from "@shared/utils/toast-manager";
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
import { projectStatusMeta } from "../project-model";
import { ProjectBoard } from "./project-board";
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
				onSuccess: () =>
					showSuccessToast(`Moved to ${projectStatusMeta(status).label}`),
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
				 * The loading state wears the LIST's own frame — same border, same
				 * ground, same radius — so the page does not jump when rows arrive, and
				 * so the frame is a picture with an edge rather than a spinner on an
				 * empty canvas (a ground with one small mark on it is the shape
				 * `check-evidence`'s uniformity ceiling refuses, measured: 99.27% of a
				 * 1280x900 frame was one colour without the panel).
				 */
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-surface">
					<div className="flex flex-1 items-center justify-center">
						<Spinner label="Loading projects" />
					</div>
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
				 * THE EMPTY STATE WEARS THE LIST'S FRAME TOO (design round 1, D3): the
				 * panel collapsed from 876 to 350 on the arrival of an empty store —
				 * every first run — while the loading frame it replaced had already
				 * promised no move. The panel is the page's one body and its height is
				 * not a fact about how many rows are in it; the content centres in the
				 * frame instead. The first line also takes the heading step (D7), the
				 * one the schedules page's empty state uses for the same slot.
				 */
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-hairline bg-surface">
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
					await create.mutateAsync(payload.fields);
					showSuccessToast(`Project ${payload.fields.name} created`);
				}}
			/>
		</div>
	);
};
