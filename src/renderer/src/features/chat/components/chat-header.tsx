import { faFileAlt, faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Avatar,
	Box,
	IconButton,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC } from "react";
type ChatHeaderProps = {
	agentName?: string;
	description?: string;
	onOpenOptions?: () => void; // Kept for backward compatibility
};

const OptionsButton = styled(IconButton)(({ theme }) => ({
	marginLeft: "auto",
	color: theme.palette.text.secondary,
	width: "48px",
	height: "48px",
	cursor: "pointer",
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
		color: theme.palette.primary.main,
		transform: "translateY(-1px)",
	},
}));

export const ChatHeader: FC<ChatHeaderProps> = ({
	agentName = "Local Operator",
	description = "Your on-device AI assistant",
	onOpenOptions,
}) => {
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);

	return (
		<Box
			sx={(theme) => ({
				p: 2,
				borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
				display: "flex",
				alignItems: "center",
				height: "84px",
			})}
		>
			<Avatar
				sx={(theme) => ({
					bgcolor: theme.palette.icon.background,
					color: theme.palette.icon.text,
					mr: 2,
				})}
			>
				<FontAwesomeIcon icon={faRobot} />
			</Avatar>
			<Box>
				<Typography variant="h6" sx={{ fontWeight: 500 }}>
					{agentName}
				</Typography>
				<Typography variant="caption" color="text.secondary">
					{description}
				</Typography>
			</Box>

			{onOpenOptions && !isCanvasOpen && (
				<Tooltip title="Open Canvas" arrow placement="top">
					<OptionsButton onClick={() => setCanvasOpen(true)} size="medium">
						<FontAwesomeIcon icon={faFileAlt} size="sm" />
					</OptionsButton>
				</Tooltip>
			)}
		</Box>
	);
};
