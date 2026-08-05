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
import type {
	CellStyle,
	CellValueChangedEvent,
	ColDef,
} from "ag-grid-community";
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

	// Type: chrome in the app's sans, and cell data in whichever voice its
	// column speaks. Most of a sheet is machine output - figures, dates, ids,
	// codes, statuses - so monospace stays the default here and the columns
	// that genuinely read as prose opt out of it, per column, below.
	//
	// The header was `text-body` (14px) over `text-mono-sm` (12px) data — the
	// column label set larger than the number under it, which reads as though
	// the labels are the content. Chrome never out-sizes data, so the header
	// drops to the caption step and carries its weight in the font instead.
	fontFamily: "var(--font-sans)",
	headerFontFamily: "var(--font-sans)",
	cellFontFamily: "var(--font-mono)",
	fontSize: "var(--text-meta)",
	headerFontSize: "var(--text-meta)",
	headerFontWeight: "600",
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

	// Density. ag-grid's stock 36px row at 12px mono is 24px of padding around
	// 12px of data — a table of two-word cells reading as a list of cards.
	// Numbers' and Airtable's compact rows sit at 24-32px; 32 keeps a
	// comfortable click target, stays on the 4px ramp, and shows four more rows
	// per screen in a panel where vertical space is the scarce thing.
	//
	// The header is one ramp step taller than a row rather than identical to
	// it. Equal heights gave the header no presence at all; the extra 4px plus
	// the sunken ground is what makes it read as the edge of the data.
	spacing: 6,
	headerHeight: 36,
	rowHeight: 32,

	// Vertical rules. A sheet of numbers with only horizontal lines makes the
	// eye track across rows when the question is almost always about a column.
	// The header's rules are full-height so the columns start at a hard edge.
	columnBorder: "solid 1px var(--color-hairline)",
	headerColumnBorder: "solid 1px var(--color-hairline)",
	headerColumnBorderHeight: "100%",
	headerRowBorder: "solid 1px var(--color-hairline)",
});

/*
 * A quantity as it appears once a cell has been rendered for display: an
 * optional sign, an optional leading currency symbol, digits with optional
 * thousands grouping and decimals, and an optional trailing percent.
 *
 * The grid receives display text rather than JS numbers, because that is the
 * only way a cell keeps the trailing zero on `2310.50` and the format its
 * author chose. So the column that decides right-alignment can no longer ask
 * `typeof value === "number"`; it has to read the text, and it has to read
 * past the format, because `$2,310.50` and `12.5%` are quantities and belong
 * in a column whose digits line up.
 */
/*
 * One grammar, one reader. The gate that decides whether a column is a
 * quantity runs the same parser the comparator uses, so a column of
 * bracketed accounting negatives - `(1,234.50)` - cannot sort by size in one
 * place and be declared prose in the other.
 */
const readsAsQuantity = (value: unknown): boolean =>
	typeof value === "number" || quantityValue(value) !== null;

/*
 * The marks a rendered quantity carries that say nothing about its size: a
 * currency symbol, thousands separators, a percent sign, and the space an
 * accounting format emits where the closing paren would be (`1,234.50 `).
 */
const QUANTITY_DECORATION = /[\s,$€£¥%]/g;

/*
 * An accounting format writes a negative in brackets - xlsx renders -1234.5
 * under `#,##0.00_);(#,##0.00)` as `(1,234.50)`, with no minus anywhere - so
 * the sign has to be read off the brackets or every loss sorts as a gain.
 */
const BRACKETED_NEGATIVE = /^\((.+)\)$/;

/** What may remain once the decoration is gone. Deliberately not `Number()`'s
 * grammar: hex, exponents and `Infinity` are not things a cell displays. */
const BARE_DECIMAL = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

/*
 * Digits with a space BETWEEN them are a grouped identifier, not a quantity:
 * `555 123 4567`, `+44 20 7946 0958`, `1234 5678 9012 3456`, `0800 555 111`.
 * Stripping whitespace as decoration turns each into a bare decimal, which
 * right-aligns a phone-number column, sets it in machine voice and sorts it
 * numerically - and a 16-digit card number is past `MAX_SAFE_INTEGER`, so
 * that order is not even stable. The accounting trailing space (`1,234.50 `)
 * and a spaced currency symbol (`$ 1,234`) put the space at an edge or beside
 * a symbol, never between two digits, so both survive this guard.
 *
 * The cost is a space-grouped thousands format. `# ##0.00` is a real, SheetJS-
 * supported format and `raw: false` hands us `1 234.50` as display text, so a
 * sheet written that way loses right-alignment, machine voice and size
 * ordering in its amount column.
 *
 * The reason to take that trade is ambiguity, and only ambiguity: `1 234.50`
 * and `555 123 4567` are the same shape, and nothing in a single cell tells
 * them apart. Getting a phone column wrong is the worse error of the two,
 * because it sorts as a number and 16 digits are past `MAX_SAFE_INTEGER`.
 *
 * Two things this is NOT justified by, though both are true. That
 * `coerceEditedCell` would keep the cell as text proves nothing: it keeps
 * `$2,310.50`, `12.5%` and `(1,234.50)` as text too, and all three are
 * quantities here. And the guard is not free in a way the column hides -
 * `readColumn` takes a majority over 50 rows, so a `# ##0.00` column of
 * amounts under 1,000 still reads as a quantity (` 999.00` has a leading
 * space, not an internal one) and flips to prose once the figures grow past
 * the grouping. Alignment therefore depends on magnitude, not on the column.
 * Fixing that properly means knowing the sheet's locale, which is a product
 * decision about the whole spreadsheet rather than a regex in this gate.
 */
const INTERNAL_DIGIT_SPACE = /\d\s+\d/;

/**
 * The size of a quantity as it was rendered, or null where the cell holds no
 * quantity at all.
 *
 * Percentages rank on their face digits rather than being divided by 100:
 * every cell in a column carries the same unit, so `12.5%` against `9%` is
 * already the right order and converting would only lose precision.
 */
const quantityValue = (value: unknown): number | null => {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value !== "string") return null;
	if (INTERNAL_DIGIT_SPACE.test(value)) return null;
	const bare = value.replace(QUANTITY_DECORATION, "");
	const bracketed = BRACKETED_NEGATIVE.exec(bare);
	const digits = bracketed ? `-${bracketed[1]}` : bare;
	return BARE_DECIMAL.test(digits) ? Number(digits) : null;
};

/*
 * Order a quantity column by size rather than by spelling.
 *
 * ag-grid's `numericColumn` type is `{ headerClass, cellClass }` and nothing
 * else - it aligns, it does not sort - and the grid holds display text, so
 * without this the default comparator's `a > b` runs on strings and `275.00`
 * lands between `2310.50` and `3105.00`. Someone looking for the smallest
 * invoice is shown the wrong row, which is worse than an unsorted column
 * because it looks answered.
 *
 * A cell with no quantity in it - blank, `n/a`, a note someone typed in the
 * total column - is the absence of a figure rather than a small one, so it
 * sits below the figures in BOTH directions, as blanks do in Excel and
 * Sheets. The grid negates a comparator's result when the sort is descending,
 * so that rank is pre-negated here to survive the flip; ordering within the
 * non-quantity group is left to flip along with everything else.
 */
const compareQuantities: NonNullable<ColDef["comparator"]> = (
	valueA,
	valueB,
	_nodeA,
	_nodeB,
	isDescending,
) => {
	const sizeA = quantityValue(valueA);
	const sizeB = quantityValue(valueB);
	if (sizeA !== null && sizeB !== null) return sizeA - sizeB;
	if (sizeA !== null) return isDescending ? 1 : -1;
	if (sizeB !== null) return isDescending ? -1 : 1;
	const textA = String(valueA ?? "");
	const textB = String(valueB ?? "");
	return textA > textB ? 1 : textA < textB ? -1 : 0;
};

/*
 * Dates as a sheet renders them, in the two shapes that survive display.
 *
 * A numeric date is unmistakable - two or three groups of digits joined by
 * `-`, `/` or `.`, optionally followed by a clock. A written date is only a
 * date if a month name appears next to a number, so `May 2026` is one and
 * `payment due in May` is not.
 */
const NUMERIC_DATE =
	/^\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,4})?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/;
const MONTH_WORD =
	/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const HAS_DIGIT = /\d/;

const readsAsDate = (text: string): boolean =>
	NUMERIC_DATE.test(text) || (MONTH_WORD.test(text) && HAS_DIGIT.test(text));

/*
 * Punctuation that only machine output uses: paths, urls, snake_case keys,
 * clock times, field references, template braces. A name or a sentence can
 * carry a comma, a period, an apostrophe or a hyphen, and none of those are
 * here.
 */
const MACHINE_PUNCTUATION = /[\\/_|:=#@<>{}[\]]/;
const HAS_LETTER = /\p{L}/u;
const HAS_SPACE = /\s/;
/*
 * Tested rather than `\p{Lu}` so that uncased scripts count as capitalised:
 * `北京` is a proper noun and should read as one.
 */
const STARTS_LOWERCASE = /^\p{Ll}/u;

/**
 * Whether a cell reads as human prose rather than machine output.
 *
 * Monospace marks the machine voice, and in a spreadsheet almost everything
 * is machine voice - figures, dates, ids, reference codes, statuses - so this
 * is the exception rather than the rule, and it is deliberately reluctant.
 *
 * A value qualifies when it holds letters, carries no machine punctuation and
 * is neither a quantity nor a date, AND it either contains a space or is a
 * capitalised single word with no digits in it. That second clause is what
 * separates `Northwind` and `Contoso` - names, of which a customer column is
 * mostly made - from `unpaid` and `n/a`, which are statuses a machine wrote.
 */
const readsAsProse = (value: unknown): boolean => {
	if (typeof value !== "string") return false;
	const text = value.trim();
	if (text === "" || !HAS_LETTER.test(text)) return false;
	if (MACHINE_PUNCTUATION.test(text)) return false;
	if (readsAsQuantity(text) || readsAsDate(text)) return false;
	return (
		HAS_SPACE.test(text) ||
		(!HAS_DIGIT.test(text) && !STARTS_LOWERCASE.test(text))
	);
};

/*
 * How many rows a column is judged from.
 *
 * The first row is not a column: one blank or atypical cell should not decide
 * the face and the alignment of everything under it. Reading every row would
 * rescan the whole sheet on each cell edit, so the judgement is taken from
 * the top and left there - far more than enough for a majority to be stable,
 * and bounded whatever the sheet's size.
 */
const COLUMN_SAMPLE_ROWS = 50;

/**
 * What a column is made of, read off a sample rather than off one cell.
 *
 * Blanks are skipped rather than counted against either reading, so a sparse
 * column is judged on the values it does have. A column that is neither -
 * invoice ids, statuses, anything mixed - falls through to the grid's
 * defaults: monospace and left-aligned.
 */
const readColumn = (
	rows: Record<string, unknown>[],
	key: string,
): { isQuantity: boolean; isProse: boolean } => {
	let quantities = 0;
	let prose = 0;
	let seen = 0;
	const depth = Math.min(rows.length, COLUMN_SAMPLE_ROWS);
	for (let i = 0; i < depth; i++) {
		const value = rows[i][key];
		if (value === null || value === undefined || String(value).trim() === "") {
			continue;
		}
		seen++;
		if (readsAsQuantity(value)) quantities++;
		else if (readsAsProse(value)) prose++;
	}
	return { isQuantity: quantities * 2 > seen, isProse: prose * 2 > seen };
};

/*
 * The human voice, granted to the columns that speak it.
 *
 * It is an inline style rather than a class because the theme sets the face
 * on `.ag-row`; the cell's own style is what reliably wins without a new
 * stylesheet rule, and the editor input inherits it, so a name stays in the
 * sans face while it is being typed.
 */
const PROSE_CELL_STYLE: CellStyle = {
	fontFamily: "var(--font-sans)",
	fontSize: "var(--text-meta)",
};

/*
 * A plain decimal, and nothing cleverer.
 *
 * `Number()` accepts far more than a spreadsheet cell should: it reads `0x1A`
 * as 26, `1e3` as 1000, and it strips the leading zeros off `0800`. Those are
 * not numbers a user typed, they are identifiers - zip codes, account numbers,
 * phone extensions, part numbers - and silently renumbering one is exactly the
 * corruption this path exists to prevent.
 *
 * A leading zero is therefore disqualifying (except a bare `0`), as is any
 * exponent, sign other than `-`, or separator. Fifteen significant digits is
 * the ceiling because a double cannot hold more without rounding, and a
 * 19-digit reference silently becoming ...6800 is worse than leaving it text.
 */
const PLAIN_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
/** Sign and decimal point, removed before counting significant digits. */
const NON_DIGITS = /[-.]/g;
/** Leading zeros, which do not count toward precision. */
const LEADING_ZEROS = /^0+/;

/*
 * Turn a cell the user just edited back into a typed value.
 *
 * Only a plain decimal becomes a number. Anything carrying a currency symbol,
 * a thousands separator or a percent sign is left as text on purpose:
 * re-typing `$2,310.50` as 2310.5 would discard the formatting the user is
 * looking at, which is the same class of loss as the above. Cells the user
 * never touched do not come through here at all - they are written from the
 * typed copy read off the original sheet, formats intact.
 */
const coerceEditedCell = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!PLAIN_DECIMAL.test(trimmed)) return value;
	if (trimmed.replace(NON_DIGITS, "").replace(LEADING_ZEROS, "").length > 15)
		return value;
	const asNumber = Number(trimmed);
	return Number.isFinite(asNumber) ? asNumber : value;
};

/*
 * Read each column's number format off the source worksheet.
 *
 * Keyed by header text rather than by column letter, because saving rebuilds
 * the sheet from row objects and a column can end up in a different position.
 * The format is taken from the first data row that actually declares one: a
 * spreadsheet applies a format per column in practice, and a blank first cell
 * should not lose the format for the whole column.
 */
const harvestColumnFormats = (
	worksheet: XLSX.WorkSheet,
): Record<string, string> => {
	const formats: Record<string, string> = {};
	const ref = worksheet["!ref"];
	if (!ref) return formats;
	const range = XLSX.utils.decode_range(ref);
	/*
	 * Disambiguate repeated headers exactly the way `sheet_to_json` does.
	 *
	 * A sheet may legitimately carry two columns called `Amount`. `sheet_to_json`
	 * turns them into the keys `Amount` and `Amount_1`, and the rebuilt sheet
	 * takes its headers from those keys - so keying this map on the raw header
	 * text made both columns collide and the LAST one win. A currency column
	 * followed by a percentage column came back as a percentage.
	 *
	 * Counting repeats per name is not enough, because a real header can
	 * collide with a generated suffix: `[Amount, Amount_1, Amount]` counts to
	 * `Amount / Amount_1 / Amount_1`, and the third column silently overwrites
	 * the second. `sheet_to_json` resolves against every key already taken, so
	 * this does the same - and the app manufactures that shape itself, because
	 * saving a two-`Amount` sheet writes the headers back as `Amount` and
	 * `Amount_1`.
	 *
	 * The scan resumes from the last index used for a name rather than from 1.
	 * Keys are never removed, so an index that was taken stays taken and
	 * re-checking it is pure cost: restarting each time is quadratic, and a
	 * sheet at Excel's 16,384-column limit sharing one header took 8.8s
	 * against 15ms this way. The resolved keys are identical either way.
	 */
	const taken = new Set<string>();
	const nextIndex = new Map<string, number>();
	for (let col = range.s.c; col <= range.e.c; col++) {
		const header = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
		const name = header?.v;
		if (typeof name !== "string") continue;
		let key = name;
		let n = nextIndex.get(name) ?? 1;
		while (taken.has(key)) {
			key = `${name}_${n}`;
			n++;
		}
		nextIndex.set(name, n);
		taken.add(key);
		for (let row = range.s.r + 1; row <= range.e.r; row++) {
			const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
			/*
			 * `General` is the absence of a format, not a format. With `cellNF`
			 * every present cell carries a `z`, so without this guard the loop
			 * would stop at a `TBD` or `n/a` placeholder sitting above the real
			 * currency cells, and saving would then stamp `General` onto the
			 * whole column - losing exactly the formats this exists to keep.
			 */
			if (cell?.z && cell.z !== "General") {
				formats[key] = String(cell.z);
				break;
			}
		}
	}
	return formats;
};

/*
 * Put those formats back on a rebuilt worksheet.
 *
 * Only cells that carry a value get one, and only for columns that had a
 * format to begin with - a column the user added keeps xlsx's default, which
 * is the honest outcome, since we have nothing to restore for it.
 */
const applyColumnFormats = (
	worksheet: XLSX.WorkSheet,
	formats: Record<string, string> | undefined,
): void => {
	if (!formats) return;
	const ref = worksheet["!ref"];
	if (!ref) return;
	const range = XLSX.utils.decode_range(ref);
	for (let col = range.s.c; col <= range.e.c; col++) {
		const header = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
		const name = header?.v;
		if (typeof name !== "string") continue;
		const z = formats[name];
		if (!z) continue;
		for (let row = range.s.r + 1; row <= range.e.r; row++) {
			const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
			if (cell && cell.v !== undefined) cell.z = z;
		}
	}
};

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
	/*
	 * The typed values behind the displayed strings, keyed the same way. Saving
	 * reads from here for every cell the user did not edit, so a round-trip
	 * through the grid cannot downgrade a number or a date to text.
	 */
	const originalRawRef = useRef<Record<string, Record<string, unknown>[]>>({});
	/*
	 * The author's number format per column, kept so saving can put it back.
	 *
	 * `json_to_sheet` writes values and nothing else, and `book_new()` discards
	 * the source workbook, so a rebuilt sheet has no `z` on any cell. Before the
	 * typed-value fix that was invisible, because every cell was being written
	 * as text anyway; making the values numeric again is what exposed it. The
	 * visible symptom is sharp: edit one unrelated text cell, and three seconds
	 * later the save round-trips through the store and the date column re-reads
	 * as five-digit serials.
	 */
	const originalFormatsRef = useRef<Record<string, Record<string, string>>>({});
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
				/*
				 * `raw` keeps every cell as the text the file actually contains.
				 * A CSV carries no cell formats, so the parser's default is to
				 * guess one: `2026-03-15` becomes the Excel serial `46095.83`
				 * (the fraction is the UTC-to-local offset) and then renders as
				 * `3/14/26`, a day earlier than what was pasted, while
				 * `2026-03-15 14:30` loses its time entirely. There is nothing
				 * in the file to recover the intended format from, so the
				 * literal text is the only value that cannot be wrong.
				 */
				workbook = XLSX.read(csvText, { type: "string", raw: true });
			} else {
				/*
				 * `cellNF: true` is what makes the author's number formats
				 * readable at all. Without it xlsx parses the format but does not
				 * expose `z` on the cell, so there is nothing to harvest and
				 * nothing to put back on save - the formats are lost before the
				 * save path ever sees them.
				 */
				workbook = XLSX.read(fileContent, { type: "base64", cellNF: true });
			}

			const newSheetsData: Record<string, Record<string, unknown>[]> = {};
			const newRawData: Record<string, Record<string, unknown>[]> = {};
			const newFormats: Record<string, Record<string, string>> = {};
			for (const sheetName of workbook.SheetNames) {
				const worksheet = workbook.Sheets[sheetName];
				/*
				 * Two reads of the same sheet, deliberately.
				 *
				 * `raw: false` gives each cell's RENDERED text, which is what the
				 * grid shows: an invoice total keeps its trailing zero and its
				 * currency symbol, and an xlsx date renders through the number
				 * format its author chose instead of as a serial. That is the
				 * whole point of displaying it this way.
				 *
				 * `raw: true` gives the underlying TYPED value, and it is kept
				 * because saving needs it. `json_to_sheet` types whatever it is
				 * handed, so writing the display strings back produced an xlsx
				 * where every number and date was stored as text - Excel flags
				 * them, number formats are gone, and any formula referencing them
				 * breaks. The display string is lossy on purpose; it must never be
				 * the thing that gets persisted.
				 *
				 * On save, a cell the user did not touch is written from this
				 * typed copy; only a cell they actually edited is re-derived from
				 * what they typed. CSV is unaffected either way - it is read with
				 * `raw: true` above, so both copies agree.
				 */
				const jsonSheet = XLSX.utils.sheet_to_json(worksheet, {
					raw: false,
				}) as Record<string, unknown>[];
				newSheetsData[sheetName] = jsonSheet;
				newRawData[sheetName] = XLSX.utils.sheet_to_json(worksheet, {
					raw: true,
				}) as Record<string, unknown>[];
				newFormats[sheetName] = harvestColumnFormats(worksheet);
			}
			setSheetsData(newSheetsData);
			// Deep clone the original data to prevent reference issues
			originalDataRef.current = JSON.parse(JSON.stringify(newSheetsData));
			originalRawRef.current = newRawData;
			originalFormatsRef.current = newFormats;
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
			/*
			 * Rebuild each row from the TYPED copy, overlaying only what changed.
			 *
			 * `sheetData` holds display strings (see the two-read comment above),
			 * and `json_to_sheet` types whatever it is given - so handing it these
			 * directly stored every number and date in the file as text. A cell
			 * the user never touched is therefore written from `originalRawRef`,
			 * byte-for-byte what was read; only a cell they actually edited is
			 * re-derived, and then a value that is wholly numeric becomes a
			 * number so it stays arithmetic rather than becoming text on its
			 * first edit.
			 */
			const originalDisplay = originalDataRef.current[sheetName] ?? [];
			const originalTyped = originalRawRef.current[sheetName] ?? [];
			const rows = sheetData.map((row, i) => {
				const wasDisplay = originalDisplay[i];
				const wasTyped = originalTyped[i];
				const out: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(row)) {
					const untouched =
						wasDisplay !== undefined && wasDisplay[key] === value;
					if (untouched && wasTyped !== undefined && key in wasTyped) {
						out[key] = wasTyped[key];
						continue;
					}
					out[key] = coerceEditedCell(value);
				}
				return out;
			});
			const worksheet = XLSX.utils.json_to_sheet(rows);
			applyColumnFormats(worksheet, originalFormatsRef.current[sheetName]);
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

			/*
			 * Re-parse the saved content rather than hand-refreshing the refs.
			 *
			 * Refreshing `originalDataRef` alone left `originalRawRef` and the
			 * format map holding the PREVIOUS parse. A second save with no
			 * re-parse in between then compared every cell the first save
			 * edited against its old display value, found them "untouched", and
			 * wrote the stale typed value back - edit one silently reverted.
			 * In the shipped chat surface the store round-trip re-triggers
			 * `parseFile` and masked it; on any surface where the store does not
			 * bounce, it was live.
			 *
			 * Parsing our own output is also the honest definition of "saved":
			 * whatever the file now contains is the truth the next edit works
			 * from, including anything the write normalised.
			 */
			parseFile(newContent, document.path);
			setHasUserChanges(false);

			showSuccessToast("Spreadsheet saved");
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
		parseFile,
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
			const { colDef, newValue, data } = event;
			const sheetData = sheetsData[activeSheetName];
			if (!sheetData || !colDef.field) return;

			/*
			 * Locate the row by IDENTITY, not by `node.rowIndex`.
			 *
			 * `rowIndex` is ag-grid's DISPLAYED position, and both `sortable`
			 * and `filter` are enabled on every column. Sort by any header, edit
			 * a cell, and the displayed index no longer matches the array index -
			 * so the edit was written into whichever row happened to occupy that
			 * slot in the unsorted data. Silent, and it corrupts a row the user
			 * was not even looking at.
			 *
			 * `event.data` is the same object reference this array holds, so
			 * `indexOf` finds the real position regardless of sort or filter.
			 */
			const rowIndex = sheetData.indexOf(data);
			if (rowIndex === -1) return;

			const updatedSheetData = [...sheetData];
			updatedSheetData[rowIndex] = {
				...sheetData[rowIndex],
				[colDef.field]: newValue,
			};
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
		const rows = sheetsData[activeSheetName];
		return Object.keys(rows[0]).map((key) => {
			// Two readings of the same column, each carrying its own rule.
			//
			// Quantities right-align so their digits line up by place value, and
			// they sort by size rather than alphabetically; the header follows
			// the cells, or the label floats away from its column.
			//
			// The face is the branding rule instead: monospace is the machine
			// voice, and a customer name is not machine output. Prose is the
			// narrow exception because nearly everything else in a sheet - ids,
			// dates, codes, statuses, figures - genuinely is machine output.
			const { isQuantity, isProse } = readColumn(rows, key);
			return {
				field: key,
				headerName: key,
				editable: true,
				sortable: true,
				filter: true,
				/*
				 * Alignment and sorting are applied as classes and a comparator,
				 * deliberately NOT via ag-grid's `numericColumn` type. The type is
				 * `{ headerClass: "ag-right-aligned-header", cellClass:
				 * "ag-right-aligned-cell" }` and nothing else, and
				 * `ag-right-aligned-header` right-aligns by setting
				 * `flex-direction: row-reverse` on the header label - which parks
				 * the filter icon at the far LEFT of the header cell, beside the
				 * NEIGHBOURING column's label. Right-aligned data with a
				 * left-parked icon reads as belonging to the previous column.
				 * `lo-quantity-header` right-aligns the label without reversing
				 * it, so the icon stays with its own label.
				 */
				cellClass: isQuantity ? "ag-right-aligned-cell" : undefined,
				headerClass: isQuantity ? "lo-quantity-header" : undefined,
				comparator: isQuantity ? compareQuantities : undefined,
				cellStyle: isProse ? PROSE_CELL_STYLE : undefined,
			};
		});
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
