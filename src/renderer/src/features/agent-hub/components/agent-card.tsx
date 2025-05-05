import {
	Avatar,
	Box,
	ButtonBase,
	Card,
	CardActions,
	CardContent,
	Chip,
	IconButton,
	Skeleton,
	Tooltip,
	Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { Agent } from "@shared/api/radient/types";
import { formatDistanceToNowStrict } from "date-fns";
import { Bot, Download, Heart, Info, Star } from "lucide-react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { useAgentDownloadCountQuery } from "../hooks/use-agent-download-count-query";
import { useAgentFavouriteCountQuery } from "../hooks/use-agent-favourite-count-query";
import { useAgentLikeCountQuery } from "../hooks/use-agent-like-count-query";
import { useDownloadAgentMutation } from "../hooks/use-download-agent-mutation";
import { AgentTagsAndCategories } from "./agent-tags-and-categories";

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
	height: 410,
	maxHeight: 410,
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

// New AgentDescription style: no minHeight, no line clamp, just ellipsis for single line
const AgentDescription = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(2),
	fontSize: "0.875rem",
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
	width: "fit-content",
	"&:hover": {
		background: theme.palette.action.hover,
		textDecoration: "none",
	},
	"&:disabled": {
		opacity: 0.5,
		pointerEvents: "none",
	},
}));

// Helper function to truncate text with ellipsis if over 140 chars
function truncateWithEllipsis(text: string, maxLength = 140): string {
	if (!text) return "";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 1)}…`;
}

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

	const { data: likeCount, isLoading: isLoadingLikes } = useAgentLikeCountQuery(
		{
			agentId: agent.id,
		},
	);
	const { data: favouriteCount, isLoading: isLoadingFavourites } =
		useAgentFavouriteCountQuery({
			agentId: agent.id,
		});
	const { data: downloadCount, isLoading: isLoadingDownloads } =
		useAgentDownloadCountQuery({
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

	const description = agent.description ?? "";
	const truncatedDescription = truncateWithEllipsis(description, 140);

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
				<Box
					sx={{
						flexGrow: 1,
						minHeight: 0,
						display: "flex",
						flexDirection: "column",
					}}
				>
					{description.length > 140 ? (
						<Tooltip title={description} arrow>
							<span>
								<AgentDescription
									variant="body2"
									sx={{ flexGrow: 1, minHeight: 0 }}
								>
									{truncatedDescription}
								</AgentDescription>
							</span>
						</Tooltip>
					) : (
						<AgentDescription
							variant="body2"
							sx={{ flexGrow: 1, minHeight: 0 }}
						>
							{truncatedDescription}
						</AgentDescription>
					)}
				</Box>
				<Box>
					<AgentTagsAndCategories
						tags={agent.tags}
						categories={agent.categories}
					/>
					<MetaInfoContainer>
						<MetaInfoItem>
							Creator: {agent.account_metadata?.name ?? "Unknown"} (
							{agent.account_metadata?.email ?? "No email"})
						</MetaInfoItem>
						<MetaInfoItem>
							Created: {formatDistanceToNowStrict(new Date(agent.created_at))}{" "}
							ago
						</MetaInfoItem>
						<MetaInfoItem>
							Updated: {formatDistanceToNowStrict(new Date(agent.updated_at))}{" "}
							ago
						</MetaInfoItem>
					</MetaInfoContainer>
				</Box>
			</StyledCardContent>
			<StyledCardActions>
				{showActions ? (
					<ActionButtonGroup>
						<LikeFavouriteButton
							onClick={(e) => handleActionClick(e, onLikeToggle)}
							disabled={isLikeActionLoading}
							color={isLiked ? "error" : undefined}
							aria-label={isLiked ? "Unlike agent" : "Like agent"}
							focusRipple
							tabIndex={0}
							type="button"
						>
							<Heart
								size={18}
								strokeWidth={2}
								fill={isLiked ? "#e53935" : "none"}
								color={isLiked ? "#e53935" : undefined}
								style={{ verticalAlign: "middle" }}
								data-testid="agent-like-heart"
							/>
							<CountDisplay>
								{isLoadingLikes ? (
									<Skeleton variant="text" width={20} />
								) : (
									(likeCount ?? 0)
								)}
							</CountDisplay>
						</LikeFavouriteButton>
						<LikeFavouriteButton
							onClick={(e) => handleActionClick(e, onFavouriteToggle)}
							disabled={isFavouriteActionLoading}
							color={isFavourited ? "warning" : undefined}
							aria-label={
								isFavourited ? "Unfavourite agent" : "Favourite agent"
							}
							focusRipple
							tabIndex={0}
							type="button"
						>
							<Star
								size={18}
								strokeWidth={2}
								fill={isFavourited ? "#ffb300" : "none"}
								color={isFavourited ? "#ffb300" : undefined}
								style={{ verticalAlign: "middle" }}
								data-testid="agent-favourite-star"
							/>
							<CountDisplay>
								{isLoadingFavourites ? (
									<Skeleton variant="text" width={20} />
								) : (
									(favouriteCount ?? 0)
								)}
							</CountDisplay>
						</LikeFavouriteButton>
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
							<Download
								size={18}
								strokeWidth={2}
								style={{ verticalAlign: "middle" }}
								data-testid="agent-download"
							/>
						</IconButton>
					</Tooltip>
					{isLoadingDownloads || downloadMutation.isPending ? (
						<Skeleton
							variant="rounded"
							width={100}
							height={24}
							sx={{ ml: 1 }}
						/>
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
