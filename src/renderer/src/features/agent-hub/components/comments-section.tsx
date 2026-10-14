import type { AgentComment } from "@shared/api/radient/types";
import { Spinner } from "@shared/components/common/spinner";
import {
	Avatar,
	AvatarFallback,
	Button,
	Label,
	Separator,
	Skeleton,
	Textarea,
	Tooltip,
} from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { MessageCircle, Save, SquarePen, Trash2, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { commentAge } from "../comment-age";
import {
	useCreateAgentCommentMutation,
	useDeleteAgentCommentMutation,
	useUpdateAgentCommentMutation,
} from "../hooks/use-agent-comment-mutations";
import { useAgentCommentsQuery } from "../hooks/use-agent-comments-query";

type CommentsSectionProps = {
	agentId: string;
};

/**
 * Renders the comments section for an agent, including display and creation form.
 */
export const CommentsSection: React.FC<CommentsSectionProps> = ({
	agentId,
}) => {
	// Refresh labels and ages without discarding an in-progress comment edit.
	useI18nLocale();
	const { isAuthenticated, user } = useRadientAuth();
	const [newComment, setNewComment] = useState("");
	// State for inline editing
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");

	const {
		data: commentsResponse,
		isLoading,
		error,
	} = useAgentCommentsQuery({ agentId });

	const comments = commentsResponse?.records ?? [];

	const createCommentMutation = useCreateAgentCommentMutation();
	const updateCommentMutation = useUpdateAgentCommentMutation();
	const deleteCommentMutation = useDeleteAgentCommentMutation();

	const handleCommentSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!newComment.trim() || !isAuthenticated || !agentId) return;

		try {
			await createCommentMutation.mutateAsync({
				agentId,
				data: { text: newComment },
			});
			setNewComment(""); // Clear input on success
			// onSuccess in the hook handles refetching and success toast
		} catch (err) {
			// onError in the hook handles error toast
			console.error("Submit comment error caught in component:", err);
		}
	};

	const handleEditComment = (commentId: string, currentText: string) => {
		setEditingCommentId(commentId);
		setEditText(currentText);
	};

	const handleCancelEdit = () => {
		setEditingCommentId(null);
		setEditText("");
	};

	const handleSaveEdit = async () => {
		if (!editingCommentId || !editText.trim() || !isAuthenticated || !agentId)
			return;

		try {
			await updateCommentMutation.mutateAsync({
				agentId,
				commentId: editingCommentId,
				data: { text: editText },
			});
			handleCancelEdit(); // Exit edit mode on success
		} catch (err) {
			console.error("Update comment error caught in component:", err);
		}
	};

	const handleDeleteComment = async (commentId: string) => {
		if (!isAuthenticated || !agentId) return;

		if (window.confirm(t("ui.hub.comments.delete.confirm"))) {
			try {
				await deleteCommentMutation.mutateAsync({ agentId, commentId });
			} catch (err) {
				console.error("Delete comment error caught in component:", err);
			}
		}
	};

	const canEditOrDelete = (comment: AgentComment): boolean => {
		// Check if the logged-in user is the author of the comment
		return (
			isAuthenticated && user?.radientUser?.account?.id === comment.account_id
		);
	};

	return (
		<div className="mt-6">
			<h2 className="mb-4 font-semibold text-heading text-ink">
				{t("ui.hub.comments.heading")}
			</h2>

			{/* Comment input form (only if authenticated) */}
			{isAuthenticated ? (
				<div className="mb-4 flex flex-col gap-1.5">
					<Label htmlFor="new-comment">
						<MessageCircle size={14} aria-hidden="true" />
						{t("ui.hub.comments.form.label")}
					</Label>
					<form onSubmit={handleCommentSubmit} className="flex flex-col gap-3">
						<Textarea
							id="new-comment"
							placeholder={t("ui.hub.comments.form.placeholder")}
							rows={3}
							value={newComment}
							onChange={(event) => setNewComment(event.target.value)}
							required
						/>
						<Button
							type="submit"
							variant="primary"
							disabled={createCommentMutation.isPending || !newComment.trim()}
							className="self-end"
						>
							{createCommentMutation.isPending ? (
								<Spinner size="sm" label={t("ui.hub.comments.form.posting")} />
							) : (
								t("ui.hub.comments.form.submit")
							)}
						</Button>
					</form>
				</div>
			) : (
				<p className="mt-6 mb-4 text-body-sm text-ink-muted">
					{t("ui.hub.comments.form.sign_in")}
				</p>
			)}

			<Separator className="my-6" />

			{/* Comments list */}
			{isLoading && (
				<ul className="flex flex-col">
					{[...Array(3)].map((_, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list, index is acceptable here
						<li key={`skeleton-${index}`} className="flex gap-3 pb-6">
							<Avatar>
								<AvatarFallback>
									<Skeleton className="size-full" />
								</AvatarFallback>
							</Avatar>
							<div className="flex w-full flex-col gap-1.5">
								<Skeleton className="h-3.5 w-24" />
								<Skeleton className="h-3 w-15" />
								<Skeleton className="mt-2 h-3.5 w-full" />
								<Skeleton className="h-3.5 w-4/5" />
							</div>
						</li>
					))}
				</ul>
			)}
			{error && (
				<p role="alert" className="my-6 text-body-sm text-danger">
					{t("ui.hub.comments.load_error", { reason: error.message })}
				</p>
			)}
			{!isLoading && !error && (
				<ul className="flex flex-col gap-6">
					{comments.length === 0 ? (
						<li className="text-body-sm text-ink-muted">
							{t("ui.hub.comments.empty")}
						</li>
					) : (
						comments.map((comment) =>
							editingCommentId === comment.id ? (
								// Edit mode
								<li key={comment.id} className="flex gap-3">
									<Avatar>
										<AvatarFallback>
											{comment.account_metadata?.name
												?.charAt(0)
												.toUpperCase() || "?"}
										</AvatarFallback>
									</Avatar>
									<div className="flex w-full flex-col gap-2">
										<Textarea
											rows={3}
											value={editText}
											onChange={(event) => setEditText(event.target.value)}
											autoFocus
											aria-label={t("ui.hub.comments.edit.label")}
										/>
										<div className="flex justify-end gap-2">
											<Button
												variant="secondary"
												size="sm"
												onClick={handleCancelEdit}
											>
												<X />
												{t("ui.hub.comments.edit.cancel")}
											</Button>
											<Button
												variant="primary"
												size="sm"
												onClick={handleSaveEdit}
												disabled={
													updateCommentMutation.isPending || !editText.trim()
												}
											>
												{updateCommentMutation.isPending ? (
													<Spinner
														size="xs"
														label={t("ui.hub.comments.edit.saving")}
													/>
												) : (
													<Save />
												)}
												{t("ui.hub.comments.edit.save")}
											</Button>
										</div>
									</div>
								</li>
							) : (
								// Display mode
								<li key={comment.id} className="flex gap-3">
									<Avatar>
										<AvatarFallback>
											{comment.account_metadata?.name
												?.charAt(0)
												.toUpperCase() || "?"}
										</AvatarFallback>
									</Avatar>
									<div className="w-full">
										<div className="flex w-full items-center justify-between">
											<div>
												<p className="font-medium text-body text-ink">
													{comment.account_metadata?.name ||
														t("ui.hub.comments.author.unknown")}
												</p>
												<p className="text-ink-muted text-meta">
													{commentAge(new Date(comment.created_at))}
												</p>
											</div>
											{canEditOrDelete(comment) && (
												<div className="flex gap-0.5">
													<Tooltip content={t("ui.hub.comments.edit.label")}>
														{/* Disable edit button while another edit is in progress */}
														<Button
															variant="ghost"
															size="icon-sm"
															onClick={() =>
																handleEditComment(comment.id, comment.text)
															}
															disabled={!!editingCommentId}
															aria-label={t("ui.hub.comments.edit.label")}
														>
															<SquarePen />
														</Button>
													</Tooltip>
													<Tooltip content={t("ui.hub.comments.delete.label")}>
														{/* Disable delete button while an edit is in progress */}
														<Button
															variant="ghost"
															size="icon-sm"
															onClick={() => handleDeleteComment(comment.id)}
															disabled={!!editingCommentId}
															aria-label={t("ui.hub.comments.delete.label")}
														>
															<Trash2 />
														</Button>
													</Tooltip>
												</div>
											)}
										</div>
										{/* whitespace-pre-wrap preserves the author's line breaks */}
										<p className="mt-2 text-body-sm text-ink whitespace-pre-wrap">
											{comment.text}
										</p>
									</div>
								</li>
							),
						)
					)}
				</ul>
			)}
		</div>
	);
};
