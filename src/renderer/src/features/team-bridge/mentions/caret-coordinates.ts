/**
 * Where a character of a textarea sits on screen, so the popover can anchor at
 * the `@` the reader just typed.
 *
 * A textarea exposes no geometry for its characters, so this is the classic
 * mirror: an off-screen div with the field's computed text metrics, holding
 * the text up to the index and a marker span. Copying the COMPUTED style
 * (rather than duplicating class names) keeps it correct when the composer's
 * own classes change, which a sibling lane is actively doing.
 */
export const MIRRORED_PROPERTIES = [
	"boxSizing",
	"width",
	"height",
	"overflowX",
	"overflowY",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
	"borderStyle",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"fontStyle",
	"fontVariant",
	"fontWeight",
	"fontStretch",
	"fontSize",
	"fontSizeAdjust",
	"lineHeight",
	"fontFamily",
	"fontFeatureSettings",
	"textAlign",
	"textTransform",
	"textIndent",
	"letterSpacing",
	"wordSpacing",
	"tabSize",
	"direction",
] as const;

export function copyTextMetrics(
	from: HTMLTextAreaElement,
	to: HTMLElement,
): void {
	const style = from.ownerDocument.defaultView?.getComputedStyle(from);
	if (!style) return;
	for (const property of MIRRORED_PROPERTIES)
		to.style[property] = style[property];
	to.style.whiteSpace = "pre-wrap";
	to.style.overflowWrap = "break-word";
}

/** Viewport coordinates of the top-left of character `index`, plus its line height. */
export function caretRect(
	field: HTMLTextAreaElement,
	index: number,
): { left: number; top: number; height: number } {
	const doc = field.ownerDocument;
	const mirror = doc.createElement("div");
	copyTextMetrics(field, mirror);
	mirror.style.position = "absolute";
	mirror.style.visibility = "hidden";
	mirror.style.top = "0";
	mirror.style.left = "-9999px";
	mirror.textContent = field.value.slice(0, index);
	const marker = doc.createElement("span");
	marker.textContent = field.value.slice(index) || ".";
	mirror.appendChild(marker);
	doc.body.appendChild(mirror);
	const box = field.getBoundingClientRect();
	const lineHeight =
		Number.parseFloat(
			doc.defaultView?.getComputedStyle(field).lineHeight ?? "",
		) || 20;
	const result = {
		left: box.left + marker.offsetLeft - field.scrollLeft,
		top: box.top + marker.offsetTop - field.scrollTop,
		height: lineHeight,
	};
	mirror.remove();
	return result;
}
