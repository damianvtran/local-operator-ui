/** Human chrome only: an invocation being accepted is not a navigation having
 * committed. A typed settled outcome lets chrome report a recoverable failure
 * without an unhandled Electron IPC rejection, and names a retained partial tab.
 * This is deliberately absent from the agent browser protocol. */
export type HumanTabAction = "duplicate" | "reload";
export type HumanTabActionOutcome =
	| { status: "completed"; action: HumanTabAction; tabId: number }
	| {
			status: "failed";
			action: HumanTabAction;
			tabId: number | null;
			error: {
				code: "tab_closed" | "unsupported_page" | "navigation_failed";
				message: string;
			};
	  };
