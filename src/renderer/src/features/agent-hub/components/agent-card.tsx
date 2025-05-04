import type React from "react";
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Skeleton, // Import Skeleton
} from "@mui/material";
import { styled } from "@mui/material/styles";
import {
  faHeart as faHeartSolid,
  faStar as faStarSolid,
  faDownload,
} from "@fortawesome/free-solid-svg-icons";
import {
  faHeart as faHeartOutline,
  faStar as faStarOutline,
} from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useNavigate } from "react-router-dom";
import type { Agent } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
// No longer need useConfig here as it's handled in the hooks
import { formatDistanceToNowStrict } from "date-fns";
import { useAgentLikeCountQuery } from "../hooks/use-agent-like-count-query";
import { useAgentFavouriteCountQuery } from "../hooks/use-agent-favourite-count-query";
import { useAgentDownloadCountQuery } from "../hooks/use-agent-download-count-query";

type AgentCardProps = {
  agent: Agent;
  isLiked: boolean;
  isFavourited: boolean;
  onLikeToggle: (agentId: string) => void;
  onFavouriteToggle: (agentId: string) => void;
  onDownload: (agentId: string) => void;
};

const CountDisplay = styled("span")(({ theme }) => ({
  fontSize: "0.8rem", // Slightly larger for visibility
  marginLeft: theme.spacing(0.75), // Adjust spacing
  color: theme.palette.text.secondary,
  display: "inline-flex", // Align skeleton properly
  alignItems: "center",
  minWidth: "20px", // Ensure skeleton has some width
  height: "1em", // Match font size height
}));

const StyledCard = styled(Card)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  height: "100%", // Ensure card takes full height of grid item
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  transition: "box-shadow 0.3s ease-in-out",
  "&:hover": {
    boxShadow: theme.shadows[4],
    cursor: "pointer",
  },
}));

const StyledCardContent = styled(CardContent)({
  flexGrow: 1, // Allow content to expand
  paddingBottom: 0, // Remove default bottom padding
});

const AgentName = styled(Typography)(({ theme }) => ({
  fontWeight: 500,
  marginBottom: theme.spacing(1),
  // Truncate long names
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}));

const AgentDescription = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.secondary,
  marginBottom: theme.spacing(2),
  // Limit description lines
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minHeight: "3.9em", // Approx 3 lines height
}));

const MetaInfoContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing(0.5),
  marginBottom: theme.spacing(2),
}));

const MetaInfoItem = styled(Typography)(({ theme }) => ({
  fontSize: "0.75rem",
  color: theme.palette.text.secondary,
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(0.5),
}));

const StyledCardActions = styled(CardActions)(({ theme }) => ({
  justifyContent: "space-between",
  padding: theme.spacing(1, 2), // Adjust padding
  borderTop: `1px solid ${theme.palette.divider}`,
}));

const ActionButtonGroup = styled(Box)({
  display: "flex",
  alignItems: "center",
});

const DownloadChip = styled(Chip)(({ theme }) => ({
  marginLeft: theme.spacing(1),
  fontSize: "0.75rem",
  height: "24px",
}));

/**
 * Renders a card displaying information about a public agent.
 */
export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  isLiked,
  isFavourited,
  onLikeToggle,
  onFavouriteToggle,
  onDownload,
}) => {
  const navigate = useNavigate();
  const { isAuthenticated } = useRadientAuth();

  // Use the React Query hooks
  const { data: likeCount, isLoading: isLoadingLikes } = useAgentLikeCountQuery({
    agentId: agent.id,
    enabled: isAuthenticated, // Only fetch if authenticated
  });
  const { data: favouriteCount, isLoading: isLoadingFavourites } = useAgentFavouriteCountQuery({
    agentId: agent.id,
    enabled: isAuthenticated,
  });
  const { data: downloadCount, isLoading: isLoadingDownloads } = useAgentDownloadCountQuery({
    agentId: agent.id,
    enabled: isAuthenticated,
  });

  const handleCardClick = () => {
    navigate(`/agent-hub/${agent.id}`); // Navigate to detail page
  };

  const handleActionClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: (agentId: string) => void,
  ) => {
    event.stopPropagation(); // Prevent card click navigation
    if (isAuthenticated) {
      action(agent.id);
    }
    // Tooltip handles the 'not authenticated' case
  };

  const handleDownloadClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDownload(agent.id);
    // TODO: Implement download logic (potentially needs backend interaction)
    console.log("Download clicked for agent:", agent.id);
  };

  const likeIcon = isLiked ? faHeartSolid : faHeartOutline;
  const likeColor = isLiked ? "error.main" : "inherit"; // Use theme color for liked state
  const favouriteIcon = isFavourited ? faStarSolid : faStarOutline;
  const favouriteColor = isFavourited ? "warning.main" : "inherit"; // Use theme color for favourited state

  const AuthTooltipWrapper: React.FC<{ children: React.ReactElement }> = ({ children }) =>
    isAuthenticated ? (
      children
    ) : (
      <Tooltip title="Sign in to Radient to use this feature">
        {/* Need a span wrapper for disabled elements */}
        <span>{children}</span>
      </Tooltip>
    );

  return (
    <StyledCard onClick={handleCardClick}>
      <StyledCardContent>
        <AgentName variant="h6">{agent.name}</AgentName>
        <AgentDescription variant="body2">{agent.description}</AgentDescription>
        <MetaInfoContainer>
          <MetaInfoItem>
            Creator: {agent.account_metadata?.name ?? "Unknown"} ({agent.account_metadata?.email ?? "No email"})
          </MetaInfoItem>
          <MetaInfoItem>
            Created: {formatDistanceToNowStrict(new Date(agent.created_at))} ago
          </MetaInfoItem>
          <MetaInfoItem>
            Updated: {formatDistanceToNowStrict(new Date(agent.updated_at))} ago
          </MetaInfoItem>
        </MetaInfoContainer>
      </StyledCardContent>
      <StyledCardActions>
        <ActionButtonGroup>
          <AuthTooltipWrapper>
            <IconButton
              size="small"
              onClick={(e) => handleActionClick(e, onLikeToggle)}
              disabled={!isAuthenticated}
              sx={{ color: likeColor }}
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
              size="small"
              onClick={(e) => handleActionClick(e, onFavouriteToggle)}
              disabled={!isAuthenticated}
              sx={{ color: favouriteColor }}
              aria-label={isFavourited ? "Unfavourite agent" : "Favourite agent"}
            >
              <FontAwesomeIcon icon={favouriteIcon} />
              <CountDisplay>
                {isLoadingFavourites ? <Skeleton variant="text" width={20} /> : favouriteCount ?? 0}
              </CountDisplay>
            </IconButton>
          </AuthTooltipWrapper>
        </ActionButtonGroup>
        <ActionButtonGroup>
          <IconButton
            size="small"
            onClick={handleDownloadClick}
            aria-label="Download agent"
          >
            <FontAwesomeIcon icon={faDownload} />
          </IconButton>
          {isLoadingDownloads ? (
            <Skeleton variant="rounded" width={100} height={24} sx={{ ml: 1 }} />
          ) : (
            <DownloadChip
              label={`${downloadCount ?? 0} Download${downloadCount !== 1 ? "s" : ""}`}
              size="small"
              variant="outlined"
            />
          )}
        </ActionButtonGroup>
      </StyledCardActions>
    </StyledCard>
  );
};
