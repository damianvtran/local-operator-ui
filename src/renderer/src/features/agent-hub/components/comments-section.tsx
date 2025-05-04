import type React from "react";
import { useState } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  Avatar,
  TextField,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
  Divider,
  Skeleton,
  Stack,
} from "@mui/material";
import { styled, useTheme } from "@mui/material/styles";
import { faEdit, faTrashAlt, faSave, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAgentCommentsQuery } from "../hooks/use-agent-comments-query";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatDistanceToNowStrict } from "date-fns";
import type { AgentComment } from "@shared/api/radient/types";
import {
	useCreateAgentCommentMutation,
	useUpdateAgentCommentMutation,
	useDeleteAgentCommentMutation,
} from "../hooks/use-agent-comment-mutations";

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

// Replace styled component with a functional component using sx prop
const CommentForm: React.FC<React.PropsWithChildren<{ onSubmit: React.FormEventHandler<HTMLFormElement> }>> = ({ onSubmit, children }) => {
  const theme = useTheme();
  return (
    <Box
      component="form"
      onSubmit={onSubmit}
      sx={{
        marginTop: theme.spacing(3),
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing(2),
      }}
    >
      {children}
    </Box>
  );
};


/**
 * Renders the comments section for an agent, including display and creation form.
 */
export const CommentsSection: React.FC<CommentsSectionProps> = ({ agentId }) => {
	const { isAuthenticated, user, sessionToken } = useRadientAuth();
	const [newComment, setNewComment] = useState("");
	// State for inline editing
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");

	const {
		data: comments = [],
    isLoading,
    error,
		// refetch, // Removed unused variable
	} = useAgentCommentsQuery({ agentId, enabled: isAuthenticated });

	// Instantiate mutation hooks
	const createCommentMutation = useCreateAgentCommentMutation();
	const updateCommentMutation = useUpdateAgentCommentMutation(); // Keep for future edit
	const deleteCommentMutation = useDeleteAgentCommentMutation();

	const handleCommentSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!newComment.trim() || !isAuthenticated || !agentId || !sessionToken) return;

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
		if (!editingCommentId || !editText.trim() || !isAuthenticated || !agentId || !sessionToken) return;

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
		return isAuthenticated && user?.radientUser?.account?.id === comment.account_id;
	};

	return (
		<CommentsContainer>
			<Typography variant="h5" gutterBottom>
				Comments
			</Typography>

			{/* Comment Input Form (only if authenticated) */}
			{isAuthenticated ? (
				<CommentForm onSubmit={handleCommentSubmit}>
					<TextField
						label="Leave a comment"
						multiline
            rows={3}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            variant="outlined"
            fullWidth
            required
          />
          <Button
            type="submit"
            variant="contained"
            disabled={createCommentMutation.isPending || !newComment.trim()} // Use mutation pending state
            sx={{ alignSelf: "flex-end" }}
          >
            {createCommentMutation.isPending ? <CircularProgress size={24} /> : "Post Comment"}
          </Button>
        </CommentForm>
      ) : (
        <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
          Sign in to view and leave comments.
        </Typography>
      )}

      <Divider sx={{ my: 3 }} />

      {/* Comments List */}
      {isLoading && isAuthenticated && (
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
      {error && isAuthenticated && (
        <Typography color="error" sx={{ my: 3 }}>
          {/* @ts-ignore */}
          Failed to load comments: {error.message}
        </Typography>
      )}
      {!isLoading && !error && isAuthenticated && (
        <List>
          {comments.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              No comments yet. Be the first to comment!
            </Typography>
          ) : (
            comments.map((comment) =>
              editingCommentId === comment.id ? (
                // Edit Mode
                <CommentItem key={comment.id} divider>
                  <CommentAvatar>
                    {comment.account_metadata?.name?.charAt(0).toUpperCase() || "?"}
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
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
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
                        disabled={updateCommentMutation.isPending || !editText.trim()}
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
                    {comment.account_metadata?.name?.charAt(0).toUpperCase() || "?"}
                  </CommentAvatar>
                  <Box sx={{ width: "100%" }}>
                    <CommentHeader>
                      <Box>
                        <CommentAuthor variant="body1">
                          {comment.account_metadata?.name || "Anonymous"}
                        </CommentAuthor>
                        <CommentTimestamp>
                          {formatDistanceToNowStrict(new Date(comment.created_at))} ago
                        </CommentTimestamp>
                      </Box>
                      {canEditOrDelete(comment) && (
                        <CommentActions>
                          <Tooltip title="Edit Comment">
                            {/* Disable edit button while another edit is in progress */}
                            <IconButton
                              size="small"
                              onClick={() => handleEditComment(comment.id, comment.text)}
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
                    <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}> {/* Preserve whitespace */}
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
