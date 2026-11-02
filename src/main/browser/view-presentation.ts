/** The native parent seam, kept independent of Electron for regression tests. */
export interface BrowserViewParent<View> {
	readonly children: readonly View[];
	addChildView(view: View): void;
	removeChildView(view: View): void;
}

/**
 * Visibility is not a native focus boundary: Electron can make a hidden attached
 * WebContentsView the first responder when its navigation commits. Detach every
 * unpresented page instead; a previously sized view retains its compositor and
 * viewport (1280x720 for inactive tabs), so agent reads/input/capture still work.
 *
 * Presentation changes parent membership only, never the view, WebContents,
 * partition, debugger, history or capability. Avoid re-adding an attached page:
 * that would reorder it above native overlays and can itself move focus.
 */
export function setBrowserViewPresented<View>(
	parent: BrowserViewParent<View>,
	view: View,
	presented: boolean,
): void {
	const attached = parent.children.includes(view);
	if (presented && !attached) parent.addChildView(view);
	else if (!presented && attached) parent.removeChildView(view);
}
