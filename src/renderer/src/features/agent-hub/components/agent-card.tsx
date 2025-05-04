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
  Skeleton,
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
import { formatDistanceToNowStrict } from "date-fns";
import { useAgentLikeCountQuery } from "../hooks/use-agent-like-count-query";
import { useAgentFavouriteCountQuery } from "../hooks/use-agent-favourite-count-query";
import { useAgentDownloadCountQuery } from "../hooks/use-agent-download-count-query";
import { useDownloadAgentMutation } from "../hooks/use-download-agent-mutation"; 

type AgentCardProps = {
  agent: Agent;
  isLiked: boolean;
  isFavourited: boolean;
  onLikeToggle: (agentId: string) => void;
  onFavouriteToggle: (agentId: string) => void;
};

const CountDisplay = styled("span")(({ theme }) => ({
  fontSize: "0.8rem", 
  marginLeft: theme.spacing(0.75), 
  color: theme.palette.text.secondary,
  display: "inline-flex", 
  alignItems: "center",
  minWidth: "20px", 
  height: "1em", 
}));

const StyledCard = styled(Card)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  height: "100%", 
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  transition: "box-shadow 0.3s ease-in-out",
  "&:hover": {
    boxShadow: theme.shadows[4],
    cursor: "pointer",
  },
}));

const StyledCardContent = styled(CardContent)({
  flexGrow: 1, 
  paddingBottom: 0, 
});

const AgentName = styled(Typography)(({ theme }) => ({
  fontWeight: 500,
  marginBottom: theme.spacing(1),
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}));

const AgentDescription = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.secondary,
  marginBottom: theme.spacing(2),
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minHeight: "3.9em",
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
  padding: theme.spacing(1, 2), 
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
}) => {
  const navigate = useNavigate();
  const { isAuthenticated } = useRadientAuth();
  const downloadMutation = useDownloadAgentMutation(); 

  const { data: likeCount, isLoading: isLoadingLikes } = useAgentLikeCountQuery({
    agentId: agent.id,
  });
  const { data: favouriteCount, isLoading: isLoadingFavourites } = useAgentFavouriteCountQuery({
    agentId: agent.id,
  });
  const { data: downloadCount, isLoading: isLoadingDownloads } = useAgentDownloadCountQuery({
    agentId: agent.id,
  });

  const handleCardClick = () => {
    navigate(`/agent-hub/${agent.id}`); 
  };

  const handleActionClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: (agentId: string) => void,
  ) => {
    event.stopPropagation(); 
    if (isAuthenticated) {
      action(agent.id);
    }
  };

  const handleDownloadClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!downloadMutation.isPending) {
      downloadMutation.mutate({ agentId: agent.id, agentName: agent.name });
    }
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
          {/* @ts-ignore - Tooltip title prop type issue */}
          <Tooltip title="Download agent to your local instance">
            <IconButton
              size="small"
              onClick={handleDownloadClick}
              disabled={downloadMutation.isPending} // Use mutation pending state
              aria-label="Download agent"
            >
              <FontAwesomeIcon icon={faDownload} />
            </IconButton>
          </Tooltip>
          {isLoadingDownloads || downloadMutation.isPending ? ( // Use mutation pending state
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
