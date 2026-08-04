import {
	AllCommunityModule,
	ModuleRegistry,
	themeQuartz,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { FC } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { iconSetQuartz } from "ag-grid-community";
import type { CanvasDocument } from "../../types/canvas";
import { getFileTypeFromPath } from "../../utils/file-types";

type SpreadsheetPreviewProps = {
	document: CanvasDocument;
	conversationId?: string;
	agentId?: string;
};

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * The grid's palette, expressed entirely in role variables.
 *
 * Every value here is a `var(--color-*)` / `var(--font-*)` read rather than a
 * resolved colour, which is what lets a module-level constant be correct: the
 * theme changes the variables, the browser recomputes, and the grid never
 * re-renders or re-reads anything from JS. The params ag-grid derives from
 * these (row hover mixes, focus ring, subtle text) are computed in CSS with
 * `color-mix()`, so they follow the variables too.
 *
 * Only the base params are set. ag-grid's remaining defaults are `{ref: ...}`
 * or mixes of `backgroundColor` / `foregroundColor` / `accentColor` /
 * `borderColor`, so overriding those four carries most of the grid; the rest of
 * this list is the surfaces whose defaults are literal light-theme colours
 * (menus, tooltips, inputs, shadows) and would otherwise stay light in a dark
 * theme.
 */
const SPREADSHEET_THEME = themeQuartz.withPart(iconSetQuartz).withParams({
	// Grounds, ink and lines.
	backgroundColor: "var(--color-surface)",
	foregroundColor: "var(--color-ink)",
	cellTextColor: "var(--color-ink)",
	borderColor: "var(--color-hairline)",
	chromeBackgroundColor: "var(--color-sunken)",
	headerBackgroundColor: "var(--color-sunken)",
	headerTextColor: "var(--color-ink-muted)",
	// Zebra striping is one ground step, not a re-derived alpha.
	oddRowBackgroundColor: "var(--color-canvas)",
	rowHoverColor: "var(--color-accent-wash)",
	selectedRowBackgroundColor: "var(--color-accent-wash)",
	accentColor: "var(--color-accent)",
	invalidColor: "var(--color-danger)",
	// Native scrollbars and form controls inside the grid follow the palette.
	browserColorScheme: "inherit",

	// Type: chrome in the app's sans, cell data in the machine voice.
	fontFamily: "var(--font-sans)",
	headerFontFamily: "var(--font-sans)",
	cellFontFamily: "var(--font-mono)",
	fontSize: "var(--text-meta)",
	headerFontSize: "var(--text-body)",
	dataFontSize: "var(--text-mono-sm)",

	// Sort, filter and menu icons.
	iconColor: "var(--color-ink-muted)",
	iconButtonColor: "var(--color-ink-muted)",
	iconButtonHoverColor: "var(--color-ink)",
	iconButtonBackgroundColor: "transparent",
	iconButtonHoverBackgroundColor: "var(--color-accent-wash)",

	// Column menus, filter popups and tooltips: true overlays, so the one
	// shadow applies and the ground is `elevated`.
	menuBackgroundColor: "var(--color-elevated)",
	menuTextColor: "var(--color-ink)",
	menuBorder: "solid 1px var(--color-hairline)",
	tooltipBackgroundColor: "var(--color-elevated)",
	tooltipTextColor: "var(--color-ink)",
	tooltipBorder: "solid 1px var(--color-hairline)",
	popupShadow: "var(--shadow-overlay)",
	cardShadow: "var(--shadow-overlay)",
	modalOverlayBackgroundColor: "var(--color-scrim)",

	// Filter inputs.
	inputBackgroundColor: "var(--color-surface)",
	inputTextColor: "var(--color-ink)",
	inputPlaceholderTextColor: "var(--color-ink-dim)",
	inputBorder: "solid 1px var(--color-control)",
	inputFocusBorder: "solid 1px var(--color-accent)",
	inputDisabledBackgroundColor: "var(--color-sunken)",
	inputDisabledTextColor: "var(--color-ink-disabled)",

	// Filter buttons. Disabled is a colour, never a transparency.
	buttonBackgroundColor: "var(--color-surface)",
	buttonTextColor: "var(--color-ink)",
	buttonBorder: "solid 1px var(--color-control)",
	buttonHoverBackgroundColor: "var(--color-elevated)",
	buttonHoverTextColor: "var(--color-ink)",
	buttonDisabledBackgroundColor: "var(--color-sunken)",
	buttonDisabledTextColor: "var(--color-ink-disabled)",

	// Set-filter checkboxes.
	checkboxUncheckedBackgroundColor: "transparent",
	checkboxUncheckedBorderColor: "var(--color-control)",
	checkboxCheckedBackgroundColor: "var(--color-accent)",
	checkboxCheckedBorderColor: "var(--color-accent)",
	checkboxCheckedShapeColor: "var(--color-on-accent)",

	// An editing cell is marked by its border, not by lifting off the sheet.
	cellEditingBorder: "solid 1px var(--color-accent)",
	cellEditingShadow: "none",

	// Metrics. The canvas panel already draws the outer boundary, so the grid
	// does not draw a second one.
	wrapperBorder: false,
	wrapperBorderRadius: 0,
	borderRadius: "var(--radius-sm)",
	spacing: 8,
	headerHeight: 36,
	rowHeight: 36,
});

const SpreadsheetPreviewComponent: FC<SpreadsheetPreviewProps> = ({
	document,
	conversationId,
}) => {
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
				} catch {
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
				const jsonSheet = XLSX.utils.sheet_to_json(worksheet) as Record<
					string,
					unknown
				>[];
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
		if (
			JSON.stringify(debouncedSheetsData) ===
			JSON.stringify(originalDataRef.current)
		) {
			// Data is the same, reset the hasUserChanges flag
			setHasUserChanges(false);
			return;
		}

		setIsSaving(true);

		const workbook = XLSX.utils.book_new();
		for (const [sheetName, sheetData] of Object.entries(debouncedSheetsData)) {
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
					file.id === document.id ? { ...file, content: newContent } : file,
				);
				setFiles(conversationId, updatedFiles);
			}

			// Update the original data reference and reset change flags
			originalDataRef.current = JSON.parse(JSON.stringify(debouncedSheetsData));
			setHasUserChanges(false);

			showSuccessToast("Spreadsheet saved successfully");
		} catch (error) {
			console.error("Failed to save file:", error);
			showErrorToast(
				`Failed to save spreadsheet: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		} finally {
			setIsSaving(false);
		}
	}, [
		document.path,
		document.id,
		debouncedSheetsData,
		conversationId,
		canvasState,
		setFiles,
		hasUserChanges,
		isSaving,
	]);

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
		[
			activeSheetName,
			sheetsData,
			conversationId,
			document.id,
			setSpreadsheetData,
		],
	);

	const columnDefs = useMemo<ColDef[]>(() => {
		if (
			!sheetsData[activeSheetName] ||
			sheetsData[activeSheetName].length === 0
		) {
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

	return (
		<div className={cn("flex h-full w-full flex-col")}>
			<div className={cn("min-h-0 w-full flex-1")}>
				<AgGridReact
					ref={gridRef}
					rowData={sheetsData[activeSheetName] || []}
					columnDefs={columnDefs}
					onCellValueChanged={onCellValueChanged}
					defaultColDef={{
						resizable: true,
					}}
					theme={SPREADSHEET_THEME}
				/>
			</div>
			{/*
			 * Sheet selection is the segmented-control idiom the app's Tabs
			 * primitive defines — a sunken track with the active sheet raised to
			 * `surface` — rather than the growing underline this used to draw.
			 * Plain buttons because the grid above is a single instance shared by
			 * every sheet, so there is no per-sheet panel for `role="tab"` to own.
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center overflow-x-auto border-hairline border-t bg-surface px-2",
				)}
			>
				<div
					className={cn(
						"inline-flex h-8 w-fit items-center gap-1 rounded-md bg-sunken p-1",
					)}
				>
					{Object.keys(sheetsData).map((sheetName) => (
						<button
							key={sheetName}
							type="button"
							aria-pressed={activeSheetName === sheetName}
							onClick={() => setActiveSheetName(sheetName)}
							className={cn(
								"inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-3 font-medium text-body-sm transition-colors duration-fast ease-out-quart",
								activeSheetName === sheetName
									? "bg-surface text-ink"
									: "text-ink-muted hover:text-ink",
							)}
						>
							{sheetName}
						</button>
					))}
				</div>
			</div>
		</div>
	);
};

export const SpreadsheetPreview = memo(SpreadsheetPreviewComponent);
