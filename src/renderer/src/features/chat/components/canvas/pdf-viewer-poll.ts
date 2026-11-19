type PdfStatus = "loading" | "ready" | "failed";

/**
 * One outstanding IPC at a time; a wall deadline still applies if IPC never
 * answers. Cancellation and terminal results discard late answers from a PDF
 * whose tab closed or whose retry already mounted another guest.
 */
export function watchPdfViewer(
	readStatus: () => Promise<PdfStatus>,
	onStatus: (status: "ready" | "failed") => void,
): () => void {
	let stopped = false;
	let next: ReturnType<typeof setTimeout> | undefined;
	const finish = (status: "ready" | "failed") => {
		if (stopped) return;
		stopped = true;
		clearTimeout(next);
		clearTimeout(deadline);
		onStatus(status);
	};
	// Parsing, not byte access, owns this budget. OS open stays available during it.
	const deadline = setTimeout(() => finish("failed"), 30_000);
	const poll = async () => {
		let status: PdfStatus = "loading";
		try {
			status = await readStatus();
		} catch {
			// A host/guest transitioning may recover before the shared deadline.
		}
		if (stopped) return;
		if (status === "ready" || status === "failed") finish(status);
		else next = setTimeout(poll, 250);
	};
	void poll();
	return () => {
		stopped = true;
		clearTimeout(next);
		clearTimeout(deadline);
	};
}
