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
import {
	useCreateProject,
	useProjectsList,
} from "../hooks/use-projects-queries";
import { ProjectDetailScreen } from "./project-detail";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectList } from "./project-list";

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
	const [createOpen, setCreateOpen] = useState(false);

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
				<Alert variant="danger">
					{list.error instanceof Error && list.error.message
						? list.error.message
						: "The projects could not be read."}
				</Alert>
			)}

			{list.isSuccess && list.data.length === 0 && (
				<div className="flex flex-col items-center gap-4 rounded-lg border border-hairline bg-surface py-16">
					<p className="text-body text-ink">No projects yet.</p>
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

			{list.isSuccess && list.data.length > 0 && (
				<ProjectList
					projects={list.data}
					nowMs={nowMs}
					onOpen={(project) => void navigate(`/projects/${project.id}`)}
				/>
			)}

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
