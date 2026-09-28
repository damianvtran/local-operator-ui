/**
 * One project's detail screen (`/projects/:projectId`).
 *
 * WHAT IT OWNS: the reads/writes for one project (via the hooks module), the
 * edit / delete / start-session dialogs, and the wiring of every block to its
 * ops. What it deliberately does NOT own: any label or derivation — those live
 * in `project-model.ts` — and any of the confirmation copy, which lives in the
 * dialog that owns the destructive act.
 *
 * THE REFUSALS ARE TOASTS for the row-level acts (milestone toggle, link,
 * unlink, quick-send) and IN-DIALOG for edit/delete/start — the distinction
 * `delete-conversation-dialog.tsx` states: a refusal that arrives while a
 * dialog is up belongs to that dialog, and one that arrives from a row control
 * has no dialog to inhabit, so the toast is the honest surface.
 *
 * TITLE-FIRST, KEY-SECOND: the heading is the display name (`title`, falling
 * back to `name` — the backend's own precedence), and when a title is set the
 * addressing key sits under it in the machine voice. Every route, verb and
 * filename still addresses the project by `name`; this screen decides only
 * what a reader sees first.
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
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button } from "@shared/components/ui";
import {
	admitChatDraft,
	paneDraftKey,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
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
	managedByLine,
	milestoneSummaryLabel,
	progressLine,
	projectDisplayName,
	sessionLabel,
	sessionTargetLabel,
	startSessionPrompt,
} from "../project-model";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectLinks } from "./project-links";
import { ProjectMilestones } from "./project-milestones";
import { ProjectProperties } from "./project-properties";
import {
	ProjectStartSessionDialog,
	type StartSessionSelection,
} from "./project-start-session";
import { ProjectStatusBadge } from "./project-status-badge";
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
	const detail = useProjectDetail(projectKey, true);
	const update = useUpdateProject();
	const remove = useDeleteProject();
	const setMilestone = useSetProjectMilestone();
	const removeMilestone = useRemoveProjectMilestone();
	const link = useLinkProjectSession();
	const unlink = useUnlinkProjectSession();
	const [editing, setEditing] = useState(false);
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
	const managedBy = managedByLine(project.owner, project.team);
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
		<div className="mx-auto flex min-h-0 w-full max-w-200 flex-1 flex-col gap-8 overflow-y-auto">
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
					<div className="flex min-w-0 flex-col gap-1.5">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="min-w-0 truncate text-display text-ink">
								{displayName}
							</h1>
							<ProjectStatusBadge status={project.status} />
							{project.progress_stale && (
								<Badge variant="warning">{PROGRESS_STALE_LABEL}</Badge>
							)}
						</div>
						{project.title && (
							<p className="font-mono text-mono-sm text-ink-muted">
								{project.name}
							</p>
						)}
						{managedBy && (
							<p className="text-body-sm text-ink-muted">
								Managed by {managedBy}
							</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							onClick={() => setEditing(true)}
							data-tour-tag="project-edit"
						>
							<Pencil />
							Edit
						</Button>
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

			{project.description.trim() && (
				<ProjectMarkdown className="text-body">
					{project.description}
				</ProjectMarkdown>
			)}

			<ProjectProperties project={project} nowMs={nowMs} />

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

			<ProjectFormDialog
				open={editing}
				mode="edit"
				initial={{
					key: project.id,
					name: project.name,
					title: project.title,
					owner: project.owner,
					team: project.team,
					description: project.description,
					status: project.status,
					tags: project.tags,
					start_date: project.start_date,
					target_date: project.target_date,
					estimate: project.estimate,
					estimate_unit: project.estimate_unit,
				}}
				onClose={() => setEditing(false)}
				onSubmit={async (payload) => {
					if (payload.mode !== "edit") return;
					await update.mutateAsync({
						key: payload.key,
						fields: payload.fields,
					});
					showSuccessToast("Project saved");
				}}
			/>

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
	);
};
