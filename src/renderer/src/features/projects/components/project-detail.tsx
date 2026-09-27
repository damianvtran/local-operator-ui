/**
 * One project's detail screen (`/projects/:projectId`).
 *
 * WHAT IT OWNS: the reads/writes for one project (via the hooks module), the
 * edit and delete dialogs, and the wiring of the milestones and links blocks
 * to their ops. What it deliberately does NOT own: any label or derivation —
 * those live in `project-model.ts` — and any of the confirmation copy, which
 * lives in the dialog that owns the destructive act.
 *
 * THE REFUSALS ARE TOASTS for the row-level acts (milestone toggle, link,
 * unlink) and IN-DIALOG for edit/delete — the distinction
 * `delete-conversation-dialog.tsx` states: a refusal that arrives while a
 * dialog is up belongs to that dialog, and one that arrives from a row control
 * has no dialog to inhabit, so the toast is the honest surface. A milestone
 * refusal changes nothing on screen, which is why it must say something.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button } from "@shared/components/ui";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	useDeleteProject,
	useLinkProjectSession,
	useProjectDetail,
	useRemoveProjectMilestone,
	useSetProjectMilestone,
	useUnlinkProjectSession,
	useUpdateProject,
} from "../hooks/use-projects-queries";
import {
	PROGRESS_STALE_LABEL,
	estimateLabel,
	formatProjectDay,
	progressLine,
	projectStatusMeta,
} from "../project-model";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectLinks } from "./project-links";
import { ProjectMilestones } from "./project-milestones";

type ProjectDetailScreenProps = {
	projectKey: string;
	nowMs: number;
};

export const ProjectDetailScreen: FC<ProjectDetailScreenProps> = ({
	projectKey,
	nowMs,
}) => {
	const navigate = useNavigate();
	const detail = useProjectDetail(projectKey, true);
	const update = useUpdateProject();
	const remove = useDeleteProject();
	const setMilestone = useSetProjectMilestone();
	const removeMilestone = useRemoveProjectMilestone();
	const link = useLinkProjectSession();
	const unlink = useUnlinkProjectSession();
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);

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
		return (
			<div className="flex flex-col gap-4">
				<Alert variant="danger">
					{detail.error instanceof Error && detail.error.message
						? detail.error.message
						: "The project could not be read."}
				</Alert>
				<Button variant="secondary" onClick={() => void navigate("/projects")}>
					<ArrowLeft />
					All projects
				</Button>
			</div>
		);
	}

	const { project, links } = detail.data;
	const statusMeta = projectStatusMeta(project.status);
	const estimate = estimateLabel(project.estimate, project.estimate_unit);
	const dateRow: { label: string; value: string }[] = [];
	const start = formatProjectDay(
		project.start_date,
		typeof navigator === "undefined" ? undefined : navigator.language,
	);
	const target = formatProjectDay(
		project.target_date,
		typeof navigator === "undefined" ? undefined : navigator.language,
	);
	const completed = formatProjectDay(
		project.completed_at,
		typeof navigator === "undefined" ? undefined : navigator.language,
	);
	if (start) dateRow.push({ label: "Start", value: start });
	if (target) dateRow.push({ label: "Target", value: target });
	if (completed) dateRow.push({ label: "Completed", value: completed });

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
			<div className="flex flex-col gap-4">
				<button
					type="button"
					onClick={() => void navigate("/projects")}
					className="flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
				>
					<ArrowLeft className="size-4" />
					All projects
				</button>

				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-2">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="min-w-0 truncate text-display text-ink">
								{project.name}
							</h1>
							<Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
							{project.progress_stale && (
								<Badge variant="warning">{PROGRESS_STALE_LABEL}</Badge>
							)}
						</div>
						{project.description && (
							<p className="max-w-200 text-body text-ink-muted">
								{project.description}
							</p>
						)}
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-muted">
							{dateRow.map((row) => (
								<span key={row.label}>
									{row.label} {row.value}
								</span>
							))}
							{estimate && <span>{estimate}</span>}
							{project.tags.length > 0 && (
								<span className="flex flex-wrap items-center gap-1.5">
									{project.tags.map((tag) => (
										<Badge key={tag} variant="outline">
											{tag}
										</Badge>
									))}
								</span>
							)}
						</div>
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
			</div>

			<section className="flex flex-col gap-2">
				<h2 className="text-title text-ink">Progress</h2>
				<p className="max-w-200 whitespace-pre-wrap text-body-sm text-ink">
					{project.progress || "No progress has been reported yet."}
				</p>
				<p className="text-meta text-ink-muted">
					{progressLine(project, nowMs)}
				</p>
			</section>

			<ProjectMilestones
				milestones={project.milestones}
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

			<ProjectFormDialog
				open={editing}
				mode="edit"
				initial={{
					key: project.id,
					name: project.name,
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
		</div>
	);
};
