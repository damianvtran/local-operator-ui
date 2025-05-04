import type React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  IconButton,
  Tooltip,
  Button,
  Divider,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import {
  faArrowLeft,
  faHeart as faHeartSolid,
  faStar as faStarSolid,
  faDownload,
} from "@fortawesome/free-solid-svg-icons";
import {
  faHeart as faHeartOutline,
  faStar as faStarOutline,
} from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAgentDetailsQuery } from "./hooks/use-agent-details-query";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatDistanceToNowStrict } from "date-fns";
import { CommentsSection } from "./components/comments-section"; // Import CommentsSection

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

const AgentName = styled(Typography)(({ theme }) => ({
  fontWeight: 500,
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

/**
 * Renders the detailed view for a specific public agent.
 */
export const AgentDetailsPage: React.FC = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useRadientAuth();

  const { data: agent, isLoading, error } = useAgentDetailsQuery({
    agentId: agentId ?? "", // Ensure agentId is not undefined
    enabled: !!agentId, // Only run query if agentId exists
  });

  // TODO: Fetch like/favourite status for the current user
  const isLiked = false; // Placeholder
  const isFavourited = false; // Placeholder
  const downloadCount = 0; // Placeholder

  // Placeholder handlers - TODO: Implement actual logic with mutations
  const handleLikeToggle = () => {
    if (!agentId) return;
    console.log("Toggle like for agent:", agentId);
    // Invalidate/update queries after mutation
  };

  const handleFavouriteToggle = () => {
    if (!agentId) return;
    console.log("Toggle favourite for agent:", agentId);
    // Invalidate/update queries after mutation
  };

  const handleDownload = () => {
    if (!agentId) return;
    console.log("Download agent:", agentId);
    // Implement download logic
  };

  const handleBack = () => {
    navigate("/agent-hub"); // Navigate back to the hub list
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
            <FontAwesomeIcon icon={faArrowLeft} />
          </BackButton>
          <AgentName variant="h4">{agent.name}</AgentName>
        </TitleBox>
        <ActionButtonGroup>
          <AuthTooltipWrapper>
            <IconButton
              size="medium"
              onClick={handleLikeToggle}
              disabled={!isAuthenticated}
              sx={{ color: likeColor }}
              aria-label={isLiked ? "Unlike agent" : "Like agent"}
            >
              <FontAwesomeIcon icon={likeIcon} />
              {/* TODO: Display like count? */}
            </IconButton>
          </AuthTooltipWrapper>
          <AuthTooltipWrapper>
            <IconButton
              size="medium"
              onClick={handleFavouriteToggle}
              disabled={!isAuthenticated}
              sx={{ color: favouriteColor }}
              aria-label={isFavourited ? "Unfavourite agent" : "Favourite agent"}
            >
              <FontAwesomeIcon icon={favouriteIcon} />
              {/* TODO: Display favourite count? */}
            </IconButton>
          </AuthTooltipWrapper>
          <Button
            variant="contained"
            startIcon={<FontAwesomeIcon icon={faDownload} />}
            onClick={handleDownload}
            sx={{ ml: 2 }} // Add margin left
          >
            Download ({downloadCount})
          </Button>
        </ActionButtonGroup>
      </HeaderBox>

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
        {/* TODO: Add Tags/Categories if available */}
      </MetaInfoContainer>

      <DescriptionBox>
        <Typography variant="body1">{agent.description || "No description provided."}</Typography>
      </DescriptionBox>

      <Divider sx={{ my: 3 }} />

      {/* Render Comments Section */}
      <CommentsSection agentId={agent.id} />
    </DetailsContainer>
  );
};
