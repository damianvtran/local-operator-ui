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
import { Copy, Edit2, Minus, Plus, PlusCircle, Trash2 } from "lucide-react";
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

		// Memoize variable type display
		const typeDisplay = useMemo(() => `{${variable.type}}`, [variable.type]);

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
			<div className={cn("border-hairline border-b last:border-b-0")}>
				<div
					className={cn(
						"flex items-center gap-1 transition-colors duration-fast ease-out-quart hover:bg-elevated",
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
							"flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-left font-mono text-mono-sm",
						)}
					>
						<span className={cn("shrink-0 text-ink-dim")}>
							{expanded ? <Minus size={12} /> : <Plus size={12} />}
						</span>
						<span className={cn("shrink-0 font-medium text-ink")}>
							{variable.key}
						</span>
						<span className={cn("shrink-0 text-ink-dim italic")}>
							{typeDisplay}
						</span>
						<Tooltip content={tooltipValue} align="start">
							<span className={cn("min-w-0 flex-1 truncate text-ink-muted")}>
								{truncatedValue}
							</span>
						</Tooltip>
					</button>
					<div className={cn("flex shrink-0 items-center gap-0.5 pr-1.5")}>
						<Tooltip content={copied ? "Copied" : "Copy value"}>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleCopy}
								aria-label="Copy value"
							>
								<Copy size={14} />
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
									<Edit2 size={14} />
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
									<Edit2 size={14} />
								</Button>
							</Tooltip>
						)}
						<Tooltip content="Delete variable">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleDelete}
								aria-label="Delete variable"
								className={cn(
									"text-danger hover:bg-danger-wash hover:text-danger",
								)}
							>
								<Trash2 size={14} />
							</Button>
						</Tooltip>
					</div>
				</div>
				{expanded ? (
					<div
						id={contentId}
						className={cn(
							"max-h-75 overflow-auto whitespace-pre-wrap break-words bg-sunken px-8 py-2 font-mono text-ink-muted text-mono-sm",
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
					<p className={cn("text-body-sm text-ink-muted")}>
						Loading variables...
					</p>
				</CenteredState>
			);
		}

		if (isError) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						Could not load variables.
					</p>
					<p className={cn("text-ink-muted text-meta")}>
						Please check notifications or try again.
					</p>
				</CenteredState>
			);
		}

		if (variables.length === 0) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>No execution variables</p>
					<p className={cn("max-w-md text-body-sm text-ink-muted")}>
						This agent currently has no execution variables set. When your agent
						does work for you, it will store things that it runs with code in
						its memory, and those elements will show up here.
					</p>
					<Button variant="outline" size="sm" onClick={handleOpenCreateForm}>
						<PlusCircle size={16} />
						Create variable
					</Button>
				</CenteredState>
			);
		}

		return (
			<div className={cn("flex h-full min-h-0 flex-col gap-3 p-6")}>
				<div className={cn("flex shrink-0 items-start justify-between gap-3")}>
					<div className={cn("min-w-0")}>
						<h2 className={cn("text-heading text-ink")}>
							Agent execution variables
						</h2>
						<p className={cn("mt-0.5 text-body-sm text-ink-muted")}>
							This is code memory that the agent uses to store information.
						</p>
					</div>
					<Tooltip content="Create new variable">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={handleOpenCreateForm}
							aria-label="Create new variable"
						>
							<PlusCircle size={18} />
						</Button>
					</Tooltip>
				</div>
				<div
					className={cn("min-h-0 flex-1 overflow-auto rounded-md bg-surface")}
				>
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
