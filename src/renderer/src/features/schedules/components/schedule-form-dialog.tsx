import type {
	AgentDetails,
	ScheduleCreateRequest,
	ScheduleResponse,
	ScheduleUnit,
	ScheduleUpdateRequest,
} from "@shared/api/local-operator";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { DateTimePicker } from "@shared/components/common/date-time-picker";
import { Spinner } from "@shared/components/common/spinner";
import {
	Input,
	Label,
	Popover,
	PopoverAnchor,
	PopoverContent,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	Textarea,
	Tooltip,
} from "@shared/components/ui";
import { useAgents } from "@shared/hooks/use-agents";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import { ChevronDown, Info, Save, SquareX } from "lucide-react";
import type { FC, KeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

type ScheduleFormDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (
		data: ScheduleCreateRequest | ScheduleUpdateRequest,
		agentId: string, // AgentId is mandatory for submission from this form
	) => Promise<void>;
	initialData?: ScheduleResponse | null;
};

// Represents the form state. `interval` is `number | ""` because the number
// input passes through an empty intermediate state while typing.
type FormDataType = Omit<ScheduleCreateRequest, "interval"> & {
	interval: number | "";
	selectedAgentId: string | null;
};

const defaultFormState: FormDataType = {
	selectedAgentId: null,
	prompt: "",
	interval: 1,
	unit: "hours",
	is_active: true,
	one_time: false,
	start_time_utc: null,
	end_time_utc: null,
};

/**
 * Type-to-filter agent combobox with server-side search.
 *
 * The primitive layer has no Autocomplete, so this is assembled from
 * `Popover` + `Input` + a hand-rolled listbox, the same shape as
 * `hosting/searchable-select`. The difference is deliberate: the schedule
 * form searches the agent API (debounced 300ms) rather than filtering a
 * static list, because the agent list is paginated and client-side filtering
 * would only ever see the first page.
 *
 * ARIA follows the WAI-ARIA combobox pattern: focus stays in the text field
 * and `aria-activedescendant` names the active row.
 */
const AgentSelect: FC<{
	options: AgentDetails[];
	selected: AgentDetails | null;
	onSelect: (agent: AgentDetails | null) => void;
	onQueryChange: (query: string) => void;
	loading: boolean;
	invalid: boolean;
}> = ({ options, selected, onSelect, onQueryChange, loading, invalid }) => {
	useI18nLocale();
	const baseId = useId();
	const inputId = `${baseId}-input`;
	const listId = `${baseId}-listbox`;

	const anchorRef = useRef<HTMLDivElement>(null);
	const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

	const selectedName =
		selected?.name ||
		(selected
			? t("ui.schedules.schedule_form_dialog.agent_id_substring_0_8", {
					substring_0__8: String(selected.id.substring(0, 8)),
				})
			: "");
	const [query, setQuery] = useState(selectedName);
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);

	// The owner's selection wins over whatever is typed, so a reopen after a
	// cancelled edit shows the chosen agent rather than stale text.
	useEffect(() => {
		setQuery(selectedName);
	}, [selectedName]);

	optionRefs.current.length = options.length;

	// A stale highlight after the list changes would put Enter on a row the
	// user can no longer see.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the list
	useEffect(() => {
		setActiveIndex(-1);
	}, [options]);

	useEffect(() => {
		if (!open || activeIndex < 0) return;
		optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
	}, [open, activeIndex]);

	const commit = (agent: AgentDetails) => {
		setOpen(false);
		setQuery(
			agent.name ||
				t("ui.schedules.schedule_form_dialog.agent_id_substring_0_8", {
					substring_0__8: String(agent.id.substring(0, 8)),
				}),
		);
		onSelect(agent);
	};

	const revert = () => {
		setOpen(false);
		setQuery(selectedName);
	};

	const move = (delta: number) => {
		if (options.length === 0) return;
		setActiveIndex((previous) => {
			const next = previous + delta;
			if (next < 0) return options.length - 1;
			if (next >= options.length) return 0;
			return next;
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				if (!open) {
					setOpen(true);
					return;
				}
				move(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			case "Home":
			case "End": {
				if (!open || options.length === 0) return;
				event.preventDefault();
				setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
				return;
			}
			case "Enter": {
				// Unconditional: the field sits in a dialog and a bare Enter must
				// pick a row, not submit the form behind the popover.
				event.preventDefault();
				if (open && activeIndex >= 0) {
					commit(options[activeIndex]);
				}
				return;
			}
			case "Escape": {
				if (!open) return;
				// Stop here rather than let the dialog's dismiss layer also see
				// it: a second listener would close the form itself.
				event.preventDefault();
				event.stopPropagation();
				revert();
				return;
			}
			default:
		}
	};

	const activeOptionId =
		open && activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined;

	return (
		<div className="relative">
			<Popover
				open={open}
				onOpenChange={(next) => {
					if (next) setOpen(true);
					else revert();
				}}
			>
				<PopoverAnchor asChild>
					<div ref={anchorRef} className="relative">
						<Input
							id={inputId}
							role="combobox"
							aria-expanded={open}
							aria-controls={listId}
							aria-autocomplete="list"
							aria-activedescendant={activeOptionId}
							aria-invalid={invalid || undefined}
							autoComplete="off"
							className="pr-8"
							placeholder={t("ui.schedules.schedule_form_dialog.search_agents")}
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								onQueryChange(event.target.value);
								setOpen(true);
							}}
							onFocus={() => setOpen(true)}
							// Focus fires only once; without this, clicking an
							// already-focused field after a selection can't reopen the list.
							onClick={() => setOpen(true)}
							onBlur={revert}
							onKeyDown={handleKeyDown}
						/>
						<span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
							{loading ? (
								<Spinner
									size="sm"
									label={t("ui.schedules.schedule_form_dialog.loading_agents")}
								/>
							) : (
								<ChevronDown
									className="size-4 text-ink-dim"
									aria-hidden="true"
								/>
							)}
						</span>
					</div>
				</PopoverAnchor>

				<PopoverContent
					align="start"
					className="w-(--radix-popover-trigger-width) p-1"
					// Focus stays in the text field; that is the difference between
					// a combobox and a popover holding a list.
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
					// Clicking the field while the list is open must not dismiss it —
					// the field is the anchor, so Radix counts it as "outside".
					onPointerDownOutside={(event) => {
						if (anchorRef.current?.contains(event.target as Node)) {
							event.preventDefault();
						}
					}}
					onFocusOutside={(event) => {
						if (anchorRef.current?.contains(event.target as Node)) {
							event.preventDefault();
						}
					}}
					// Keeps the field focused when a row is clicked, so `onBlur` stays
					// free to mean "the user left the control".
					onMouseDown={(event) => event.preventDefault()}
				>
					{/* biome-ignore lint/a11y/useFocusableInteractive: the text input keeps focus; the list is reached through aria-activedescendant, so it must not be in the tab order. */}
					<ul
						id={listId}
						// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>.
						// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the listbox role is the WAI-ARIA combobox pattern for a popup driven from a text input.
						role="listbox"
						aria-label={t("ui.schedules.schedule_form_dialog.select_agent")}
						className="max-h-72 overflow-y-auto"
					>
						{options.length === 0 && (
							<li
								role="presentation"
								className="px-2 py-1.5 text-body-sm text-ink-dim"
							>
								{loading
									? t("ui.schedules.schedule_form_dialog.loading_agents")
									: t("ui.schedules.schedule_form_dialog.no_matching_agents")}
							</li>
						)}
						{options.map((option, index) => (
							/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox input; the active option is announced through aria-activedescendant. */
							/* biome-ignore lint/a11y/useKeyWithClickEvents: Arrow keys, Enter and Escape are handled on the combobox input, not on the option. */
							<li
								key={option.id}
								id={`${baseId}-option-${index}`}
								// biome-ignore lint/a11y/useSemanticElements: a combobox option cannot be a native <option>.
								// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the option role is part of the combobox listbox pattern.
								role="option"
								aria-selected={option.id === selected?.id}
								ref={(node) => {
									optionRefs.current[index] = node;
								}}
								className={cn(
									"cursor-pointer rounded-sm px-2 py-1.5",
									"transition-colors duration-fast ease-out-quart",
									index === activeIndex && "bg-accent-wash",
								)}
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => commit(option)}
							>
								<span className="font-medium text-body-sm text-ink">
									{option.name ||
										t("ui.schedules.schedule_form_dialog.unnamed_agent")}
								</span>
							</li>
						))}
					</ul>
				</PopoverContent>
			</Popover>
		</div>
	);
};

/**
 * ScheduleFormDialog component
 *
 * A dialog for creating or editing agent schedules.
 */
export const ScheduleFormDialog: FC<ScheduleFormDialogProps> = ({
	open,
	onClose,
	onSubmit,
	initialData,
}) => {
	useI18nLocale();
	const [formData, setFormData] = useState<FormDataType>(defaultFormState);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [agentSearchQuery, setAgentSearchQuery] = useState("");
	const [debouncedAgentQuery, setDebouncedAgentQuery] = useState("");
	const [selectedAgentForForm, setSelectedAgentForForm] =
		useState<AgentDetails | null>(null);

	const isEditMode = !!initialData;

	// Debounce the combobox text before it becomes an API search query; the
	// old Autocomplete fired a timer per keystroke, this collapses them.
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedAgentQuery(agentSearchQuery);
		}, 300);
		return () => clearTimeout(timer);
	}, [agentSearchQuery]);

	// Fetch agents for the combobox
	const {
		data: agentsListResult,
		isLoading: isLoadingAgents,
		isError: isAgentsError,
	} = useAgents(1, 50, 0, debouncedAgentQuery || undefined);

	const agentOptions = useMemo(
		() => agentsListResult?.agents || [],
		[agentsListResult],
	);

	useEffect(() => {
		if (open) {
			if (initialData) {
				// Editing existing schedule
				setFormData({
					selectedAgentId: initialData.agent_id, // Pre-fill agent if editing
					prompt: initialData.prompt,
					interval: initialData.interval,
					unit: initialData.unit,
					is_active: initialData.is_active,
					one_time: initialData.one_time,
					start_time_utc: initialData.start_time_utc
						? new Date(initialData.start_time_utc).toISOString()
						: null,
					end_time_utc: initialData.end_time_utc
						? new Date(initialData.end_time_utc).toISOString()
						: null,
				});
				// Attempt to find and set the agent object for display if editing
				const currentAgent = agentOptions.find(
					(agent) => agent.id === initialData.agent_id,
				);
				if (currentAgent) {
					setSelectedAgentForForm(currentAgent);
				}
			} else {
				// Creating new schedule, reset to default
				setFormData(defaultFormState);
				setSelectedAgentForForm(null);
				setAgentSearchQuery("");
			}
		}
	}, [open, initialData, agentOptions]);

	const handleSubmit = async () => {
		setIsSubmitting(true);
		try {
			if (!isEditMode && !formData.selectedAgentId) {
				console.error(t("ui.schedules.errors.agent_id_required"));
				setIsSubmitting(false);
				return;
			}

			const scheduleData: ScheduleCreateRequest | ScheduleUpdateRequest = {
				prompt: formData.prompt,
				interval: Number(formData.interval),
				unit: formData.unit,
				is_active: formData.is_active,
				one_time: formData.one_time,
				start_time_utc: formData.start_time_utc || null,
				end_time_utc: formData.end_time_utc || null,
			};

			// Clean up empty optional fields that should be null
			if (scheduleData.start_time_utc === "")
				scheduleData.start_time_utc = null;
			if (scheduleData.end_time_utc === "") scheduleData.end_time_utc = null;

			// For new schedules, agentId comes from formData.selectedAgentId
			// For edits, agentId is inherent to initialData and not changed here.
			const agentForSubmit = isEditMode
				? initialData.agent_id
				: formData.selectedAgentId;

			if (!agentForSubmit) {
				console.error(t("ui.schedules.errors.agent_id_missing"));
				setIsSubmitting(false);
				return;
			}

			await onSubmit(scheduleData, agentForSubmit);
			// Success toast comes from the parent page; a second one here would
			// duplicate it.
			onClose();
		} catch (error) {
			console.error("Failed to submit schedule:", error);
			showErrorToast(
				t(
					"ui.schedules.schedule_form_dialog.failed_to_save_schedule_unknown_error",
					{
						unknown_error: String(
							error instanceof Error
								? error.message
								: t("ui.schedules.schedule_form_dialog.unknown_error"),
						),
					},
				),
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const dialogTitle = isEditMode
		? t("ui.schedules.schedule_form_dialog.edit_schedule")
		: t("ui.schedules.schedule_form_dialog.new_schedule");

	const agentInvalid =
		isAgentsError || (!isEditMode && !formData.selectedAgentId && isSubmitting);

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={onClose}
				disabled={isSubmitting}
				startIcon={<SquareX size={18} />}
				data-tour-tag="create-schedule-dialog-cancel-button"
			>
				{t("ui.schedules.schedule_form_dialog.cancel")}
			</SecondaryButton>
			<PrimaryButton
				onClick={handleSubmit}
				disabled={
					isSubmitting ||
					!formData.prompt ||
					formData.interval === "" ||
					formData.interval < 1 ||
					(!isEditMode && !formData.selectedAgentId)
				}
				startIcon={isSubmitting ? <Spinner size="sm" /> : <Save size={18} />}
			>
				{isSubmitting
					? t("ui.schedules.schedule_form_dialog.saving")
					: isEditMode
						? t("ui.schedules.schedule_form_dialog.save_changes")
						: t("ui.schedules.schedule_form_dialog.create_schedule")}
			</PrimaryButton>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
			dataTourTag="create-schedule-dialog"
		>
			<div className="grid grid-cols-2 gap-4">
				<div className="col-span-2 flex items-start gap-2">
					<Info
						size={16}
						aria-hidden="true"
						className="mt-0.5 shrink-0 text-info"
					/>
					<p className="text-body-sm text-ink-muted">
						{t(
							"ui.schedules.schedule_form_dialog.it_is_usually_quicker_to_ask_an_agent_in_chat_send_me_an_email_wi",
						)}
					</p>
				</div>

				{!isEditMode && (
					<div className="col-span-2 flex flex-col gap-1.5">
						<Label htmlFor="agent-select-for-schedule">
							{t("ui.schedules.schedule_form_dialog.agent")}
							<span className="text-danger">*</span>
						</Label>
						<AgentSelect
							options={agentOptions}
							selected={selectedAgentForForm}
							onSelect={(agent) => {
								setSelectedAgentForForm(agent);
								setFormData((prev) => ({
									...prev,
									selectedAgentId: agent ? agent.id : null,
								}));
							}}
							onQueryChange={setAgentSearchQuery}
							loading={isLoadingAgents}
							invalid={agentInvalid}
						/>
						{agentInvalid && (
							<p className="text-danger text-meta">
								{isAgentsError
									? t("ui.schedules.schedule_form_dialog.failed_to_load_agents")
									: t(
											"ui.schedules.schedule_form_dialog.agent_selection_is_required",
										)}
							</p>
						)}
					</div>
				)}
				{isEditMode && initialData && (
					<p className="col-span-2 text-body-sm text-ink-muted">
						{t("ui.schedules.schedule_form_dialog.runs_as")}{" "}
						<span className="font-medium text-ink">
							{selectedAgentForForm?.name ||
								`${initialData.agent_id.substring(0, 8)}…`}
						</span>
						{t(
							"ui.schedules.schedule_form_dialog.the_agent_cannot_be_changed_after_a_schedule_is_created",
						)}
					</p>
				)}

				<div className="col-span-2 flex flex-col gap-1.5">
					<Label htmlFor="prompt" className="items-center">
						{t("ui.schedules.schedule_form_dialog.prompt")}
						<span className="text-danger">*</span>
						<Tooltip
							side="top"
							align="start"
							content={
								<div className="flex flex-col gap-1">
									<span>
										{t(
											"ui.schedules.schedule_form_dialog.this_is_the_message_that_will_be_sent_to_the_agent_on_the_schedul",
										)}
									</span>
									<span>
										{t(
											"ui.schedules.schedule_form_dialog.example_send_me_an_email_with_a_detailed_world_news_breakdown_wit",
										)}
									</span>
								</div>
							}
						>
							<Info size={14} aria-hidden="true" className="text-info" />
						</Tooltip>
					</Label>
					<Textarea
						id="prompt"
						name="prompt"
						value={formData.prompt}
						onChange={(event) =>
							setFormData((prev) => ({ ...prev, prompt: event.target.value }))
						}
						required
						rows={3}
						disabled={isSubmitting}
						placeholder={t(
							"ui.schedules.schedule_form_dialog.send_me_an_email_with_a_detailed_world_news_breakdown",
						)}
					/>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="interval">
						{t("ui.schedules.schedule_form_dialog.interval")}
						<span className="text-danger">*</span>
					</Label>
					<Input
						id="interval"
						name="interval"
						type="number"
						min={1}
						value={formData.interval}
						onChange={(event) => {
							const value = event.target.value;
							setFormData((prev) => ({
								...prev,
								// Allow the empty intermediate state while typing.
								interval: value === "" ? "" : Number.parseInt(value, 10),
							}));
						}}
						required
						disabled={isSubmitting}
						placeholder="1"
					/>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="unit-select">
						{t("ui.schedules.schedule_form_dialog.unit")}
						<span className="text-danger">*</span>
					</Label>
					<Select
						value={formData.unit || "hours"}
						onValueChange={(value) =>
							setFormData((prev) => ({
								...prev,
								unit: value as ScheduleUnit,
							}))
						}
						disabled={isSubmitting}
					>
						<SelectTrigger id="unit-select" name="unit">
							<SelectValue
								placeholder={t("ui.schedules.schedule_form_dialog.select_unit")}
							/>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="minutes">
								{t("ui.schedules.schedule_form_dialog.minutes")}
							</SelectItem>
							<SelectItem value="hours">
								{t("ui.schedules.schedule_form_dialog.hours")}
							</SelectItem>
							<SelectItem value="days">
								{t("ui.schedules.schedule_form_dialog.days")}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<DateTimePicker
					label={t("ui.schedules.schedule_form_dialog.start_time")}
					value={formData.start_time_utc ?? null}
					onChange={(newValue) =>
						setFormData((prev) => ({ ...prev, start_time_utc: newValue }))
					}
					disabled={isSubmitting}
					helperText={t(
						"ui.schedules.schedule_form_dialog.if_not_set_starts_immediately_or_on_next_interval",
					)}
				/>
				<DateTimePicker
					label={t("ui.schedules.schedule_form_dialog.end_time_optional")}
					value={formData.end_time_utc ?? null}
					onChange={(newValue) =>
						setFormData((prev) => ({ ...prev, end_time_utc: newValue }))
					}
					disabled={isSubmitting}
					helperText={t(
						"ui.schedules.schedule_form_dialog.if_not_set_schedule_runs_indefinitely",
					)}
				/>

				<div className="flex items-center gap-2">
					<Switch
						id="is-active"
						checked={formData.is_active || false}
						onCheckedChange={(checked) =>
							setFormData((prev) => ({ ...prev, is_active: checked }))
						}
						disabled={isSubmitting}
					/>
					<Label htmlFor="is-active">
						{t("ui.schedules.schedule_form_dialog.active")}
					</Label>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						id="one-time"
						checked={formData.one_time || false}
						onCheckedChange={(checked) =>
							setFormData((prev) => ({ ...prev, one_time: checked }))
						}
						disabled={isSubmitting}
					/>
					<Label htmlFor="one-time">
						{t("ui.schedules.schedule_form_dialog.run_once")}
					</Label>
				</div>
			</div>
		</BaseDialog>
	);
};
