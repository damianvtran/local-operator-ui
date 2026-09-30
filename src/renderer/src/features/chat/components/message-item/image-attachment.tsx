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
	 * ("Image") instead.
	 */
	label?: string;
	/**
	 * The height ceiling the picture is drawn to.
	 *
	 * `full` is the transcript's own ceiling (240px): the size a picture is read
	 * at when it IS the thing on screen. `thumbnail` is for a picture that is an
	 * AFFORDANCE TO the full one — a condensed action group shows what its run
	 * produced without every image-bearing group costing the height of a full
	 * figure, and the click that expands to `full` is the same click either way.
	 *
	 * The thumbnail is the attachment frame's own floor (`min-h-16`, 64px) used as
	 * the height of a fixed 96x64 SLOT rather than as a shrink-wrap ceiling: it is
	 * the smallest tile this system already draws, so a thumbnail is an existing
	 * measure used in a new place rather than a fourth one nobody has looked at,
	 * and the fixed width is what keeps a row of tiles a grid when the pictures in
	 * it have different aspects.
	 */
	size?: ImageSize;
};

/**
 * The two boxes a picture is drawn into, named from the caller's question
 * ("is this the picture, or a way into it?") rather than from its pixels.
 *
 * `full` is the ledger rule every existing caller already had, spelled out
 * rather than implied: a shared 240px ceiling, `max-w-full` so a wide capture is
 * bounded by its column, `object-contain` so nothing is cropped or stretched at
 * any aspect. The last two are NOT left to Tailwind's preflight
 * (`img,video{max-width:100%;height:auto}`) even though it agrees with them here:
 * a constraint that has to hold for every picture has to be written where the
 * picture's own box is written, or a later change to the box reads the preflight
 * as permission rather than as a guard.
 *
 * `thumbnail` is a SLOT, not a shrink-wrap, and the fixed 96x64 is the point. A
 * tile sized by its own picture made the strip a ragged grid — a 200x360 portrait
 * drew 36px wide beside 96px landscapes, so the least legible picture got the
 * least room — and it also made the wrap count depend on which aspect happened to
 * be in the row (design review round 1, D4). `object-contain` inside the fixed
 * slot letterboxes the picture on the frame's own ground instead: every tile is
 * the same canvas, every picture gets the largest box the row can give it, and
 * the cap below has one number to hold.
 */
export type ImageSize = "full" | "thumbnail";

const PICTURE_CLASS: Record<ImageSize, string> = {
	full: "max-h-[240px] max-w-full object-contain",
	thumbnail: "h-16 w-24 object-contain",
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
 * accessible name that states the ACTION ("Expand Image"), and Enter/Space
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
	({ file, src, conversationId, label, size = "full" }) => {
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
			return <BrokenAttachment name={name} compact={size === "thumbnail"} />;
		}

		const picture = (
			<AttachmentFrame
				/*
				 * A tile IS a control: the frame is the whole of the button's visible
				 * boundary, so it takes the control edge rather than the decorative
				 * hairline (design review round 1, D2). At `full` the frame is an
				 * illustration's backing and the picture supplies its own extent.
				 */
				boundary={size === "thumbnail" ? "control" : "hairline"}
			>
				<img
					className={cn(
						// A shared height ceiling is the ledger rule, and `object-contain`
						// plus `max-w-full` is what keeps it honest at every aspect. It does
						// leave a phone-aspect capture (828x1792) as a ~111px slice, but a
						// `min-w` floor is NOT the fix and was measured doing harm: it
						// widens the img BOX while `object-contain` keeps letterboxing
						// the picture inside it, so the portrait case paints 110.9px
						// either way and only gains empty ground — while a 24x18 image
						// gets its width forced to 120px and upscales 5x into a blur.
						// `AttachmentFrame`'s own `min-h-16`/`min-w-16` already floors
						// the TILE, which is the level where a small picture should be
						// centred rather than stretched. The thumbnail's own portrait case
						// is answered at the SLOT instead (a fixed 96x64 box every tile
						// shares), not by a width floor on the image.
						PICTURE_CLASS[size],
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
					 * `directory-indicator.tsx`, `browser-tab-strip.tsx`,
					 * `agents-sidebar.tsx`, `schedule-list-item.tsx`, `chat-sidebar.tsx`,
					 * `editable-field.tsx`, `sidebar-navigation.tsx` and the three
					 * canvas views (`canvas-file-viewer`, `canvas-tabs`,
					 * `canvas-variables-viewer`) — where the control is hidden with
					 * `pointer-events-none opacity-0` (paint and pointer only) and both
					 * `group-hover` and `group-focus-within` bring it back, so being
					 * hidden and being unreachable stopped being the same thing.
					 * **Thirteen files under `src/renderer/src` carry
					 * `group-focus-within`**, this one included, and the ten above are
					 * the nearest analogues. The count and the names are greppable rather
					 * than recalled, and the list has now been corrected twice for exactly
					 * that reason: round 2 dropped `message-controls.tsx` (no such class),
					 * and round 3 dropped `quote-toolkit.tsx` — whose only match is its own
					 * comment saying it has neither class, which is the trap a grep for
					 * the token walks straight into (review round 3, R3-3). `group` is this component's own wrapper, so
					 * focusing the picture reveals the menu the same way hovering it
					 * does, and Tab walks picture -> menu.
					 */
					<div
						/*
						 * `has-[[aria-expanded=true]]` for the OPEN state, and WHICH
						 * attribute it keys on was measured rather than assumed.
						 *
						 * Opening this menu by keyboard moves focus into the Radix portal,
						 * so `group-focus-within` stops matching while the menu is on
						 * screen and the trigger vanishes from under it — the menu reads
						 * as hanging off an empty focus ring (U2-1). A pointer user never
						 * saw it, because the pointer is still hovering the wrapper.
						 *
						 * Round 2 first keyed this on `data-state=open` and it never
						 * fired: the only descendant of this wrapper holding `data-state`
						 * is the trigger, and that attribute is the TOOLTIP's, not the
						 * dropdown's — `file-actions-menu.tsx` nests
						 * `<Tooltip><DropdownMenuTrigger asChild>` and
						 * `ui/tooltip.tsx`'s `TooltipTrigger asChild` owns it. Measured
						 * with the menu genuinely open (`div[role="menu"][data-state=
						 * "open"]`, four entries, focus in the portal): the trigger read
						 * `data-state="closed"` with `aria-expanded="true"`, and the
						 * wrapper stayed at `opacity: 0` at 0, 60, 120, 250, 500 and
						 * 900ms. The dropdown's OWN attribute on that node is
						 * `aria-expanded`, so that is the one to key on — it is `true`
						 * exactly while the menu is open and `false` at rest, which is the
						 * state the reveal is for (UX round 3 U3-1, QA round 3 Q3-1; the
						 * frame and the frame measurement are in the evidence README).
						 */
						className="file-actions-menu pointer-events-none absolute top-1 right-1 z-[2] opacity-0 transition-opacity duration-fast ease-out-quart group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100"
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
