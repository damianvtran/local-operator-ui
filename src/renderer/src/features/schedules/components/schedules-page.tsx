import type {
	ScheduleCreateRequest,
	ScheduleResponse,
	ScheduleUpdateRequest,
} from "@shared/api/local-operator";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button } from "@shared/components/ui";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { CalendarDays, PlusCircle } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import {
	useCreateScheduleForAgent,
	useEditSchedule,
	useListAllSchedules,
	useRemoveSchedule,
} from "../hooks/use-schedules-queries";
import { ScheduleFormDialog } from "./schedule-form-dialog";
import { ScheduleListItem } from "./schedule-list-item";

/**
 * SchedulesPage component
 * This page displays a list of all agent schedules and allows for managing them.
 */
export const SchedulesPage: FC = () => {
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingSchedule, setEditingSchedule] =
		useState<ScheduleResponse | null>(null);

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
				showSuccessToast("Schedule updated successfully!");
			} else {
				// Creating a new schedule
				await createScheduleMutation.mutateAsync({
					agentId: agentId, // Use the agentId selected in the form
					scheduleData: data as ScheduleCreateRequest,
				});
				showSuccessToast("Schedule created successfully!");
			}
			refetchSchedules();
		} catch (err) {
			console.error("Failed to save schedule:", err);
			showErrorToast(
				`Failed to save schedule: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
		}
	};

	const handleDeleteSchedule = async (scheduleId: string) => {
		const scheduleToDelete = schedulesResponse?.result?.schedules.find(
			(s) => s.id === scheduleId,
		);
		try {
			await removeScheduleMutation.mutateAsync({
				scheduleId,
				agentId: scheduleToDelete?.agent_id,
			});
			showSuccessToast("Schedule removed successfully!");
			refetchSchedules();
		} catch (err) {
			console.error("Failed to delete schedule:", err);
			showErrorToast(
				`Failed to remove schedule: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
		}
	};

	const handleToggleActive = async (schedule: ScheduleResponse) => {
		try {
			await editScheduleMutation.mutateAsync({
				scheduleId: schedule.id,
				scheduleData: { is_active: !schedule.is_active },
			});
			showSuccessToast(
				`Schedule ${schedule.is_active ? "deactivated" : "activated"} successfully!`,
			);
			refetchSchedules();
		} catch (err) {
			console.error("Failed to toggle schedule active state:", err);
			showErrorToast(
				`Failed to toggle schedule: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
		}
	};

	const schedules = schedulesResponse?.result?.schedules || [];

	return (
		<div className="flex h-full flex-col p-6">
			<PageHeader
				title="Schedules"
				icon={CalendarDays}
				subtitle="View and manage scheduled tasks for your AI team."
			>
				{/* Opens ScheduleFormDialog for a new schedule */}
				<Button
					variant="outline"
					size="lg"
					onClick={() => handleOpenForm()}
					data-tour-tag="create-schedule-button"
				>
					<PlusCircle />
					Create Schedule
				</Button>
			</PageHeader>

			<div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-hairline bg-surface">
				{isLoading && (
					<div className="flex justify-center py-16">
						<Spinner label="Loading schedules" />
					</div>
				)}
				{error && (
					<div role="alert" className="p-4">
						<Alert variant="danger">
							Error fetching schedules: {error.message}
						</Alert>
					</div>
				)}
				{!isLoading && !error && schedules.length === 0 && (
					<p className="py-16 text-center text-body-sm text-ink-muted">
						No schedules found. Simply ask an agent to do a daily/weekly task
						for you, or to handle something in the future and that task will
						appear here.
					</p>
				)}
				{!isLoading && !error && schedules.length > 0 && (
					<div>
						{schedules.map((schedule) => (
							<ScheduleListItem
								key={schedule.id}
								schedule={schedule}
								onEdit={() => handleOpenForm(schedule)}
								onDelete={handleDeleteSchedule}
								onToggleActive={handleToggleActive}
							/>
						))}
					</div>
				)}
			</div>

			<ScheduleFormDialog
				open={isFormOpen}
				onClose={handleCloseForm}
				onSubmit={handleSubmitForm}
				initialData={editingSchedule}
			/>
		</div>
	);
};
