/**
 * One project's detail screen (`/projects/:projectId`).
 *
 * WHAT IT OWNS: the reads/writes for one project (via the hooks module), the
 * delete / start-session dialogs, and the wiring of every block to its ops.
 * Since the inline-edit slice (operator, 2026-09-30) the RECORD'S FIELDS are
 * edited in place by `project-editors.tsx` — the edit dialog and its Edit
 * button retired — and this file's remaining job is the one write door they
 * share (`commitFields`), the pane wrapper that carries the shared save
 * announcement, and the section composition.
 *
 * THE REFUSALS ARE TOASTS for the row-level acts (milestone toggle, link,
 * unlink, quick-send) and IN-FIELD for a refused field save (the inline
 * editor holds the attempted value and this screen's editors show the
 * backend's sentence beside it) — the distinction
 * `delete-conversation-dialog.tsx` states: a refusal that arrives while a
 * dialog is up belongs to that dialog, and one that arrives from a row control
 * has no dialog to inhabit, so the toast is the honest surface.
 *
 * TITLE-FIRST, KEY-SECOND: the heading is the display name (`title`, falling
 * back to `name` — the backend's own precedence), and when a title is set the
 * addressing key sits under it in the machine voice. Every route, verb and
 * filename still addresses the project by `name`; this screen decides only
 * what a reader sees first. AND IT WRAPS: a long title is never ellipsised
 * (operator, 2026-09-30) — the header carries the whole title the author gave
 * the project, because a clipped one is exactly how the title "did not show
 * up as the main ticket title".
 *
 * THE PROGRESS SECTION IS CONDITIONAL, and the condition states a rule: a
 * project whose history has entries shows them in the feed, whose newest entry
 * IS the current progress (the store keeps `progress` and the log's tail in
 * step). The separate "Progress" block renders only for a row with no history
 * — a record written before the log existed — so the current pointer is
 * never lost and never drawn twice.
 *
 * QUICK-SEND GOES THROUGH THE CHAT'S OWN ADMISSION PATH (`admitChatDraft`):
 * the message is a normal user message with the composer's own receipts,
 * busy-resend and `steer` semantics. The strip is the door and this screen
 * owns the outcome's words; nothing here talks to the transport directly.
 *
 * START-SESSION creates a canonical session on the target the picker chose,
 * links it, seeds its composer with an editable prompt and lands on the
 * session through `openConversation` (the one owner of a switch's URL write) —
 * the prompt is deliberately NOT auto-sent.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useTeamLabelFor } from "@shared/api/local-operator/profile-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { InlineEditPane } from "@shared/components/inline-edit";
import { Alert, Badge, Button } from "@shared/components/ui";
import {
	admitChatDraft,
	paneDraftKey,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { openConversation } from "../../chat/open-conversation";
import {
	useDeleteProject,
	useLinkProjectSession,
	useProjectDetail,
	useRemoveProjectMilestone,
	useSetProjectMilestone,
	useUnlinkProjectSession,
	useUpdateProject,
} from "../hooks/use-projects-queries";
import { ProjectMarkdown } from "../project-markdown";
import {
	PROGRESS_STALE_LABEL,
	milestoneSummaryLabel,
	progressLine,
	projectDisplayName,
	sessionLabel,
	sessionTargetLabel,
	startSessionPrompt,
} from "../project-model";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import {
	type CommitProjectFields,
	ProjectDescriptionBlock,
	ProjectHeaderIdentity,
	ProjectStatusField,
} from "./project-editors";
import { ProjectLinks } from "./project-links";
import { ProjectMilestones } from "./project-milestones";
import { ProjectProperties } from "./project-properties";
import { ProjectRequestUpdateButton } from "./project-request-update-button";
import {
	ProjectStartSessionDialog,
	type StartSessionSelection,
} from "./project-start-session";
import { ProjectTodos } from "./project-todos";
import { ProjectUpdates } from "./project-updates";

/**
 * The daemon's own category for a row that is gone, read off `detail.code` in
 * the 404 body. The route answers it for a key no row holds - including one
 * deleted between the list read and this page's own fetch - and the page maps
 * exactly this one to a crafted sentence (design round 1, D2).
 */
const PROJECT_NOT_FOUND_CODE = "project_not_found";

type ProjectDetailScreenProps = {
	projectKey: string;
	nowMs: number;
};

export const ProjectDetailScreen: FC<ProjectDetailScreenProps> = ({
	projectKey,
	nowMs,
}) => {
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	/*
	 * The team the `Managed by` line names, read the way every other human-read
	 * surface reads it (round 1, R1-3/D5): the same catalogue and gate as
	 * `teamDisplayName`, so this page cannot name a team differently from the
	 * start-session picker on top of it. A slug with no resolvable row renders
	 * as itself.
	 */
	const teamLabelFor = useTeamLabelFor(
		desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	const detail = useProjectDetail(projectKey, true);
	const update = useUpdateProject();
	const remove = useDeleteProject();
	const setMilestone = useSetProjectMilestone();
	const removeMilestone = useRemoveProjectMilestone();
	const link = useLinkProjectSession();
	const unlink = useUnlinkProjectSession();
	const [deleting, setDeleting] = useState(false);
	const [starting, setStarting] = useState(false);

	const busy =
		update.isPending ||
		remove.isPending ||
		setMilestone.isPending ||
		removeMilestone.isPending ||
		link.isPending ||
		unlink.isPending;

	if (detail.isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner label="Loading project" />
			</div>
		);
	}

	if (detail.isError || !detail.data) {
		/*
		 * A MISSING ROW IS SAID IN THE APP'S OWN WORDS (design round 1, D2). The
		 * daemon's refusal for a row that is gone is `no such project` - lowercase,
		 * no next step - and passing it through made the state read as a defect of
		 * this page rather than as a fact about the row. The category is declared
		 * on the wire (`detail.code`), so it is read rather than matched against a
		 * sentence; anything else keeps the transport's own words, the same
		 * passthrough the list uses, now with the same way back (`Try again`, the
		 * list's own recovery, design round 1 D5 there).
		 */
		const gone =
			detail.error instanceof DesktopControlError &&
			(detail.error.code === PROJECT_NOT_FOUND_CODE ||
				detail.error.status === 404);
		return (
			<div className="mx-auto flex w-full max-w-200 flex-col items-start gap-4">
				<Alert variant="danger" className="w-full">
					{gone
						? "This project could not be found. It may have been deleted."
						: detail.error instanceof Error && detail.error.message
							? detail.error.message
							: "The project could not be read."}
				</Alert>
				<div className="flex items-center gap-2">
					{/*
					 * THE PAIR MATCHES IN SIZE (design round 2, D5): `Try again` was a
					 * `size="sm"` control beside the default-size escape the page has
					 * always drawn, and a one-step height mismatch between two adjacent
					 * recoveries reads built-by-hand - hierarchy here belongs to the
					 * variant, not to the height. The list's own `Try again` keeps its
					 * `sm` size: it stands alone there, with nothing to mismatch.
					 */}
					<Button variant="secondary" onClick={() => void detail.refetch()}>
						Try again
					</Button>
					<Button
						variant="secondary"
						onClick={() => void navigate("/projects")}
					>
						<ArrowLeft />
						All projects
					</Button>
				</div>
			</div>
		);
	}

	const { project, links } = detail.data;
	const displayName = projectDisplayName(project);
	/*
	 * THE ONE WRITE DOOR for every field editor on this screen: the record's
	 * own key and the caller's fields object, straight into
	 * `useUpdateProject` - which is what makes a field's save a partial PATCH
	 * by construction rather than by discipline. A plain function, not a
	 * `useCallback`: it is created after the early returns, and a hook cannot
	 * live there; nothing downstream memoises on its identity.
	 */
	const commitFields: CommitProjectFields = (fields) =>
		update.mutateAsync({ key: project.id, fields }).then(() => undefined);
	/*
	 * THE TEAM'S HUMAN NAME (the team-labels lane, `69d088ec52`, carried through
	 * this slice's restructure): the Properties Team row DISPLAYS the
	 * catalogue's label - resolved through the same `useTeamLabelFor` hook and
	 * feature gate every other human-read surface uses, so this page cannot
	 * name a team differently from the start-session picker on top of it - while
	 * the field still EDITS the raw slug the wire stores. The header's
	 * `Managed by` line, this resolution's original site, retired with the
	 * inline-edit slice; the row below is where it moved.
	 */
	const teamLabel = project.team ? teamLabelFor(project.team) : null;
	const milestoneSummary = milestoneSummaryLabel(
		project.milestones.filter((item) => item.completed_at !== null).length,
		project.milestones.length,
	);

	/**
	 * One quick-send, through the composer's own admission path.
	 *
	 * The draft key is resolved the way the chat pane resolves it
	 * (`paneDraftKey`), so a session that already has a row carrying a claim
	 * gets that row rather than a second one beside it — the same
	 * one-row-per-conversation rule every send obeys. `null` back from the
	 * admission means nothing was sent (a send is already in flight for that
	 * row); that is said rather than silently swallowed.
	 */
	const quickSend = async (
		sessionId: string,
		text: string,
		mode: "prompt" | "steer",
	): Promise<boolean> => {
		const store = useCanonicalSessionsStore.getState();
		const key = paneDraftKey(null, sessionId, store.drafts);
		if (!key) return false;
		try {
			const admitted = await admitChatDraft(
				key,
				{ text, attachments: [], images: [], mode, cwd: store.cwd },
				sessionId,
			);
			if (admitted === null) {
				showErrorToast(
					"That session already has a message going out. Try again in a moment.",
				);
				return false;
			}
			const row = links.find((item) => item.session_id === sessionId);
			showSuccessToast(`Sent to ${row ? sessionLabel(row) : sessionId}`);
			return true;
		} catch (error) {
			showErrorToast(
				error instanceof Error && error.message
					? error.message
					: "The message was not sent.",
			);
			return false;
		}
	};

	/** Create, link, pre-fill, land — in that order, each step's failure named. */
	const startSession = async (selection: StartSessionSelection) => {
		const store = useCanonicalSessionsStore.getState();
		const target =
			selection.kind === "plain"
				? undefined
				: { kind: selection.kind, name: selection.name };
		const id = await store.createSession(store.cwd || "~", target);
		if (!id) {
			/* The store answered without an id and without a throw: nothing to open. */
			throw new Error(store.error ?? "The session could not be started.");
		}
		/*
		 * THE PROMPT IS SEEDED BEFORE THE LINK, so a linking failure cannot
		 * cost the operator the draft the button exists to prepare.
		 */
		useConversationInputStore
			.getState()
			.setCurrentInput(id, startSessionPrompt(project));
		let linkFailure: string | null = null;
		try {
			await link.mutateAsync({ key: project.id, sessionId: id });
		} catch (error) {
			linkFailure =
				error instanceof Error && error.message
					? error.message
					: "the link was refused";
		}
		if (linkFailure) {
			showErrorToast(`Session started, but linking it failed: ${linkFailure}`);
		} else {
			const withTarget = target ? ` with ${sessionTargetLabel(target)}` : "";
			showSuccessToast(
				`Session started${withTarget} and linked to ${displayName}.`,
			);
		}
		await openConversation(navigate, id);
	};

	return (
		/*
		 * THE COLUMN IS THE CONTENT, NOT THE SCROLLER (operator, 2026-09-30). The
		 * scroll region is the page's own view (`projects-page.tsx` wraps this
		 * screen), so the column here is only a centred measurement - and it is
		 * the page that reserves the gutter, which is why nothing in this file
		 * names the scrollbar.
		 *
		 * THE PANE WRAPPER IS THE ARIA BOUNDARY of the inline editing on this
		 * screen: one live region for its transient save acknowledgements, no
		 * matter how many fields save while a reader works (note § 2.6; see
		 * `@shared/components/inline-edit`).
		 */
		<InlineEditPane>
			<div className="mx-auto flex w-full max-w-200 flex-col gap-8">
				<header className="flex flex-col gap-4">
					<button
						type="button"
						onClick={() => void navigate("/projects")}
						className="flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
					>
						<ArrowLeft className="size-4" />
						All projects
					</button>

					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
							{/*
							 * THE IDENTITY BLOCK: the h1 and, under it, whichever of the
							 * title/key pair is not the heading (`project-editors.tsx` owns
							 * the full rule). It wraps and never clips, the operator's own
							 * 2026-09-30 requirement for a long title; the chips beside it
							 * flow as the row wraps.
							 */}
							<ProjectHeaderIdentity project={project} commit={commitFields} />
							<div className="flex flex-wrap items-center gap-2 pt-1.5">
								<ProjectStatusField project={project} commit={commitFields} />
								{project.progress_stale && (
									<Badge variant="warning">{PROGRESS_STALE_LABEL}</Badge>
								)}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							{/*
							 * THE ACTIONS CLUSTER, left to right: the sibling lane's
							 * "Request update" secondary button (landed; its component owns
							 * the capability gate and the request states), then Delete.
							 * Edit retired with the inline edits - every field edits in
							 * place now. The column is NON-WRAPPING and shrink-0 (design
							 * round 1, D1's own words): the status cluster beside the title
							 * can widen while it edits or while a refusal shows, and the
							 * LEFT column (flex-1) absorbs that instead of these two
							 * buttons wrapping to a second line and dragging the header's
							 * whole geometry with them.
							 */}
							<ProjectRequestUpdateButton project={project} />
							<Button
								variant="secondary"
								onClick={() => setDeleting(true)}
								data-tour-tag="project-delete"
							>
								<Trash2 />
								Delete
							</Button>
						</div>
					</div>
				</header>

				<ProjectDescriptionBlock project={project} commit={commitFields} />

				<ProjectProperties
					project={project}
					nowMs={nowMs}
					commit={commitFields}
					teamLabel={teamLabel}
				/>

				{/*
				 * THE PRE-LOG PROGRESS, and only when there is a reading to show: an
				 * empty one would land beside the feed's own empty state and say
				 * "nothing yet" twice (design round 1, D3) - the feed's line is the more
				 * informative of the two, so it is the one that stays.
				 */}
				{project.updates.length === 0 && project.progress && (
					<section className="flex flex-col gap-2">
						<h2 className="text-title text-ink">Progress</h2>
						<ProjectMarkdown className="text-body">
							{project.progress}
						</ProjectMarkdown>
						<p className="text-meta text-ink-muted">
							{progressLine(project, nowMs)}
						</p>
					</section>
				)}

				<ProjectMilestones
					milestones={project.milestones}
					summary={milestoneSummary}
					busy={busy}
					onToggle={(name, completedFlag) => {
						void setMilestone
							.mutateAsync({ key: project.id, name, completed: completedFlag })
							.catch((error: unknown) => {
								showErrorToast(
									error instanceof Error && error.message
										? error.message
										: "The milestone was not updated.",
								);
							});
					}}
					onRemove={(name) => {
						void removeMilestone
							.mutateAsync({ key: project.id, name })
							.catch((error: unknown) => {
								showErrorToast(
									error instanceof Error && error.message
										? error.message
										: "The milestone was not removed.",
								);
							});
					}}
					onAdd={(name, targetDate) => {
						void setMilestone
							.mutateAsync({ key: project.id, name, targetDate })
							.catch((error: unknown) => {
								showErrorToast(
									error instanceof Error && error.message
										? error.message
										: "The milestone was not added.",
								);
							});
					}}
				/>

				<ProjectLinks
					projectKey={project.id}
					links={links}
					busy={busy}
					onStartSession={() => setStarting(true)}
					onQuickSend={quickSend}
					onLink={(sessionId) => {
						void link
							.mutateAsync({ key: project.id, sessionId })
							.catch((error: unknown) => {
								showErrorToast(
									error instanceof Error && error.message
										? error.message
										: "The session was not linked.",
								);
							});
					}}
					onUnlink={(sessionId) => {
						void unlink
							.mutateAsync({ key: project.id, sessionId })
							.catch((error: unknown) => {
								showErrorToast(
									error instanceof Error && error.message
										? error.message
										: "The session was not unlinked.",
								);
							});
					}}
				/>

				<ProjectTodos links={links} />

				<ProjectUpdates updates={project.updates} nowMs={nowMs} />

				<ProjectDeleteDialog
					open={deleting}
					projectName={project.name}
					onClose={() => setDeleting(false)}
					onConfirm={async (typedName) => {
						await remove.mutateAsync({
							key: project.id,
							confirmedName: typedName,
						});
						showSuccessToast("Project deleted");
						void navigate("/projects");
					}}
				/>

				<ProjectStartSessionDialog
					open={starting}
					onClose={() => setStarting(false)}
					onStart={startSession}
					teamsEnabled={desktopFeatureEnabled(
						capabilities.data,
						"team_catalogue",
					)}
					profilesEnabled={desktopFeatureEnabled(
						capabilities.data,
						"profile_catalogue",
					)}
				/>
			</div>
		</InlineEditPane>
	);
};
