import {
	Box,
	Button,
	CircularProgress,
	Collapse,
	IconButton,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
// Dialog import is not needed as ConfirmationModal handles its own dialog.
import { styled, useTheme } from "@mui/material/styles";
import type { ExecutionVariable } from "@shared/api/local-operator/types";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import {
	useAgentExecutionVariables,
	useCreateAgentExecutionVariable,
	useDeleteAgentExecutionVariable,
	useUpdateAgentExecutionVariable,
} from "@shared/hooks/use-agent-execution-variables";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Copy, Edit2, Minus, Plus, PlusCircle, Trash2 } from "lucide-react";
import type { FC } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { VariableFormDialog } from "./variable-form-dialog";

type CanvasVariablesViewerProps = {
	conversationId: string;
};

const VariableListContainer = styled(Box)(({ theme }) => ({
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	backgroundColor:
		theme.palette.mode === "dark"
			? alpha(theme.palette.background.paper, 0.3)
			: alpha(theme.palette.grey[50], 0.7),
	overflow: "auto",
	maxHeight: "100%",
	flex: 1,
}));

const VariableItem = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	padding: theme.spacing(0.75, 1),
	borderBottom: `1px solid ${theme.palette.divider}`,
	"&:last-child": {
		borderBottom: "none",
	},
	fontSize: "0.8rem",
}));

const VariableName = styled(Typography)(({ theme }) => ({
	marginLeft: theme.spacing(0.5),
	fontWeight: 500,
	color: theme.palette.text.primary,
	marginRight: theme.spacing(1),
	fontFamily: "monospace", // PyCharm uses monospace for variables
	fontSize: "0.8rem",
}));

const VariableType = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontStyle: "italic",
	marginRight: theme.spacing(1),
	fontFamily: "monospace",
	fontSize: "0.8rem",
}));

const VariableValue = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	flexGrow: 1,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	fontFamily: "monospace",
	maxWidth: "100%",
	fontSize: "0.8rem",
}));

const VariableActions = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginLeft: theme.spacing(1),
}));

const CenteredBox = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	padding: theme.spacing(2),
	textAlign: "center",
}));

const ExpandButton = styled(IconButton)(({ theme }) => ({
	width: 20,
	height: 20,
	marginRight: theme.spacing(0.5),
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: 2,
	padding: 0,
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.08),
	},
}));

// Utility function to truncate text
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}...`;
};

// Define editable variable types
const EDITABLE_TYPES = new Set(["str", "int", "float", "list", "dict", "bool"]);

// Individual variable display component
type VariableDisplayProps = {
	variable: ExecutionVariable;
	onEdit: (variable: ExecutionVariable) => void;
	onDelete: (variableKey: string) => void;
};

const VariableRow: FC<VariableDisplayProps> = memo(
	({ variable, onEdit, onDelete }) => {
		const theme = useTheme();
		const [expanded, setExpanded] = useState(false);
		const [copied, setCopied] = useState(false);

		// Check if variable type is editable
		const isEditable = useMemo(
			() => EDITABLE_TYPES.has(variable.type),
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

		// Memoize dynamic styles
		const itemStyles = useMemo(
			() => ({
				cursor: "pointer",
				"&:hover": {
					backgroundColor: alpha(theme.palette.action.hover, 0.08),
				},
			}),
			[theme.palette.action.hover],
		);

		const expandedContentStyles = useMemo(
			() => ({
				pl: 4,
				py: 1,
				backgroundColor: alpha(theme.palette.background.default, 0.05),
				borderBottom: `1px solid ${theme.palette.divider}`,
				fontFamily: "monospace",
				fontSize: "0.8rem",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				maxHeight: "300px",
				overflow: "auto",
			}),
			[theme.palette.background.default, theme.palette.divider],
		);

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
			<>
				<VariableItem sx={itemStyles} onClick={handleToggleExpand}>
					<ExpandButton size="small">
						{expanded ? <Minus size={12} /> : <Plus size={12} />}
					</ExpandButton>
					<VariableName variant="body2">{variable.key}</VariableName>
					<VariableType variant="caption">{typeDisplay}</VariableType>
					<Tooltip title={tooltipValue} placement="top-start" arrow>
						<VariableValue variant="body2">{truncatedValue}</VariableValue>
					</Tooltip>
					<VariableActions>
						<Tooltip title={copied ? "Copied!" : "Copy Value"}>
							<IconButton
								onClick={handleCopy}
								size="small"
								sx={{ mr: 0.25, padding: theme.spacing(0.5) }}
							>
								<Copy size={14} />
							</IconButton>
						</Tooltip>
						{isEditable ? (
							<Tooltip title="Edit Variable">
								<IconButton
									onClick={handleEdit}
									size="small"
									sx={{ mr: 0.25, padding: theme.spacing(0.5) }}
								>
									<Edit2 size={14} />
								</IconButton>
							</Tooltip>
						) : (
							<Tooltip title="This variable can't be edited because its type is not yet supported for editing.">
								<IconButton
									size="small"
									sx={{
										mr: 0.25,
										padding: theme.spacing(0.5),
										opacity: 0.4,
										cursor: "not-allowed",
									}}
								>
									<Edit2 size={14} />
								</IconButton>
							</Tooltip>
						)}
						<Tooltip title="Delete Variable">
							<IconButton
								onClick={handleDelete}
								size="small"
								color="error"
								sx={{ padding: theme.spacing(0.5) }}
							>
								<Trash2 size={14} />
							</IconButton>
						</Tooltip>
					</VariableActions>
				</VariableItem>
				<Collapse in={expanded} timeout="auto" unmountOnExit>
					<Box sx={expandedContentStyles}>
						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
						>
							{stringValue}
						</Typography>
					</Box>
				</Collapse>
			</>
		);
	},
);

VariableRow.displayName = "VariableRow";

export const CanvasVariablesViewer: FC<CanvasVariablesViewerProps> = memo(
	({ conversationId }) => {
		const agentId = conversationId;
		const theme = useTheme();

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

		// Memoize static styles
		const containerStyles = useMemo(
			() => ({
				p: 3,
				height: "100%",
				display: "flex",
				flexDirection: "column",
				minHeight: 0, // Important for flex children to shrink
			}),
			[],
		);

		const headerStyles = useMemo(
			() => ({
				display: "flex",
				flexDirection: "column",
				mb: 1,
				px: 0.5,
				flexShrink: 0, // Prevent header from shrinking
			}),
			[],
		);

		const titleRowStyles = useMemo(
			() => ({
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				mb: 0.5,
			}),
			[],
		);

		const titleStyles = useMemo(
			() => ({
				fontSize: "0.875rem",
			}),
			[],
		);

		const subtitleStyles = useMemo(
			() => ({
				fontSize: "0.75rem",
				color: "text.secondary",
				fontStyle: "italic",
			}),
			[],
		);

		const createButtonStyles = useMemo(
			() => ({
				textTransform: "none",
				fontSize: "0.8125rem",
				padding: theme.spacing(0.5, 1.5),
			}),
			[theme],
		);

		const loadingTextStyles = useMemo(
			() => ({
				mt: 1.5,
			}),
			[],
		);

		const emptyStateTextStyles = useMemo(
			() => ({
				mb: 1.5,
			}),
			[],
		);

		useEffect(() => {
			if (isError && error) {
				showErrorToast(
					`Error loading variables: ${error.message || "An unknown error occurred."}`,
				);
			}
		}, [isError, error]);

		if (isLoading) {
			return (
				<CenteredBox>
					<CircularProgress size={24} />
					<Typography
						variant="body2"
						sx={loadingTextStyles}
						color="text.secondary"
					>
						Loading variables...
					</Typography>
				</CenteredBox>
			);
		}

		if (isError) {
			return (
				<CenteredBox>
					<Typography variant="subtitle1" color="text.secondary" gutterBottom>
						Could not load variables.
					</Typography>
					<Typography variant="caption" color="text.secondary">
						Please check notifications or try again.
					</Typography>
				</CenteredBox>
			);
		}

		if (variables.length === 0) {
			return (
				<CenteredBox>
					<Typography variant="subtitle1" gutterBottom color="text.primary">
						No Execution Variables
					</Typography>
					<Typography
						variant="body2"
						color="text.secondary"
						sx={emptyStateTextStyles}
					>
						This agent currently has no execution variables set. When your agent
						does work for you, it will store things that it runs with code in
						its memory, and those elements will show up here.
					</Typography>
					<Button
						variant="outlined"
						size="small"
						startIcon={<PlusCircle size={16} />}
						onClick={handleOpenCreateForm}
						sx={createButtonStyles}
					>
						Create Variable
					</Button>
				</CenteredBox>
			);
		}

		return (
			<Box sx={containerStyles}>
				<Box sx={headerStyles}>
					<Typography variant="body1" fontWeight={500} sx={titleStyles}>
						Agent Execution Variables
					</Typography>
					<Box sx={titleRowStyles}>
						<Typography
							variant="body2"
							color="text.secondary"
							sx={subtitleStyles}
						>
							This is code memory that the agent uses to store information.
						</Typography>
						<Tooltip title="Create New Variable">
							<IconButton onClick={handleOpenCreateForm} size="small">
								<PlusCircle size={18} />
							</IconButton>
						</Tooltip>
					</Box>
				</Box>
				<VariableListContainer>
					{variables.map((variable) => (
						<VariableRow
							key={variable.key}
							variable={variable}
							onEdit={handleOpenEditForm}
							onDelete={handleDeleteVariable}
						/>
					))}
				</VariableListContainer>
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
						title="Delete Variable"
						message={
							<Typography>
								Are you sure you want to delete the variable{" "}
								<strong>"{variableToDeleteKey}"</strong>? This action cannot be
								undone.
							</Typography>
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
			</Box>
		);
	},
);

CanvasVariablesViewer.displayName = "CanvasVariablesViewer";
