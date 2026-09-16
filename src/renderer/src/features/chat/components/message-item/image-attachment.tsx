import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { ImageLightbox } from "@shared/components/common/image-lightbox";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type FC, memo, useCallback, useRef, useState } from "react";
import { getFileTypeFromPath } from "../../utils/file-types";
import { isCanvasSupported } from "../../utils/is-canvas-supported";
import {
	ATTACHMENT_UNAVAILABLE_COPY,
	AttachmentFrame,
	BrokenAttachment,
} from "./attachment-frame";

/**
 * Props for the ImageAttachment component (base)
 */
type BaseImageAttachmentProps = {
	file: string;
	src: string;
	/**
	 * What to call this picture in `alt` and in the title.
	 *
	 * Defaults to the filename, which is right for a file on disk. A canonical
	 * image has no filename — `getFileName` on a blob URL yields the blob's
	 * UUID, so a screen reader announced a GUID — and passes a position
	 * ("Screenshot") instead.
	 */
	label?: string;
};

export type ImageAttachmentProps = BaseImageAttachmentProps & {
	conversationId: string;
};

/**
 * Extracts the filename from a path
 * @param path - The file path or URL
 * @returns The extracted filename
 */
const PATH_SEPARATOR_REGEX = /[/\\]/;
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

/**
 * An image sent or produced in the conversation.
 *
 * Every state it can be in — decoding, decoded, unreadable — is drawn by
 * `attachment-frame`, so the box never collapses, never reflows the message
 * when the picture lands, and never falls through to the browser's own broken
 * image glyph.
 *
 * THE PICTURE IS ALWAYS A BUTTON, and its click expands it (`ImageLightbox`).
 * It used to be a button only where the caller passed an `onClick`, which opened
 * the file in the OS default application; a canonical row passed none, so
 * clicking a tool row's screenshot did nothing at all — the operator's report.
 * Expansion is now the click's one meaning here, and the old action did not go
 * away with it: the frame's hover actions (`FileActionsMenu`, rendered for any
 * on-disk path) carry it, in the same place as every other action on the file,
 * and that menu is reachable by KEYBOARD as well as by pointer (see the wrapper
 * below) — which is the bar the round-1 review held this change to.
 *
 * ## The resting affordance, decided rather than left to omission
 *
 * There is no badge, glyph, border or shadow on a picture at rest, and that is a
 * decision with a reason (UX round 1, U1-1, asked for it to be stated). A
 * canonical row can carry a dozen screenshots and § 7 asks agent output to read
 * as rows rather than as a decorated scrapbook; the same reasoning is why the
 * composer's staging preview and the canvas viewer carry no mark either. What
 * says "this expands" is therefore the pointer cursor, the `title` tooltip, an
 * accessible name that states the ACTION ("Expand Screenshot"), and Enter/Space
 * on a real button — four cues that cost the composition nothing, rather than a
 * fifth that would sit on every picture in every transcript.
 *
 * ## The row's SHAPE, accepted rather than inherited
 *
 * The frame HUGS the picture and sits flush with the column's left edge, rather
 * than spanning the column with the picture floating centred in a panel wider
 * than itself. That is decided, not incidental (design round 2 accepted it on
 * measured facts, D2-1/D2-5): a wide picture now shares the message column's
 * left edge instead of being centred in dead ground, and a narrow one — which
 * used to get that whole panel of ground around it — is unchanged. What decides
 * it is the wrapper's own display: `<button>` shrink-wraps where a block `<div>`
 * filled its container. So an author reaching for `w-full` on the wrapper to
 * "fix" a narrow frame should know they are re-deciding this, and that the
 * canonical surface takes the same shape through its `inline-block` wrapper.
 */
export const ImageAttachment: FC<ImageAttachmentProps> = memo(
	({ file, src, conversationId, label }) => {
		const [hasError, setHasError] = useState(false);
		const [isLoaded, setIsLoaded] = useState(false);
		/**
		 * Whether the expanded overlay is on screen, and the control it returns
		 * focus to. Both live here because the picture is this component's: a
		 * caller that had to wire either one could forget to.
		 */
		const [expanded, setExpanded] = useState(false);
		const pictureRef = useRef<HTMLButtonElement>(null);
		const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
		const { setViewMode } = useCanvasStore();

		const handleShowInCanvas = useCallback(async () => {
			const title = getFileName(file);
			const fallbackAction = (err?: string) => {
				if (err) console.error("Error processing file:", err);
				/*
				 * The read failed, so open the file itself rather than the canvas
				 * view of it. This used to be the picture's own click handler, reached
				 * through the `onClick` prop; that click expands the picture now, and
				 * the call is stated here instead of routed through a prop that no
				 * longer means anything. It is the same call `FileActionsMenu`'s
				 * "Open file" item makes, so this is one action with two entry points
				 * rather than a second action.
				 */
				const normalizedPath = file.startsWith("file://")
					? file.substring(7)
					: file;
				window.api.openFile(normalizedPath).catch((error: unknown) => {
					console.error("Error opening file:", error);
				});
			};

			const { setFiles, setOpenTabs, setSelectedTab } =
				useCanvasStore.getState();

			if (file.startsWith("data:")) {
				if (isCanvasSupported(title)) {
					const docId = file;
					const newDoc = {
						id: docId,
						title,
						path: docId,
						content: file,
						type: getFileTypeFromPath(file),
					};

					const state = useCanvasStore.getState();
					const conversationCanvasState = state.conversations?.[conversationId];
					const filesInState = conversationCanvasState?.files ?? [];
					const openTabsInState = conversationCanvasState?.openTabs ?? [];

					const updatedFiles = (() => {
						const idx = filesInState.findIndex((d) => d.id === docId);
						if (idx !== -1) {
							return [
								...filesInState.slice(0, idx),
								newDoc,
								...filesInState.slice(idx + 1),
							];
						}
						return [...filesInState, newDoc];
					})();
					setFiles(conversationId, updatedFiles);

					const existsTab = openTabsInState.some((t) => t.id === docId);
					const updatedTabs = existsTab
						? openTabsInState
						: [...openTabsInState, { id: docId, title }];
					setOpenTabs(conversationId, updatedTabs);
					setSelectedTab(conversationId, docId);
					setCanvasOpen(true);
					setViewMode(conversationId, "documents");
				} else {
					setCanvasOpen(true);
					setViewMode(conversationId, "files");
				}
			} else {
				const normalizedPath = file.startsWith("file://")
					? file.substring(7)
					: file;
				try {
					const result = await window.api.readFile(normalizedPath);

					if (result.success && isCanvasSupported(title)) {
						const docId = normalizedPath;
						const newDoc = {
							id: docId,
							title,
							path: normalizedPath,
							content: result.data,
							type: getFileTypeFromPath(file),
						};

						const state = useCanvasStore.getState();
						const conversationCanvasState =
							state.conversations?.[conversationId];
						const filesInState = conversationCanvasState?.files ?? [];
						const openTabsInState = conversationCanvasState?.openTabs ?? [];

						const updatedFiles = (() => {
							const idx = filesInState.findIndex((d) => d.id === docId);
							if (idx !== -1) {
								return [
									...filesInState.slice(0, idx),
									newDoc,
									...filesInState.slice(idx + 1),
								];
							}
							return [...filesInState, newDoc];
						})();
						setFiles(conversationId, updatedFiles);

						const existsTab = openTabsInState.some((t) => t.id === docId);
						const updatedTabs = existsTab
							? openTabsInState
							: [...openTabsInState, { id: docId, title }];
						setOpenTabs(conversationId, updatedTabs);
						setSelectedTab(conversationId, docId);
						setCanvasOpen(true);
						setViewMode(conversationId, "documents");
						return;
					}

					setCanvasOpen(true);
					setViewMode(conversationId, "files");
				} catch (error: unknown) {
					const message =
						error instanceof Error
							? error.message
							: String(error ?? "Unknown error reading file");
					return fallbackAction(message);
				}
			}
		}, [file, setCanvasOpen, setViewMode, conversationId]);

		const handleError = () => {
			setHasError(true);
		};

		// `blob:` belongs in this guard beside `data:`. Both are in-memory handles
		// with no path behind them, and a blob URL starts with neither of the other
		// two prefixes — so without it every durable transcript image grew a file
		// menu whose entries called `showItemInFolder`/`openFile` on a string that
		// is not a path, and whose "copy file path" put a dead handle on the
		// clipboard under a "copied" toast.
		const isLocalFile =
			!file.startsWith("data:") &&
			!file.startsWith("blob:") &&
			!file.startsWith("http");
		const normalizedPath = file.startsWith("file://")
			? file.substring(7)
			: file;

		// The picture's own name: a caller-supplied position for something with no
		// path, the filename otherwise.
		const name = label ?? getFileName(file);

		if (hasError) {
			return <BrokenAttachment name={name} />;
		}

		const picture = (
			<AttachmentFrame>
				<img
					className={cn(
						// A shared height ceiling is the ledger rule. It does leave a
						// phone-aspect capture (828x1792) as a ~111px slice, but a
						// `min-w` floor is NOT the fix and was measured doing harm: it
						// widens the img BOX while `object-contain` keeps letterboxing
						// the picture inside it, so the portrait case paints 110.9px
						// either way and only gains empty ground — while a 24x18 image
						// gets its width forced to 120px and upscales 5x into a blur.
						// `AttachmentFrame`'s own `min-h-16`/`min-w-16` already floors
						// the TILE, which is the level where a small picture should be
						// centred rather than stretched. Solving the portrait case
						// properly means bounding by area, or relaxing `max-h` below
						// roughly a 0.6 aspect — not a width floor on the image.
						"max-h-[240px] max-w-full object-contain",
						// The picture is invisible, not absent, until it decodes:
						// the frame has already reserved the box, so nothing moves
						// when it appears.
						isLoaded ? "opacity-100" : "opacity-0",
					)}
					src={src}
					alt={name}
					onLoad={() => setIsLoaded(true)}
					onError={handleError}
				/>
			</AttachmentFrame>
		);

		return (
			<div className="group relative inline-block">
				<button
					ref={pictureRef}
					type="button"
					className={cn("block max-w-full cursor-pointer")}
					onClick={() => setExpanded(true)}
					/*
					 * `aria-label` rather than the picture's own `alt` as the name. The
					 * alt names the THING ("Attached image") and the action used to reach
					 * a screen reader only as the accessible DESCRIPTION, off the title —
					 * which is the fallback some readers skip, so the action was there
					 * for a mouse and effectively absent for a reader (UX round 1, U1-1).
					 * The name now states what pressing it does.
					 */
					aria-label={`Expand ${name}`}
					title={`Click to expand ${name}`}
				>
					{picture}
				</button>
				{isLocalFile && (
					/*
					 * Pointer-only REVEAL, keyboard-reachable CONTROL. `invisible` is
					 * `visibility: hidden`, which takes the trigger out of the tab order
					 * outright — so a keyboard reader could reach none of "open file",
					 * "open folder", "copy path" or "show in canvas" here, and the
					 * actions that used to be reachable through the picture's own click
					 * (it called `onClick`, i.e. `openFile`) became pointer-only when
					 * that click became the expansion (review round 1, R1-1).
					 *
					 * This is the reveal the repo already uses for a hovering toolbar —
					 * `quote-toolkit.tsx`, `directory-indicator.tsx`,
					 * `browser-tab-strip.tsx`, `agents-sidebar.tsx`,
					 * `schedule-list-item.tsx` and the three canvas views
					 * (`canvas-file-viewer`, `canvas-tabs`, `canvas-variables-viewer`) —
					 * where the control is hidden with `pointer-events-none opacity-0`
					 * (paint and pointer only) and both `group-hover` and
					 * `group-focus-within` bring it back, so being hidden and being
					 * unreachable stopped being the same thing. (Twelve files under
					 * `src/renderer/src` carry `group-focus-within`; those eight are the
					 * nearest analogues, and the count is greppable rather than recalled —
					 * review round 2, R2-3, corrected this list.) `group` is this component's own wrapper, so
					 * focusing the picture reveals the menu the same way hovering it
					 * does, and Tab walks picture -> menu.
					 */
					<div
						/*
						 * `has-[[data-state=open]]` for the OPEN state, and it is not
						 * decoration: opening this menu by KEYBOARD moves focus into the
						 * Radix portal, so `group-focus-within` stops matching while the
						 * menu is on screen and the trigger vanishes from under it — the
						 * menu reads as hanging off an empty focus ring (UX round 2,
						 * U2-1). A pointer user never saw it, because the pointer is still
						 * hovering the wrapper. The trigger carries `data-state` from
						 * Radix, so the wrapper can hold its own reveal for exactly as
						 * long as its menu is open, on either input.
						 */
						className="file-actions-menu pointer-events-none absolute top-1 right-1 z-[2] opacity-0 transition-opacity duration-fast ease-out-quart group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100"
						onClick={(e) => {
							e.stopPropagation();
						}}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<FileActionsMenu
							filePath={normalizedPath}
							tooltip="File actions"
							aria-label="File actions"
							onShowInCanvas={handleShowInCanvas}
						/>
					</div>
				)}
				<ImageLightbox
					src={src}
					label={name}
					open={expanded}
					onOpenChange={setExpanded}
					restoreFocusTo={pictureRef}
					/*
					 * The transcript's own failure treatment, and the sentence follows the
					 * SOURCE: a `file` on disk can honestly have been moved, renamed or
					 * deleted (`BrokenAttachment`'s default), while a `blob:`/`data:`
					 * handle is a digest in the app's own store and cannot have been any
					 * of those — the same split, with the same reason, that
					 * `canonical-image.tsx` makes for its unavailable state.
					 */
					fallback={
						<BrokenAttachment
							name={name}
							detail={isLocalFile ? undefined : ATTACHMENT_UNAVAILABLE_COPY}
						/>
					}
				/>
			</div>
		);
	},
);

ImageAttachment.displayName = "ImageAttachment";
