/** Browser commands are UI intents, never agent capabilities. Both input doors
 * use this table so a DOM synthetic event cannot quietly acquire a different
 * meaning from the native view's key. Find/zoom stay with the existing app until
 * their separately reviewed browser slice; editing shortcuts are not intercepted. */
export type BrowserChord =
	| "reload"
	| "hard-reload"
	| "back"
	| "forward"
	| "focus-address"
	| "new-tab"
	| "close-tab"
	| "reopen-tab"
	| "next-tab"
	| "prev-tab"
	| "tab-1"
	| "tab-2"
	| "tab-3"
	| "tab-4"
	| "tab-5"
	| "tab-6"
	| "tab-7"
	| "tab-8"
	| "tab-9";
export interface BrowserChordInput {
	type: string;
	key: string;
	meta: boolean;
	control: boolean;
	alt: boolean;
	shift: boolean;
	isAutoRepeat?: boolean;
	isComposing?: boolean;
}
export function browserChordIntent(
	input: BrowserChordInput,
	platform: string,
): BrowserChord | null {
	if (input.type !== "keyDown" || input.alt || input.isComposing) return null;
	const key = input.key.toLowerCase();
	let intent: BrowserChord | null = null;
	if (key === "tab" && input.control && !input.meta) {
		intent = input.shift ? "prev-tab" : "next-tab";
	} else {
		const primary =
			platform === "darwin"
				? input.meta && !input.control
				: input.control && !input.meta;
		if (!primary) return null;
		if (
			platform === "darwin" &&
			input.shift &&
			["[", "]", "{", "}"].includes(key)
		) {
			intent = key === "[" || key === "{" ? "prev-tab" : "next-tab";
		} else if (key === "r") intent = input.shift ? "hard-reload" : "reload";
		else if (key === "t") intent = input.shift ? "reopen-tab" : "new-tab";
		else if (!input.shift) {
			if (key === "l") intent = "focus-address";
			else if (key === "w") intent = "close-tab";
			else if (key === "[") intent = "back";
			else if (key === "]") intent = "forward";
			else if (/^[1-9]$/.test(key)) intent = `tab-${key}` as BrowserChord;
		}
	}
	return input.isAutoRepeat && intent !== "next-tab" && intent !== "prev-tab"
		? null
		: intent;
}

/** A real hook prevents both DOM delivery and the menu accelerator. A DOM event
 * is a separate fallback door (and can be exercised without OS focus), not a
 * second listener for the same physical press. Never debounce user commands. */
export interface BrowserChordMessage {
	intent: BrowserChord;
	origin: "page" | "chrome";
}
