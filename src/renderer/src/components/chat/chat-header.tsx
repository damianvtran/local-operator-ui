import { faRobot, faSliders } from "@fortawesome/free-solid-svg-icons";
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
import type { FC } from "react";

type ChatHeaderProps = {
	agentName?: string;
	description?: string;
	onOpenOptions?: () => void;
};

const OptionsButton = styled(IconButton)(({ theme }) => ({
	marginLeft: "auto",
	color: theme.palette.text.secondary,
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
	return (
		<Box
			sx={{
				p: 2,
				borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
				display: "flex",
				alignItems: "center",
			}}
		>
			<Avatar
				sx={{
					bgcolor: "rgba(56, 201, 106, 0.2)",
					color: "primary.main",
					mr: 2,
				}}
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

			{onOpenOptions && (
				/* @ts-ignore - Tooltip has issues with TypeScript but works fine */
				<Tooltip title="Chat Options" arrow placement="top">
					<OptionsButton onClick={onOpenOptions} size="medium">
						<FontAwesomeIcon icon={faSliders} />
					</OptionsButton>
				</Tooltip>
			)}
		</Box>
	);
};
