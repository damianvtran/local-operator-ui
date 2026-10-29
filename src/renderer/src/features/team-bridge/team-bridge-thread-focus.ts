/** A thread is an explicitly opened reading surface. Move focus into its header,
 * handle Escape only inside the pane (and after a menu has had its chance), and
 * restore the invoking row control if it still exists. Never pull focus back
 * from another control the reader deliberately selected while the pane was open.
 */
export function manageThreadFocus(
	pane: HTMLElement,
	close: () => void,
): () => void {
	const doc = pane.ownerDocument;
	const origin =
		doc.activeElement instanceof (doc.defaultView?.HTMLElement ?? HTMLElement)
			? (doc.activeElement as HTMLElement)
			: null;
	pane.querySelector<HTMLElement>("[data-thread-close]")?.focus();
	const handleEscape = (event: KeyboardEvent) => {
		if (event.key !== "Escape" || event.defaultPrevented || event.isComposing)
			return;
		if (doc.querySelector('[role="menu"], [role="listbox"]')) return;
		event.preventDefault();
		event.stopPropagation();
		close();
	};
	pane.addEventListener("keydown", handleEscape);
	return () => {
		pane.removeEventListener("keydown", handleEscape);
		if (
			origin?.isConnected &&
			(pane.contains(doc.activeElement) || doc.activeElement === doc.body)
		)
			origin.focus();
	};
}
