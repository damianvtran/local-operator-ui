interface ActiveTab {
	tabId: number;
	owner: "agent" | "user";
	presented: boolean;
}

interface Notice {
	tabId: number;
	at: number;
	dismissed: boolean;
}

/** Projection of the host chooser only. In particular there is no connection
 * to page console messages, pending timers, recovery notices or frame loads.
 * Dismissing a projection never answers the chooser or mutates a page. */
export class NativePasskeyNotice {
	private readonly notices = new Map<string, Notice>();
	private sequence = 0;

	started(
		request: { requestId: string; tabId: number | null },
		active: ActiveTab | null,
		engagement: { has(tabId: number): boolean },
	): boolean {
		if (
			!active?.presented ||
			active.owner !== "agent" ||
			active.tabId !== request.tabId ||
			!engagement.has(active.tabId) ||
			this.notices.has(request.requestId)
		)
			return false;
		this.notices.set(request.requestId, {
			tabId: active.tabId,
			at: ++this.sequence,
			dismissed: false,
		});
		return true;
	}

	settled(requestId: string): boolean {
		return this.notices.delete(requestId);
	}

	viewFor(active: ActiveTab | null): Pick<Notice, "tabId" | "at"> | null {
		if (!active?.presented || active.owner !== "agent") return null;
		for (const { tabId, at, dismissed } of this.notices.values()) {
			if (tabId === active.tabId && !dismissed) return { tabId, at };
		}
		return null;
	}

	dismiss(tabId: number, at: number): boolean {
		for (const notice of this.notices.values()) {
			if (notice.tabId === tabId && notice.at === at && !notice.dismissed) {
				notice.dismissed = true;
				return true;
			}
		}
		return false;
	}

	/** Navigation, ownership transfer, close or an explicit continue makes all
	 * outstanding projections for this tab irrelevant, without settling them. */
	clearTab(tabId: number): boolean {
		let changed = false;
		for (const [requestId, notice] of this.notices) {
			if (notice.tabId === tabId) changed = this.notices.delete(requestId);
		}
		return changed;
	}
}

/** Only the focused page's bare, physical Escape belongs to the visible notice.
 * Claim that keystroke so it cannot also cancel the site's own flow. */
export function dismissNativePasskeyNoticeOnEscape(options: {
	event: Pick<Event, "defaultPrevented" | "preventDefault">;
	input: Pick<
		Electron.Input,
		| "type"
		| "key"
		| "alt"
		| "control"
		| "meta"
		| "shift"
		| "isAutoRepeat"
		| "isComposing"
	>;
	ownsFocusedPage: boolean;
	agentKey: boolean;
	dismiss(): boolean;
}): boolean {
	const { event, input } = options;
	if (
		event.defaultPrevented ||
		!options.ownsFocusedPage ||
		options.agentKey ||
		input.type !== "keyDown" ||
		input.key !== "Escape" ||
		input.alt ||
		input.control ||
		input.meta ||
		input.shift ||
		input.isAutoRepeat ||
		input.isComposing ||
		!options.dismiss()
	)
		return false;
	event.preventDefault();
	return true;
}
