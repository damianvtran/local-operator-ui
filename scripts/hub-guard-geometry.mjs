/** A display:contents wrapper can return a perfect-looking 0x0 overflow ratio.
 * These captures must measure a painted scroll container, not mistake that zero
 * box for evidence. Vertical scrolling is allowed; horizontal clipping is not. */
export function isPaintedScrollBox(box) {
	return (
		!!box &&
		[box.w, box.h, box.cw, box.ch, box.sw].every(Number.isFinite) &&
		box.w > 0 &&
		box.h > 0 &&
		box.cw > 0 &&
		box.ch > 0 &&
		box.sw <= box.cw
	);
}
