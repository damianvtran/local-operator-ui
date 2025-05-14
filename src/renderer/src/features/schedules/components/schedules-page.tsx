import { Box, Typography, Button, CircularProgress, Alert, Paper, useTheme } from "@mui/material";
import type { FC } from "react";
import { useState } from "react";
import { PlusCircle, CalendarDays } from "lucide-react";
import { toast } from "react-toastify";
import {
	useListAllSchedules,
	useCreateScheduleForAgent,
	useEditSchedule,
	useRemoveSchedule,
} from "../hooks/use-schedules-queries";
import { ScheduleListItem } from "./schedule-list-item";
import { ScheduleFormDialog } from "./schedule-form-dialog";
import type { ScheduleCreateRequest, ScheduleResponse, ScheduleUpdateRequest } from "@shared/api/local-operator";
import { PageHeader } from "@shared/components/common/page-header";
import { styled } from "@mui/material/styles";

const SchedulesContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(3),
	marginTop: theme.spacing(2),
	backgroundImage: "none",
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 2,
}));

const NoSchedulesMessage = styled(Typography)(({ theme }) => ({
	textAlign: "center",
	color: theme.palette.text.secondary,
	padding: theme.spacing(4, 0),
}));

/**
 * SchedulesPage component
 * This page displays a list of all agent schedules and allows for managing them.
 */
export const SchedulesPage: FC = () => {
	const theme = useTheme();
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingSchedule, setEditingSchedule] = useState<ScheduleResponse | null>(null);

	const {
		data: schedulesResponse,
		isLoading,
		error,
		refetch: refetchSchedules,
	} = useListAllSchedules();
	const createScheduleMutation = useCreateScheduleForAgent();
	const editScheduleMutation = useEditSchedule();
	const removeScheduleMutation = useRemoveSchedule();

	const handleOpenForm = (schedule?: ScheduleResponse) => {
		setEditingSchedule(schedule || null);
		setIsFormOpen(true);
	};

	const handleCloseForm = () => {
		setIsFormOpen(false);
		setEditingSchedule(null);
	};

	const handleSubmitForm = async (
		data: ScheduleCreateRequest | ScheduleUpdateRequest,
		agentId: string, // agentId is now directly passed from ScheduleFormDialog
	) => {
		try {
			if (editingSchedule) {
				// Editing an existing schedule
				await editScheduleMutation.mutateAsync({
					scheduleId: editingSchedule.id,
					scheduleData: data as ScheduleUpdateRequest,
				});
				toast.success("Schedule updated successfully!");
			} else {
				// Creating a new schedule
				await createScheduleMutation.mutateAsync({
					agentId: agentId, // Use the agentId selected in the form
					scheduleData: data as ScheduleCreateRequest,
				});
				toast.success("Schedule created successfully!");
			}
			refetchSchedules();
		} catch (err) {
			console.error("Failed to save schedule:", err);
			toast.error(`Failed to save schedule: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleDeleteSchedule = async (scheduleId: string) => {
		const scheduleToDelete = schedulesResponse?.result?.schedules.find(s => s.id === scheduleId);
		try {
			await removeScheduleMutation.mutateAsync({ scheduleId, agentId: scheduleToDelete?.agent_id });
			toast.success("Schedule removed successfully!");
			refetchSchedules();
		} catch (err) {
			console.error("Failed to delete schedule:", err);
			toast.error(`Failed to remove schedule: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};
	
	const handleToggleActive = async (schedule: ScheduleResponse) => {
		try {
			await editScheduleMutation.mutateAsync({
				scheduleId: schedule.id,
				scheduleData: { is_active: !schedule.is_active },
			});
			toast.success(`Schedule ${schedule.is_active ? "deactivated" : "activated"} successfully!`);
			refetchSchedules();
		} catch (err) {
			console.error("Failed to toggle schedule active state:", err);
			toast.error(`Failed to toggle schedule: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const schedules = schedulesResponse?.result?.schedules || [];

	return (
		<Box sx={{ p: 3, height: "100%", display: "flex", flexDirection: "column" }}>
			<PageHeader
				title="Schedules"
				icon={CalendarDays}
				subtitle="View and manage all agent schedules."
			>
				<Button
					variant="contained"
					color="primary"
					startIcon={<PlusCircle size={18} />}
					onClick={() => handleOpenForm()} // Opens ScheduleFormDialog for new schedule
					sx={{
						textTransform: "none",
						fontSize: "0.8125rem",
						padding: theme.spacing(0.75, 1.75),
						borderRadius: theme.shape.borderRadius * 0.75,
						fontWeight: 500,
						"&:hover": {
							backgroundColor: theme.palette.primary.dark,
						},
					}}
				>
					Create Schedule
				</Button>
			</PageHeader>

			<SchedulesContainer elevation={0} sx={{ flexGrow: 1, overflowY: 'auto' }}>
				{isLoading && <CircularProgress sx={{ display: 'block', margin: 'auto', mt: 4 }} />}
				{error && <Alert severity="error" sx={{ mt: 2 }}>Error fetching schedules: {error.message}</Alert>}
				{!isLoading && !error && schedules.length === 0 && (
					<NoSchedulesMessage>
						No schedules found. Click "Create Schedule" to add one.
					</NoSchedulesMessage>
				)}
				{!isLoading && !error && schedules.length > 0 && (
					<Box sx={{ mt: 2 }}>
						{schedules.map((schedule) => (
							<ScheduleListItem
								key={schedule.id}
								schedule={schedule}
								onEdit={() => handleOpenForm(schedule)}
								onDelete={handleDeleteSchedule}
								onToggleActive={handleToggleActive}
							/>
						))}
					</Box>
				)}
			</SchedulesContainer>

			<ScheduleFormDialog
				open={isFormOpen}
				onClose={handleCloseForm}
				onSubmit={handleSubmitForm}
				initialData={editingSchedule}
				// The 'agentId' prop is no longer passed here; it's handled internally by ScheduleFormDialog
			/>
		</Box>
	);
};
