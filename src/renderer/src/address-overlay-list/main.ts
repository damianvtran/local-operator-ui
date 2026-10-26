/**
 * The S2 child document's script: a dumb, fixed renderer for the model main
 * sends. It is reachable only through `window.__loAddressOverlay`, which main
 * calls with `executeJavaScript` using a main-built JSON argument.
 *
 * WHAT IT MAY DO (and all it does): set text through `textContent`, toggle class
 * names, set validated CSS custom properties through `style.setProperty`, and
 * report measurements. It never builds HTML, never navigates, never reads a
 * cookie, never talks to main and imports nothing from the app — this bundle is
 * deliberately inert, so a compromised renderer projection can, at worst, paint
 * wrong glyphs inside the child window.
 *
 * WHY MEASUREMENTS COME FROM HERE: main must know the list was ACTUALLY applied
 * before it routes a mouse click to a row. A model echoed back would prove
 * nothing; the numbers below come from the real layout in the child.
 */

import "./list.css";

interface Model {
	v: 1;
	seq: number;
	dir: "ltr" | "rtl";
	label: string;
	active: number;
	height: number;
	view:
		| {
				kind: "rows";
				rows: Array<{
					text: string;
					title: string;
					/** Main-validated display span; see `AddressListIsolate`. */
					isolate?: { start: number; end: number };
				}>;
		  }
		| {
				kind: "notice";
				notice: "error" | "empty" | "no_match";
				text: string;
		  };
	theme: Record<string, string>;
}

const THEME_VARIABLES = [
	["elevated", "--lo-elevated"],
	["ink", "--lo-ink"],
	["inkMuted", "--lo-ink-muted"],
	["accent", "--lo-accent"],
	["accentWash", "--lo-accent-wash"],
	["rowHover", "--lo-row-hover"],
	["hairline", "--lo-hairline"],
	["control", "--lo-control"],
] as const;

const root = document.getElementById("address-list-root") as HTMLDivElement;
const header = document.getElementById("address-list-header") as HTMLDivElement;
const label = document.getElementById("address-list-label") as HTMLSpanElement;
const viewport = document.getElementById(
	"address-list-viewport",
) as HTMLDivElement;
const rowsHost = document.getElementById("address-list-rows") as HTMLDivElement;
const noticeEl = document.getElementById(
	"address-list-notice",
) as HTMLDivElement;

let appliedSeq = 0;

function rectOf(element: Element): { top: number; height: number } {
	const rect = element.getBoundingClientRect();
	return { top: rect.top, height: rect.height };
}

export function measure(): {
	appliedSeq: number;
	rowCount: number;
	headerHeight: number;
	rowRects: Array<{ top: number; height: number }>;
	viewportHeight: number;
	scrollHeight: number;
	innerHeight: number;
	/** The visual viewport, when the browser reports one. A pinned document can
	 * leave `innerHeight` stale on a hidden window while the visible viewport is
	 * already the new rectangle; main trusts whichever it can prove. */
	visualHeight: number | null;
	activeRowRect: { top: number; height: number } | null;
} {
	const rows = Array.from(rowsHost.children) as HTMLElement[];
	const active = rowsHost.querySelector<HTMLElement>(".is-active");
	return {
		appliedSeq,
		rowCount: rows.length,
		headerHeight: header.getBoundingClientRect().height,
		// Child-local coordinates: the row's top relative to the viewport (which is
		// the coordinate space of the mouse events main observes).
		rowRects: rows.map((row) => {
			const rect = rectOf(row);
			const base = viewport.getBoundingClientRect();
			return { top: rect.top - base.top, height: rect.height };
		}),
		viewportHeight: viewport.getBoundingClientRect().height,
		scrollHeight: viewport.scrollHeight,
		innerHeight: window.innerHeight,
		visualHeight: window.visualViewport?.height ?? null,
		activeRowRect: active
			? (() => {
					const rect = rectOf(active);
					const base = viewport.getBoundingClientRect();
					return { top: rect.top - base.top, height: rect.height };
				})()
			: null,
	};
}

export function apply(model: Model): ReturnType<typeof measure> {
	appliedSeq = model.seq;
	document.documentElement.dir = model.dir === "rtl" ? "rtl" : "ltr";

	for (const [key, variable] of THEME_VARIABLES) {
		const value = model.theme[key];
		if (typeof value === "string") {
			document.documentElement.style.setProperty(variable, value);
		}
	}

	label.textContent = model.label;
	// The paint box is main's rectangle, but the LAYOUT height is the model's: a
	// hidden window can defer a native resize, and the rows must not be measured
	// against a stale viewport.
	if (typeof model.height === "number" && model.height > 0) {
		root.style.height = `${model.height}px`;
	}
	root.dataset.view = model.view.kind;

	if (model.view.kind === "rows") {
		const fragment = document.createDocumentFragment();
		model.view.rows.forEach((row, index) => {
			const rowEl = document.createElement("div");
			rowEl.className = "lo-row";
			rowEl.dataset.index = String(index);
			if (index === model.active) {
				rowEl.classList.add("is-active");
				rowEl.dataset.active = "true";
			}
			const text = document.createElement("span");
			text.className = "lo-row-text";
			// `auto`, not `ltr`: a URL's strong Latin bytes already resolve LTR,
			// while a search sentence in Urdu must read right-to-left (design D5).
			// Forcing LTR reversed the sentence in an RTL chrome.
			text.dir = "auto";
			const { isolate } = row;
			// A row that embeds the user's value is a sentence in the UI's language:
			// its direction is the UI's, not the first strong character's. `dir=auto`
			// skips the isolate and reads the first strong letter OUTSIDE it, which in
			// an Urdu sentence opening with Latin text ("DuckDuckGo ...") is LTR - the
			// sentence painted left-to-right and left-aligned beside an RTL Open row
			// (design D1). Plain candidate rows (a bare URL or a title) keep `auto`.
			if (isolate) text.dir = model.dir === "rtl" ? "rtl" : "ltr";
			if (
				isolate &&
				Number.isInteger(isolate.start) &&
				Number.isInteger(isolate.end) &&
				isolate.start >= 0 &&
				isolate.start < isolate.end &&
				isolate.end <= row.text.length
			) {
				// THE TYPED VALUE IS AN LTR RUN INSIDE A SENTENCE IN THE UI'S
				// LANGUAGE. With no strong Latin character (an IP literal) the
				// paragraph would otherwise be RTL and reorder it. `<bdi dir="ltr">`
				// is the isolate; the text stays text (`textContent` on each part),
				// so the concatenation is exactly the unsplit text. main already
				// bounds-checked the range; the guard above only keeps a corrupt
				// model from throwing inside the child.
				// The sentence is UI type and only the value is the machine face
				// (design D4): `is-sentence` turns the row text sans, `list.css` keeps
				// the value in mono.
				text.classList.add("is-sentence");
				const bdi = document.createElement("bdi");
				bdi.dir = "ltr";
				bdi.textContent = row.text.slice(isolate.start, isolate.end);
				text.append(
					document.createTextNode(row.text.slice(0, isolate.start)),
					bdi,
					document.createTextNode(row.text.slice(isolate.end)),
				);
			} else {
				text.textContent = row.text;
			}
			rowEl.append(text);
			if (row.title) {
				const title = document.createElement("span");
				title.className = "lo-row-title";
				title.dir = "auto";
				title.textContent = row.title;
				rowEl.append(title);
			}
			fragment.append(rowEl);
		});
		rowsHost.replaceChildren(fragment);
		noticeEl.textContent = "";
		noticeEl.hidden = true;
		noticeEl.dataset.kind = "";
	} else {
		rowsHost.replaceChildren();
		noticeEl.hidden = false;
		noticeEl.dataset.kind = model.view.notice;
		noticeEl.textContent = model.view.text;
	}

	return measure();
}

declare global {
	interface Window {
		__loAddressOverlay?: { apply: typeof apply; measure: typeof measure };
	}
}

window.__loAddressOverlay = { apply, measure };
