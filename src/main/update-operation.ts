type UpdateOperation = "app" | "backend" | "combined" | "overnight";

export type TransferUpdateOperation = () => () => void;

/** An IPC verdict and a writer's lifetime can end at different times. */
export async function runUpdateOperation<T>(
	release: () => void,
	run: (transfer: TransferUpdateOperation) => Promise<T>,
): Promise<T> {
	let transferred = false;
	try {
		return await run(() => {
			// Transfer before returning the IPC verdict. Only the new owner can
			// release; a window closing or the outer finally firing isn't evidence.
			transferred = true;
			return release;
		});
	} finally {
		if (!transferred) release();
	}
}

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
