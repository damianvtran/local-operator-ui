export type HistoryDirection = -1 | 1;

/** Renderer-local metadata, not a second history stack. The native HashRouter
 * owns the entries, keys and route state; this index only identifies which
 * native offsets actually move to a different app destination. It starts at
 * this window's initial entry, never exposing history from before boot. */
export class DesktopNavigationHistory {
	private readonly addresses = new Map<number, string>();
	private index: number | undefined;

	visit(
		index: number | undefined,
		address: string,
		action: "push" | "replace" | "pop",
	) {
		if (index === undefined) {
			// An out-of-band hash edit lost the router's index. Don't guess where
			// Back would go when this window no longer knows its boundary.
			this.addresses.clear();
		} else {
			if (action === "push") {
				for (const entry of this.addresses.keys()) {
					if (entry >= index) this.addresses.delete(entry);
				}
			}
			this.addresses.set(index, address);
		}
		this.index = index;
	}

	offset(direction: HistoryDirection): number | undefined {
		if (this.index === undefined) return;
		const address = this.addresses.get(this.index);
		for (
			let target = this.index + direction;
			this.addresses.has(target);
			target += direction
		) {
			// Redirects and refused opens may replace an entry with its neighbour.
			// Skip that native slot rather than showing the same page twice.
			if (this.addresses.get(target) !== address) return target - this.index;
		}
	}
}
