import type React from "react";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  IconButton,
  Tooltip,
  Divider,
  Skeleton,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import {
  faArrowLeft,
  faHeart as faHeartSolid,
  faStar as faStarSolid,
  faDownload,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { AgentTagsAndCategories } from "./components/agent-tags-and-categories";
import {
  faHeart as faHeartOutline,
  faStar as faStarOutline,
} from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { formatDistanceToNowStrict } from "date-fns";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useAgentDetailsQuery } from "./hooks/use-agent-details-query";
import { useAgentLikeQuery } from "./hooks/use-agent-like-query";
import { useAgentFavouriteQuery } from "./hooks/use-agent-favourite-query";
import { useAgentLikeCountQuery } from "./hooks/use-agent-like-count-query";
import { useAgentFavouriteCountQuery } from "./hooks/use-agent-favourite-count-query";
import { useAgentDownloadCountQuery } from "./hooks/use-agent-download-count-query";
import { useAgentLikeMutation } from "./hooks/use-agent-like-mutation";
import { useAgentFavouriteMutation } from "./hooks/use-agent-favourite-mutation";
import { useDownloadAgentMutation } from "./hooks/use-download-agent-mutation";
import { useDelistAgentMutation } from "./hooks/use-delist-agent-mutation";
import { CommentsSection } from "./components/comments-section";

const DetailsContainer = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4),
  margin: theme.spacing(3),
  flexGrow: 1,
  display: "flex",
  flexDirection: "column",
}));

const HeaderBox = styled(Box)(({ theme }) => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: theme.spacing(3),
}));

const TitleBox = styled(Box)({
  display: "flex",
  alignItems: "center",
});

const BackButton = styled(IconButton)(({ theme }) => ({
  marginRight: theme.spacing(2),
}));

// Match PageHeader title style
const AgentName = styled(Typography)(({ theme }) => ({
  fontSize: "2rem", // Match PageHeader TitleText
  fontWeight: 500,    // Match PageHeader TitleText
  lineHeight: 1.3,    // Match PageHeader TitleText
  marginRight: theme.spacing(2), // Space between name and actions
}));

const ActionButtonGroup = styled(Box)({
  display: "flex",
  alignItems: "center",
  gap: 1,
});

const MetaInfoContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing(1),
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(3),
  color: theme.palette.text.secondary,
  fontSize: "0.875rem",
}));

const DescriptionBox = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(4),
  lineHeight: 1.6,
}));

// Copied from AgentCard
const CountDisplay = styled("span")(({ theme }) => ({
  fontSize: "0.8rem",
  marginLeft: theme.spacing(0.75),
  color: theme.palette.text.secondary,
  display: "inline-flex",
  alignItems: "center",
  minWidth: "20px",
  height: "1em",
}));

/**
 * Renders the detailed view for a specific public agent.
 */
export const AgentDetailsPage: React.FC = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useRadientAuth();

  const { data: agent, isLoading, error } = useAgentDetailsQuery({
    agentId: agentId ?? "",
    enabled: !!agentId,
  });
  // Destructure isLiked directly from the hook result
  const { isLiked } = useAgentLikeQuery({
    agentId: agentId ?? "",
    enabled: !!agentId && isAuthenticated,
  });
  // Destructure isFavourited directly from the hook result
  const { isFavourited } = useAgentFavouriteQuery({
    agentId: agentId ?? "",
    enabled: !!agentId && isAuthenticated,
  });
  const { data: likeCount, isLoading: isLoadingLikes } = useAgentLikeCountQuery({
    agentId: agentId ?? "",
    enabled: !!agentId,
  });
  const { data: favouriteCount, isLoading: isLoadingFavourites } = useAgentFavouriteCountQuery({
    agentId: agentId ?? "",
    enabled: !!agentId,
  });
  const { data: downloadCount, isLoading: isLoadingDownloads } = useAgentDownloadCountQuery({
    agentId: agentId ?? "",
    enabled: !!agentId,
  });

  const likeMutation = useAgentLikeMutation();
  const favouriteMutation = useAgentFavouriteMutation();
  const downloadMutation = useDownloadAgentMutation();
  const delistMutation = useDelistAgentMutation();

  // State for the confirmation dialog
  const [isDelistDialogOpen, setIsDelistDialogOpen] = useState(false);

  // Determine if the current user is the owner
  const isOwner = !!user && !!agent && user.radientUser?.account?.id === agent.account_id;

  // --- Delist Dialog Handlers ---
  const handleOpenDelistDialog = () => {
    setIsDelistDialogOpen(true);
  };

  const handleCloseDelistDialog = () => {
    setIsDelistDialogOpen(false);
  };

  const handleConfirmDelist = () => {
    if (!agentId || !isOwner || delistMutation.isPending) return;
    delistMutation.mutate({ agentId });
    handleCloseDelistDialog();
  };
  // --- End Delist Dialog Handlers ---

  const handleLikeToggle = () => {
    if (!agentId || !isAuthenticated || likeMutation.isPending) return;
    likeMutation.mutate({ agentId, isCurrentlyLiked: isLiked });
  };

  const handleFavouriteToggle = () => {
    if (!agentId || !isAuthenticated || favouriteMutation.isPending) return;
    favouriteMutation.mutate({ agentId, isCurrentlyFavourited: isFavourited });
  };

  const handleDownload = () => {
    if (!agentId || !agent || downloadMutation.isPending) return;
    downloadMutation.mutate({ agentId: agent.id, agentName: agent.name });
  };

  const handleBack = () => {
    navigate("/agent-hub");
  };

  const likeIcon = isLiked ? faHeartSolid : faHeartOutline;
  const likeColor = isLiked ? "error.main" : "inherit";
  const favouriteIcon = isFavourited ? faStarSolid : faStarOutline;
  const favouriteColor = isFavourited ? "warning.main" : "inherit";

  const AuthTooltipWrapper: React.FC<{ children: React.ReactElement }> = ({ children }) =>
    isAuthenticated ? (
      children
    ) : (
      <Tooltip title="Sign in to Radient to use this feature">
        <span>{children}</span>
      </Tooltip>
    );

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        {/* @ts-ignore TODO: Improve error typing */}
        <Typography color="error">Failed to load agent details: {error.message}</Typography>
      </Box>
    );
  }

  if (!agent) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <Typography>Agent not found.</Typography>
      </Box>
    );
  }

  return (
    <DetailsContainer elevation={1}>
      <HeaderBox>
        <TitleBox>
          <BackButton onClick={handleBack} aria-label="Back to Agent Hub">
            <FontAwesomeIcon icon={faArrowLeft} size="sm" />
          </BackButton>
          <AgentName>{agent.name}</AgentName>
        </TitleBox>
        <ActionButtonGroup>
          <AuthTooltipWrapper>
            <IconButton
              size="medium"
              onClick={handleLikeToggle}
              disabled={!isAuthenticated || likeMutation.isPending}
              sx={{ color: likeColor, borderRadius: 4 }}
              aria-label={isLiked ? "Unlike agent" : "Like agent"}
            >
              <FontAwesomeIcon icon={likeIcon} />
              <CountDisplay>
                {isLoadingLikes ? <Skeleton variant="text" width={20} /> : likeCount ?? 0}
              </CountDisplay>
            </IconButton>
          </AuthTooltipWrapper>
          <AuthTooltipWrapper>
            <IconButton
              size="medium"
              onClick={handleFavouriteToggle}
              disabled={!isAuthenticated || favouriteMutation.isPending}
              sx={{ color: favouriteColor, borderRadius: 4 }}
              aria-label={isFavourited ? "Unfavourite agent" : "Favourite agent"}
            >
              <FontAwesomeIcon icon={favouriteIcon} />
              <CountDisplay>
                {isLoadingFavourites ? <Skeleton variant="text" width={20} /> : favouriteCount ?? 0}
              </CountDisplay>
            </IconButton>
          </AuthTooltipWrapper>
          <Tooltip title="Download agent to your local instance">
            <span>
              <IconButton
                size="medium"
                onClick={handleDownload}
                disabled={downloadMutation.isPending}
                sx={{ borderRadius: 4, ml: 1 }}
                aria-label="Download agent"
              >
                <FontAwesomeIcon icon={faDownload} />
                <CountDisplay>
                  {isLoadingDownloads || downloadMutation.isPending ? (
                    <Skeleton variant="text" width={20} />
                  ) : (
                    downloadCount ?? 0
                  )}
                </CountDisplay>
              </IconButton>
            </span>
          </Tooltip>

          {isOwner && (
            <Tooltip title="Permanently delist this agent from Agent Hub">
              <IconButton
                size="medium"
                onClick={handleOpenDelistDialog}
                disabled={delistMutation.isPending}
                sx={{ borderRadius: 4, ml: 1, color: "error.main" }} // Style as destructive action
                aria-label="Delist agent"
              >
                <FontAwesomeIcon icon={faTrash} />
              </IconButton>
            </Tooltip>
          )}
        </ActionButtonGroup>
      </HeaderBox>

      <AgentTagsAndCategories tags={agent.tags} categories={agent.categories} />
      <MetaInfoContainer>
        <Typography variant="body2">
          Created by: {agent.account_metadata?.name ?? "Unknown"} ({agent.account_metadata?.email ?? "No email"})
        </Typography>
        <Typography variant="body2">
          Created: {formatDistanceToNowStrict(new Date(agent.created_at))} ago ({new Date(agent.created_at).toLocaleDateString()})
        </Typography>
        <Typography variant="body2">
          Updated: {formatDistanceToNowStrict(new Date(agent.updated_at))} ago ({new Date(agent.updated_at).toLocaleDateString()})
        </Typography>
      </MetaInfoContainer>

      <DescriptionBox>
        <Typography variant="body1">{agent.description || "No description provided."}</Typography>
      </DescriptionBox>

      <Divider sx={{ my: 3 }} />

      <CommentsSection agentId={agent.id} />

      <Dialog
        open={isDelistDialogOpen}
        onClose={handleCloseDelistDialog}
        aria-labelledby="delist-dialog-title"
        aria-describedby="delist-dialog-description"
      >
        <DialogTitle id="delist-dialog-title">Confirm Delist Agent</DialogTitle>
        <DialogContent>
          <DialogContentText id="delist-dialog-description">
            Are you sure you want to permanently delist "{agent.name}"? This action cannot be undone.
            Nobody will be able to download this agent anymore. You can re-upload it later if you choose.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDelistDialog} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelist}
            color="error"
            disabled={delistMutation.isPending}
            autoFocus
          >
            {delistMutation.isPending ? <CircularProgress size={24} /> : "Delist"}
          </Button>
        </DialogActions>
      </Dialog>
    </DetailsContainer>
  );
};
