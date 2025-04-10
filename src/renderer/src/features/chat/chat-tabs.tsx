import { faCode, faCommentDots } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tab, Tabs, alpha, styled } from "@mui/material";
import type { FC } from "react";

/**
 * Props for the ChatTabs component
 */
type ChatTabsProps = {
	activeTab: "chat" | "raw";
	onChange: (newTab: "chat" | "raw") => void;
};

const StyledTabs = styled(Tabs)(({ theme }) => ({
	borderBottom: `1px solid ${alpha(theme.palette.divider, 0.05)}`,
	minHeight: "42px",
	"& .MuiTabs-indicator": {
		height: 2,
		borderRadius: "2px 2px 0 0",
	},
}));

const StyledTab = styled(Tab, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive?: boolean }>(({ theme, isActive }) => ({
	minHeight: "42px",
	padding: "4px 0",
	textTransform: "none",
	fontSize: "0.85rem",
	fontWeight: 500,
	transition: "all 0.2s ease",
	opacity: isActive ? 1 : 0.7,
	"&:hover": {
		opacity: 1,
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.common.black,
			0.05,
		),
	},
	"& .MuiTab-iconWrapper": {
		marginRight: 6,
		fontSize: "0.9rem",
	},
}));

/**
 * ChatTabs Component
 *
 * Displays tabs for switching between chat and raw views
 */
export const ChatTabs: FC<ChatTabsProps> = ({ activeTab, onChange }) => {
	return (
		<StyledTabs
			value={activeTab}
			onChange={(_, newValue) => onChange(newValue)}
			variant="fullWidth"
			TabIndicatorProps={{
				style: {
					transition: "all 0.3s ease",
				},
			}}
		>
			<StyledTab
				icon={<FontAwesomeIcon icon={faCommentDots} />}
				iconPosition="start"
				label="Chat"
				value="chat"
				isActive={activeTab === "chat"}
			/>
			<StyledTab
				icon={<FontAwesomeIcon icon={faCode} />}
				iconPosition="start"
				label="Raw"
				value="raw"
				isActive={activeTab === "raw"}
			/>
		</StyledTabs>
	);
};
