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
import { useCanvasStore } from "@shared/store/canvas-store";
import { ChevronRight } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef } from "react";
import type { DesktopProject } from "../../../../../../shared/desktop-control-contract";
import { ProjectDetailScreen } from "../../../projects/components/project-detail";
import { ProjectStatusBadge } from "../../../projects/components/project-status-badge";
import { useSessionProjects } from "../../../projects/hooks/use-projects-queries";
import {
	boardProgressText,
	listRowMeta,
	progressAge,
	projectDisplayName,
} from "../../../projects/project-model";
import { EmptyState } from "./canvas-empty-state";

/*
 * The no-sentence fallback for both failures this view can show (capabilities
 * and the read itself): an error without a message must still say something
 * (round-1 R1-4), and the variables viewer's rule is one sentence for "the
 * runtime didn't answer" rather than two tenses of it.
 */
const BACKEND_SILENT = () => t("ui.canvas.projects.unreachable_description");

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
 * other author of project changes is the agent in THIS conversation; its
 * turn-end refetch lives in `ChatContent` (`useProjectReadsTurnRefresh`),
 * beside the rail's count, so the rail's dot stays current with this view
 * closed too (round-1 R1-3/U5).
 *
 * EXPLICIT SELECTION lives in the canvas store, scoped to conversation AND
 * backend session. Automatic singleton selection is derived only after a
 * settled successful linked read. It is not saved as an explicit row choice:
 * 1→many returns the chooser; a still-linked explicit choice stays in detail.
 * Back suppresses singleton navigation for the current linked ID set, across
 * close/reopen as well, until that set or backend identity changes.
 *
 * The store survives view switches (round-1 U4):
 * this component unmounts on every view switch and close, and a reader who
 * glances at Files returns to the project they were reading. It is shown only
 * while that project is still linked here; once the list says otherwise
 * (unlinked, deleted) the selection is dropped and the list is the answer.
 */
export const CanvasProjectsViewer: FC<{
	/** The backend session id; undefined on a draft (nothing to ask about). */
	sessionId?: string;
	/**
	 * The canvas store's key for this conversation (the chat's `agentId`), which
	 * holds the open project. Absent (a bare story host) keeps the selection in
	 * a store slot of its own rather than dropping the feature.
	 */
	conversationId?: string;
	/** Injected clock for stories/tests; the route reads `Date.now()` too. */
	nowMs?: number;
}> = ({ sessionId, conversationId, nowMs }) => {
	useI18nLocale();
	const capabilities = useDesktopCapabilities();
	const gate = desktopFeatureState(capabilities.data, "projects_by_session");
	const supported = gate === "enabled";
	const projects = useSessionProjects(sessionId, supported);
	const storeKey = conversationId ?? sessionId ?? "draft";
	const navigation = useCanvasStore((state) => state.conversations[storeKey]);
	const remembered =
		navigation?.selectedProjectSessionId === sessionId
			? (navigation?.selectedProjectId ?? null)
			: null;
	const setSelectedProject = useCanvasStore(
		(state) => state.setSelectedProject,
	);
	const setSelected = (projectId: string | null, backFromLinks?: string) =>
		setSelectedProject(storeKey, projectId, sessionId, backFromLinks);
	const now = nowMs ?? Date.now();

	/*
	 * FOCUS FOLLOWS THE SWAP (round-1 U3). List and detail replace each other,
	 * so the focused element unmounts in both directions and focus fell to
	 * <body>: a screen reader announced nothing and a keyboard user lost their
	 * place. Opening hands focus to the detail's back link (the screen does it,
	 * `embedded.focusOnMount`); going back returns it to the row that was
	 * opened, which this ref remembers across the swap.
	 */
	const returnFocusTo = useRef<string | null>(null);
	const listRef = useRef<HTMLElement | null>(null);

	const rows = projects.data;
	/* A cached singleton is not permission to navigate while its authoritative
	   revalidation is pending (or failed). Derive the automatic destination in
	   render: no chooser flash, no effect that can reopen a closed canvas. */
	const authoritative = projects.isSuccess && !projects.isFetching;
	const links = JSON.stringify(
		(rows ?? []).map((project) => project.id).sort(),
	);
	const escaped =
		navigation?.selectedProjectSessionId === sessionId &&
		navigation?.projectListEscape === links;
	const linked =
		remembered !== null && rows?.some((project) => project.id === remembered);
	const selected = authoritative
		? linked
			? remembered
			: !escaped && rows?.length === 1
				? rows[0].id
				: null
		: null;
	/* Only explicit row opens persist across 1→many. Automatic singleton entry
	   becomes the chooser on 1→many; many→1 forwards unless Back escaped this
	   exact set. Clear invalid selections/escapes only after an authoritative read. */
	useEffect(() => {
		if (!authoritative) return;
		if (
			navigation?.selectedProjectSessionId !== sessionId ||
			(remembered !== null && !linked) ||
			(navigation?.projectListEscape !== undefined && !escaped)
		) {
			setSelectedProject(storeKey, null, sessionId);
		}
	}, [
		authoritative,
		navigation?.selectedProjectSessionId,
		navigation?.projectListEscape,
		sessionId,
		remembered,
		linked,
		escaped,
		storeKey,
		setSelectedProject,
	]);
	const deliberateOpen = useRef<string | null>(null);
	/* Focus belongs only to the click's mount, never a later revalidation or
	   restoration of the same detail while the operator types in chat. */
	useEffect(() => {
		deliberateOpen.current = null;
	});
	const showingList = selected === null;
	useEffect(() => {
		if (!showingList) return;
		const id = returnFocusTo.current;
		if (id === null) return;
		returnFocusTo.current = null;
		/* Matched by attribute value, not a built selector: a project key is
		   user-chosen text and needs no escaping this way. */
		const row = [
			...(listRef.current?.querySelectorAll<HTMLElement>(
				"[data-canvas-project-row]",
			) ?? []),
		].find((element) => element.dataset.canvasProjectRow === id);
		row?.focus();
	});

	if (capabilities.isLoading) {
		return <LoadingState />;
	}
	/*
	 * THREE CLOSED CAUSES, TWO REMEDIES (round-1 R1-2/D1). Update advice is
	 * right only for a runtime that answered without `projects_by_session`
	 * (`below-version`); a failed capabilities read, an unpaired app or no
	 * answer at all is a reachability fact that updating cannot fix — the
	 * variables viewer's `capabilities.isError` branch, which quotes the
	 * transport's own sentence because the transport knows whether it was a
	 * refused socket or a wrong bearer.
	 */
	if (capabilities.isError || gate === "unpaired" || gate === "unknown") {
		return (
			<EmptyState
				title={t("ui.canvas.projects.unreachable_title")}
				description={
					capabilities.isError
						? userFacingMessage(capabilities.error, BACKEND_SILENT())
						: gate === "unpaired"
							? t("ui.canvas.projects.unpaired_description")
							: BACKEND_SILENT()
				}
			>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => void capabilities.refetch()}
				>
					{t("ui.canvas.projects.try_again")}
				</Button>
			</EmptyState>
		);
	}
	if (!supported) {
		/* An older runtime: the rail door stays put (always-present rule) and
		   the pane names the one remedy that works. */
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
		const opened = selected;
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
					/* `px-3`: the list's text column (heading `px-3`; ul + row
					   `px-1.5` each), so row → detail → back does not jump the text
					   4px sideways (round-1 D3). */
					"flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-4 [scrollbar-gutter:stable]",
				)}
			>
				<ProjectDetailScreen
					projectKey={opened}
					nowMs={now}
					embedded={{
						onBack: () => {
							returnFocusTo.current = opened;
							deliberateOpen.current = null;
							setSelected(null, links);
						},
						backLabel: t("ui.canvas.projects.back"),
						focusOnMount: deliberateOpen.current === `${sessionId}:${opened}`,
					}}
				/>
			</div>
		);
	}
	/* Loading and failed revalidation never authorize cached detail, even if
	   the last successful response still contains a remembered/single project. */
	if (projects.isLoading || (!projects.isError && !authoritative)) {
		return <LoadingState />;
	}
	if (projects.isError) {
		return (
			<EmptyState
				title={t("ui.canvas.projects.error_title")}
				description={userFacingMessage(projects.error, BACKEND_SILENT())}
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
	if (!rows || rows.length === 0) {
		return (
			<EmptyState
				title={t("ui.canvas.projects.empty_title")}
				description={t("ui.canvas.projects.empty_description")}
			/>
		);
	}
	return (
		<section
			ref={listRef}
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
						onOpen={() => {
							deliberateOpen.current = `${sessionId}:${project.id}`;
							setSelected(project.id);
						}}
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
								/* The chip keeps its own 1px control edge: it sits inside the
								   row's `hover:bg-row-hover` state, and on some palettes the
								   `sunken` fill lands on the hover rung (ΔE00 ~0), so without
								   an edge the chip would vanish into the hovered row. The row-
								   state guard in scripts/chat-sidebar-selection.test.mjs
								   (PLATES_INSIDE_ROW_STATES) pins this. */
								<span
									key={entry.key}
									className={cn(
										"rounded-sm border border-control bg-sunken px-1.5 py-0.5 text-meta text-ink-muted",
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
