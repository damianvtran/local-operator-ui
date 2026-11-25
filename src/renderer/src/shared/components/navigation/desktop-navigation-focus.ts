// These persistent controls are a user's active keyboard target across POPs.
// Suppress only unsolicited chat-arrival focus; explicit composer focus still
// works, and ordinary conversation opens retain their existing focus behavior.
export function desktopHistoryKeepsFocus(element: Element | null): boolean {
	return (
		element?.matches("[data-desktop-back], [data-desktop-forward]") ?? false
	);
}
