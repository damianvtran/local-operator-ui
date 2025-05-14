import type { FC } from "react";
import { Box, Typography, IconButton, Paper, Skeleton, Chip } from "@mui/material";
import { Edit, Trash2, User } from "lucide-react";
import type { ScheduleResponse } from "@shared/api/local-operator";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { useQuery } from "@tanstack/react-query";
import { alpha, styled } from "@mui/material/styles";
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
	backgroundImage: "none",
	border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	borderRadius: theme.shape.borderRadius,
  transition: "border-color 0.2s ease",
	"&:hover": {
		borderColor: alpha(theme.palette.divider, 0.4),
	},
}));

const PromptSection = styled(Box)({
	gridArea: "prompt",
	wordBreak: "break-word",
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
	alignSelf: "start",
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
				return "Agent ID";
			}
			const response = await AgentsApi.getAgent(baseUrl, agentId);
			return response.result?.name || "Unknown Agent";
		},
		enabled: !!agentId && !!baseUrl,
		staleTime: 1000 * 60 * 5,
	});
};

/**
 * ScheduleListItem component
 *
 * Displays a single schedule item with actions to edit, delete, and toggle active state.
 *
 * @param schedule - The schedule object to display.
 * @param onEdit - Callback for editing the schedule.
 * @param onDelete - Callback for deleting the schedule.
 * @param onToggleActive - Callback for toggling the schedule's active state.
 * @throws Will throw if agent name cannot be fetched.
 */
export const ScheduleListItem: FC<ScheduleListItemProps> = ({
	schedule,
	onEdit,
	onDelete,
}) => {
	const { data: agentName, isLoading: isLoadingAgentName } = useAgentName(
		schedule.agent_id,
	);

	return (
		<ListItemPaper elevation={0}>
			<PromptSection>
				<Typography variant="body2" color="text.secondary" fontSize="0.875rem" sx={{ mt: 0.5 }}>
					{schedule.prompt}
				</Typography>
			</PromptSection>

			<ActionsSection>
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
				<Box sx={{ display: "flex", alignItems: "center", minHeight: 28 }}>
					{isLoadingAgentName ? (
						<Skeleton
							width={80}
							height={28}
							variant="rectangular"
							sx={{ borderRadius: 1 }}
						/>
					) : (
						<Chip
							icon={<User size={12} style={{ marginLeft: 2 }} />}
							label={agentName || schedule.agent_id.substring(0, 8)}
							variant="outlined"
							color="primary"
							size="small"
							sx={{
								fontSize: "0.75rem",
								height: 24,
								maxWidth: 180,
								overflow: "hidden",
								textOverflow: "ellipsis",
                pl: 1,
                pr: 0.5,
							}}
							aria-label="Agent Name"
						/>
					)}
				</Box>
				<Typography variant="caption" color="text.secondary">
					Every {schedule.interval} {schedule.unit}
					{schedule.one_time ? " (One-time)" : ""}
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
				<Typography
					variant="caption"
					color="text.secondary"
					fontSize="0.75rem"
					sx={{ opacity: 0.6 }}
				>
					ID: {schedule.id}
				</Typography>
			</FooterSection>
		</ListItemPaper>
	);
};
