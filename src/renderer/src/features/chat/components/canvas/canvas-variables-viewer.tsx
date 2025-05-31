import {
	Box,
	Button,
	CircularProgress,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Tooltip,
	Typography,
	alpha,
	IconButton,
} from "@mui/material";
import { styled, useTheme } from "@mui/material/styles"; 
import type { ExecutionVariable } from "@shared/api/local-operator/types";
import { useAgentExecutionVariables } from "@shared/hooks/use-agent-execution-variables";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { Edit2, Trash2, PlusCircle } from "lucide-react";
import type { FC } from "react";
import { useEffect } from "react";

type CanvasVariablesViewerProps = {
	conversationId: string;
};

// Moved styled components inside or ensure theme is correctly accessed
const StyledTableContainer = styled(TableContainer)(({ theme }) => ({
	margin: 0, // Shadcn: often less margin around tables
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius, // Match theme's border radius
	backgroundColor: theme.palette.mode === "dark" ? alpha(theme.palette.background.paper, 0.3) : alpha(theme.palette.grey[50], 0.7), // Subtle background
}));

const CenteredBox = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	padding: theme.spacing(2), // Reduced padding
	textAlign: "center",
}));

const StyledTableCell = styled(TableCell)(({ theme }) => ({
	padding: theme.spacing(0.5, 1), // Shadcn: compact padding
	fontSize: "0.75rem", // Shadcn: smaller text
	borderBottom: `1px solid ${theme.palette.divider}`,
	"&:last-child": {
		borderBottom: 0,
	},
}));

const HeaderTableCell = styled(StyledTableCell)(({ theme }) => ({
	fontWeight: 500,
	color: theme.palette.text.secondary, // Subtler header text
	backgroundColor: alpha(theme.palette.background.default, 0.05)
}));


export const CanvasVariablesViewer: FC<CanvasVariablesViewerProps> = ({
	conversationId,
}) => {
	const agentId = conversationId;
	const theme = useTheme(); // Access theme for inline styles if needed

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
				<Typography variant="body1" fontWeight={600} sx={{ fontSize: "0.875rem" }}>
					Agent Execution Variables
				</Typography>
				<Tooltip title="Create New Variable">
					<IconButton onClick={handleCreateVariable} size="small">
						<PlusCircle size={18} />
					</IconButton>
				</Tooltip>
			</Box>
			<StyledTableContainer>
				<Table stickyHeader size="small" aria-label="execution variables table">
					<TableHead>
						<TableRow>
							<HeaderTableCell>Key</HeaderTableCell>
							<HeaderTableCell>Value</HeaderTableCell>
							<HeaderTableCell>Type</HeaderTableCell>
							<HeaderTableCell align="right">Actions</HeaderTableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{variables.map((variable) => (
							<TableRow hover key={variable.key} sx={{ "&:last-child td, &:last-child th": { border: 0 } }}>
								<StyledTableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
									{variable.key}
								</StyledTableCell>
								<StyledTableCell sx={{ wordBreak: "break-word", minWidth: 150, maxWidth: 300 }}>
									<Tooltip title={variable.value} placement="top-start" arrow>
										<Typography
											variant="body2"
											component="span"
											sx={{
												display: "-webkit-box",
												WebkitLineClamp: 3, // Show up to 3 lines
												WebkitBoxOrient: "vertical",
												overflow: "hidden",
												textOverflow: "ellipsis",
												fontSize: "0.75rem",
												lineHeight: 1.4,
											}}
										>
											{variable.value}
										</Typography>
									</Tooltip>
								</StyledTableCell>
								<StyledTableCell sx={{ whiteSpace: "nowrap" }}>{variable.type}</StyledTableCell>
								<StyledTableCell align="right">
									<Tooltip title="Edit Variable">
										<IconButton onClick={() => handleEditVariable(variable)} size="small" sx={{ mr: 0.25, padding: theme.spacing(0.5) }}>
											<Edit2 size={14} />
										</IconButton>
									</Tooltip>
									<Tooltip title="Delete Variable">
										<IconButton onClick={() => handleDeleteVariable(variable.key)} size="small" color="error" sx={{ padding: theme.spacing(0.5) }}>
											<Trash2 size={14} />
										</IconButton>
									</Tooltip>
								</StyledTableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</StyledTableContainer>
		</Box>
	);
};
