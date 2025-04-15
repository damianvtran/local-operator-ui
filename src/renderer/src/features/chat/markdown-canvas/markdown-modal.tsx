import { Box, Fade, Modal, Stack } from "@mui/material";
import { type FC, useEffect, useRef, useState } from "react";
import Split from "react-split";
import { CanvasEditor } from "./canvas-editor";
import type { MarkdownDocument } from "./types";

type MarkdownModalProps = {
	/** Whether the canvas is open */
	open: boolean;

	/** Function to close the canvas */
	onClose: () => void;

	/** Initial markdown documents to display */
	initialDocuments?: MarkdownDocument[];

	/** ID of the active document */
	activeDocumentId?: string | null;

	/** Callback when a document tab is selected */
	onChangeActiveDocument?: (documentId: string) => void;

	/** @SELF:This is a test and should be removed  */
	test?: () => JSX.Element;
};

const FADE_DURATION = 100; // match your transition timing

/**
 * Displays markdown documents in tabs within a sidebar.
 * Replaces the agent options sidebar with a markdown canvas.
 */
export const MarkdownModal: FC<MarkdownModalProps> = ({
	test,
	open,
	onClose,
	initialDocuments = [],
	activeDocumentId,
	onChangeActiveDocument: externalChangeActiveDocument,
}) => {
	return (
		<Stack
			direction="row"
			sx={(theme) => ({
				backgroundColor: "white",

				opacity: open ? 1 : 0,
				pointerEvents: open ? "auto" : "none",
				transition: `opacity ${FADE_DURATION}ms ease-in-out`,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: "100vw",
				height: "100vh",
				position: "fixed", // make sure it's full-screen
				top: 0,
				left: 0,
				bgcolor: "background.default", // optional
				zIndex: theme.zIndex.modal,

				".gutter": {
					backgroundColor: "#eee",
					backgroundRepeat: "no-repeat",
					backgroundPosition: "50%",
				},

				".gutter.gutter-horizontal": {
					backgroundImage:
						"url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAeCAYAAADkftS9AAAAIklEQVQoU2M4c+bMfxAGAgYYmwGrIIiDjrELjpo5aiZeMwF+yNnOs5KSvgAAAABJRU5ErkJggg==')",
					cursor: "col-resize",
				},
			})}
		>
			<Split
				style={{
					display: "flex",
					flexDirection: "row",
					height: "100%",
					width: "100%",
				}}
			>
				<Box
					sx={
						{
							// border: "2px solid blue",
						}
					}
				>
					{
						// test()
						<CanvasEditor
							{...{
								onClose,
								initialDocuments,
								activeDocumentId,
							}}
							onChangeActiveDocument={externalChangeActiveDocument}
						/>
					}
				</Box>
				<Box
					sx={
						{
							// border: "2px solid green",
						}
					}
				>
					<CanvasEditor
						{...{
							onClose,
							initialDocuments,
							activeDocumentId,
						}}
						onChangeActiveDocument={externalChangeActiveDocument}
					/>
				</Box>
			</Split>
		</Stack>
	);
};
