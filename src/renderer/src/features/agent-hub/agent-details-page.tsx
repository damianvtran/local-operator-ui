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
  Avatar,
  ButtonBase,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import {
  Bot,
  ArrowLeft,
  Heart,
  Star,
  Download,
  Trash2,
} from "lucide-react";
import { AgentTagsAndCategories } from "./components/agent-tags-and-categories";
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

// Filled icon replacements using Lucide's two-tone approach
const HeartFilled = (props: React.ComponentProps<typeof Heart>) => (
  <Heart {...props} fill="currentColor" style={{ color: "#e53935" }} />
);
const StarFilled = (props: React.ComponentProps<typeof Star>) => (
  <Star {...props} fill="currentColor" style={{ color: "#ffb300" }} />
);

const DetailsContainer = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4),
  margin: theme.spacing(3),
  backgroundImage: "none",
  backgroundColor: theme.palette.background.default,
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
  gap: 16,
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

const LikeFavouriteButton = styled(ButtonBase, {
  shouldForwardProp: (prop) => prop !== "color",
})<{ color?: string }>(({ theme, color }) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  padding: theme.spacing(0.5, 1),
  color: color ? theme.palette[color].main : theme.palette.text.primary,
  background: "transparent",
  transition: "background 0.2s, color 0.2s",
  "&:hover": {
    background: theme.palette.action.hover,
    textDecoration: "none",
  },
  "&:disabled": {
    opacity: 0.5,
    pointerEvents: "none",
  },
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

  // Lucide icon selection for like/favourite
  // Use slightly larger size for like/favourite icons
  const likeIcon = isLiked ? (
    <HeartFilled size={18} strokeWidth={2.2} />
  ) : (
    <Heart size={18} strokeWidth={2.2} />
  );
  const favouriteIcon = isFavourited ? (
    <StarFilled size={18} strokeWidth={2.2} />
  ) : (
    <Star size={18} strokeWidth={2.2} />
  );

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
            <ArrowLeft size={20} />
          </BackButton>
          <Avatar
            sx={{
              bgcolor: (theme) => theme.palette.icon.background,
              color: (theme) => theme.palette.icon.text,
              width: 44,
              height: 44,
              boxShadow: 2,
              border: (theme) => `2px solid ${theme.palette.primary.main}`,
              mr: 2,
            }}
            variant="circular"
          >
            <Bot size={28} />
          </Avatar>
          <AgentName>{agent.name}</AgentName>
        </TitleBox>
        <ActionButtonGroup>
          <AuthTooltipWrapper>
            <LikeFavouriteButton
              onClick={handleLikeToggle}
              disabled={!isAuthenticated || likeMutation.isPending}
              color={isLiked ? "error" : undefined}
              aria-label={isLiked ? "Unlike agent" : "Like agent"}
              focusRipple
              tabIndex={0}
              type="button"
            >
              {likeIcon}
              <CountDisplay>
                {isLoadingLikes ? <Skeleton variant="text" width={20} /> : likeCount ?? 0}
              </CountDisplay>
            </LikeFavouriteButton>
          </AuthTooltipWrapper>
          <AuthTooltipWrapper>
            <LikeFavouriteButton
              onClick={handleFavouriteToggle}
              disabled={!isAuthenticated || favouriteMutation.isPending}
              color={isFavourited ? "warning" : undefined}
              aria-label={isFavourited ? "Unfavourite agent" : "Favourite agent"}
              focusRipple
              tabIndex={0}
              type="button"
            >
              {favouriteIcon}
              <CountDisplay>
                {isLoadingFavourites ? <Skeleton variant="text" width={20} /> : favouriteCount ?? 0}
              </CountDisplay>
            </LikeFavouriteButton>
          </AuthTooltipWrapper>
          <Tooltip title="Download agent to your computer">
            <span>
              <IconButton
                size="medium"
                onClick={handleDownload}
                disabled={downloadMutation.isPending}
                sx={{ borderRadius: 4, ml: 1 }}
                aria-label="Download agent"
              >
                <Download size={20} />
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
                <Trash2 size={20} />
              </IconButton>
            </Tooltip>
          )}
        </ActionButtonGroup>
      </HeaderBox>

      <AgentTagsAndCategories tags={agent.tags} categories={agent.categories} />
      <MetaInfoContainer>
        <Typography variant="body2" sx={{ fontSize: "0.875rem" }}>
          Created by: {agent.account_metadata?.name ?? "Unknown"} ({agent.account_metadata?.email ?? "No email"})
        </Typography>
        <Typography variant="body2" sx={{ fontSize: "0.875rem" }}>
          Created: {formatDistanceToNowStrict(new Date(agent.created_at))} ago ({new Date(agent.created_at).toLocaleDateString()})
        </Typography>
        <Typography variant="body2" sx={{ fontSize: "0.875rem" }}>
          Updated: {formatDistanceToNowStrict(new Date(agent.updated_at))} ago ({new Date(agent.updated_at).toLocaleDateString()})
        </Typography>
      </MetaInfoContainer>

      <DescriptionBox>
        <Typography variant="body1" sx={{ fontSize: "0.875rem" }}>{agent.description || "No description provided."}</Typography>
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
