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
  Avatar,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { Bot, Info } from "lucide-react";
import { AgentTagsAndCategories } from "./agent-tags-and-categories";
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
  isLikeActionLoading?: boolean; // Optional: Loading state for like button
  isFavouriteActionLoading?: boolean; // Optional: Loading state for favourite button
  showActions?: boolean; // Optional: Whether to show like/favourite buttons
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
  height: 320,
  maxHeight: 320,
  border: `1px solid ${theme.palette.divider}`,
  backgroundImage: "none",
  backgroundColor: theme.palette.background.default,
  borderRadius: theme.shape.borderRadius * 2,
  transition: "box-shadow 0.3s, border-color 0.3s",
  "&:hover": {
    boxShadow: theme.shadows[4],
    borderColor: theme.palette.primary.main,
    cursor: "pointer",
  },
  overflow: "hidden",
}));

const StyledCardContent = styled(CardContent)({
  display: "flex",
  flexDirection: "column",
  flexGrow: 1,
  minHeight: 0,
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
 * Renders a card displaying information about a public agent, with avatar and details icon.
 *
 * @param agent - The agent data to display.
 * @param isLiked - Whether the agent is liked by the user.
 * @param isFavourited - Whether the agent is favourited by the user.
 * @param onLikeToggle - Callback for toggling like state.
 * @param onFavouriteToggle - Callback for toggling favourite state.
 * @param isLikeActionLoading - Loading state for like button.
 * @param isFavouriteActionLoading - Loading state for favourite button.
 * @param showActions - Whether to show like/favourite buttons.
 */
export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  isLiked,
  isFavourited,
  onLikeToggle,
  onFavouriteToggle,
  isLikeActionLoading = false,
  isFavouriteActionLoading = false,
  showActions = false,
}) => {
  const navigate = useNavigate();
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
    action(agent.id);
  };

  const handleDownloadClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!downloadMutation.isPending) {
      downloadMutation.mutate({ agentId: agent.id, agentName: agent.name });
    }
  };

  const handleDetailsClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    navigate(`/agent-hub/${agent.id}`);
  };

  const likeIcon = isLiked ? faHeartSolid : faHeartOutline;
  const likeColor = isLiked ? "error.main" : "inherit";
  const favouriteIcon = isFavourited ? faStarSolid : faStarOutline;
  const favouriteColor = isFavourited ? "warning.main" : "inherit";

  return (
    <StyledCard onClick={handleCardClick}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          px: 2,
          pt: 2,
          pb: 0,
        }}
      >
        <Avatar
          sx={{
            bgcolor: (theme) => theme.palette.icon.background,
            color: (theme) => theme.palette.icon.text,
            width: 44,
            height: 44,
            boxShadow: 2,
            border: (theme) => `2px solid ${theme.palette.primary.main}`,
          }}
          variant="circular"
        >
          <Bot size={24} />
        </Avatar>
        {/* @ts-ignore - Tooltip title prop type issue */}
        <Tooltip title="See details">
          <IconButton
            size="small"
            onClick={handleDetailsClick}
            sx={{
              color: (theme) => theme.palette.icon.text,
              borderRadius: 2,
              ml: 1,
            }}
            aria-label="See details"
          >
            <Info size={18} />
          </IconButton>
        </Tooltip>
      </Box>
      <StyledCardContent>
        <AgentName variant="h6">{agent.name}</AgentName>
        <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <AgentDescription variant="body2" sx={{ flexGrow: 1, minHeight: 0 }}>
            {agent.description}
          </AgentDescription>
        </Box>
        <Box>
          <AgentTagsAndCategories tags={agent.tags} categories={agent.categories} />
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
        </Box>
      </StyledCardContent>
      <StyledCardActions>
        {showActions ? (
          <ActionButtonGroup>
            <IconButton
              size="small"
              onClick={(e) => handleActionClick(e, onLikeToggle)}
              disabled={isLikeActionLoading}
              sx={{ color: likeColor, borderRadius: 4 }}
              aria-label={isLiked ? "Unlike agent" : "Like agent"}
            >
              <FontAwesomeIcon icon={likeIcon} size="xs" />
              <CountDisplay>
                {isLoadingLikes ? <Skeleton variant="text" width={20} /> : likeCount ?? 0}
              </CountDisplay>
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => handleActionClick(e, onFavouriteToggle)}
              disabled={isFavouriteActionLoading}
              sx={{ color: favouriteColor, borderRadius: 4 }}
              aria-label={isFavourited ? "Unfavourite agent" : "Favourite agent"}
            >
              <FontAwesomeIcon icon={favouriteIcon} size="xs" />
              <CountDisplay>
                {isLoadingFavourites ? <Skeleton variant="text" width={20} /> : favouriteCount ?? 0}
              </CountDisplay>
            </IconButton>
          </ActionButtonGroup>
        ) : (
          <Box />
        )}
        <ActionButtonGroup>
          <Tooltip title="Download agent to your computer">
            <IconButton
              size="small"
              onClick={handleDownloadClick}
              disabled={downloadMutation.isPending}
              aria-label="Download agent"
            >
              <FontAwesomeIcon icon={faDownload} size="xs" />
            </IconButton>
          </Tooltip>
          {isLoadingDownloads || downloadMutation.isPending ? (
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
