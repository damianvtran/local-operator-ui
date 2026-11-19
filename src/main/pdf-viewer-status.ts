import type { WebContents, WebFrameMain } from "electron";
import { PDF_VIEWER_DOCUMENT, frameNavigationVerdict } from "./window-guards";

export type PdfViewerStatus = "loading" | "ready" | "failed";

/*
 * Electron 45's PDF guest is deliberately invisible to the outer iframe's DOM
 * and postMessage bridge. Its load event proves only application/pdf arrived,
 * not that PDFium parsed it: our navigation refusal produced exactly that event
 * and a blank frame. Read only the built-in viewer's parse result, never code
 * or a frame selector supplied by the renderer. These fields are verified on
 * the pinned runtime; a future viewer changing them stays loading and the
 * renderer's deadline offers retry/OS instead of silently claiming success.
 */
export const PDF_PARSE_STATUS_SCRIPT = `(() => {
	const viewer = document.querySelector("pdf-viewer");
	if (viewer?.loadState_ === "failed") return "failed";
	const pages = viewer?.documentDimensions?.pageDimensions;
	return viewer?.loadState_ === "success" && Array.isArray(pages) &&
		pages.length > 0 && pages.every(page => page.width > 0 && page.height > 0)
		? "ready" : "loading";
})()`;

// A busy guest may not execute even a fixed expression before our query budget.
// Reuse that work on later polls instead of queuing evaluations behind its parser.
const inFlight = new WeakMap<WebFrameMain, Promise<unknown>>();

/** Poll only this sender's existing app -> PDF blob -> built-in viewer chain. */
export async function pdfViewerStatus(
	contents: WebContents,
	blobUrl: unknown,
	trustedUrls: readonly string[],
): Promise<PdfViewerStatus> {
	if (
		typeof blobUrl !== "string" ||
		!blobUrl.startsWith("blob:") ||
		!frameNavigationVerdict({ url: blobUrl, isMainFrame: false }, trustedUrls)
			.allowed ||
		!frameNavigationVerdict(
			{ url: contents.mainFrame.url, isMainFrame: true },
			trustedUrls,
		).allowed
	) {
		return "failed";
	}
	const withoutFragment = (value: string) => value.split("#", 1)[0];
	const viewer = contents.mainFrame.framesInSubtree.find(
		(frame) =>
			frame.url === PDF_VIEWER_DOCUMENT &&
			frame.parent?.parent === contents.mainFrame &&
			withoutFragment(frame.parent.url) === withoutFragment(blobUrl),
	);
	if (!viewer) return "loading";
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		let query = inFlight.get(viewer);
		if (!query) {
			query = viewer.executeJavaScript(PDF_PARSE_STATUS_SCRIPT);
			inFlight.set(viewer, query);
			void query.then(
				() => inFlight.delete(viewer),
				() => inFlight.delete(viewer),
			);
		}
		const status = await Promise.race([
			query,
			new Promise<"loading">((resolve) => {
				timer = setTimeout(() => resolve("loading"), 1_000);
			}),
		]);
		return status === "ready" || status === "failed" ? status : "loading";
	} catch {
		// A tab switch can destroy a guest between discovery and evaluation.
		return "loading";
	} finally {
		clearTimeout(timer);
	}
}
