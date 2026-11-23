import {
	type InlineSeries,
	decodeInlineSeries,
	isInlineNumber,
} from "./inline-series";

export type CategoryChart = {
	type: "bar" | "line" | "pie" | "histogram";
	title: string;
	unit?: string;
	data: [string, number][];
};
type Table = {
	type: "table";
	title: string;
	columns: string[];
	rows: (string | number)[][];
};
export type Scatter = {
	type: "scatter";
	title: string;
	xLabel: string;
	yLabel: string;
	data: [number, number][];
};
export type Heatmap = {
	type: "heatmap";
	title: string;
	unit?: string;
	columns: string[];
	rowLabels: string[];
	rows: (number | null)[][];
};
type Spreadsheet = {
	type: "spreadsheet";
	title: string;
	columns: string[];
	rows: (string | number | null)[][];
};
export type InlineUi =
	| CategoryChart
	| Scatter
	| Table
	| Spreadsheet
	| Heatmap
	| InlineSeries;
export type InlineUiPlacement = { offset: number; value: InlineUi };
export type InlineUiOverlay = { text: string; widgets: InlineUiPlacement[] };

// These bounds are the inline-ui-v1 payload schema, not transcript limits.
const MAX_ROWS = 32;
const MAX_COLUMNS = 8;
const isText = (value: unknown): value is string =>
	typeof value === "string" && value.length <= 256;
const isLabel = (value: unknown): value is string =>
	isText(value) && value.trim().length > 0;
const isNumber = isInlineNumber;

function decode(value: unknown): InlineUi | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const { type, title, unit, data, columns, rows, rowLabels, xLabel, yLabel } =
		record;
	if (type === "series") return decodeInlineSeries(record);
	if (!isLabel(title)) return null;
	if (
		type === "bar" ||
		type === "line" ||
		type === "pie" ||
		type === "histogram"
	) {
		if (
			(unit !== undefined && !isText(unit)) ||
			!Array.isArray(data) ||
			data.length === 0 ||
			data.length > MAX_ROWS ||
			!data.every(
				(point): point is [string, number] =>
					Array.isArray(point) &&
					point.length === 2 &&
					isLabel(point[0]) &&
					isNumber(point[1]) &&
					(type !== "pie" || point[1] > 0) &&
					(type !== "histogram" || point[1] >= 0),
			)
		)
			return null;
		return unit === undefined
			? { type, title, data }
			: { type, title, unit, data };
	}
	if (type === "scatter") {
		if (
			!isLabel(xLabel) ||
			!isLabel(yLabel) ||
			!Array.isArray(data) ||
			data.length === 0 ||
			data.length > MAX_ROWS ||
			!data.every(
				(point): point is [number, number] =>
					Array.isArray(point) && point.length === 2 && point.every(isNumber),
			)
		)
			return null;
		return { type, title, xLabel, yLabel, data };
	}
	if (type === "table" || type === "spreadsheet" || type === "heatmap") {
		if (
			!Array.isArray(columns) ||
			columns.length === 0 ||
			columns.length > MAX_COLUMNS ||
			!columns.every(isLabel) ||
			!Array.isArray(rows) ||
			rows.length > MAX_ROWS ||
			!rows.every((row) => Array.isArray(row) && row.length === columns.length)
		)
			return null;
		if (type === "heatmap") {
			if (
				(unit !== undefined && !isText(unit)) ||
				!Array.isArray(rowLabels) ||
				rowLabels.length !== rows.length ||
				!rowLabels.every(isLabel) ||
				!rows.every((row): row is (number | null)[] =>
					row.every((cell: unknown) => cell === null || isNumber(cell)),
				)
			)
				return null;
			return unit === undefined
				? { type, title, columns, rowLabels, rows }
				: { type, title, unit, columns, rowLabels, rows };
		}
		const isValue = (cell: unknown): cell is string | number =>
			isText(cell) || isNumber(cell);
		if (type === "spreadsheet") {
			if (
				!rows.every((row): row is (string | number | null)[] =>
					row.every((cell: unknown) => cell === null || isValue(cell)),
				)
			)
				return null;
			return { type, title, columns, rows };
		}
		if (!rows.every((row): row is (string | number)[] => row.every(isValue)))
			return null;
		return { type, title, columns, rows };
	}
	return null;
}

/** Read only negotiated typed data; reading Markdown as a widget would turn
 * archived code examples into live UI, including on an older runtime. */
export function readInlineUi(
	input: unknown,
	text: string,
	previous?: InlineUiOverlay,
	allowEmptySeed = false,
): InlineUiOverlay | undefined {
	if (!input || typeof input !== "object") return;
	const overlay = input as Record<string, unknown>;
	if (
		overlay.version !== 1 ||
		overlay.text !== text ||
		!Array.isArray(overlay.widgets)
	)
		return;
	const widgets: InlineUiPlacement[] = [];
	let lastOffset = 0;
	for (const raw of overlay.widgets) {
		if (!raw || typeof raw !== "object") continue;
		const { offset, payload } = raw as Record<string, unknown>;
		if (
			typeof offset !== "number" ||
			!Number.isInteger(offset) ||
			offset < lastOffset ||
			offset > text.length
		)
			continue;
		// A UTF-16 offset can fall inside a Unicode code point in a malformed
		// frame. The producer removes a Markdown block, so its boundary is
		// always the start of a line (or EOF), never inside a prose token.
		if (
			offset !== 0 &&
			offset !== text.length &&
			text[offset - 1] !== "\n" &&
			text[offset - 1] !== "\r"
		)
			continue;
		const value = decode(payload);
		if (!value) continue;
		lastOffset = offset;
		widgets.push({ offset, value });
	}
	// Only an explicitly empty v1 row on the snapshot seed path attests
	// cumulative prose. A non-empty list of invalid widgets is not a seed.
	if (!widgets.length && !(allowEmptySeed && overlay.widgets.length === 0))
		return;
	// A normal appended delta repeats the same widgets against longer prose.
	// Keep values stable so memoized figures don't repaint on every token; a
	// reconciled page with the exact same text can keep the entire object.
	const sameWidgets =
		previous && JSON.stringify(previous.widgets) === JSON.stringify(widgets);
	if (sameWidgets)
		return previous.text === text
			? previous
			: { text, widgets: previous.widgets };
	return { text, widgets };
}

/** The message map belongs to the page/frame, not to a journal row. Do not
 * use an inherited property or let a non-v1 envelope change the row. */
export function inlineUiForRow(input: unknown, id: string): unknown {
	if (!input || typeof input !== "object") return;
	const { version, messages } = input as Record<string, unknown>;
	if (
		version !== 1 ||
		!messages ||
		typeof messages !== "object" ||
		Array.isArray(messages)
	)
		return;
	return Object.getOwnPropertyDescriptor(messages, id)?.value;
}
