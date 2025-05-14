import type { FC } from "react";
import { Box, Typography, IconButton, Paper, Skeleton } from "@mui/material";
import { Edit, Trash2, PlayCircle, PauseCircle } from "lucide-react";
import type { ScheduleResponse } from "@shared/api/local-operator";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { useQuery } from "@tanstack/react-query";
import { styled } from "@mui/material/styles";
import { apiConfig } from "@shared/config";

type ScheduleListItemProps = {
	schedule: ScheduleResponse;
	onEdit: (schedule: ScheduleResponse) => void;
	onDelete: (scheduleId: string) => void;
	onToggleActive: (schedule: ScheduleResponse) => void;
};

const ListItemPaper = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2),
	marginBottom: theme.spacing(2),
	display: "grid",
	gridTemplateAreas: `
    "prompt prompt actions"
    "info info info"
    "footer footer footer"
  `,
	gridTemplateColumns: "1fr auto auto",
	gap: theme.spacing(1),
	backgroundImage: "none", // Ensure no MUI paper default background image
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	"&:hover": {
		borderColor: theme.palette.text.secondary,
	},
}));

const PromptSection = styled(Box)({
	gridArea: "prompt",
	wordBreak: "break-word", // Ensure long prompts wrap
});

const InfoSection = styled(Box)(({ theme }) => ({
	gridArea: "info",
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(0.5),
}));

const ActionsSection = styled(Box)(({ theme }) => ({
	gridArea: "actions",
	display: "flex",
	gap: theme.spacing(1),
	alignSelf: "start", // Align to the top of the grid area
}));

const FooterSection = styled(Box)({
	gridArea: "footer",
	display: "flex",
	justifyContent: "flex-end",
	alignItems: "center",
});

const useAgentName = (agentId: string) => {
	const baseUrl = apiConfig.baseUrl;

	return useQuery({
		queryKey: ["agent-name", agentId, baseUrl],
		queryFn: async () => {
			if (!baseUrl) {
				// eslint-disable-next-line no-console
				console.warn("Base URL for Local Operator API is not configured.");
				return "Agent ID"; // Fallback or throw error
			}
			const response = await AgentsApi.getAgent(baseUrl, agentId);
			return response.result?.name || "Unknown Agent";
		},
		enabled: !!agentId && !!baseUrl, // Only run query if agentId and baseUrl are available
		staleTime: 1000 * 60 * 5, // Cache for 5 minutes
	});
};

/**
 * ScheduleListItem component
 *
 * Displays a single schedule item with actions to edit, delete, and toggle active state.
 */
export const ScheduleListItem: FC<ScheduleListItemProps> = ({
	schedule,
	onEdit,
	onDelete,
	onToggleActive,
}) => {
	const { data: agentName, isLoading: isLoadingAgentName } = useAgentName(
		schedule.agent_id,
	);

	return (
		<ListItemPaper elevation={0}>
			<PromptSection>
				<Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
					{schedule.prompt}
				</Typography>
			</PromptSection>

			<ActionsSection>
				<IconButton
					onClick={() => onToggleActive(schedule)}
					size="small"
					title={schedule.is_active ? "Deactivate" : "Activate"}
				>
					{schedule.is_active ? (
						<PauseCircle size={20} />
					) : (
						<PlayCircle size={20} />
					)}
				</IconButton>
				<IconButton
					onClick={() => onEdit(schedule)}
					size="small"
					title="Edit Schedule"
				>
					<Edit size={20} />
				</IconButton>
				<IconButton
					onClick={() => onDelete(schedule.id)}
					size="small"
					title="Delete Schedule"
				>
					<Trash2 size={20} />
				</IconButton>
			</ActionsSection>

			<InfoSection>
				<Typography variant="caption" color="text.secondary">
					Interval: Every {schedule.interval} {schedule.unit}
					{schedule.one_time ? " (One-time)" : ""}
				</Typography>
				<Typography variant="caption" display="block" color="text.secondary">
					Agent:{" "}
					{isLoadingAgentName ? (
						<Skeleton width={80} sx={{ display: "inline-block" }} />
					) : (
						agentName || schedule.agent_id.substring(0, 8)
					)}
				</Typography>
				<Typography
					variant="caption"
					display="block"
					color={schedule.is_active ? "success.main" : "error.main"}
				>
					Status: {schedule.is_active ? "Active" : "Inactive"}
				</Typography>
			</InfoSection>

			<FooterSection>
				<Typography variant="caption" color="text.secondary" fontSize="0.75rem">
					ID: {schedule.id}
				</Typography>
			</FooterSection>
		</ListItemPaper>
	);
};
