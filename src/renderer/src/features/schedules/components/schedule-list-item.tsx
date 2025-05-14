import type { FC } from "react";
import { Box, Typography, IconButton, Paper } from "@mui/material";
import { Edit, Trash2, PlayCircle, PauseCircle } from "lucide-react";
import type { ScheduleResponse } from "@shared/api/local-operator";
import { styled } from "@mui/material/styles";

type ScheduleListItemProps = {
	schedule: ScheduleResponse;
	onEdit: (schedule: ScheduleResponse) => void;
	onDelete: (scheduleId: string) => void;
	onToggleActive: (schedule: ScheduleResponse) => void;
};

const ListItemPaper = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2),
	marginBottom: theme.spacing(2),
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	backgroundImage: "none", // Ensure no MUI paper default background image
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	"&:hover": {
		borderColor: theme.palette.text.secondary,
	},
}));

const ScheduleInfo = styled(Box)({
	flexGrow: 1,
});

const ScheduleActions = styled(Box)(({ theme }) => ({
	display: "flex",
	gap: theme.spacing(1),
}));

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
	return (
		<ListItemPaper elevation={0}>
			<ScheduleInfo>
				<Typography variant="subtitle1" fontWeight="medium">
					{schedule.name || `Schedule ID: ${schedule.id.substring(0, 8)}...`}
				</Typography>
				<Typography variant="body2" color="text.secondary">
					Prompt: {schedule.prompt.length > 100 ? `${schedule.prompt.substring(0, 97)}...` : schedule.prompt}
				</Typography>
				<Typography variant="caption" color="text.secondary">
					Interval: Every {schedule.interval} {schedule.unit}
					{schedule.one_time ? " (One-time)" : ""}
				</Typography>
				<Typography variant="caption" display="block" color="text.secondary">
					Agent ID: {schedule.agent_id.substring(0,8)}...
				</Typography>
				<Typography variant="caption" display="block" color={schedule.is_active ? "success.main" : "error.main"}>
					Status: {schedule.is_active ? "Active" : "Inactive"}
				</Typography>
			</ScheduleInfo>
			<ScheduleActions>
				<IconButton onClick={() => onToggleActive(schedule)} size="small" title={schedule.is_active ? "Deactivate" : "Activate"}>
					{schedule.is_active ? <PauseCircle size={20} /> : <PlayCircle size={20} />}
				</IconButton>
				<IconButton onClick={() => onEdit(schedule)} size="small" title="Edit Schedule">
					<Edit size={20} />
				</IconButton>
				<IconButton onClick={() => onDelete(schedule.id)} size="small" title="Delete Schedule">
					<Trash2 size={20} />
				</IconButton>
			</ScheduleActions>
		</ListItemPaper>
	);
};
