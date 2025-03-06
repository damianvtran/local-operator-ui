/**
 * Agent List Item Component
 *
 * Displays a single agent in the list with basic information
 */

import { Box, Card, CardContent, Chip, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { AgentOptionsMenu } from "@renderer/components/common/agent-options-menu";
import React from "react";
import type { FC } from "react";

type AgentListItemProps = {
	/** Agent data to display */
	agent: AgentDetails;
	/** Whether this agent is selected */
	isSelected?: boolean;
	/** Click handler for the agent item */
	onClick?: () => void;
	/** Optional callback when an agent is deleted */
	onAgentDeleted?: (agentId: string) => void;
};

interface StyledComponentProps {
	isSelected?: boolean;
}

const StyledCard = styled(Card, {
	shouldForwardProp: (prop) => prop !== "isSelected",
})<StyledComponentProps>(({ theme, isSelected }) => ({
	marginBottom: 20,
	cursor: "pointer",
	transition:
		"background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
	borderRadius: 8,
	backgroundColor: isSelected
		? alpha(theme.palette.primary.main, 0.08)
		: theme.palette.background.paper,
	border: isSelected
		? `1px solid ${theme.palette.primary.main}`
		: "1px solid transparent",
	"&:hover": {
		boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.08)}`,
		backgroundColor: !isSelected
			? alpha(theme.palette.background.default, 0.7)
			: alpha(theme.palette.primary.main, 0.12),
	},
	position: "relative",
	overflow: "visible",
	willChange: "background-color, border-color, box-shadow",
}));

const StyledCardContent = styled(CardContent)({
	padding: 20,
});

const HeaderContainer = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 12,
});

const AgentTitle = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "isSelected",
})<StyledComponentProps>(({ theme, isSelected }) => ({
	fontWeight: 600,
	fontSize: "1.1rem",
	lineHeight: 1.2,
	color: isSelected ? theme.palette.primary.main : "inherit",
}));

const HeaderActionsContainer = styled(Box)({
	display: "flex",
	alignItems: "center",
	gap: 8,
});

const ModelChip = styled(Chip)({
	fontWeight: 500,
	borderRadius: 8,
	"& .MuiChip-label": {
		paddingLeft: 8,
		paddingRight: 8,
	},
});

const MenuContainer = styled(Box)({
	width: 32,
	height: 32,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	position: "relative",
	zIndex: 1,
});

const DescriptionText = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "hasDescription",
})<{ hasDescription: boolean }>(({ theme, hasDescription }) => ({
	marginBottom: 16,
	lineHeight: 1.5,
	color: "text.primary",
	backgroundColor: alpha(theme.palette.background.default, 0.5),
	padding: 12,
	borderRadius: 8,
	borderLeft: `3px solid ${alpha(theme.palette.primary.main, 0.6)}`,
	maxHeight: "80px",
	overflow: "auto",
	"&::-webkit-scrollbar": {
		width: "4px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "4px",
	},
	fontStyle: hasDescription ? "normal" : "italic",
	opacity: hasDescription ? 1 : 0.7,
}));

const MetadataContainer = styled(Box)({
	display: "flex",
	flexWrap: "wrap",
	gap: 16,
	marginBottom: 16,
	opacity: 0.8,
});

const MetadataText = styled(Typography)({
	fontSize: "0.8rem",
});

const TagsContainer = styled(Box)({
	display: "flex",
	gap: 12,
	flexWrap: "wrap",
});

const TagChip = styled(Chip)({
	borderRadius: 8,
	height: 24,
	"& .MuiChip-label": {
		paddingLeft: 8,
		paddingRight: 8,
	},
});

/**
 * Agent List Item Component
 *
 * Displays a single agent in the list with basic information
 */
export const AgentListItem: FC<AgentListItemProps> = ({
	agent,
	isSelected = false,
	onClick,
	onAgentDeleted,
}) => {
	const createdDate = new Date(agent.created_date).toLocaleDateString();

	return (
		<StyledCard
			isSelected={isSelected}
			onClick={onClick}
			data-testid={`agent-item-${agent.id}`}
		>
			<StyledCardContent>
				<HeaderContainer>
					<AgentTitle variant="h6" isSelected={isSelected}>
						{agent.name}
					</AgentTitle>

					<HeaderActionsContainer>
						{agent.model && (
							<ModelChip
								label={agent.model}
								size="small"
								color="primary"
								variant="outlined"
								title="AI model powering this agent"
							/>
						)}

						<MenuContainer>
							<AgentOptionsMenu
								agentId={agent.id}
								agentName={agent.name}
								onAgentDeleted={onAgentDeleted}
								isAgentsPage={true}
								buttonSx={{
									".MuiListItem-root:hover &": {
										opacity: 0.6,
									},
									".MuiCard-root:hover &": {
										opacity: 0.6,
									},
									width: "100%",
									height: "100%",
									borderRadius: "8px",
									padding: 0,
									minWidth: "unset",
								}}
							/>
						</MenuContainer>
					</HeaderActionsContainer>
				</HeaderContainer>

				<DescriptionText variant="body2" hasDescription={!!agent.description}>
					{agent.description || "No description available"}
				</DescriptionText>

				<MetadataContainer>
					<MetadataText
						variant="body2"
						color="text.secondary"
						title="Unique identifier for this agent"
					>
						ID: {agent.id}
					</MetadataText>
					<MetadataText
						variant="body2"
						color="text.secondary"
						title="When this agent was created"
					>
						Created: {createdDate}
					</MetadataText>
				</MetadataContainer>

				<TagsContainer>
					<TagChip
						label={`v${agent.version}`}
						size="small"
						color="secondary"
						variant="outlined"
						title="Agent version number"
					/>
					{agent.hosting && (
						<TagChip
							label={agent.hosting}
							size="small"
							color="info"
							variant="outlined"
							title="Where this agent is hosted"
						/>
					)}
				</TagsContainer>
			</StyledCardContent>
		</StyledCard>
	);
};
