/**
 * S2 of the browser address overlay: the geometry, the projection boundary and
 * the row hit-test for a VISUAL MIRROR of the in-flow address list.
 *
 * WHY THIS FILE IS SEPARATE FROM `address-overlay.ts`: it is the part that can
 * be decided from numbers alone — where the native child sits, what a renderer
 * projection is allowed to become, and which row a mouse coordinate names. The
 * S1 controller still owns the child's lifetime; this module owns the one new
 * decision S2 adds. Keeping it free of Electron imports is what lets
 * `scripts/browser-address-overlay.test.mjs` assert every edge by calling it,
 * including the refusals, without an app or a window.
 *
 * WHAT IS DELIBERATELY NOT HERE: no URL, href, HTML, script, CSS text or
 * navigation target. A projection carries display strings only. The renderer is
 * the only place a row becomes a URL (through its existing `commit()`); main
 * receives back only `{seq, index}` and never holds a destination.
 *
 * THE SHAPE IS A CONTRACT: the renderer's HOSTILE-INPUT rules are duplicated
 * here on purpose. A renderer bug or a compromised renderer must not be able to
 * widen the child document, and main revalidates every field before the model
 * reaches `executeJavaScript`.
 */

/**
 * The exact S2 opt-in, honoured only on top of the S1 opt-in and its gates.
 *
 * BUILT APP ONLY: the child's CSP (`style-src 'self'`, `connect-src 'none'`)
 * deliberately forbids Vite's dev-server style injection and HMR socket, so an
 * S2 launch against `pnpm dev` fails closed at the first measurement
 * (`measure_header`) rather than rendering. The probe runs the built document;
 * a dev-mode allowance would be a second, weaker trust boundary for no product
 * path (review round 1, n1).
 */
export const ADDRESS_LIST_ENV = "LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2";

/** The S2 document (script + stylesheet, unlike S1's inert one). */
export const ADDRESS_LIST_DOCUMENT = "browser-address-overlay-list.html";

/** Dock geometry, copied from the in-flow list and pinned by the probe.
 * 28 header, 2px list padding above and below, 1px bottom rule, 35.5 rows. */
export const ADDRESS_LIST_HEADER_HEIGHT = 28;
export const ADDRESS_LIST_ROW_HEIGHT = 35.5;
export const ADDRESS_LIST_ROWS_MAX = 5;
/** ceil(28 + 2 + 5*35.5 + 2 + 1) = 211, with one DIP of headroom. */
export const ADDRESS_LIST_MAX_HEIGHT_DIP = 212;
/** The dock's closed/open notice height (`data-address-dock-height="104"`). */
export const ADDRESS_LIST_NOTICE_HEIGHT_DIP = 104;
/** The toolbar's `py-1` plus its rule; anything further is a different surface.
 * S4b's v2 projection has no field/list pair to relate, so this constant is read
 * only by the v1 path the S1/S2 probe script still drives. */
export const ADDRESS_LIST_ANCHOR_GAP_MAX = 24;
/**
 * S4b's floor for the popout's width.
 *
 * The child is placed at the STRIP's width (design §3), and a rail pane can be
 * narrower than a usable list: at 240 DIP a row still fits a title and a URL,
 * and below it the design's answer is to stop painting a native popout at all
 * and let the renderer show the field alone (mode `suspend`). Refusing here is
 * what makes that state observable instead of a clipped row the user cannot map
 * to the row they clicked.
 */
export const ADDRESS_LIST_MIN_WIDTH_DIP = 240;
/** JSON-byte ceiling for one projection. The real payload is ~1 KB with five
 * rows; the cap exists so a runaway/hostile renderer cannot turn the handler
 * into a memory amplifier. */
export const ADDRESS_LIST_MAX_PAYLOAD_BYTES = 16 * 1024;
export const ADDRESS_LIST_MAX_TEXT = 512;
export const ADDRESS_LIST_MAX_TITLE = 256;
export const ADDRESS_LIST_MAX_LABEL = 256;
/** Opaque and deliberately not a theme claim (same constant as S1). */
export const ADDRESS_LIST_THEME_FALLBACK = "#1b1f24";

const DIP_INT32_MAX = 2 ** 31 - 1;

export type AddressListNoticeKind = "error" | "empty" | "no_match";

const NOTICE_KINDS: readonly AddressListNoticeKind[] = [
	"error",
	"empty",
	"no_match",
];

export interface AddressListRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * One display span inside a row's `text` that the child isolates as an LTR run.
 *
 * WHY IT EXISTS: a row's text is a localized sentence with the user's own value
 * substituted in. In an RTL locale a value with no strong Latin character
 * (`192.168.1.1/`, `[::1]:3000/`) takes its direction from the sentence and
 * reorders. Bidi controls (U+2066-2069) would isolate it, but they are stripped
 * from every row on purpose - a bidi control is how a row can be made to look
 * like another - so the renderer names the span instead and the child wraps it in
 * `<bdi dir="ltr">`. UTF-16 offsets into `text`; display only, never a
 * destination, never trusted for anything else.
 */
export interface AddressListIsolate {
	start: number;
	end: number;
}

export interface AddressListRow {
	text: string;
	title: string;
	/** At most one range, only on rows whose text embeds the typed value. */
	isolate?: AddressListIsolate;
}

export type AddressListView =
	| { kind: "rows"; rows: AddressListRow[] }
	| { kind: "notice"; notice: AddressListNoticeKind; text: string };

export interface AddressListTheme {
	elevated: string;
	ink: string;
	inkMuted: string;
	accent: string;
	accentWash: string;
	rowHover: string;
	hairline: string;
	control: string;
}

export type AddressListThemeFact = "resolved" | "fallback" | "absent";

/**
 * The projection the SHIPPED popout sends.
 *
 * WHY `anchor` IS ONLY THE STRIP'S x/width: the renderer may say where the
 * chrome band is, but it may not say where the native child goes. Main owns the
 * page rectangle (the registry's trusted `contentRect`), derives the child's x
 * and width as the intersection of the strip band with that rectangle, and puts
 * its y at the page's top edge. A compromised renderer can therefore misplace the
 * field row inside the chrome, but it can never paint the child anywhere except
 * over the page it names — and it cannot name a page either (the tab id and rect
 * are both re-checked against the layout main applied).
 */
export interface AddressListAnchor {
	x: number;
	width: number;
}

export interface AddressListProjectionV2 {
	v: 2;
	seq: number;
	tabId: number;
	visible: boolean;
	pageRect: AddressListRect;
	anchor: AddressListAnchor;
	active: number;
	view: AddressListView;
	label: string;
	dir: "ltr" | "rtl";
	theme: AddressListTheme | null;
	themeFact: AddressListThemeFact;
}

/**
 * The pre-S4b shape, still accepted because the S1–S3 probe script constructs
 * v1 payloads itself (`s2Projection`) against the same controller. Product code
 * never sends it; the two shapes are distinguished by `v` and each has its own
 * strict key set, so an extra key from either side is still a refusal.
 */
export interface AddressListProjectionV1 {
	v: 1;
	seq: number;
	tabId: number;
	visible: boolean;
	pageRect: AddressListRect;
	field: AddressListRect;
	listTop: number;
	active: number;
	view: AddressListView;
	label: string;
	dir: "ltr" | "rtl";
	theme: AddressListTheme | null;
	themeFact: AddressListThemeFact;
}

export type AddressListProjection =
	| AddressListProjectionV1
	| AddressListProjectionV2;

export type AddressListSanitizeResult =
	| { ok: true; projection: AddressListProjection }
	| { ok: false; reason: string };

/** Control characters, line/paragraph separators and bidi overrides. A row is a
 * display string; none of these can be part of a legitimate one, and the bidi
 * controls are how a sanitized string can still be made to LOOK like another. */
const HOSTILE_STRING = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;
const COLOR = /^(#[0-9a-f]{6}|rgb\(\d{1,3}, ?\d{1,3}, ?\d{1,3}\))$/i;

const PROJECTION_KEYS_V1 = new Set([
	"v",
	"seq",
	"tabId",
	"visible",
	"pageRect",
	"field",
	"listTop",
	"active",
	"view",
	"label",
	"dir",
	"theme",
]);
const PROJECTION_KEYS_V2 = new Set([
	"v",
	"seq",
	"tabId",
	"visible",
	"pageRect",
	"anchor",
	"active",
	"view",
	"label",
	"dir",
	"theme",
]);
const ANCHOR_KEYS = ["x", "width"] as const;
const RECT_KEYS = ["x", "y", "width", "height"] as const;
const THEME_KEYS: readonly (keyof AddressListTheme)[] = [
	"elevated",
	"ink",
	"inkMuted",
	"accent",
	"accentWash",
	"rowHover",
	"hairline",
	"control",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	allowed: Set<string> | readonly string[],
): boolean {
	const set = allowed instanceof Set ? allowed : new Set(allowed);
	for (const key of Object.keys(value)) if (!set.has(key)) return false;
	return true;
}

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rect(value: unknown): AddressListRect | null {
	if (!isRecord(value)) return null;
	if (!hasOnlyKeys(value, RECT_KEYS)) return null;
	const x = finite(value.x);
	const y = finite(value.y);
	const width = finite(value.width);
	const height = finite(value.height);
	if (x === null || y === null || width === null || height === null)
		return null;
	return { x, y, width, height };
}

/** Strip the characters a display string must never carry, then cap by CODE
 * POINTS so a truncation cannot split a surrogate pair into a lone half. */
export function sanitizeOverlayText(
	value: unknown,
	cap: number,
): string | null {
	if (typeof value !== "string") return null;
	const stripped = value.replace(HOSTILE_STRING, "");
	const points = [...stripped];
	return points.length > cap ? points.slice(0, cap).join("") : stripped;
}

const ROW_KEYS = ["text", "title", "isolate"] as const;
const ISOLATE_KEYS = ["start", "end"] as const;

/** A valid range is two integers with 0 <= start < end <= text.length. Anything
 * else is a malformed row (refused), not a row to paint plain: a renderer that
 * sends a bad range is a renderer this boundary should not half-trust. */
function sanitizeIsolate(
	value: unknown,
	textLength: number,
): AddressListIsolate | null {
	if (!isRecord(value) || !hasOnlyKeys(value, ISOLATE_KEYS)) return null;
	const { start, end } = value;
	if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
	const from = start as number;
	const to = end as number;
	if (from < 0 || from >= to || to > textLength) return null;
	return { start: from, end: to };
}

function sanitizeRows(value: unknown): AddressListRow[] | null {
	if (!Array.isArray(value)) return null;
	if (value.length === 0 || value.length > ADDRESS_LIST_ROWS_MAX) return null;
	const rows: AddressListRow[] = [];
	for (const entry of value) {
		if (!isRecord(entry) || !hasOnlyKeys(entry, ROW_KEYS)) return null;
		const text = sanitizeOverlayText(entry.text, ADDRESS_LIST_MAX_TEXT);
		const title = sanitizeOverlayText(entry.title, ADDRESS_LIST_MAX_TITLE);
		if (text === null || title === null) return null;
		// An empty display text could only be a bug: the renderer's displayText
		// always ends in the destination. Refusing beats rendering a blank row the
		// user cannot map to the row they clicked.
		if (text.length === 0) return null;
		if (entry.isolate === undefined) {
			rows.push({ text, title });
			continue;
		}
		// The range is validated against the text the renderer SENT, then dropped
		// when sanitizing changed that text: stripping a control or truncating
		// shifts every offset, and a range pointing at the wrong bytes would isolate
		// the wrong span. Dropping it only costs the cosmetic isolate.
		const sent = typeof entry.text === "string" ? entry.text : "";
		const isolate = sanitizeIsolate(entry.isolate, sent.length);
		if (isolate === null) return null;
		rows.push(text === sent ? { text, title, isolate } : { text, title });
	}
	return rows;
}

function sanitizeTheme(value: unknown): {
	theme: AddressListTheme | null;
	fact: AddressListThemeFact;
} {
	if (value === undefined) return { theme: null, fact: "absent" };
	if (!isRecord(value) || !hasOnlyKeys(value, THEME_KEYS)) {
		return { theme: null, fact: "fallback" };
	}
	const theme = {} as AddressListTheme;
	for (const key of THEME_KEYS) {
		const raw = value[key];
		// Alpha-bearing colours are refused: the child must stay opaque, and an
		// rgba() would let the live page show through a surface meant to hide it.
		if (typeof raw !== "string" || !COLOR.test(raw)) {
			return { theme: null, fact: "fallback" };
		}
		theme[key] = raw;
	}
	return { theme, fact: "resolved" };
}

function jsonBytes(value: unknown): number {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).length;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * The untrusted boundary. Returns a fully rebuilt projection or the reason it
 * was refused; never a partially trusted object.
 */
export function sanitizeProjection(raw: unknown): AddressListSanitizeResult {
	if (jsonBytes(raw) > ADDRESS_LIST_MAX_PAYLOAD_BYTES) {
		return { ok: false, reason: "payload_too_large" };
	}
	if (!isRecord(raw)) return { ok: false, reason: "not_an_object" };
	if (raw.v !== 1 && raw.v !== 2) return { ok: false, reason: "bad_version" };
	const version = raw.v;
	const keys = version === 2 ? PROJECTION_KEYS_V2 : PROJECTION_KEYS_V1;
	if (!hasOnlyKeys(raw, keys)) return { ok: false, reason: "unknown_key" };
	if (!Number.isInteger(raw.seq) || (raw.seq as number) < 1) {
		return { ok: false, reason: "bad_seq" };
	}
	if (!Number.isInteger(raw.tabId)) return { ok: false, reason: "bad_tab" };
	if (typeof raw.visible !== "boolean") {
		return { ok: false, reason: "bad_visible" };
	}

	// A hide carries only the identity fields. Reading geometry it does not need
	// is how a hide path becomes a place a malformed rectangle can throw.
	if (!raw.visible) {
		const empty = { x: 0, y: 0, width: 0, height: 0 };
		return {
			ok: true,
			projection:
				version === 2
					? {
							v: 2,
							seq: raw.seq as number,
							tabId: raw.tabId as number,
							visible: false,
							pageRect: empty,
							anchor: { x: 0, width: 0 },
							active: -1,
							view: { kind: "notice", notice: "empty", text: "" },
							label: "",
							dir: "ltr",
							theme: null,
							themeFact: "absent",
						}
					: {
							v: 1,
							seq: raw.seq as number,
							tabId: raw.tabId as number,
							visible: false,
							pageRect: empty,
							field: empty,
							listTop: 0,
							active: -1,
							view: { kind: "notice", notice: "empty", text: "" },
							label: "",
							dir: "ltr",
							theme: null,
							themeFact: "absent",
						},
		};
	}

	const pageRect = rect(raw.pageRect);
	if (pageRect === null) return { ok: false, reason: "bad_rect" };
	let field: AddressListRect | null = null;
	let listTop = 0;
	let anchor: AddressListAnchor | null = null;
	if (version === 2) {
		if (!isRecord(raw.anchor) || !hasOnlyKeys(raw.anchor, ANCHOR_KEYS)) {
			return { ok: false, reason: "bad_anchor" };
		}
		const x = finite(raw.anchor.x);
		const width = finite(raw.anchor.width);
		if (x === null || width === null) {
			return { ok: false, reason: "bad_anchor" };
		}
		if (width <= 0) return { ok: false, reason: "bad_anchor" };
		anchor = { x, width };
	} else {
		field = rect(raw.field);
		if (field === null) return { ok: false, reason: "bad_rect" };
		const top = finite(raw.listTop);
		if (top === null) return { ok: false, reason: "bad_list_top" };
		listTop = top;
		if (field.width <= 0 || field.height <= 0) {
			return { ok: false, reason: "bad_field" };
		}
	}
	if (!Number.isInteger(raw.active)) return { ok: false, reason: "bad_active" };
	const active = raw.active as number;

	const viewRaw = raw.view;
	if (!isRecord(viewRaw)) return { ok: false, reason: "bad_view" };
	let view: AddressListView;
	if (viewRaw.kind === "rows") {
		if (!hasOnlyKeys(viewRaw, ["kind", "rows"])) {
			return { ok: false, reason: "bad_view" };
		}
		const rows = sanitizeRows(viewRaw.rows);
		if (rows === null) return { ok: false, reason: "bad_rows" };
		view = { kind: "rows", rows };
	} else if (viewRaw.kind === "notice") {
		if (!hasOnlyKeys(viewRaw, ["kind", "notice", "text"])) {
			return { ok: false, reason: "bad_view" };
		}
		if (!NOTICE_KINDS.includes(viewRaw.notice as AddressListNoticeKind)) {
			return { ok: false, reason: "bad_notice" };
		}
		const text = sanitizeOverlayText(viewRaw.text, ADDRESS_LIST_MAX_LABEL);
		if (text === null) return { ok: false, reason: "bad_notice_text" };
		view = {
			kind: "notice",
			notice: viewRaw.notice as AddressListNoticeKind,
			text,
		};
	} else {
		return { ok: false, reason: "bad_view" };
	}

	if (
		view.kind === "rows"
			? active < -1 || active >= view.rows.length
			: active !== -1
	) {
		return { ok: false, reason: "bad_active" };
	}

	const label = sanitizeOverlayText(raw.label, ADDRESS_LIST_MAX_LABEL);
	if (label === null) return { ok: false, reason: "bad_label" };
	if (raw.dir !== "ltr" && raw.dir !== "rtl") {
		return { ok: false, reason: "bad_dir" };
	}
	const { theme, fact } = sanitizeTheme(raw.theme);

	if (version === 2) {
		if (anchor === null) return { ok: false, reason: "bad_anchor" };
		return {
			ok: true,
			projection: {
				v: 2,
				seq: raw.seq as number,
				tabId: raw.tabId as number,
				visible: true,
				pageRect,
				anchor,
				active,
				view,
				label,
				dir: raw.dir,
				theme,
				themeFact: fact,
			},
		};
	}
	if (field === null) return { ok: false, reason: "bad_rect" };
	return {
		ok: true,
		projection: {
			v: 1,
			seq: raw.seq as number,
			tabId: raw.tabId as number,
			visible: true,
			pageRect,
			field,
			listTop,
			active,
			view,
			label,
			dir: raw.dir,
			theme,
			themeFact: fact,
		},
	};
}
function int32(value: number): number | null {
	if (!Number.isFinite(value)) return null;
	const rounded = Math.round(value);
	return Math.abs(rounded) > DIP_INT32_MAX ? null : rounded;
}

/** The number of DIP the list surface needs for a view. Rows: header + list
 * padding + n rows + bottom rule, rounded UP so a fractional row cannot clip. */
export function addressListHeightFor(view: AddressListView): number {
	if (view.kind === "notice") return ADDRESS_LIST_NOTICE_HEIGHT_DIP;
	return Math.ceil(
		ADDRESS_LIST_HEADER_HEIGHT +
			2 +
			view.rows.length * ADDRESS_LIST_ROW_HEIGHT +
			2 +
			1,
	);
}

/**
 * The one S2 geometry decision: the list surface sits exactly under the URL
 * field, inset to the field's own x/width, at the dock's measured top.
 *
 * WHY THE GAP IS VALIDATED RATHER THAN CLAMPED: the field and the dock are two
 * DOM elements in one renderer, so a gap outside `[0, 24]` means the renderer's
 * measurement is describing some other layout (a scrolled pane, a stale frame, a
 * theme that moved the toolbar). Drawing the child at a coerced position would
 * put it over the page with no relationship to the field; refusing leaves the
 * in-flow list as the only surface, which is still correct.
 *
 * The clamp to the owner content box is rounding insurance, not a fit policy: a
 * surface that would be shortened by the clamp is refused so a clipped row can
 * never be shown.
 */
export function addressListBoundsFor(
	field: AddressListRect,
	listTop: number,
	view: AddressListView,
	owner: { width: number; height: number },
): AddressListRect | null {
	const fx = int32(field.x);
	const fy = int32(field.y);
	const fw = int32(field.width);
	const fh = int32(field.height);
	const top = int32(listTop);
	const ownerWidth = int32(owner.width);
	const ownerHeight = int32(owner.height);
	if (
		fx === null ||
		fy === null ||
		fw === null ||
		fh === null ||
		top === null ||
		ownerWidth === null ||
		ownerHeight === null
	) {
		return null;
	}
	if (fw <= 0 || fh <= 0 || ownerWidth <= 0 || ownerHeight <= 0) return null;
	const gap = top - (fy + fh);
	if (gap < 0 || gap > ADDRESS_LIST_ANCHOR_GAP_MAX) return null;
	const height = addressListHeightFor(view);
	if (height > ADDRESS_LIST_MAX_HEIGHT_DIP) return null;
	const left = Math.max(0, fx);
	const right = Math.min(ownerWidth, fx + fw);
	const bottom = Math.min(ownerHeight, top + height);
	if (right <= left) return null;
	// Never shorten: a clamped surface would hide rows the model claims exist.
	if (bottom - top !== height) return null;
	return { x: left, y: top, width: right - left, height };
}

/**
 * S4b's geometry: the list surface starts at the page's own top edge and spans
 * the intersection of the strip band and the page rectangle.
 *
 * WHY THE PAGE RECT, NOT THE FIELD: the field row is now painted over the STRIP
 * (design §3) and is removed from the flow, so `field.y + field.height` no
 * longer names where the page begins — and the old gap rule would refuse every
 * projection. The trusted `pageRect` is the registry's `contentRect`, which is
 * exactly where the page view starts. Using its `y` is also the requirement
 * "the page does not move": the native child is the only thing that changes
 * rectangle when the popout opens.
 *
 * The child is never allowed to leave the owner's box and never shortened: a
 * clamped surface would hide rows the model says exist (the S2 rule, unchanged).
 */
export function addressListBoundsV2For(
	anchor: AddressListAnchor,
	pageRect: AddressListRect,
	view: AddressListView,
	owner: { width: number; height: number },
): AddressListRect | null {
	const ax = int32(anchor.x);
	const aw = int32(anchor.width);
	const px = int32(pageRect.x);
	const pw = int32(pageRect.width);
	const py = int32(pageRect.y);
	const ownerWidth = int32(owner.width);
	const ownerHeight = int32(owner.height);
	if (
		ax === null ||
		aw === null ||
		px === null ||
		pw === null ||
		py === null ||
		ownerWidth === null ||
		ownerHeight === null
	) {
		return null;
	}
	if (aw <= 0 || pw <= 0 || ownerWidth <= 0 || ownerHeight <= 0) return null;
	const left = Math.max(0, Math.max(ax, px));
	const right = Math.min(ownerWidth, Math.min(ax + aw, px + pw));
	if (right - left < ADDRESS_LIST_MIN_WIDTH_DIP) return null;
	const height = addressListHeightFor(view);
	if (height > ADDRESS_LIST_MAX_HEIGHT_DIP) return null;
	if (py < 0 || py + height > ownerHeight) return null;
	return { x: left, y: py, width: right - left, height };
}

/** Child-local y → row index, using the dock's own fixed geometry. Padding above
 * the first row is 2 CSS px; rows are 35.5. Header, padding, a notice and the
 * bottom rule name no row, so they answer null and the click is swallowed. */
export function addressListRowIndexAt(
	view: AddressListView,
	offsetY: number,
): number | null {
	if (view.kind !== "rows") return null;
	if (!Number.isFinite(offsetY)) return null;
	const withinRows = offsetY - ADDRESS_LIST_HEADER_HEIGHT - 2;
	if (withinRows < 0) return null;
	const index = Math.floor(withinRows / ADDRESS_LIST_ROW_HEIGHT);
	return index >= 0 && index < view.rows.length ? index : null;
}

/** What the child's `apply()` returns. Only numbers, so a child bug can make
 * main hide — it cannot make main believe a string. */
export interface AddressListMeasurement {
	appliedSeq: number;
	rowCount: number;
	headerHeight: number;
	rowRects: Array<{ top: number; height: number }>;
	viewportHeight: number;
	scrollHeight: number;
	/** The child's own viewport height, so a failed resize is distinguishable
	 * from a layout bug. Optional: the first shipped document did not report it. */
	innerHeight?: number;
	/** The child's visual viewport, when it reports one. */
	visualHeight?: number;
	activeRowRect: { top: number; height: number } | null;
}

function measurementValue(value: unknown): AddressListMeasurement | null {
	if (!isRecord(value)) return null;
	if (!Number.isInteger(value.appliedSeq)) return null;
	if (!Number.isInteger(value.rowCount)) return null;
	const headerHeight = finite(value.headerHeight);
	const viewportHeight = finite(value.viewportHeight);
	const scrollHeight = finite(value.scrollHeight);
	if (headerHeight === null || viewportHeight === null || scrollHeight === null)
		return null;
	if (!Array.isArray(value.rowRects)) return null;
	const rowRects: Array<{ top: number; height: number }> = [];
	for (const entry of value.rowRects) {
		if (!isRecord(entry)) return null;
		const top = finite(entry.top);
		const height = finite(entry.height);
		if (top === null || height === null) return null;
		rowRects.push({ top, height });
	}
	const innerHeight = finite(value.innerHeight);
	const visualHeight = finite(value.visualHeight);
	let activeRowRect: { top: number; height: number } | null = null;
	if (value.activeRowRect !== null && value.activeRowRect !== undefined) {
		if (!isRecord(value.activeRowRect)) return null;
		const top = finite(value.activeRowRect.top);
		const height = finite(value.activeRowRect.height);
		if (top === null || height === null) return null;
		activeRowRect = { top, height };
	}
	const appliedSeq = value.appliedSeq;
	const rowCount = value.rowCount;
	if (typeof appliedSeq !== "number" || typeof rowCount !== "number")
		return null;
	return {
		appliedSeq,
		rowCount,
		headerHeight,
		rowRects,
		viewportHeight,
		scrollHeight,
		...(innerHeight === null ? {} : { innerHeight }),
		...(visualHeight === null ? {} : { visualHeight }),
		activeRowRect,
	};
}

/**
 * Did the child actually render the model main sent — INSIDE the paint box?
 *
 * The child pins its own layout to the model height, so `viewportHeight` alone
 * cannot prove the native view was resized: a deferred native resize leaves the
 * layout viewport at the model height while the view still paints the previous
 * rectangle. `innerHeight` is the only signal for that case, and comparing it
 * with the requested height is what stops main from claiming "shown" over rows
 * that are outside the view. A mismatch is retryable (`measure_viewport`), not a
 * permanent defect: the compositor may need a frame.
 *
 * A failed check is still a HIDE when it persists: main must never route a mouse
 * click onto a row the user cannot see. Tolerances are the rendered values' own
 * (±0.5 CSS px for sub-pixel row height; 1 px of scroll/view slop).
 */
export function addressListMeasurementProblem(
	raw: unknown,
	projection: AddressListProjection,
	requestedHeight: number,
): string | null {
	const measurement = measurementValue(raw);
	if (measurement === null) return "measure_invalid";
	if (measurement.appliedSeq !== projection.seq) return "measure_stale";
	const reported = measurement.visualHeight ?? measurement.innerHeight;
	if (reported !== undefined && Math.abs(reported - requestedHeight) > 1) {
		return "measure_viewport";
	}
	if (projection.view.kind !== "rows") {
		return measurement.rowCount === 0 ? null : "measure_extra_rows";
	}
	const rows = projection.view.rows;
	if (measurement.rowCount !== rows.length) return "measure_row_count";
	if (measurement.rowRects.length !== rows.length) return "measure_row_rects";
	if (Math.abs(measurement.headerHeight - ADDRESS_LIST_HEADER_HEIGHT) > 0.5) {
		return "measure_header";
	}
	for (const row of measurement.rowRects) {
		if (Math.abs(row.height - ADDRESS_LIST_ROW_HEIGHT) > 0.5) {
			return "measure_row_height";
		}
	}
	if (measurement.scrollHeight > measurement.viewportHeight + 1) {
		return "measure_scroll";
	}
	if (projection.active >= 0) {
		if (measurement.activeRowRect === null) return "measure_active_missing";
		// The paint box is the native view (`innerHeight`), not the child's own
		// pinned layout. A row whose document-space bottom is below it is painted
		// nowhere, even though the model says it exists.
		const paintBox =
			measurement.visualHeight ?? measurement.innerHeight ?? requestedHeight;
		const { top, height } = measurement.activeRowRect;
		const documentBottom = measurement.headerHeight + top + height;
		if (top < -0.5 || documentBottom > paintBox + 0.5) {
			return "active_not_visible";
		}
	}
	return null;
}

/** The exact model the child's fixed `apply()` receives. No URL, no geometry the
 * child does not paint with, no page identity. */
export interface AddressListViewModel {
	v: 1;
	seq: number;
	dir: "ltr" | "rtl";
	label: string;
	active: number;
	view: AddressListView;
	/** The block height main sized the native view to. The child pins its own
	 * root to this, so its layout does not depend on when a native resize lands
	 * (a hidden window can defer one for a second); the view is a paint box. */
	height: number;
	theme: AddressListTheme;
}

export function addressListViewModel(
	projection: AddressListProjection,
): AddressListViewModel {
	const fallback: AddressListTheme = {
		elevated: ADDRESS_LIST_THEME_FALLBACK,
		ink: "#e6e8ea",
		inkMuted: "#9aa0a6",
		accent: "#5b9dd9",
		accentWash: "#23303d",
		rowHover: "#24282e",
		hairline: "#2f343b",
		control: "#3a4048",
	};
	const theme = projection.theme ?? fallback;
	return {
		v: 1,
		seq: projection.seq,
		dir: projection.dir,
		label: projection.label,
		active: projection.active,
		view: projection.view,
		height: addressListHeightFor(projection.view),
		theme,
	};
}
