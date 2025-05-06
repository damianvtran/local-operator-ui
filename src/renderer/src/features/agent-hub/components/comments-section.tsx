import {
	faComment,
	faEdit,
	faSave,
	faTimes,
	faTrashAlt,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Avatar,
	Box,
	Button,
	CircularProgress,
	Divider,
	IconButton,
	List,
	ListItem,
	Skeleton,
	Stack,
	TextField,
	Tooltip,
	Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentComment } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatDistanceToNowStrict } from "date-fns";
import type React from "react";
import { useState } from "react";
import {
	useCreateAgentCommentMutation,
	useDeleteAgentCommentMutation,
	useUpdateAgentCommentMutation,
} from "../hooks/use-agent-comment-mutations";
import { useAgentCommentsQuery } from "../hooks/use-agent-comments-query";

type CommentsSectionProps = {
	agentId: string;
};

const CommentsContainer = styled(Box)(({ theme }) => ({
	marginTop: theme.spacing(3),
}));

const CommentItem = styled(ListItem)(({ theme }) => ({
	alignItems: "flex-start",
	paddingLeft: 0,
	paddingRight: 0,
	position: "relative", // For positioning edit/delete buttons
	"&:not(:last-child)": {
		marginBottom: theme.spacing(2),
	},
}));

const CommentAvatar = styled(Avatar)(({ theme }) => ({
	marginRight: theme.spacing(2),
	marginTop: theme.spacing(0.5), // Align avatar better with text
}));

const CommentHeader = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	width: "100%",
});

const CommentAuthor = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	marginRight: theme.spacing(1),
}));

const CommentTimestamp = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
}));

const CommentActions = styled(Box)({
	display: "flex",
	gap: 0.5,
});

// Mimic EditableField label style
const CommentLabel = styled("label")(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: 6,
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.875rem",
	fontFamily: theme.typography.fontFamily,
	lineHeight: theme.typography.body2.lineHeight,
}));

const LabelIcon = styled(Box)({
	marginRight: 8,
	opacity: 0.9,
	display: "flex",
	alignItems: "center",
});

// Mimic EditableField text field style
const StyledCommentTextField = styled(TextField)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: 6,
		backgroundColor: theme.palette.background.paper,
		border: `1px solid ${theme.palette.divider}`,
		padding: 0, // Remove default padding
		transition: "border-color 0.2s ease, box-shadow 0.2s ease",
		"&:hover": {
			borderColor: theme.palette.text.secondary,
			backgroundColor: theme.palette.background.paper, // Keep background consistent
		},
		"&.Mui-focused": {
			backgroundColor: theme.palette.background.paper,
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
		},
		"& .MuiOutlinedInput-notchedOutline": {
			border: "none", // Hide the default outline
		},
	},
	"& .MuiInputBase-inputMultiline": {
		// Target multiline input specifically
		padding: "8px 12px", // Apply padding directly to the input area
		fontSize: "0.875rem",
		lineHeight: 1.5,
		fontFamily: "inherit",
	},
	"& .MuiInputBase-input::placeholder": {
		color: theme.palette.text.disabled,
		opacity: 1,
	},
}));

// Container for the comment form elements
const CommentFormContainer = styled(Box)(({ theme }) => ({
	marginTop: theme.spacing(3), // Keep original top margin
	marginBottom: theme.spacing(2), // Add bottom margin consistent with EditableField
}));

/**
 * Renders the comments section for an agent, including display and creation form.
 */
export const CommentsSection: React.FC<CommentsSectionProps> = ({
	agentId,
}) => {
	const { isAuthenticated, user, sessionToken } = useRadientAuth();
	const [newComment, setNewComment] = useState("");
	// State for inline editing
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");

	const {
		data: commentsResponse, // Renamed from 'comments'
		isLoading,
		error,
	} = useAgentCommentsQuery({ agentId });

	// Extract comments array, default to empty array if response/records are undefined
	const comments = commentsResponse?.records ?? [];

	// Instantiate mutation hooks
	const createCommentMutation = useCreateAgentCommentMutation();
	const updateCommentMutation = useUpdateAgentCommentMutation(); // Keep for future edit
	const deleteCommentMutation = useDeleteAgentCommentMutation();

	const handleCommentSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!newComment.trim() || !isAuthenticated || !agentId || !sessionToken)
			return;

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
		if (
			!editingCommentId ||
			!editText.trim() ||
			!isAuthenticated ||
			!agentId ||
			!sessionToken
		)
			return;

		try {
			await updateCommentMutation.mutateAsync({
				agentId,
				commentId: editingCommentId,
				data: { text: editText },
			});
			handleCancelEdit(); // Exit edit mode on success
			// onSuccess in the hook handles refetching and success toast
		} catch (err) {
			// onError in the hook handles error toast
			console.error("Update comment error caught in component:", err);
			// Optionally keep edit mode open on error? Or provide specific feedback.
		}
	};

	const handleDeleteComment = async (commentId: string) => {
		if (!isAuthenticated || !agentId || !sessionToken) return;

		// Simple confirmation dialog
		if (window.confirm("Are you sure you want to delete this comment?")) {
			try {
				await deleteCommentMutation.mutateAsync({ agentId, commentId });
				// onSuccess in the hook handles refetching and success toast
			} catch (err) {
				// onError in the hook handles error toast
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
		<CommentsContainer>
			<Typography variant="h6" gutterBottom>
				Comments
			</Typography>

			{/* Comment Input Form (only if authenticated) */}
			{isAuthenticated ? (
				<CommentFormContainer>
					<CommentLabel>
						<LabelIcon>
							<FontAwesomeIcon icon={faComment} size="sm" />
						</LabelIcon>
						Leave a comment
					</CommentLabel>
					<Box
						component="form"
						onSubmit={handleCommentSubmit}
						sx={{ display: "flex", flexDirection: "column", gap: 2 }}
					>
						<StyledCommentTextField
							placeholder="Share your thoughts..." // Use placeholder instead of label
							multiline
							rows={3}
							value={newComment}
							onChange={(e) => setNewComment(e.target.value)}
							variant="outlined" // Keep variant for structure, style overrides hide default look
							fullWidth
							required
						/>
						<Button
							type="submit"
							variant="contained"
							color="primary" // Explicitly set color if needed
							disabled={createCommentMutation.isPending || !newComment.trim()} // Use mutation pending state
							sx={{ alignSelf: "flex-end" }}
						>
							{createCommentMutation.isPending ? (
								<CircularProgress size={24} />
							) : (
								"Post Comment"
							)}
						</Button>
					</Box>
				</CommentFormContainer>
			) : (
				<Typography variant="body2" color="textSecondary" sx={{ mt: 3, mb: 2 }}>
					Sign in to leave comments.
				</Typography>
			)}

			<Divider sx={{ my: 3 }} />

			{/* Comments List */}
			{isLoading && (
				// Skeleton Loading State
				<List>
					{[...Array(3)].map((_, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Static list for skeleton, index is acceptable here
						<CommentItem key={`skeleton-${index}`} divider>
							<CommentAvatar>
								<Skeleton variant="circular" width={40} height={40} />
							</CommentAvatar>
							<Box sx={{ width: "100%" }}>
								<CommentHeader>
									<Box>
										<Skeleton variant="text" width="100px" sx={{ mb: 0.5 }} />
										<Skeleton variant="text" width="60px" height="0.75rem" />
									</Box>
									{/* Optionally show skeleton actions */}
								</CommentHeader>
								<Skeleton variant="text" sx={{ mt: 1 }} />
								<Skeleton variant="text" width="80%" />
							</Box>
						</CommentItem>
					))}
				</List>
			)}
			{error && (
				<Typography color="error" sx={{ my: 3 }}>
					{/* @ts-ignore */}
					Failed to load comments: {error.message}
				</Typography>
			)}
			{!isLoading && !error && (
				<List>
					{/* Use the extracted comments array */}
					{comments.length === 0 ? (
						<Typography variant="body2" color="textSecondary">
							No comments yet. Be the first to comment!
						</Typography>
					) : (
						// Use the extracted comments array
						comments.map((comment) =>
							editingCommentId === comment.id ? (
								// Edit Mode
								<CommentItem key={comment.id} divider>
									<CommentAvatar>
										{comment.account_metadata?.name?.charAt(0).toUpperCase() ||
											"?"}
									</CommentAvatar>
									<Box sx={{ width: "100%" }}>
										<TextField
											multiline
											rows={3}
											value={editText}
											onChange={(e) => setEditText(e.target.value)}
											variant="outlined"
											fullWidth
											autoFocus
											sx={{ mb: 1 }}
										/>
										<Stack
											direction="row"
											spacing={1}
											justifyContent="flex-end"
										>
											<Button
												size="small"
												onClick={handleCancelEdit}
												startIcon={<FontAwesomeIcon icon={faTimes} />}
											>
												Cancel
											</Button>
											<Button
												size="small"
												variant="contained"
												onClick={handleSaveEdit}
												disabled={
													updateCommentMutation.isPending || !editText.trim()
												}
												startIcon={
													updateCommentMutation.isPending ? (
														<CircularProgress size={16} color="inherit" />
													) : (
														<FontAwesomeIcon icon={faSave} />
													)
												}
											>
												Save
											</Button>
										</Stack>
									</Box>
								</CommentItem>
							) : (
								// Display Mode
								<CommentItem key={comment.id} divider>
									<CommentAvatar>
										{comment.account_metadata?.name?.charAt(0).toUpperCase() ||
											"?"}
									</CommentAvatar>
									<Box sx={{ width: "100%" }}>
										<CommentHeader>
											<Box>
												<CommentAuthor variant="body1">
													{comment.account_metadata?.name || "Anonymous"}
												</CommentAuthor>
												<CommentTimestamp>
													{formatDistanceToNowStrict(
														new Date(comment.created_at),
													)}{" "}
													ago
												</CommentTimestamp>
											</Box>
											{canEditOrDelete(comment) && (
												<CommentActions>
													<Tooltip title="Edit Comment">
														{/* Disable edit button while another edit is in progress */}
														<IconButton
															size="small"
															onClick={() =>
																handleEditComment(comment.id, comment.text)
															}
															disabled={!!editingCommentId}
														>
															<FontAwesomeIcon icon={faEdit} size="xs" />
														</IconButton>
													</Tooltip>
													<Tooltip title="Delete Comment">
														{/* Disable delete button while an edit is in progress */}
														<IconButton
															size="small"
															onClick={() => handleDeleteComment(comment.id)}
															disabled={!!editingCommentId}
														>
															<FontAwesomeIcon icon={faTrashAlt} size="xs" />
														</IconButton>
													</Tooltip>
												</CommentActions>
											)}
										</CommentHeader>
										<Typography
											variant="body2"
											sx={{ mt: 1, whiteSpace: "pre-wrap" }}
										>
											{" "}
											{/* Preserve whitespace */}
											{comment.text}
										</Typography>
									</Box>
								</CommentItem>
							),
						)
					)}
				</List>
			)}
		</CommentsContainer>
	);
};
