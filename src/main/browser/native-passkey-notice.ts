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

/** Resolved by main from Electron's originating frame, never page claims. */
export interface NativeAuthSource {
	owner: "agent" | "user";
	documentEpoch: number;
	origin: string;
}

/** Request-specific information, not tab custody. No account names, credential
 * IDs, origin URLs or provider pixels cross this boundary. This is NOT evidence
 * that an overlapping agent action caused the authentication request. */
export interface PendingNativeAuth {
	status: "pending-auth";
	blocking: false;
	requestId: string;
	tabId: number;
}

/** Projection of the host chooser only. In particular there is no connection
 * to page console messages, pending timers, recovery notices or frame loads.
 * Dismissing a projection never answers the chooser or mutates a page. */
export class NativePasskeyNotice {
	private readonly notices = new Map<string, Notice>();
	private readonly pending = new Map<
		string,
		PendingNativeAuth & NativeAuthSource
	>();
	private sequence = 0;

	started(
		request: { requestId: string; tabId: number | null },
		active: ActiveTab | null,
		engagement: { has(tabId: number): boolean },
		source?: NativeAuthSource,
	): boolean {
		// The host resolves ownership from Electron's originating frame. Engagement
		// controls presentation only: an unattended request must remain observable
		// without focusing its tab, taking ownership, or admitting extension UI.
		if (
			request.tabId !== null &&
			source?.owner === "agent" &&
			!this.pending.has(request.requestId)
		)
			this.pending.set(request.requestId, {
				...source,
				status: "pending-auth",
				blocking: false,
				requestId: request.requestId,
				tabId: request.tabId,
			});
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

	/** Reading state never waits, answers the chooser or affects another request.
	 * An epoch-qualified read cannot project an old document's authentication. */
	pendingFor(tabId: number, documentEpoch?: number): PendingNativeAuth[] {
		return [...this.pending.values()]
			.filter(
				(request) =>
					request.tabId === tabId &&
					(documentEpoch === undefined ||
						request.documentEpoch === documentEpoch),
			)
			.map(({ status, blocking, requestId, tabId }) => ({
				status,
				blocking,
				requestId,
				tabId,
			}));
	}

	settled(requestId: string): boolean {
		this.pending.delete(requestId);
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

	/** Tab teardown or document replacement makes its projections irrelevant.
	 * Copying the page into another tab does not affect this tab's requests. */
	clearTab(tabId: number): boolean {
		for (const [requestId, request] of this.pending) {
			if (request.tabId === tabId) this.pending.delete(requestId);
		}
		let changed = false;
		for (const [requestId, notice] of this.notices) {
			if (notice.tabId === tabId) changed = this.notices.delete(requestId);
		}
		return changed;
	}
}

/** What the notice slot needs from the provider-document requests
 * (`extensions/auth-request.ts` `AuthRequests`). Structural, so this module
 * stays free of that one. */
export interface ProviderNoticeSource {
	providerViewForTab(tabId: number): {
		requestId: string;
		tabId: number;
		at: number;
		dismissed: boolean;
	} | null;
	dismiss(tabId: number, requestId: string): boolean;
}

/**
 * The ONE notice the card shows for the active tab, or null.
 *
 * ONE IDENTITY PER REQUEST (review Q3). A native request used to be projected
 * twice: here (`{tabId, at: <sequence>}`) and again from `AuthRequests`
 * (`{tabId, at: <clock>}`), so the card's entry id switched mid-life, one X or
 * Esc dismissed only the source whose `at` it carried, and the slot then fell
 * back to the other, still undismissed projection: the card stayed. Now a
 * native request is projected ONLY from `NativePasskeyNotice` (which also
 * carries the engagement + presented gate), and a provider-document request
 * only from `AuthRequests.providerViewForTab`, which never returns a native
 * one. The provider's wins for the tab the person is looking at: it is the more
 * specific statement.
 */
export function passkeyNoticeFor(
	active: ActiveTab | null,
	provider: ProviderNoticeSource,
	native: NativePasskeyNotice,
): Pick<Notice, "tabId" | "at"> | null {
	const pending = active ? provider.providerViewForTab(active.tabId) : null;
	if (pending && !pending.dismissed)
		return { tabId: pending.tabId, at: pending.at };
	return native.viewFor(active);
}

/** The card's X or Esc: hide the notice it carried, whichever source owns it.
 * Presentation only — never settles, reloads or cancels the request. */
export function dismissPasskeyNotice(
	notice: { tabId: number; at: number },
	provider: ProviderNoticeSource,
	native: NativePasskeyNotice,
): boolean {
	const pending = provider.providerViewForTab(notice.tabId);
	if (pending && pending.at === notice.at && !pending.dismissed)
		return provider.dismiss(notice.tabId, pending.requestId);
	return native.dismiss(notice.tabId, notice.at);
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
	/**
	 * The page's focused frame is a password manager's prompt (review U10).
	 * A person pressing Esc there is backing out of THAT prompt; claiming the
	 * key for the notice made them press twice. Left to the page.
	 */
	providerFocused: boolean;
	dismiss(): boolean;
}): boolean {
	const { event, input } = options;
	if (
		event.defaultPrevented ||
		!options.ownsFocusedPage ||
		options.agentKey ||
		options.providerFocused ||
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
