/**
 * Import Agent Dialog Component
 *
 * A dialog for importing agents from ZIP files
 */

import type { AgentDetails } from "@shared/api/local-operator/types";
import { Spinner } from "@shared/components/common/spinner";
import { useImportAgent } from "@shared/hooks/use-agent-mutations";
import { cn } from "@shared/lib/utils";
import { FileInput as FileImportIcon, Upload } from "lucide-react";
import type { FC } from "react";
import { useCallback, useRef, useState } from "react";
import { BaseDialog, PrimaryButton, SecondaryButton } from "./base-dialog";

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

	const handleDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(false);
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
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
		(e: React.DragEvent<HTMLElement>) => {
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
		<>
			<FileImportIcon size={19} className="text-accent" aria-hidden="true" />
			Import agent
		</>
	);

	const dialogActions = (
		<>
			<SecondaryButton onClick={handleClose} disabled={isLoading}>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={handleSubmit}
				disabled={isSubmitDisabled}
				startIcon={isLoading ? <Spinner /> : null}
			>
				Import agent
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
			<p className="mb-4 text-body-sm text-ink-muted">
				Import an agent from a ZIP file exported from Local Operator. The file
				should contain an agent.yml file.
			</p>
			<div className="flex flex-col gap-5">
				<input
					ref={fileInputRef}
					type="file"
					accept=".zip"
					onChange={handleFileSelect}
					disabled={isLoading}
					className="hidden"
				/>
				{/*
				 * The drop target: `border-control` is its sole boundary, so it is
				 * structural, and dragging swaps it to the accent as state feedback.
				 */}
				<button
					type="button"
					onClick={handleClickUpload}
					onDragEnter={handleDragEnter}
					onDragLeave={handleDragLeave}
					onDragOver={handleDragOver}
					onDrop={handleDrop}
					disabled={isLoading}
					className={cn(
						"cursor-pointer rounded-lg border-2 border-control border-dashed bg-surface p-4 text-center",
						"transition-colors duration-base ease-out-quart",
						"hover:bg-accent-wash",
						"disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
						isDragActive && "border-accent bg-accent-wash",
					)}
				>
					{file ? (
						<>
							<FileImportIcon
								size={32}
								className="mx-auto mb-2 text-ink-muted"
								aria-hidden="true"
							/>
							<p className="text-body text-ink">{file.name}</p>
							<p className="text-body-sm text-ink-muted">
								Click or drag to replace
							</p>
						</>
					) : (
						<>
							<Upload
								size={32}
								className="mx-auto mb-2 text-ink-muted"
								aria-hidden="true"
							/>
							<p className="text-body text-ink">
								Drag and drop a ZIP file here
							</p>
							<p className="text-body-sm text-ink-muted">
								or click to select a file
							</p>
						</>
					)}
				</button>

				{error && (
					<p role="alert" className="text-body-sm text-danger">
						{error}
					</p>
				)}
			</div>
		</BaseDialog>
	);
};
