import {
	Box,
	Button,
	CircularProgress,
	Tooltip,
	Typography,
	alpha,
	IconButton,
	Collapse,
} from "@mui/material";
import { styled, useTheme } from "@mui/material/styles";
import type { ExecutionVariable } from "@shared/api/local-operator/types";
import { useAgentExecutionVariables } from "@shared/hooks/use-agent-execution-variables";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { Edit2, Trash2, PlusCircle, ChevronRight, ChevronDown } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState, useMemo, useCallback, memo } from "react";

type CanvasVariablesViewerProps = {
	conversationId: string;
};

const VariableListContainer = styled(Box)(({ theme }) => ({
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	backgroundColor: theme.palette.mode === "dark" ? alpha(theme.palette.background.paper, 0.3) : alpha(theme.palette.grey[50], 0.7),
	overflow: "auto",
	maxHeight: "100%",
  "&::-webkit-scrollbar": {
    width: "8px",
  },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.1)"
        : "rgba(0, 0, 0, 0.2)",
    borderRadius: "4px",
  },
  // For Firefox
  scrollbarWidth: "thin",
  scrollbarColor:
    theme.palette.mode === "dark"
      ? "rgba(255,255,255,0.1) transparent"
      : "rgba(0,0,0,0.2) transparent",
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
	maxWidth: 'calc(100% - 200px)', // Adjust as needed based on other elements
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

// Memoized constants
const EXPANDABLE_TYPES = ['dict', 'list', 'DataFrame', 'ndarray', 'object', 'array'];

// Utility function to truncate text
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}...`;
};

// Individual variable display component
type VariableDisplayProps = {
	variable: ExecutionVariable;
	onEdit: (variable: ExecutionVariable) => void;
	onDelete: (variableKey: string) => void;
};

const VariableRow: FC<VariableDisplayProps> = memo(({ variable, onEdit, onDelete }) => {
	const theme = useTheme();
	const [expanded, setExpanded] = useState(false);

	// Memoize expandable check
	const isExpandable = useMemo(() => 
		EXPANDABLE_TYPES.includes(variable.type), 
		[variable.type]
	);

	// Memoize string value conversion with truncation
	const stringValue = useMemo(() => String(variable.value), [variable.value]);
	const truncatedValue = useMemo(() => truncateText(stringValue, 200), [stringValue]);
	const tooltipValue = useMemo(() => truncateText(stringValue, 1000), [stringValue]);

	// Memoize variable type display
	const typeDisplay = useMemo(() => `{${variable.type}}`, [variable.type]);

	// Memoize dynamic styles
	const itemStyles = useMemo(() => ({
		cursor: isExpandable ? "pointer" : "default",
		"&:hover": {
			backgroundColor: isExpandable ? alpha(theme.palette.action.hover, 0.08) : "transparent",
		},
	}), [isExpandable, theme.palette.action.hover]);

	const expandedContentStyles = useMemo(() => ({
		pl: 4,
		py: 1,
		backgroundColor: alpha(theme.palette.background.default, 0.05),
		borderBottom: `1px solid ${theme.palette.divider}`
	}), [theme.palette.background.default, theme.palette.divider]);

	const placeholderBoxStyles = useMemo(() => ({
		width: theme.spacing(3.5)
	}), [theme]);

	// Memoize callbacks
	const handleToggleExpand = useCallback(() => {
		if (isExpandable) {
			setExpanded(prev => !prev);
		}
	}, [isExpandable]);

	const handleEdit = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		onEdit(variable);
	}, [onEdit, variable]);

	const handleDelete = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		onDelete(variable.key);
	}, [onDelete, variable.key]);

	return (
		<>
			<VariableItem
				sx={itemStyles}
				onClick={handleToggleExpand}
			>
				{isExpandable ? (
					<IconButton size="small" sx={{ mr: 0.5, p: 0.25 }} >
						{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					</IconButton>
				) : (
					<Box sx={placeholderBoxStyles} /> // Placeholder for alignment
				)}
				<VariableName variant="body2">{variable.key}</VariableName>
				<VariableType variant="caption">{typeDisplay}</VariableType>
				<Tooltip title={tooltipValue} placement="top-start" arrow>
					<VariableValue variant="body2">
						{truncatedValue}
					</VariableValue>
				</Tooltip>
				<VariableActions>
					<Tooltip title="Edit Variable">
						<IconButton onClick={handleEdit} size="small" sx={{ mr: 0.25, padding: theme.spacing(0.5) }}>
							<Edit2 size={14} />
						</IconButton>
					</Tooltip>
					<Tooltip title="Delete Variable">
						<IconButton onClick={handleDelete} size="small" color="error" sx={{ padding: theme.spacing(0.5) }}>
							<Trash2 size={14} />
						</IconButton>
					</Tooltip>
				</VariableActions>
			</VariableItem>
			{isExpandable && (
				<Collapse in={expanded} timeout="auto" unmountOnExit>
					<Box sx={expandedContentStyles}>
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
});

VariableRow.displayName = 'VariableRow';

export const CanvasVariablesViewer: FC<CanvasVariablesViewerProps> = memo(({
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

	// Memoize variables array
	const variables = useMemo(() => 
		variablesResponse?.result?.execution_variables ?? [], 
		[variablesResponse?.result?.execution_variables]
	);

	// Memoize callbacks
	const handleCreateVariable = useCallback(() => {
		showInfoToast("Create variable functionality not yet implemented.");
	}, []);

	const handleEditVariable = useCallback((variable: ExecutionVariable) => {
		showInfoToast(`Edit variable "${variable.key}" functionality not yet implemented.`);
	}, []);

	const handleDeleteVariable = useCallback((variableKey: string) => {
		showInfoToast(`Delete variable "${variableKey}" functionality not yet implemented.`);
	}, []);

	// Memoize static styles
	const containerStyles = useMemo(() => ({
		p: 1.5,
		height: "100%",
		display: "flex",
		flexDirection: "column",
		minHeight: 0, // Important for flex children to shrink
	}), []);

	const headerStyles = useMemo(() => ({
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
		mb: 1,
		px: 0.5,
		flexShrink: 0, // Prevent header from shrinking
	}), []);

	const titleStyles = useMemo(() => ({
		fontSize: "0.875rem"
	}), []);

	const createButtonStyles = useMemo(() => ({
		textTransform: "none",
		fontSize: "0.8125rem",
		padding: theme.spacing(0.5, 1.5)
	}), [theme]);

	const loadingTextStyles = useMemo(() => ({
		mt: 1.5
	}), []);

	const emptyStateTextStyles = useMemo(() => ({
		mb: 1.5
	}), []);

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
				<Typography variant="body2" sx={loadingTextStyles} color="text.secondary">
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
				<Typography variant="body2" color="text.secondary" sx={emptyStateTextStyles}>
					This agent currently has no execution variables set.
				</Typography>
				<Button
					variant="outlined"
					size="small"
					startIcon={<PlusCircle size={16} />}
					onClick={handleCreateVariable}
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
});

CanvasVariablesViewer.displayName = 'CanvasVariablesViewer';
