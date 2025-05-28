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
import { Bot, FileText } from "lucide-react";
import type { FC } from "react";

/**
 * ChatHeaderProps
 * @property agentName - The name of the agent to display.
 * @property description - The description of the agent.
 * @property onOpenOptions - Optional callback for opening options/canvas.
 */
type ChatHeaderProps = {
	agentName?: string;
	description?: string;
	onOpenOptions?: () => void;
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

const DescriptionBox = styled(Box)({
	display: "flex",
	flexDirection: "column",
	width: "90%",
});

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
			data-tour-tag="chat-header"
		>
			<Avatar
				sx={(theme) => ({
					bgcolor: theme.palette.icon.background,
					color: theme.palette.icon.text,
					mr: 2,
				})}
			>
				<Bot size={24} />
			</Avatar>
			<DescriptionBox>
				<Typography
					variant="h6"
					sx={{
						fontWeight: 400,
						lineHeight: 1.5,
						fontSize: "1.4rem",
						mb: 0,
					}}
				>
					{agentName}
				</Typography>
				<Typography
					variant="caption"
					color="text.secondary"
					sx={{
						lineHeight: 1.5,
						mt: 0,
						fontSize: "0.875rem",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						width: "100%", // Truncate as a percentage of parent container
						display: "block",
					}}
					title={description}
				>
					{description}
				</Typography>
			</DescriptionBox>

			{onOpenOptions && !isCanvasOpen && (
				<Tooltip title="Open Canvas" arrow placement="top">
					<OptionsButton
						onClick={() => setCanvasOpen(true)}
						size="medium"
						data-tour-tag="open-canvas-button"
					>
						<FileText size={24} strokeWidth={1.5} />
					</OptionsButton>
				</Tooltip>
			)}
		</Box>
	);
};
