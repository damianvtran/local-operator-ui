import {
	Box,
	Button,
	CircularProgress,
	Tooltip,
	Typography,
	alpha,
	IconButton,
	Collapse, // Added for expandable sections
} from "@mui/material";
import { styled, useTheme } from "@mui/material/styles";
import type { ExecutionVariable } from "@shared/api/local-operator/types";
import { useAgentExecutionVariables } from "@shared/hooks/use-agent-execution-variables";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { Edit2, Trash2, PlusCircle, ChevronRight, ChevronDown } from "lucide-react"; // Added Chevron icons
import type { FC } from "react";
import { useEffect, useState } from "react"; // Added useState

type CanvasVariablesViewerProps = {
	conversationId: string;
};

const VariableListContainer = styled(Box)(({ theme }) => ({
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	backgroundColor: theme.palette.mode === "dark" ? alpha(theme.palette.background.paper, 0.3) : alpha(theme.palette.grey[50], 0.7),
	overflow: "hidden",
}));

const VariableItem = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	padding: theme.spacing(0.75, 1.5),
	borderBottom: `1px solid ${theme.palette.divider}`,
	"&:last-child": {
		borderBottom: "none",
	},
	fontSize: "0.8rem",
}));

const VariableName = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	color: theme.palette.text.primary,
	marginRight: theme.spacing(1),
	fontFamily: "monospace", // PyCharm uses monospace for variables
}));

const VariableType = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontStyle: "italic",
	marginRight: theme.spacing(1),
	fontFamily: "monospace",
}));

const VariableValue = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	flexGrow: 1,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	fontFamily: "monospace",
	maxWidth: 'calc(100% - 200px)', // Adjust as needed based on other elements
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

// Individual variable display component
type VariableDisplayProps = {
	variable: ExecutionVariable;
	onEdit: (variable: ExecutionVariable) => void;
	onDelete: (variableKey: string) => void;
};

const VariableRow: FC<VariableDisplayProps> = ({ variable, onEdit, onDelete }) => {
	const theme = useTheme();
	const [expanded, setExpanded] = useState(false);

	// Determine if variable is expandable (e.g., dict, list, dataframe, array)
	// For now, let's assume types like 'dict', 'list', 'DataFrame', 'ndarray' are expandable
	const isExpandable = ['dict', 'list', 'DataFrame', 'ndarray', 'object', 'array'].includes(variable.type);

	const handleToggleExpand = () => {
		if (isExpandable) {
			setExpanded(!expanded);
		}
	};

	return (
		<>
			<VariableItem
				sx={{
					cursor: isExpandable ? "pointer" : "default",
					"&:hover": {
						backgroundColor: isExpandable ? alpha(theme.palette.action.hover, 0.08) : "transparent",
					},
				}}
				onClick={handleToggleExpand}
			>
				{isExpandable ? (
					<IconButton size="small" sx={{ mr: 0.5, p: 0.25 }} >
						{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					</IconButton>
				) : (
					<Box sx={{ width: theme.spacing(3.5) }} /> // Placeholder for alignment
				)}
				<VariableName variant="body2">{variable.key}</VariableName>
				<VariableType variant="caption">{`{${variable.type}}`}</VariableType>
				<Tooltip title={String(variable.value)} placement="top-start" arrow>
					<VariableValue variant="body2">
						{String(variable.value)}
					</VariableValue>
				</Tooltip>
				<VariableActions>
					<Tooltip title="Edit Variable">
						<IconButton onClick={(e) => { e.stopPropagation(); onEdit(variable); }} size="small" sx={{ mr: 0.25, padding: theme.spacing(0.5) }}>
							<Edit2 size={14} />
						</IconButton>
					</Tooltip>
					<Tooltip title="Delete Variable">
						<IconButton onClick={(e) => { e.stopPropagation(); onDelete(variable.key); }} size="small" color="error" sx={{ padding: theme.spacing(0.5) }}>
							<Trash2 size={14} />
						</IconButton>
					</Tooltip>
				</VariableActions>
			</VariableItem>
			{isExpandable && (
				<Collapse in={expanded} timeout="auto" unmountOnExit>
					<Box sx={{ pl: 4, py: 1, backgroundColor: alpha(theme.palette.background.default, 0.05), borderBottom: `1px solid ${theme.palette.divider}` }}>
						{/* Placeholder for expanded content */}
						<Typography variant="caption" color="text.secondary">
							Detailed view for {variable.key} (type: {variable.type}) will be shown here.
							<br />
							For example, a table for a DataFrame or a formatted list for an array.
						</Typography>
					</Box>
				</Collapse>
			)}
		</>
	);
};


export const CanvasVariablesViewer: FC<CanvasVariablesViewerProps> = ({
	conversationId,
}) => {
	const agentId = conversationId;
	const theme = useTheme();

	const {
		data: variablesResponse,
		isLoading,
		error,
		isError,
	} = useAgentExecutionVariables(agentId);

	useEffect(() => {
		if (isError && error) {
			showErrorToast(
				`Error loading variables: ${error.message || "An unknown error occurred."}`,
			);
		}
	}, [isError, error]);

	const handleCreateVariable = () => {
		showInfoToast("Create variable functionality not yet implemented.");
	};

	const handleEditVariable = (variable: ExecutionVariable) => {
		showInfoToast(`Edit variable "${variable.key}" functionality not yet implemented.`);
	};

	const handleDeleteVariable = (variableKey: string) => {
		showInfoToast(`Delete variable "${variableKey}" functionality not yet implemented.`);
	};

	if (isLoading) {
		return (
			<CenteredBox>
				<CircularProgress size={24} />
				<Typography variant="body2" sx={{ mt: 1.5 }} color="text.secondary">
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

	const variables = variablesResponse?.result?.execution_variables ?? [];

	if (variables.length === 0) {
		return (
			<CenteredBox>
				<Typography variant="subtitle1" gutterBottom color="text.primary">
					No Execution Variables
				</Typography>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
					This agent currently has no execution variables set.
				</Typography>
				<Button
					variant="outlined"
					size="small"
					startIcon={<PlusCircle size={16} />}
					onClick={handleCreateVariable}
					sx={{ textTransform: "none", fontSize: "0.8125rem", padding: theme.spacing(0.5, 1.5) }}
				>
					Create Variable
				</Button>
			</CenteredBox>
		);
	}

	return (
		<Box sx={{ p: 1.5, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
			<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1, px: 0.5 }}>
				<Typography variant="body1" fontWeight={500} sx={{ fontSize: "0.875rem" }}>
					Agent Execution Variables
				</Typography>
				<Tooltip title="Create New Variable">
					<IconButton onClick={handleCreateVariable} size="small">
						<PlusCircle size={18} />
					</IconButton>
				</Tooltip>
			</Box>
			<VariableListContainer>
				{variables.map((variable) => (
					<VariableRow
						key={variable.key}
						variable={variable}
						onEdit={handleEditVariable}
						onDelete={handleDeleteVariable}
					/>
				))}
			</VariableListContainer>
		</Box>
	);
};
