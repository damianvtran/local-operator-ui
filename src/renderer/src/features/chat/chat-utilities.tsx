import { faChevronDown, faTools } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Collapse,
	IconButton,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import type { Dispatch, FC, SetStateAction } from "react";
import { DirectoryIndicator } from "./directory-indicator";

/**
 * Props for the ChatUtilities component
 */
type ChatUtilitiesProps = {
	/** The ID of the current agent */
	agentId?: string;
	/** The agent data */
	agentData?: AgentDetails | null;

	// Add props for a use state
	expanded: boolean;
	setExpanded: Dispatch<SetStateAction<boolean>>;
};

const UtilitiesContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(1, 3),
	backgroundColor: alpha(theme.palette.background.paper, 0.4),
	borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}));

const UtilitiesHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	cursor: "pointer",
	padding: theme.spacing(0.5, 0),
	borderRadius: theme.shape.borderRadius,
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.05),
	},
}));

const UtilitiesContent = styled(Box)(({ theme }) => ({
	padding: theme.spacing(1.5, 0, 2.5, 2),
	display: "flex",
	flexWrap: "wrap",
	gap: theme.spacing(1.5),
}));

/**
 * ChatUtilities Component
 *
 * Displays expandable utilities section below the chat input
 * Contains tools like directory indicator and potentially other utilities
 */
export const ChatUtilities: FC<ChatUtilitiesProps> = ({
	agentId,
	agentData,
	expanded,
	setExpanded,
}) => {
	// Toggle the expanded state
	const toggleExpanded = () => {
		setExpanded(!expanded);
	};

	// If no agent is selected, don't render anything
	if (!agentId) return null;

	return (
		<UtilitiesContainer>
			<UtilitiesHeader onClick={toggleExpanded}>
				<IconButton
					size="small"
					sx={{
						mr: 1,
						p: 0.5,
						color: "text.secondary",
						transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
						transition: "transform 0.2s ease",
					}}
					disableRipple
				>
					<FontAwesomeIcon icon={faChevronDown} size="sm" />
				</IconButton>
				<Typography
					variant="caption"
					color="text.secondary"
					sx={{
						display: "flex",
						alignItems: "center",
						fontWeight: 500,
						fontSize: "0.75rem",
					}}
				>
					<FontAwesomeIcon
						icon={faTools}
						size="xs"
						style={{ marginRight: "6px", opacity: 0.7 }}
					/>
					Chat Utilities
				</Typography>
			</UtilitiesHeader>

			<Collapse in={expanded}>
				<UtilitiesContent>
					<DirectoryIndicator
						agentId={agentId}
						currentWorkingDirectory={agentData?.current_working_directory}
					/>
					{/* Additional utilities can be added here */}
				</UtilitiesContent>
			</Collapse>
		</UtilitiesContainer>
	);
};
