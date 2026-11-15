import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ChevronRight } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import type { DesktopProject } from "../../../../../../shared/desktop-control-contract";
import { ProjectDetailScreen } from "../../../projects/components/project-detail";
import { ProjectStatusBadge } from "../../../projects/components/project-status-badge";
import {
	useInvalidateProjectReads,
	useSessionProjects,
} from "../../../projects/hooks/use-projects-queries";
import {
	boardProgressText,
	listRowMeta,
	progressAge,
	projectDisplayName,
} from "../../../projects/project-model";
import { EmptyState } from "./canvas-empty-state";

/**
 * THE CANVAS'S PROJECTS VIEW: the projects this conversation is linked to, and
 * one project's full detail without leaving the chat (operator, 2026-11-15).
 *
 * TWO STATES, ONE PANE. The list is this file's own; the detail is the
 * Projects route's `ProjectDetailScreen` itself, hosted with `embedded` so that
 * only the route-shaped parts change (its back link returns HERE, and the
 * quick-send composer is omitted because the conversation's composer is
 * already on screen). Name, description, status, milestones, the update
 * history with its attachments and lightbox are the route's code path, not a
 * copy, so the two surfaces cannot drift.
 *
 * THE GATE ORDER is the variables viewer's (`canvas-variables-viewer.tsx`):
 * capabilities loading → unreachable → unsupported → draft → loading → error →
 * empty → rows. `projects_by_session` absent means the route is not there,
 * so the pane says so and sends nothing rather than painting a 404.
 *
 * FRESHNESS. The read nests under the Projects tab's key prefix, so every
 * project write anywhere in the app refreshes it (see `projectKeys`). The
 * other author of project changes is the agent in THIS conversation, and the
 * one moment it is guaranteed to have finished writing is the end of a turn —
 * so a turn ending while this view is mounted drops every project read (list
 * and any open detail), the variables viewer's rule for its own namespace.
 *
 * The selection is local state, deliberately not persisted: the mount site
 * keys this component by session, so switching conversations always lands on
 * that conversation's list rather than on a project it may not be linked to.
 */
export const CanvasProjectsViewer: FC<{
	/** The backend session id; undefined on a draft (nothing to ask about). */
	sessionId?: string;
	/** Count of observed turn completions; a rise re-reads (see above). */
	turnTerminal?: number;
	/** Injected clock for stories/tests; the route reads `Date.now()` too. */
	nowMs?: number;
}> = ({ sessionId, turnTerminal, nowMs }) => {
	useI18nLocale();
	const capabilities = useDesktopCapabilities();
	const gate = desktopFeatureState(capabilities.data, "projects_by_session");
	const supported = gate === "enabled";
	const projects = useSessionProjects(sessionId, supported);
	const invalidateProjects = useInvalidateProjectReads();
	const [selected, setSelected] = useState<string | null>(null);
	const now = nowMs ?? Date.now();

	const turnsSeen = useRef(turnTerminal);
	useEffect(() => {
		const previous = turnsSeen.current;
		turnsSeen.current = turnTerminal;
		if (previous === undefined || turnTerminal === undefined) return;
		if (turnTerminal <= previous) return;
		if (!sessionId || !supported) return;
		invalidateProjects();
	}, [turnTerminal, sessionId, supported, invalidateProjects]);

	if (capabilities.isLoading) {
		return <LoadingState />;
	}
	if (!supported) {
		/*
		 * One sentence for every closed cause (older runtime, unpaired, no answer):
		 * the operator's remedy is the same - a runtime that serves the route - and
		 * the rail door that led here stays put rather than flickering with the
		 * backend's state (the panel rail's always-present rule).
		 */
		return (
			<EmptyState
				title={t("ui.canvas.projects.unavailable_title")}
				description={t("ui.canvas.projects.unavailable_description")}
			/>
		);
	}
	if (!sessionId) {
		return (
			<EmptyState
				title={t("ui.canvas.projects.draft_title")}
				description={t("ui.canvas.projects.draft_description")}
			/>
		);
	}
	if (selected !== null) {
		return (
			/*
			 * THE PANE IS THE SCROLLER here, as `projects-page.tsx` is for the route:
			 * the screen's column is only a centred measure (its own note), so the
			 * host owns overflow. `overflow-x-hidden` because the canvas can be far
			 * narrower than the route's 800px measure and nothing in the screen may
			 * push the pane sideways; `scrollbar-gutter: stable` so the bar appearing
			 * as updates load does not reflow the text (AGENTS.md, scrollbars).
			 */
			<div
				data-canvas-project-detail=""
				className={cn(
					"flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-4 [scrollbar-gutter:stable]",
				)}
			>
				<ProjectDetailScreen
					projectKey={selected}
					nowMs={now}
					embedded={{
						onBack: () => setSelected(null),
						backLabel: t("ui.canvas.projects.back"),
					}}
				/>
			</div>
		);
	}
	if (projects.isLoading) {
		return <LoadingState />;
	}
	if (projects.isError) {
		return (
			<EmptyState
				title={t("ui.canvas.projects.error_title")}
				description={userFacingMessage(projects.error, "")}
			>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => void projects.refetch()}
				>
					{t("ui.canvas.projects.try_again")}
				</Button>
			</EmptyState>
		);
	}
	const rows = projects.data ?? [];
	if (rows.length === 0) {
		return (
			<EmptyState
				title={t("ui.canvas.projects.empty_title")}
				description={t("ui.canvas.projects.empty_description")}
			/>
		);
	}
	return (
		<section
			data-canvas-projects-list=""
			className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto")}
		>
			<div className={cn("flex items-baseline gap-2 px-3 pt-2 pb-1")}>
				<span className={cn("text-meta text-ink-muted")}>
					{t("ui.canvas.projects.heading")}
				</span>
			</div>
			<ul className={cn("flex flex-col gap-0.5 px-1.5 pb-1.5")}>
				{rows.map((project) => (
					<LinkedProjectRow
						key={project.id}
						project={project}
						nowMs={now}
						onOpen={() => setSelected(project.id)}
					/>
				))}
			</ul>
		</section>
	);
};

const LoadingState: FC = () => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
		)}
	>
		<Spinner size="sm" />
		<p className={cn("text-body-sm text-ink-muted")}>
			{t("ui.canvas.projects.loading")}
		</p>
	</div>
);

/**
 * One linked project: the board card's facts at list density.
 *
 * Built from the board's own formatters (`projectDisplayName`, `listRowMeta`,
 * `boardProgressText`, `ProjectStatusBadge`) rather than the card component,
 * which carries drag handles, a status-move menu and a sessions popover that
 * belong to the board's job, not to "which projects is this chat part of".
 * The title WRAPS (the detail header's rule: a clipped title is how a title
 * "did not show up"); the meta chips wrap beneath it in the narrow pane.
 */
const LinkedProjectRow: FC<{
	project: DesktopProject;
	nowMs: number;
	onOpen: () => void;
}> = ({ project, nowMs, onOpen }) => {
	const name = projectDisplayName(project);
	const meta = listRowMeta(project).filter((entry) => entry.key !== "live");
	const age = progressAge(project.progress_updated_at, nowMs);
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				aria-label={t("ui.canvas.projects.open_project", { name })}
				data-canvas-project-row={project.id}
				className={cn(
					"flex w-full items-start gap-2 rounded-sm px-1.5 py-2 text-start",
					"transition-colors duration-fast ease-out-quart hover:bg-row-hover",
				)}
			>
				<span className={cn("flex min-w-0 flex-1 flex-col gap-1.5")}>
					<span className={cn("flex flex-wrap items-start gap-x-2 gap-y-1")}>
						<span className={cn("min-w-0 break-words text-body-sm text-ink")}>
							{name}
						</span>
						<ProjectStatusBadge status={project.status} />
					</span>
					{meta.length > 0 && (
						<span className={cn("flex flex-wrap gap-1.5")}>
							{meta.map((entry) => (
								<span
									key={entry.key}
									className={cn(
										"rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-ink-muted",
									)}
								>
									{entry.text}
								</span>
							))}
						</span>
					)}
					<span className={cn("flex items-center gap-1.5")}>
						<span className={cn("min-w-0 truncate text-meta text-ink-muted")}>
							{boardProgressText(age)}
						</span>
						{project.progress_stale && (
							<span
								aria-label={t("ui.projects.project_model.stale")}
								title={t("ui.projects.project_model.stale")}
								className={cn("size-1.5 shrink-0 rounded-full bg-warning")}
							/>
						)}
					</span>
				</span>
				<ChevronRight
					aria-hidden={true}
					className={cn("mt-0.5 size-4 shrink-0 text-ink-dim rtl:-scale-x-100")}
				/>
			</button>
		</li>
	);
};
