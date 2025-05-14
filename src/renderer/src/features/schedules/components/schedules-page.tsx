import { Box, Typography, Button, CircularProgress, Alert, Paper } from "@mui/material";
import type { FC } from "react";
import { useState } from "react";
import { PlusCircle, CalendarDays } from "lucide-react"; // Added CalendarDays
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
	backgroundImage: "none", // Ensure no MUI paper default background image
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 2, // Slightly more rounded
}));

const NoSchedulesMessage = styled(Typography)(({ theme }) => ({
	textAlign: "center",
	color: theme.palette.text.secondary,
	padding: theme.spacing(4, 0),
}));


/**
 * SchedulesPage component
 *
 * This page displays a list of all agent schedules and allows for managing them.
 */
export const SchedulesPage: FC = () => {
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingSchedule, setEditingSchedule] = useState<ScheduleResponse | null>(null);
	// For now, we'll list all schedules. Agent-specific views can be added later if needed.
	// We might need a way to select an agent if creating a new schedule directly from this page.
	// For simplicity, let's assume for now that creation might require an agentId context,
	// or the API supports creating schedules without an agent initially (though the spec implies agentId for creation).
	// Let's assume we need an agentId for creation for now.
	// This page will primarily show ALL schedules.
	const [selectedAgentIdForCreation, setSelectedAgentIdForCreation] = useState<string | undefined>(undefined);


	const { data: schedulesResponse, isLoading, error, refetch: refetchSchedules } = useListAllSchedules();
	const createScheduleMutation = useCreateScheduleForAgent();
	const editScheduleMutation = useEditSchedule();
	const removeScheduleMutation = useRemoveSchedule();

	const handleOpenForm = (schedule?: ScheduleResponse, agentId?: string) => {
		setEditingSchedule(schedule || null);
		setSelectedAgentIdForCreation(agentId); // Set if creating for a specific agent
		setIsFormOpen(true);
	};

	const handleCloseForm = () => {
		setIsFormOpen(false);
		setEditingSchedule(null);
		setSelectedAgentIdForCreation(undefined);
	};

	const handleSubmitForm = async (
		data: ScheduleCreateRequest | ScheduleUpdateRequest,
		// agentId is passed if creating a new schedule for a specific agent
		// For editing, agentId is inherent to the schedule being edited
		agentIdForCreation?: string,
	) => {
		try {
			if (editingSchedule) {
				await editScheduleMutation.mutateAsync({
					scheduleId: editingSchedule.id,
					scheduleData: data as ScheduleUpdateRequest,
				});
			} else if (agentIdForCreation) { // Require agentId for creation
				await createScheduleMutation.mutateAsync({
					agentId: agentIdForCreation,
					scheduleData: data as ScheduleCreateRequest,
				});
			} else {
				// This case should ideally be handled by disabling the create button
				// or prompting for an agent if no agent context is available.
				// For now, we'll log an error.
				console.error("Agent ID is required to create a new schedule from this page.");
				// You might want to show a user-facing error here.
				return;
			}
			refetchSchedules(); // Refetch schedules after submission
		} catch (err) {
			console.error("Failed to save schedule:", err);
			// Error handling can be enhanced here (e.g., toast notifications)
		}
	};

	const handleDeleteSchedule = async (scheduleId: string) => {
		// Optionally, find the schedule to get its agent_id for more precise cache invalidation
		const scheduleToDelete = schedulesResponse?.result?.schedules.find(s => s.id === scheduleId);
		try {
			await removeScheduleMutation.mutateAsync({ scheduleId, agentId: scheduleToDelete?.agent_id });
			refetchSchedules();
		} catch (err) {
			console.error("Failed to delete schedule:", err);
		}
	};
	
	const handleToggleActive = async (schedule: ScheduleResponse) => {
		try {
			await editScheduleMutation.mutateAsync({
				scheduleId: schedule.id,
				scheduleData: { is_active: !schedule.is_active },
			});
			refetchSchedules();
		} catch (err) {
			console.error("Failed to toggle schedule active state:", err);
		}
	};


	// TODO: Implement agent selection for creating new schedules if not in an agent-specific context
	// For now, the "Create Schedule" button might be disabled or simplified.
	// A simple approach: have a TextField to input agentId before opening create dialog.
	// Or, this page only lists, and creation happens from an agent's detail page.
	// For this iteration, let's assume we can select an agent or it's a global schedule.
	// The API spec has POST /v1/agents/{agent_id}/schedules, so agent_id is needed.
	// We can add a temporary input for agentId for testing.

	const schedules = schedulesResponse?.result?.schedules || [];

	return (
		<Box sx={{ p: 3, height: "100%", display: "flex", flexDirection: "column" }}>
			<PageHeader
				title="Schedules"
				icon={CalendarDays} // Added icon prop
				subtitle="View and manage all agent schedules."
			>
				{/* Button is now passed as children */}
				<Button
					variant="contained"
					color="primary"
					startIcon={<PlusCircle size={18} />}
					onClick={() => {
						const tempAgentId = prompt("Enter Agent ID to create schedule for (or leave blank for a general schedule if supported by API - currently requires agentId):");
						// Updated prompt to reflect current API requirement
						if (tempAgentId) {
							handleOpenForm(undefined, tempAgentId);
						} else {
							// Potentially open a different dialog or show an error if agentId is strictly required
							alert("Agent ID is required to create a schedule via the current API structure.");
						}
					}}
					sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 500 }}
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
				agentId={selectedAgentIdForCreation || editingSchedule?.agent_id}
			/>
		</Box>
	);
};
