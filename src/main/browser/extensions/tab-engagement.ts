/** Engagement must come from app chrome, not a driven page's native focus or
 * input events: CDP travels through Chromium's input pipeline too. */
export class TabEngagement {
	private tabId: number | null = null;

	selected(tabId: number, trusted: boolean, windowFocused: boolean): void {
		if (trusted && windowFocused) this.tabId = tabId;
	}

	activated(tabId: number | null): void {
		if (this.tabId !== tabId) this.clearAll();
	}

	clear(tabId: number): void {
		if (this.tabId === tabId) this.clearAll();
	}

	clearAll(): void {
		this.tabId = null;
	}

	has(tabId: number): boolean {
		return this.tabId === tabId;
	}
}
