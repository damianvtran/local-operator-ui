import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import {
	ClipboardCopy,
	Copy,
	Ellipsis,
	ExternalLink,
	File as FileIcon,
	FolderOpen,
	LayoutGrid,
	Link,
} from "lucide-react";
import {
	type ImageAction,
	type ImageActionId,
	barePath,
	classifyAttachmentSource,
	imageActions,
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
	tooltip?: string;
	"aria-label"?: string;
};

/** One icon per entry, keyed by the stable id the matrix returns. */
const ACTION_ICONS: Record<ImageActionId, React.ReactNode> = {
	"open-file": <FileIcon aria-hidden="true" />,
	"show-in-canvas": <LayoutGrid aria-hidden="true" />,
	"open-folder": <FolderOpen aria-hidden="true" />,
	"copy-file-path": <ClipboardCopy aria-hidden="true" />,
	"copy-image": <Copy aria-hidden="true" />,
	"copy-image-url": <Link aria-hidden="true" />,
	"open-in-browser": <ExternalLink aria-hidden="true" />,
};

export const ImageActionsMenu = ({
	file,
	src,
	label,
	onShowInCanvas,
	tooltip = "Image actions",
	"aria-label": ariaLabel,
}: ImageActionsMenuProps) => {
	const kind = classifyAttachmentSource(file);
	const actions = imageActions(kind, {
		canShowInCanvas: Boolean(onShowInCanvas),
		source: src ?? file,
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

	const copyImage = async () => {
		try {
			if (typeof ClipboardItem === "undefined") {
				throw new Error("this window cannot write an image to the clipboard");
			}
			const blob = await resolveCopyableImage(kind, file, src);
			await navigator.clipboard.write([
				new ClipboardItem({ [blob.type || "image/png"]: blob }),
			]);
			showSuccessToast("Image copied to clipboard");
		} catch (error) {
			console.error("Failed to copy image: ", error);
			showErrorToast("Failed to copy image");
		}
	};

	const perform = (action: ImageAction) => {
		// `barePath` once, here: the bridge and both OS doors speak bare paths,
		// and a `file://` spelling is the same path (the rule `canvas-document.ts`
		// strips by).
		const path = barePath(file);
		switch (action.id) {
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
		<DropdownMenu>
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
						// The trigger sits inside a clickable picture; without this the
						// picture's own press (expansion) fires behind the menu.
						onClick={(e) => e.stopPropagation()}
					>
						<Ellipsis aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>

			<DropdownMenuContent
				align="end"
				className="min-w-45"
				onClick={(e) => e.stopPropagation()}
			>
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
