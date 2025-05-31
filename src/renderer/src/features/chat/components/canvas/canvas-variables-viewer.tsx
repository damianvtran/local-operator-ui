import {
	Box,
	Button,
	CircularProgress,
	Paper,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { useAgentExecutionVariables } from "@shared/hooks/use-agent-execution-variables";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Edit2, Trash2 } from "lucide-react";
import type { FC } from "react";
import { useEffect } from "react";

type CanvasVariablesViewerProps = {
	conversationId: string;
	// agentId is needed to fetch variables, assuming it can be derived or passed
	// For now, let's assume agentId is the same as conversationId or can be fetched
	// based on conversationId. This might need adjustment based on actual app logic.
	// For the purpose of this task, we'll use conversationId as agentId.
};

const StyledPaper = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2),
	margin: theme.spacing(2, 0),
	backgroundColor: alpha(theme.palette.background.default, 0.8),
}));

const CenteredBox = styled(Box)({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	padding: 3,
	textAlign: "center",
});

export const CanvasVariablesViewer: FC<CanvasVariablesViewerProps> = ({
	conversationId,
}) => {
	const agentId = conversationId; // Assuming agentId is derivable from conversationId

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

	// TODO: Implement Create, Update, Delete mutations and UI elements (dialogs, forms)

	if (isLoading) {
		return (
			<CenteredBox>
				<CircularProgress />
				<Typography sx={{ mt: 2 }}>Loading variables...</Typography>
			</CenteredBox>
		);
	}

	// Error display is now handled by the toast, but we can still show a message in the UI
	if (isError) {
		return (
			<CenteredBox>
				<Typography variant="h6" color="text.secondary">
					Could not load variables.
				</Typography>
				<Typography color="text.secondary" variant="caption">
					Please check the notifications or try again later.
				</Typography>
			</CenteredBox>
		);
	}

	const variables = variablesResponse?.result?.execution_variables ?? [];

	if (variables.length === 0) {
		return (
			<CenteredBox>
				<Typography variant="h6" gutterBottom>
					No Execution Variables
				</Typography>
				<Typography variant="body2" color="text.secondary">
					This agent currently has no execution variables set.
				</Typography>
				{/* TODO: Add button to create a new variable */}
			</CenteredBox>
		);
	}

	return (
		<Box sx={{ p: 2, height: "100%", overflowY: "auto" }}>
			<Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
				Agent Execution Variables
			</Typography>
			{/* TODO: Add "Create New Variable" Button here */}
			<TableContainer component={StyledPaper}>
				<Table stickyHeader size="small">
					<TableHead>
						<TableRow>
							<TableCell>Key</TableCell>
							<TableCell>Value</TableCell>
							<TableCell>Type</TableCell>
							<TableCell align="right">Actions</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{variables.map((variable) => (
							<TableRow hover key={variable.key}>
								<TableCell component="th" scope="row">
									{variable.key}
								</TableCell>
								<TableCell
									sx={{
										maxWidth: 200,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									<Typography variant="caption" component="span">
										{variable.value}
									</Typography>
								</TableCell>
								<TableCell>{variable.type}</TableCell>
								<TableCell align="right">
									<Button
										size="small"
										startIcon={<Edit2 size={14} />}
										onClick={() => {
											/* TODO: Implement edit functionality */
										}}
										sx={{ mr: 0.5 }}
									>
										Edit
									</Button>
									<Button
										size="small"
										color="error"
										startIcon={<Trash2 size={14} />}
										onClick={() => {
											/* TODO: Implement delete functionality */
										}}
									>
										Delete
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableContainer>
		</Box>
	);
};
