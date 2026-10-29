import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import {
	ClipboardCopy,
	Copy,
	Download,
	Ellipsis,
	ExternalLink,
	File as FileIcon,
	FolderOpen,
	LayoutGrid,
	Link,
	Maximize2,
} from "lucide-react";
import { t } from "../../../../../i18n";
import { AttachmentGoneError } from "../canonical/use-attachment-url";
import {
	type ImageAction,
	type ImageActionId,
	barePath,
	classifyAttachmentSource,
	downloadBlob,
	imageActions,
	pngForClipboard,
	resolveCopyableImage,
} from "../utils/image-actions";
import {
	openLocalTarget,
	openUrlTarget,
	revealLocalTarget,
} from "../utils/link-open";

/**
 * The actions a PICTURE offers, wherever it is drawn.
 *
 * The sibling of `file-actions-menu.tsx` rather than a fork of it: the shell
 * (Ellipsis trigger, Tooltip, `min-w-45` menu, the stopPropagation pair that
 * keeps a press from reaching the picture behind it) is the established one, so
 * two menus in one transcript cannot drift apart. What differs is the SET, and
 * the set is data (`../utils/image-actions`) rather than branches here: the four
 * file-shaped actions this menu inherited are joined by the kinds that had no
 * menu at all — a durable screenshot (`blob:`), a pasted picture carried inline
 * (`data:`) and a markdown image's URL — each offered only the actions its kind
 * can honour (`Copy image` needs bytes this window can reach; `Open folder`
 * needs a path).
 *
 * The surface decides the REVEAL (hover, focus, the open-menu keep) and this
 * component decides the contents: on the transcript that is
 * `image-attachment.tsx`'s wrapper, whose measured caveats live beside it.
 *
 * `label` is the picture's own name, so the trigger is announced as "Actions
 * for Image 2" rather than as a run of identical buttons — the same vocabulary
 * `supplement-row.tsx` ships for files.
 */
export type ImageActionsMenuProps = {
	onExpand?: () => void;
	/** Controlled only by Finder's context/key menu; ordinary callers stay uncontrolled. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Finder's roving row is visible; its hover-only ellipsis is not a safe
	 * focus landing. Other surfaces keep Radix's normal trigger restoration. */
	onCloseAutoFocus?: (event: Event) => void;
	triggerTabIndex?: number;
	/** Resolves a real local path only when a path action is explicitly chosen. */
	resolvePath?: () => Promise<string>;
	missing?: boolean;

	/**
	 * The source string the picture came from: a path, `file://`, `data:`,
	 * `blob:` or `http(s):`. Classified by `classifyAttachmentSource`, which is
	 * the legacy attachment rule — a token that is not URL-shaped is handed to
	 * the bridge as a path, exactly as the guard this replaces did.
	 */
	file: string;
	/**
	 * The URL the picture is painted from, when it differs from `file` (a
	 * legacy attachment's `file` is its path while its `src` is a blob). The
	 * bytes actions resolve against THIS when given.
	 */
	src?: string;
	/** What to call the picture in the trigger's accessible name. */
	label?: string;
	/**
	 * Present on surfaces that can put the picture in a canvas. Its ABSENCE is
	 * what removes the `Show in canvas` entry — the same optional-callback shape
	 * `file-actions-menu.tsx` uses, for the same reason: a surface with no pane
	 * in reach must not be promised one.
	 */
	onShowInCanvas?: (() => void) | undefined;
	/**
	 * For a session artifact: what the bytes are. A video is offered `Save as...`
	 * and no clipboard copy (there is no video clipboard form) — and a sound is
	 * the same case, so it rides the same arm (`image-actions.ts`).
	 */
	mediaKind?: "image" | "video" | "audio";
	/**
	 * For a session artifact: the name `Save as...` proposes
	 * (`artifactFileName`). Required for that entry to work, which is why the
	 * entry is withheld without it.
	 */
	saveName?: string;
	/**
	 * Where the bytes come from when the surface does not hold a painted URL.
	 *
	 * A Files row mounts one menu per row and does not resolve every row's
	 * picture (the thumbnail is lazy and a video row has none), so a copy or save
	 * from the menu fetches by digest on demand. The viewers, which already hold
	 * the painted `blob:`, do not pass it and resolve through `src` as before.
	 */
	resolveBytes?: () => Promise<Blob>;
	tooltip?: string;
	"aria-label"?: string;
};

/** One icon per entry, keyed by the stable id the matrix returns. */
const ACTION_ICONS: Record<ImageActionId, React.ReactNode> = {
	"expand-image": <Maximize2 aria-hidden="true" />,
	"open-file": <FileIcon aria-hidden="true" />,
	"show-in-canvas": <LayoutGrid aria-hidden="true" />,
	"save-as": <Download aria-hidden="true" />,
	"open-folder": <FolderOpen aria-hidden="true" />,
	"copy-file-path": <ClipboardCopy aria-hidden="true" />,
	"copy-image": <Copy aria-hidden="true" />,
	"copy-image-url": <Link aria-hidden="true" />,
	"open-in-browser": <ExternalLink aria-hidden="true" />,
};

/**
 * The toast for a failed copy or save. A gone artifact says so, in the viewer's
 * own words ("no longer in the session"), because the row looks healthy until a
 * fetch fails and "Failed to save file" gives the reader no way to tell a blip
 * from a loss (UX U3). Everything else keeps the established fixed copy: the
 * specific sentence reaches the log, as before.
 */
const failureSentence = (
	fallback: string,
	gone: string,
	error: unknown,
): string => (error instanceof AttachmentGoneError ? gone : fallback);

/**
 * The entries `ImageActionsMenu` would render for these props - the one
 * definition, exported so a caller that must know whether the menu is EMPTY
 * (Finder's Shift+F10 on a refused row, QA R6 Q4) asks the menu itself
 * rather than re-deriving its filters.
 */
export function imageMenuActions({
	file,
	src,
	resolvePath,
	missing,
	onShowInCanvas,
	mediaKind,
	onExpand,
	saveName,
}: Pick<
	ImageActionsMenuProps,
	| "file"
	| "src"
	| "resolvePath"
	| "missing"
	| "onShowInCanvas"
	| "mediaKind"
	| "onExpand"
	| "saveName"
>) {
	return imageActions(classifyAttachmentSource(file), {
		canShowInCanvas: Boolean(onShowInCanvas),
		source: src ?? file,
		mediaKind,
		artifactPathActions: Boolean(resolvePath),
		canExpand: Boolean(onExpand),
	}).filter(
		(action) =>
			(action.id !== "save-as" || Boolean(saveName)) &&
			(!missing || action.id === "copy-file-path"),
	);
}

export const ImageActionsMenu = ({
	file,
	src,
	label,
	open,
	onOpenChange,
	onCloseAutoFocus,
	triggerTabIndex,
	resolvePath,
	missing,
	onShowInCanvas,
	mediaKind,
	onExpand,
	saveName,
	resolveBytes,
	tooltip = "Image actions",
	"aria-label": ariaLabel,
}: ImageActionsMenuProps) => {
	const kind = classifyAttachmentSource(file);
	const actions = imageMenuActions({
		file,
		src,
		resolvePath,
		missing,
		onShowInCanvas,
		mediaKind,
		onExpand,
		saveName,
	});
	if (actions.length === 0) return null;

	/**
	 * The feedback pair is the one `file-actions-menu.tsx` established: a
	 * success toast naming what landed on the clipboard, and a console error
	 * beside a failure toast — the failure path a `catch` here exists for is a
	 * clipboard the OS refused, not a reason to stay silent.
	 */
	const copyText = async (text: string, done: string, failed: string) => {
		try {
			await navigator.clipboard.writeText(text);
			showSuccessToast(done);
		} catch (error) {
			console.error(`${failed}: `, error);
			showErrorToast(failed);
		}
	};

	/**
	 * Copy the picture's bytes, as the clipboard's ONE writable image type.
	 *
	 * The blob this resolves is NOT the entry that goes on the clipboard: a
	 * JPEG/WEBP/GIF copy used to be written under its own MIME and Chromium's
	 * sanitized write refused it (`Type image/jpeg not supported on write.` -
	 * the operator's "Failed to copy image" on 19 JPEGs, 2026-10-11), while PNGs
	 * went through. `pngForClipboard` encodes anything non-PNG to a PNG, so the
	 * entry written here is always `image/png` - byte-exact for a source that
	 * already was one. WHY THAT RULE HOLDS, and why the encode cannot move to
	 * the store: `needsPngEncode` in `../utils/image-actions`.
	 *
	 * THE ACTIVATION NUANCE. `write` spends the click's TRANSIENT ACTIVATION
	 * (it is why a copy with no gesture fails with "Write permission denied"
	 * even in this app), and Chromium's window for it is seconds, not minutes -
	 * so the transcode has to stay quick rather than being deferred, batched or
	 * awaited behind anything slower. Measured on the committed fixture (the
	 * real-click `image-copy` scene, `docs/evidence/image-copy/`): press to
	 * landed toast is ~185 ms (180-187 across the four presses, the committed
	 * log's own readings), well inside the ~5 s window.
	 */
	const copyImage = async () => {
		try {
			if (typeof ClipboardItem === "undefined") {
				throw new Error("this window cannot write an image to the clipboard");
			}
			const bytes = resolveBytes
				? await resolveBytes()
				: await resolveCopyableImage(kind, file, src);
			const png = await pngForClipboard(bytes);
			await navigator.clipboard.write([new ClipboardItem({ [png.type]: png })]);
			showSuccessToast(t("ui.notices.files.image_copied"));
		} catch (error) {
			console.error("Failed to copy image: ", error);
			showErrorToast(
				failureSentence(
					t("ui.notices.files.image_copy_failed"),
					t("ui.notices.files.image_copy_failed_gone"),
					error,
				),
			);
		}
	};

	/*
	 * Save the bytes through the platform's save dialog. The bytes are resolved
	 * the way a copy resolves them, and the dialog (not this code) chooses where
	 * they land, so nothing here writes to a path.
	 */
	const saveAs = async () => {
		try {
			const bytes = resolveBytes
				? await resolveBytes()
				: await resolveCopyableImage(kind, file, src);
			downloadBlob(bytes, saveName ?? "download");
		} catch (error) {
			console.error("Failed to save file: ", error);
			showErrorToast(
				failureSentence(
					t("ui.notices.files.save_failed"),
					t("ui.notices.files.save_failed_gone"),
					error,
				),
			);
		}
	};

	const perform = async (action: ImageAction) => {
		// `barePath` once, here: the bridge and both OS doors speak bare paths,
		// and a `file://` spelling is the same path (the rule `canvas-document.ts`
		// strips by).
		let path = barePath(file);
		if (
			resolvePath &&
			["open-file", "open-folder", "copy-file-path"].includes(action.id)
		) {
			try {
				path = await resolvePath();
			} catch {
				showErrorToast(t("ui.canvas.files.prepareError"));
				return;
			}
		}
		switch (action.id) {
			case "expand-image":
				onExpand?.();
				return;
			case "open-file":
				void openLocalTarget(path);
				return;
			case "open-folder":
				void revealLocalTarget(path);
				return;
			case "show-in-canvas":
				onShowInCanvas?.();
				return;
			case "copy-file-path":
				void copyText(
					path,
					"File path copied to clipboard",
					"Failed to copy file path",
				);
				return;
			case "copy-image":
				void copyImage();
				return;
			case "save-as":
				void saveAs();
				return;
			case "copy-image-url":
				void copyText(
					src ?? file,
					"Image URL copied to clipboard",
					"Failed to copy image URL",
				);
				return;
			case "open-in-browser":
				void openUrlTarget(src ?? file);
				return;
		}
	};

	const resolvedAriaLabel = ariaLabel ?? `Actions for ${label ?? "this image"}`;

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip content={tooltip}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						/*
						 * THE REVEALED TRIGGER'S OWN GROUND (design round 1, D1). A ghost
						 * button has no fill at rest, so with the pointer merely OVER THE
						 * PICTURE (the reveal state this menu lives in) its glyph sat on
						 * whatever pixels the picture painted: measured 1.63:1 light
						 * palette over a dark picture, 1.81:1 inverse, against the 3:1 icon
						 * floor. The chip makes the glyph read against a TOKEN on every
						 * surface and both palettes (inkMuted on accentWash: 8.19 dark /
						 * 7.72 light, the pair the open state already proved), and it is
						 * invisible at rest anyway - the wrapper hides the control until
						 * hover or focus, so the reveal stays one step and the UI stays
						 * uncluttered. The contract row lives in
						 * `scripts/contrast-contract.mjs` ("image actions trigger").
						 */
						className="bg-accent-wash"
						aria-label={resolvedAriaLabel}
						tabIndex={triggerTabIndex}
						// The trigger sits inside a clickable picture; without this the
						// picture's own press (expansion) fires behind the menu.
						onClick={(e) => e.stopPropagation()}
					>
						<Ellipsis aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>

			<DropdownMenuContent
				onCloseAutoFocus={onCloseAutoFocus}
				align="end"
				className="min-w-45"
				onClick={(e) => e.stopPropagation()}
			>
				{resolvePath && (
					<div
						role="note"
						className={cn("max-w-64 px-2 py-1 text-meta text-ink-muted")}
					>
						{t("ui.canvas.files.pathCopyNote")}
					</div>
				)}
				{actions.map((action) => (
					<DropdownMenuItem key={action.id} onSelect={() => perform(action)}>
						{ACTION_ICONS[action.id]}
						<span>{action.label}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
