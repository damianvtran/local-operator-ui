// These persistent controls are a user's active keyboard target across POPs.
// Unsolicited chat-arrival focus yields while one still has focus. An explicit
// keyboard New Chat hands that focus back before staging its new draft.
export function desktopHistoryKeepsFocus(element: Element | null): boolean {
	return (
		element?.matches("[data-desktop-back], [data-desktop-forward]") ?? false
	);
}
