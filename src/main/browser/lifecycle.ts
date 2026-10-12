import type { BrowserAvailability } from "../../shared/browser-availability";
export type { BrowserAvailability } from "../../shared/browser-availability";

/** A startup attempt owns resources immediately, before it can publish a host.
 * Reverse-order, awaited rollback prevents a retry from mounting alongside the
 * previous attempt. Cleanup failures are reported without skipping later owners.
 * This stack is not a shutdown snapshot: rollback never persists partial state. */
export class StartupRollback {
	private owners: Array<() => void | Promise<void>> = [];
	add(cleanup: () => void | Promise<void>): void {
		this.owners.push(cleanup);
	}
	commit(): void {
		this.owners = [];
	}
	async run(log: (message: string) => void): Promise<void> {
		for (const cleanup of this.owners.splice(0).reverse()) {
			try {
				await cleanup();
			} catch (error) {
				log(`[browser] startup cleanup failed: ${String(error)}`);
			}
		}
	}
}

export const MAX_START_ATTEMPTS = 3;

/** No timeout races an initializer: all attempts finish and roll back before
 * retrying. An owner closing its window cancels the sequence, never another
 * window's host. Only startup is retried; dispatched page actions are not. */
export async function startWithRetries<T>(options: {
	start: () => Promise<T>;
	cancelled: () => boolean;
	publish: (availability: BrowserAvailability) => void;
	log: (message: string) => void;
}): Promise<T> {
	let failure: unknown = new Error("The browser window closed before startup.");
	for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt += 1) {
		if (options.cancelled()) break;
		options.publish({
			status: attempt === 1 ? "starting" : "retrying",
			attempt,
			maxAttempts: MAX_START_ATTEMPTS,
			message: null,
		});
		try {
			return await options.start();
		} catch (error) {
			failure = error;
			options.log(
				`[browser] startup attempt ${attempt}/${MAX_START_ATTEMPTS} failed: ${String(error)}`,
			);
		}
	}
	options.publish({
		status: "unavailable",
		attempt: MAX_START_ATTEMPTS,
		maxAttempts: MAX_START_ATTEMPTS,
		message:
			"The browser could not start. Your saved tabs and site access are kept.",
	});
	throw failure;
}
