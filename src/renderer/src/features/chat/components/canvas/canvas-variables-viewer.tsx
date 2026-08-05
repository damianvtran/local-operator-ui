import type { ExecutionVariable } from "@shared/api/local-operator/types";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import {
	useAgentExecutionVariables,
	useCreateAgentExecutionVariable,
	useDeleteAgentExecutionVariable,
	useUpdateAgentExecutionVariable,
} from "@shared/hooks/use-agent-execution-variables";
import { cn } from "@shared/lib/utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import {
	ChevronDown,
	ChevronRight,
	Copy,
	Pen,
	Plus,
	Trash2,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import { VariableFormDialog } from "./variable-form-dialog";

type CanvasVariablesViewerProps = {
	conversationId: string;
};

/**
 * The three terminal states (loading, failed, empty) share one centred block.
 * Local to this panel rather than a shared primitive: nothing else needs it.
 */
const CenteredState: FC<{ children: ReactNode }> = ({ children }) => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
		)}
	>
		{children}
	</div>
);

// Utility function to truncate text
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}...`;
};

// Define editable variable types
const EDITABLE_TYPES: Record<string, true> = {
	str: true,
	int: true,
	float: true,
	list: true,
	dict: true,
	bool: true,
};

// Individual variable display component
type VariableDisplayProps = {
	variable: ExecutionVariable;
	onEdit: (variable: ExecutionVariable) => void;
	onDelete: (variableKey: string) => void;
};

const VariableRow: FC<VariableDisplayProps> = memo(
	({ variable, onEdit, onDelete }) => {
		const [expanded, setExpanded] = useState(false);
		const [copied, setCopied] = useState(false);
		const contentId = useId();

		// Check if variable type is editable
		const isEditable = useMemo(
			() => EDITABLE_TYPES[variable.type] === true,
			[variable.type],
		);

		// Memoize string value conversion with truncation
		const stringValue = useMemo(() => String(variable.value), [variable.value]);
		const truncatedValue = useMemo(
			() => truncateText(stringValue, 200),
			[stringValue],
		);
		const tooltipValue = useMemo(
			() => truncateText(stringValue, 1000),
			[stringValue],
		);

		// The braces were Python `repr` punctuation leaking into the UI. The type
		// is already set apart by its dim ink and its position between the name
		// and the value.
		const typeDisplay = variable.type;

		// Memoize callbacks
		const handleToggleExpand = useCallback(() => {
			setExpanded((prev) => !prev);
		}, []);

		const handleEdit = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation();
				onEdit(variable);
			},
			[onEdit, variable],
		);

		const handleDelete = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation();
				onDelete(variable.key);
			},
			[onDelete, variable.key],
		);

		const handleCopy = useCallback(
			async (e: React.MouseEvent) => {
				e.stopPropagation();
				try {
					await navigator.clipboard.writeText(stringValue);
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				} catch (error) {
					console.error("Failed to copy to clipboard:", error);
				}
			},
			[stringValue],
		);

		return (
			<div className={cn("group border-hairline border-b last:border-b-0")}>
				<div
					className={cn(
						"flex min-h-8 items-center gap-1 pr-1",
						"transition-colors duration-fast ease-out-quart hover:bg-elevated",
					)}
				>
					{/*
					 * The disclosure trigger spans the whole reading half of the row
					 * so the click target matches what the eye reads, and the actions
					 * sit outside it — a button inside a button is invalid HTML.
					 */}
					<button
						type="button"
						onClick={handleToggleExpand}
						aria-expanded={expanded}
						aria-controls={contentId}
						className={cn(
							"flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 px-2 py-1 text-left font-mono text-mono-sm",
						)}
					>
						{/*
						 * A chevron, not a plus: a `+`/`-` pair here was a second
						 * expand/collapse language in a panel that already had one, and
						 * `+` also reads as "add" beside a create control that means
						 * exactly that.
						 *
						 * The chevron SWAPS rather than rotates, matching
						 * `@shared/components/ui/disclosure`. This row cannot use that
						 * component directly — the trigger is only the reading half of
						 * the row, with sibling action buttons outside it, and nesting a
						 * button inside a button is invalid HTML — so it reimplements the
						 * trigger and must not also reinvent the signal. Rotation was
						 * additionally a motion-rule violation: transitions are for
						 * entrances, and a toggle is not one.
						 */}
						{expanded ? (
							<ChevronDown
								aria-hidden="true"
								className="size-3 shrink-0 text-ink-dim"
							/>
						) : (
							<ChevronRight
								aria-hidden="true"
								className="size-3 shrink-0 text-ink-dim"
							/>
						)}
						<span className={cn("shrink-0 font-medium text-ink")}>
							{variable.key}
						</span>
						<span className={cn("shrink-0 text-ink-dim")}>{typeDisplay}</span>
						<Tooltip content={tooltipValue} align="start">
							<span className={cn("min-w-0 flex-1 truncate text-ink-muted")}>
								{truncatedValue}
							</span>
						</Tooltip>
					</button>
					{/*
					 * Row actions appear on hover or keyboard focus. Twenty-one
					 * permanently drawn icons down a seven-row list — seven of them
					 * red — read as a warning rather than as a set of controls, and
					 * they competed with the values, which are what the panel is for.
					 * Linear and Notion both reveal row actions this way. Focus goes
					 * through `group-focus-within`, so they stay keyboard-reachable.
					 */}
					<div
						className={cn(
							"flex shrink-0 items-center gap-0.5",
							"pointer-events-none opacity-0",
							"group-hover:pointer-events-auto group-hover:opacity-100",
							"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
						)}
					>
						<Tooltip content={copied ? "Copied" : "Copy value"}>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleCopy}
								aria-label="Copy value"
							>
								<Copy />
							</Button>
						</Tooltip>
						{isEditable ? (
							<Tooltip content="Edit variable">
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={handleEdit}
									aria-label="Edit variable"
								>
									<Pen />
								</Button>
							</Tooltip>
						) : (
							/*
							 * `aria-disabled` rather than `disabled`: a disabled button
							 * swallows pointer events, and the tooltip is the only place
							 * the reason is stated.
							 */
							<Tooltip content="This variable can't be edited because its type is not yet supported for editing.">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-disabled="true"
									aria-label="Edit variable"
									className={cn(
										"cursor-default text-ink-disabled hover:bg-transparent hover:text-ink-disabled",
									)}
								>
									<Pen />
								</Button>
							</Tooltip>
						)}
						{/*
						 * Neutral at rest, danger on hover. A red glyph on every row
						 * spends the danger role on a state where nothing is wrong.
						 */}
						<Tooltip content="Delete variable">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleDelete}
								aria-label="Delete variable"
								className={cn("hover:bg-danger-wash hover:text-danger")}
							>
								<Trash2 />
							</Button>
						</Tooltip>
					</div>
				</div>
				{expanded ? (
					<div
						id={contentId}
						className={cn(
							"max-h-75 overflow-auto whitespace-pre-wrap break-words bg-sunken px-7 py-2 font-mono text-ink-muted text-mono-sm",
						)}
					>
						{stringValue}
					</div>
				) : null}
			</div>
		);
	},
);

VariableRow.displayName = "VariableRow";

export const CanvasVariablesViewer: FC<CanvasVariablesViewerProps> = memo(
	({ conversationId }) => {
		const agentId = conversationId;

		const [isFormOpen, setIsFormOpen] = useState(false);
		const [editingVariable, setEditingVariable] =
			useState<ExecutionVariable | null>(null);
		const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
		const [variableToDeleteKey, setVariableToDeleteKey] = useState<
			string | null
		>(null);

		const {
			data: variablesResponse,
			isLoading,
			error,
			isError,
			// refetch: refetchVariables, // Not directly used, relying on query invalidation
		} = useAgentExecutionVariables(agentId);

		const createVariableMutation = useCreateAgentExecutionVariable();
		const updateVariableMutation = useUpdateAgentExecutionVariable();
		const deleteVariableMutation = useDeleteAgentExecutionVariable();

		// Memoize variables array
		const variables = useMemo(
			() => variablesResponse?.result?.execution_variables ?? [],
			[variablesResponse?.result?.execution_variables],
		);

		const handleOpenCreateForm = useCallback(() => {
			setEditingVariable(null);
			setIsFormOpen(true);
		}, []);

		const handleOpenEditForm = useCallback((variable: ExecutionVariable) => {
			setEditingVariable(variable);
			setIsFormOpen(true);
		}, []);

		const handleCloseForm = useCallback(() => {
			setIsFormOpen(false);
			setEditingVariable(null);
		}, []);

		const handleSubmitVariableForm = useCallback(
			async (data: ExecutionVariable) => {
				if (!agentId) {
					showErrorToast("Agent ID is missing.");
					return;
				}
				try {
					if (editingVariable) {
						// Update existing variable
						await updateVariableMutation.mutateAsync({
							agentId,
							variableKey: editingVariable.key, // Key cannot be changed
							variableData: { ...data, key: editingVariable.key },
						});
					} else {
						// Create new variable
						await createVariableMutation.mutateAsync({
							agentId,
							variableData: data,
						});
					}
					// Toast for success/error is handled by mutation hooks
					// refetchVariables(); // Implicitly handled by query invalidation in hooks
				} catch (e) {
					// Error already shown by mutation hook's onError
					console.error("Submission failed in component:", e);
				}
			},
			[
				agentId,
				editingVariable,
				createVariableMutation,
				updateVariableMutation,
			],
		);

		const handleDeleteVariable = useCallback(
			async (variableKey: string) => {
				if (!agentId) {
					showErrorToast("Agent ID is missing.");
					return;
				}
				setVariableToDeleteKey(variableKey);
				setIsDeleteConfirmOpen(true);
			},
			[agentId], // deleteVariableMutation will be a dependency of confirmDeleteVariable
		);

		const confirmDeleteVariable = useCallback(async () => {
			if (!agentId || !variableToDeleteKey) {
				showErrorToast("Agent ID or variable key is missing for deletion.");
				setIsDeleteConfirmOpen(false); // Close modal even if there's an issue
				setVariableToDeleteKey(null);
				return;
			}
			try {
				await deleteVariableMutation.mutateAsync({
					agentId,
					variableKey: variableToDeleteKey,
				});
				// Toast for success/error is handled by mutation hooks
			} catch (e) {
				// Error already shown by mutation hook's onError
				// showErrorToast is likely called within the mutation hook's onError
				console.error("Deletion failed during confirmation:", e);
			} finally {
				setIsDeleteConfirmOpen(false);
				setVariableToDeleteKey(null);
			}
		}, [agentId, variableToDeleteKey, deleteVariableMutation]);

		useEffect(() => {
			if (isError && error) {
				showErrorToast(
					`Error loading variables: ${error.message || "An unknown error occurred."}`,
				);
			}
		}, [isError, error]);

		if (isLoading) {
			return (
				<CenteredState>
					<Spinner size="sm" />
					<p className={cn("text-body-sm text-ink-muted")}>Loading variables</p>
				</CenteredState>
			);
		}

		if (isError) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						Could not load variables
					</p>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						The agent's code memory could not be read. Check that Local Operator
						is running, then try again.
					</p>
				</CenteredState>
			);
		}

		if (variables.length === 0) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>Nothing stored yet</p>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						When the agent runs code for you, the values it keeps around between
						steps show up here. You can add one yourself too.
					</p>
					<Button variant="secondary" size="sm" onClick={handleOpenCreateForm}>
						<Plus aria-hidden="true" />
						New variable
					</Button>
				</CenteredState>
			);
		}

		return (
			<div className={cn("flex h-full min-h-0 flex-col")}>
				{/*
				 * A one-line header, not a page masthead. The view switcher in the
				 * panel chrome already says which view this is, so a 16px title and
				 * a sentence of description restated it and spent 60px doing so.
				 * What is worth saying here is how many there are.
				 */}
				<div
					className={cn(
						"flex h-10 shrink-0 items-center justify-between gap-3 border-hairline border-b px-3",
					)}
				>
					<p className={cn("min-w-0 truncate text-body-sm text-ink-muted")}>
						<span className={cn("font-medium text-ink")}>Code memory</span>
						<span className={cn("mx-1.5 text-ink-dim")}>·</span>
						{variables.length}{" "}
						{variables.length === 1 ? "variable" : "variables"}
					</p>
					<Button variant="ghost" size="sm" onClick={handleOpenCreateForm}>
						<Plus aria-hidden="true" />
						New
					</Button>
				</div>
				{/*
				 * Full-bleed rows. The list used to sit in a `rounded-md bg-surface`
				 * box inset 24px inside a panel that is already `surface` — an
				 * invisible container costing 48px of the width the values need.
				 */}
				<div className={cn("min-h-0 flex-1 overflow-auto")}>
					{variables.map((variable) => (
						<VariableRow
							key={variable.key}
							variable={variable}
							onEdit={handleOpenEditForm}
							onDelete={handleDeleteVariable}
						/>
					))}
				</div>
				{agentId && ( // Ensure agentId is present before rendering dialog
					<VariableFormDialog
						open={isFormOpen}
						onClose={handleCloseForm}
						onSubmit={handleSubmitVariableForm}
						initialData={editingVariable}
					/>
				)}
				{variableToDeleteKey && ( // Render modal only if there's a key to delete
					<ConfirmationModal
						open={isDeleteConfirmOpen}
						title="Delete variable"
						message={
							<>
								Are you sure you want to delete the variable{" "}
								<strong className={cn("font-mono text-ink")}>
									{variableToDeleteKey}
								</strong>
								? This action cannot be undone.
							</>
						}
						confirmText="Delete"
						cancelText="Cancel"
						isDangerous
						onConfirm={confirmDeleteVariable}
						onCancel={() => {
							setIsDeleteConfirmOpen(false);
							setVariableToDeleteKey(null);
						}}
					/>
				)}
			</div>
		);
	},
);

CanvasVariablesViewer.displayName = "CanvasVariablesViewer";
