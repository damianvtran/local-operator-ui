export type HistoryDirection = -1 | 1;
export type ChatSelection = { kind: "draft" | "session"; id: string } | null;

type Destination = { address: string; selection?: ChatSelection };

function sameDestination(a: Destination | undefined, b: Destination): boolean {
	return (
		a !== undefined &&
		a.address === b.address &&
		(a.selection === null) === (b.selection === null) &&
		a.selection?.kind === b.selection?.kind &&
		a.selection?.id === b.selection?.id
	);
}

/** Renderer-local metadata, not a second history stack. The native HashRouter
 * owns the entries, keys and route state; this index only identifies which
 * native offsets actually move to a different app destination. It starts at
 * this window's initial entry, never exposing history from before boot. */
export class DesktopNavigationHistory {
	private readonly addresses = new Map<number, Destination>();
	private index: number | undefined;

	visit(
		index: number | undefined,
		address: string,
		action: "push" | "replace" | "pop",
		selection?: ChatSelection,
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
			this.addresses.set(index, { address, selection });
		}
		this.index = index;
	}

	selectionAt(
		index: number | undefined,
		address: string,
	): ChatSelection | undefined {
		const entry = index === undefined ? undefined : this.addresses.get(index);
		return entry?.address === address ? entry.selection : undefined;
	}

	isCurrent(address: string, selection?: ChatSelection): boolean {
		return (
			this.index !== undefined &&
			sameDestination(this.addresses.get(this.index), { address, selection })
		);
	}

	offset(direction: HistoryDirection): number | undefined {
		if (this.index === undefined) return;
		const address = this.addresses.get(this.index);
		for (let target = this.index + direction; ; target += direction) {
			const targetAddress = this.addresses.get(target);
			if (!targetAddress) return;
			// Redirects and refused opens may replace an entry with its neighbour.
			// Skip that native slot rather than showing the same page twice.
			if (!sameDestination(address, targetAddress)) return target - this.index;
		}
	}
}
