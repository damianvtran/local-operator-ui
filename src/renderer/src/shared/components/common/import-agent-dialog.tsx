/**
 * Import Agent Dialog Component
 *
 * A dialog for importing agents from ZIP files
 */

import { faFileImport, faUpload } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	CircularProgress,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { useImportAgent } from "@shared/hooks/use-agent-mutations";
import type { FC } from "react";
import { useCallback, useRef, useState } from "react";
import {
	BaseDialog,
	FormContainer,
	PrimaryButton,
	SecondaryButton,
	TitleContainer,
} from "./base-dialog";

/**
 * Props for the ImportAgentDialog component
 */
type ImportAgentDialogProps = {
	/**
	 * Whether the dialog is open
	 */
	open: boolean;
	/**
	 * Callback when the dialog is closed
	 */
	onClose: () => void;
	/**
	 * Optional callback when an agent is successfully imported
	 */
	onAgentImported?: (agentId: string) => void;
};

const StyledIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	color: theme.palette.primary.main,
	fontSize: "1.2rem",
}));

const UploadArea = styled(Box)(({ theme }) => ({
	border: `2px dashed ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 2,
	padding: theme.spacing(4),
	textAlign: "center",
	cursor: "pointer",
	transition: "all 0.2s ease-in-out",
	backgroundColor: alpha(theme.palette.background.paper, 0.6),
	"&:hover": {
		borderColor: theme.palette.primary.main,
		backgroundColor: alpha(theme.palette.action.hover, 0.1),
	},
	"&.drag-active": {
		borderColor: theme.palette.primary.main,
		backgroundColor: alpha(theme.palette.primary.main, 0.05),
		boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`,
	},
}));

const UploadIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	fontSize: "2rem",
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(2),
}));

const FileInput = styled("input")({
	display: "none",
});

const Subtitle = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontSize: "0.875rem",
	marginTop: 4,
	marginBottom: 16,
}));

const ErrorMessage = styled(Typography)(({ theme }) => ({
	color: theme.palette.error.main,
	fontSize: "0.875rem",
	marginTop: theme.spacing(2),
}));

/**
 * Import Agent Dialog Component
 *
 * A dialog for importing agents from ZIP files
 */
export const ImportAgentDialog: FC<ImportAgentDialogProps> = ({
	open,
	onClose,
	onAgentImported,
}) => {
	const [file, setFile] = useState<File | null>(null);
	const [isDragActive, setIsDragActive] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const importAgentMutation = useImportAgent();

	const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(false);
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
	}, []);

	const validateFile = useCallback((file: File): boolean => {
		// Check if it's a ZIP file
		if (!file.name.toLowerCase().endsWith(".zip")) {
			setError("Only ZIP files are supported");
			return false;
		}

		// Clear any previous errors
		setError(null);
		return true;
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragActive(false);

			if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
				const droppedFile = e.dataTransfer.files[0];
				if (validateFile(droppedFile)) {
					setFile(droppedFile);
				}
			}
		},
		[validateFile],
	);

	const handleFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			if (e.target.files && e.target.files.length > 0) {
				const selectedFile = e.target.files[0];
				if (validateFile(selectedFile)) {
					setFile(selectedFile);
				}
			}
		},
		[validateFile],
	);

	const handleClickUpload = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleSubmit = async () => {
		if (!file) return;

		try {
			const result = await importAgentMutation.mutateAsync(file);

			// Reset form and close dialog on success
			setFile(null);
			setError(null);

			// Call the onAgentImported callback if provided
			if (onAgentImported && result) {
				onAgentImported((result as AgentDetails).id);
			}

			onClose();
		} catch (error) {
			// Error is handled in the mutation
			console.error("Failed to import agent:", error);
		}
	};

	const handleClose = () => {
		// Reset state when closing
		setFile(null);
		setError(null);
		onClose();
	};

	const isLoading = importAgentMutation.isPending;
	const isSubmitDisabled = isLoading || !file;

	const dialogTitle = (
		<TitleContainer>
			<StyledIcon icon={faFileImport} />
			Import Agent
		</TitleContainer>
	);

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={handleClose}
				variant="outlined"
				disabled={isLoading}
			>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={handleSubmit}
				disabled={isSubmitDisabled}
				startIcon={
					isLoading ? <CircularProgress size={20} color="inherit" /> : null
				}
			>
				Import Agent
			</PrimaryButton>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={handleClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
		>
			<Subtitle>
				Import an agent from a ZIP file exported from Local Operator. The file
				should contain an agent.yml file.
			</Subtitle>
			<FormContainer>
				<FileInput
					ref={fileInputRef}
					type="file"
					accept=".zip"
					onChange={handleFileSelect}
					disabled={isLoading}
				/>
				<UploadArea
					onClick={handleClickUpload}
					onDragEnter={handleDragEnter}
					onDragLeave={handleDragLeave}
					onDragOver={handleDragOver}
					onDrop={handleDrop}
					className={isDragActive ? "drag-active" : ""}
				>
					{file ? (
						<>
							<UploadIcon icon={faFileImport} />
							<Typography variant="body1" gutterBottom>
								{file.name}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Click or drag to replace
							</Typography>
						</>
					) : (
						<>
							<UploadIcon icon={faUpload} />
							<Typography variant="body1" gutterBottom>
								Drag and drop a ZIP file here
							</Typography>
							<Typography variant="body2" color="text.secondary">
								or click to select a file
							</Typography>
						</>
					)}
				</UploadArea>

				{error && <ErrorMessage>{error}</ErrorMessage>}
			</FormContainer>
		</BaseDialog>
	);
};
