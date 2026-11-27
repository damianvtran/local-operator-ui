type UpdateOperation = "app" | "backend" | "combined" | "overnight";

// UpdateService follows the window; an install can outlive it. Keep ownership
// in the main process so reopening a window cannot start a second writer.
let active: { kind: UpdateOperation } | null = null;

export function currentUpdateOperation(): UpdateOperation | null {
	return active?.kind ?? null;
}

export function acquireUpdateOperation(
	kind: UpdateOperation,
): (() => void) | null {
	if (active) return null;
	const owner = { kind };
	active = owner;
	return () => {
		// A stale release must never clear a later acquisition, even of the same kind.
		if (active === owner) active = null;
	};
}
