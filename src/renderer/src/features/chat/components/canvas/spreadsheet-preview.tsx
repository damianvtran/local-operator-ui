import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import type { FC } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { iconSetQuartz } from "ag-grid-community";
import { getFileTypeFromPath } from "../../utils/file-types";
import { useTheme, styled, alpha } from "@mui/material";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useCanvasStore } from "@shared/store/canvas-store";
import { showSuccessToast, showErrorToast } from "@shared/utils/toast-manager";
import type { CanvasDocument } from "../../types/canvas";

type SpreadsheetPreviewProps = {
	document: CanvasDocument;
	conversationId?: string;
	agentId?: string;
};

ModuleRegistry.registerModules([AllCommunityModule]);

const SpreadsheetContainer = styled("div")({
	height: "100%",
	width: "100%",
	display: "flex",
	flexDirection: "column",
  maskImage: "none",
});

const GridWrapper = styled("div")({
	flex: 1,
	height: "calc(100% - 40px)",
	width: "100%",
});

const SheetTabsContainer = styled("div")(({ theme }) => ({
	display: "flex",
	borderTop: `1px solid ${theme.palette.divider}`,
	padding: theme.spacing(0, 1),
	background: theme.palette.background.paper,
	height: "40px",
	alignItems: "center",
}));

const SheetTab = styled("button")<{ "data-active": boolean }>(
	({ theme, "data-active": active }) => ({
		background: "none",
		border: "none",
		padding: theme.spacing(1, 2),
		cursor: "pointer",
		color: active ? theme.palette.text.primary : theme.palette.text.secondary,
		position: "relative",
		fontWeight: active ? 600 : 400,
		transition: "color 0.3s",

		"&:after": {
			content: '""',
			display: "block",
			position: "absolute",
			bottom: 0,
			left: "50%",
			transform: "translateX(-50%)",
			width: active ? "100%" : "0%",
			height: "2px",
			backgroundColor: theme.palette.primary.main,
			transition: "width 0.3s ease-in-out",
		},

		"&:hover": {
			color: theme.palette.text.primary,
		},

		"&:hover:after": {
			width: "100%",
		},
	}),
);

const SpreadsheetPreviewComponent: FC<SpreadsheetPreviewProps> = ({
	document,
	conversationId,
}) => {
	const theme = useTheme();
	const gridRef = useRef<AgGridReact>(null);
	const [sheetsData, setSheetsData] = useState<
		Record<string, Record<string, unknown>[]>
	>({});
	const [activeSheetName, setActiveSheetName] = useState("");
	const [hasUserChanges, setHasUserChanges] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const originalDataRef = useRef<Record<string, Record<string, unknown>[]>>({});
	const isInitialLoadRef = useRef(true);
	
	const { setFiles, setSpreadsheetData } = useCanvasStore();
	const canvasState = useCanvasStore((state) =>
		conversationId ? state.conversations[conversationId] : undefined,
	);

	const debouncedSheetsData = useDebouncedValue(sheetsData, 3000);

	const parseFile = useCallback((fileContent: string, filePath: string) => {
		try {
			const fileType = getFileTypeFromPath(filePath);
			const isCsv = fileType === "spreadsheet" && filePath.endsWith(".csv");

			let workbook: XLSX.WorkBook;
			if (isCsv) {
				// For CSV files, keep the original logic that was working
				let csvText = fileContent;
				// CSVs are text but might be base64 encoded from certain app flows.
				// We try to decode it, and if it fails, assume it's plain text.
				try {
					csvText = atob(fileContent);
				} catch (_) {
					// Not a valid base64 string, so use content as is.
				}
				workbook = XLSX.read(csvText, { type: "string" });
			} else {
				// For XLSX files, the content is base64-encoded binary data
				// Pass it directly to XLSX.read with type "base64"
				workbook = XLSX.read(fileContent, { type: "base64" });
			}

			const newSheetsData: Record<string, Record<string, unknown>[]> = {};
			for (const sheetName of workbook.SheetNames) {
				const worksheet = workbook.Sheets[sheetName];
				const jsonSheet = XLSX.utils.sheet_to_json(
					worksheet,
				) as Record<string, unknown>[];
				newSheetsData[sheetName] = jsonSheet;
			}
			setSheetsData(newSheetsData);
			// Deep clone the original data to prevent reference issues
			originalDataRef.current = JSON.parse(JSON.stringify(newSheetsData));
			setHasUserChanges(false);
			isInitialLoadRef.current = true;
			if (workbook.SheetNames.length > 0) {
				setActiveSheetName(workbook.SheetNames[0]);
			}
		} catch (error) {
			console.error("Error parsing file:", error);
		}
	}, []);

	useEffect(() => {
		if (document.content && document.path) {
			parseFile(document.content, document.path);
		}
	}, [document.content, document.path, parseFile]);

	// Helper function to compare spreadsheet data
	const isDataEqual = useCallback((
		data1: Record<string, Record<string, unknown>[]>,
		data2: Record<string, Record<string, unknown>[]>
	): boolean => {
		return JSON.stringify(data1) === JSON.stringify(data2);
	}, []);

	const saveChanges = useCallback(async () => {
		if (
			!document.path || 
			Object.keys(debouncedSheetsData).length === 0 || 
			isSaving ||
			!hasUserChanges
		) {
			return;
		}

		// Final check - compare data to prevent unnecessary saves
		if (isDataEqual(debouncedSheetsData, originalDataRef.current)) {
			// Data is the same, reset the hasUserChanges flag
			setHasUserChanges(false);
			return;
		}

		setIsSaving(true);

		const workbook = XLSX.utils.book_new();
		for (const [sheetName, sheetData] of Object.entries(
			debouncedSheetsData,
		)) {
			const worksheet = XLSX.utils.json_to_sheet(sheetData);
			XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
		}

		const fileType = getFileTypeFromPath(document.path);
		const isCsv = fileType === "spreadsheet" && document.path.endsWith(".csv");

		const newContent = isCsv
			? XLSX.write(workbook, { bookType: "csv", type: "string" })
			: XLSX.write(workbook, {
					type: "base64",
					bookType: "xlsx",
				});

		try {
			// Pass encoding to saveFile to ensure correct file writing.
			await window.api.saveFile(
				document.path,
				newContent,
				isCsv ? "utf8" : "base64",
			);

			// Update canvas store with new content only after successful save
			if (conversationId && canvasState) {
				const updatedFiles = canvasState.files.map((file) =>
					file.id === document.id
						? { ...file, content: newContent }
						: file,
				);
				setFiles(conversationId, updatedFiles);
			}

			// Update the original data reference and reset change flags
			originalDataRef.current = JSON.parse(JSON.stringify(debouncedSheetsData));
			setHasUserChanges(false);

			showSuccessToast("Spreadsheet saved successfully");
		} catch (error) {
			console.error("Failed to save file:", error);
			showErrorToast(`Failed to save spreadsheet: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setIsSaving(false);
		}
	}, [document.path, document.id, debouncedSheetsData, conversationId, canvasState, setFiles, hasUserChanges, isSaving, isDataEqual]);

	useEffect(() => {
		// Only save if we have data, user has made changes, and it's not the initial load
		if (
			Object.keys(debouncedSheetsData).length > 0 && 
			hasUserChanges && 
			!isInitialLoadRef.current
		) {
			saveChanges();
		}
	}, [debouncedSheetsData, saveChanges, hasUserChanges]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === "s") {
				event.preventDefault();
				saveChanges();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [saveChanges]);

	const onCellValueChanged = useCallback(
		(event: CellValueChangedEvent) => {
			const { colDef, newValue, node } = event;
			const sheetData = sheetsData[activeSheetName];
			const rowIndex = node.rowIndex;
			if (sheetData && rowIndex !== null && colDef.field) {
				const updatedRow = {
					...sheetData[rowIndex],
					[colDef.field]: newValue,
				};
				const updatedSheetData = [...sheetData];
				updatedSheetData[rowIndex] = updatedRow;
				const newSheetsData = {
					...sheetsData,
					[activeSheetName]: updatedSheetData,
				};
				setSheetsData(newSheetsData);

				// Mark that user has made changes and this is no longer initial load
				isInitialLoadRef.current = false;
				setHasUserChanges(true);

				// Update canvas store immediately for real-time sync (but don't save to disk yet)
				if (conversationId) {
					setSpreadsheetData(conversationId, document.id, newSheetsData);
				}
			}
		},
		[activeSheetName, sheetsData, conversationId, document.id, setSpreadsheetData],
	);

	const columnDefs = useMemo<ColDef[]>(() => {
		if (!sheetsData[activeSheetName] || sheetsData[activeSheetName].length === 0) {
			return [];
		}
		const firstRow = sheetsData[activeSheetName][0];
		return Object.keys(firstRow).map((key) => ({
			field: key,
			headerName: key,
			editable: true,
			sortable: true,
			filter: true,
		}));
	}, [activeSheetName, sheetsData]);

	const customTheme = useMemo(() => {
		return themeQuartz.withPart(iconSetQuartz).withParams({
			backgroundColor: theme.palette.background.paper,
			foregroundColor: theme.palette.text.primary,
			borderColor: theme.palette.divider,
			chromeBackgroundColor: theme.palette.background.default,
			headerBackgroundColor: theme.palette.background.default,
			headerTextColor: theme.palette.text.primary,
			cellTextColor: theme.palette.text.primary,
			oddRowBackgroundColor: alpha(theme.palette.action.hover, 0.03),
			rowHoverColor: theme.palette.action.hover,
			iconButtonBackgroundColor: theme.palette.background.paper,
			iconButtonHoverBackgroundColor: alpha(theme.palette.action.hover, 0.03),
			iconColor: theme.palette.text.secondary,
			spacing: 8,
			headerHeight: 36,
			rowHeight: 36,
      headerFontSize: 14,
			fontSize: 12,
		});
	}, [theme]);

	return (
		<SpreadsheetContainer>
			<GridWrapper>
				<AgGridReact
					ref={gridRef}
					rowData={sheetsData[activeSheetName] || []}
					columnDefs={columnDefs}
					onCellValueChanged={onCellValueChanged}
					defaultColDef={{
						resizable: true,
					}}
					theme={customTheme}
				/>
			</GridWrapper>
			<SheetTabsContainer>
				{Object.keys(sheetsData).map((sheetName) => (
					<SheetTab
						key={sheetName}
						data-active={activeSheetName === sheetName}
						onClick={() => setActiveSheetName(sheetName)}
					>
						{sheetName}
					</SheetTab>
				))}
			</SheetTabsContainer>
		</SpreadsheetContainer>
	);
};

export const SpreadsheetPreview = memo(SpreadsheetPreviewComponent);
