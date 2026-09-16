import { useSuppressBrowserView } from "@shared/browser-view-policy";
import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { X } from "lucide-react";
import type { FC, RefObject } from "react";

/**
 * One picture, expanded over the app.
 *
 * The operator's report: a screenshot in a conversation could not be read at the
 * size the transcript gives it, and clicking it did nothing on a canonical row.
 * A conversation image is now a button, and this is what it opens.
 *
 * ## What this deliberately is NOT
 *
 * A panel. Every other dialog in this app is a card — `bg-elevated`, a
 * `hairline` boundary, 24px of padding, the one shadow — and those are right for
 * a thing with a header, a body and actions. This one has exactly one object in
 * it, so the card would be a frame around the picture and nothing else: the
 * operator's own words are "it should just be the image over a darkened backdrop
 * where the app background is still visible behind it". So the panel clothes are
 * removed by the `className` below rather than by a second dialog implementation:
 * the primitive is still `@shared/components/ui`'s `Dialog`, the scrim is still
 * its `bg-scrim` (a per-theme role — a hardcoded black alpha is wrong in the six
 * light themes, where the scrim is a warm near-black at a lower alpha), and
 * Escape, the outside click, the focus trap and the close button are all Radix's
 * rather than a hand-rolled overlay, key handler or backdrop click.
 *
 * The close button is OURS rather than `DialogContent`'s own, and that is the
 * one thing here that looks like a duplication worth explaining. The panel's
 * button is `absolute top-4 right-4`, so it anchors to whatever box the content
 * has; here that box is the picture, which would put a 28px glyph on a small
 * image's corner. `fixed` anchors it to the viewport instead — the corner the
 * operator asked for — and a `fixed` child resolves against the viewport only
 * while no ancestor carries a `transform`. That is why the centring below is
 * `inset-0 m-auto w-fit h-fit` WITH `translate-none` rather than the primitive's
 * `top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`: a no-op translate still
 * establishes a containing block (measured in this checkout, Tailwind v4 emits
 * `translate: 0px var(--tw-translate-y)` for `translate-x-0`, and the individual
 * transform properties all establish one), which would silently drag the close
 * button back onto the picture. If a future caller mounts this inside something
 * transformed, the button degrades to the picture's corner rather than breaking:
 * that is the accepted direction.
 *
 * ## The size rule
 *
 * `max-w`/`max-h` and never a width: an `<img>` constrained only by its maxima
 * renders at its intrinsic size and is never enlarged, so a 24x18 PNG stays
 * 24x18 while a 2760-wide screenshot is fitted to the viewport. The margin is
 * 5% a side, stated as 90vw/90vh. Upscaling to the viewport is the other
 * candidate rule and it is rejected on purpose — a small picture blown up 40x is
 * a blur that hides nothing — but it is the design round's call to make, and the
 * two frames in `docs/evidence/chat-image-expand/` exist to make it.
 *
 * ## Geometry, and why the caller must know this
 *
 * The content box is the PICTURE's box, not the viewport's. That is what makes
 * "a click on the scrim outside the picture" a genuine outside click for Radix:
 * the layer is the picture, the scrim around it belongs to `DialogOverlay`, and
 * the dismissal needs no `pointer-events` juggling that would silently stop
 * working the day somebody reordered a class. The cost is that the content is
 * only as large as the picture, which is why the close button is `fixed`.
 *
 * Driven by state the caller owns, because the caller owns the button that opens
 * it and therefore the focus this returns to. Radix's own restore targets
 * `DialogTrigger`, and there is no trigger in this composition.
 */
export type ImageLightboxProps = {
	/** The picture to show, at the same URL the transcript renders it from. */
	src: string;
	/**
	 * What the picture is called. It names the dialog for a screen reader (Radix
	 * warns without a `DialogTitle` and refuses to be silent about it) and is the
	 * picture's own `alt`, so a reader hears one name rather than two.
	 */
	label: string;
	/** Whether the overlay is on screen. */
	open: boolean;
	/** All three dismissals land here: Escape, the scrim, the close button. */
	onOpenChange: (open: boolean) => void;
	/**
	 * The control that opened this, which focus returns to on close.
	 *
	 * The lightbox cannot infer it: the picture is a sibling, and the modal path
	 * in Radix moves focus to a `DialogTrigger` this composition does not have —
	 * so without this the reader would be dumped on `<body>` and the next Tab
	 * would start from the top of the app.
	 */
	restoreFocusTo?: RefObject<HTMLElement | null>;
};

export const ImageLightbox: FC<ImageLightboxProps> = ({
	src,
	label,
	open,
	onOpenChange,
	restoreFocusTo,
}) => {
	/*
	 * A native `WebContentsView` paints above all DOM, so an overlay opened over
	 * the browser route is invisible unless the view is hidden. `BaseDialog` is
	 * the funnel for the dialogs that use it; this one is not a `BaseDialog` —
	 * it has no header, body or actions to divide — so it registers here, and
	 * that registration is the reason it may not be built on the primitive
	 * without it.
	 */
	useSuppressBrowserView(open, "image-lightbox");

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				/*
				 * The panel's own close button is replaced below, and this is the
				 * primitive's supported way to say so — not a reimplementation of it:
				 * `DialogClose` and the ghost `Button` are the same two pieces.
				 */
				showClose={false}
				/*
				 * No `DialogDescription`: the picture speaks for itself, and Radix's
				 * console warning about a missing description is silenced by stating
				 * the absence rather than by inventing a sentence nobody reads.
				 */
				aria-describedby={undefined}
				onCloseAutoFocus={(event) => {
					const target = restoreFocusTo?.current;
					if (!target) return;
					/*
					 * Radix's modal path calls `preventDefault()` on this event and
					 * focuses the trigger, so the focus scope's own restore never runs
					 * and a composition without a trigger would land on `<body>`. The
					 * two `preventDefault`s are consistent, not in conflict.
					 */
					event.preventDefault();
					target.focus();
				}}
				className={cn(
					// Centred by auto margins, not by a transform: see the header note.
					"inset-0 top-0 left-0 m-auto h-fit w-fit translate-none",
					// The 5% margin, stated once at the layer and once on the picture.
					"max-h-[90vh] max-w-[90vw]",
					// Every panel clothes the primitive puts on, removed. `p-0` is
					// load-bearing rather than tidy: padding would enlarge the content
					// box past the picture, and the click-outside region would grow with
					// it. `border-transparent` is not redundancy beside `border-0` —
					// tailwind-merge drops the earlier width and keeps the earlier
					// COLOUR, which this is the only way to take off.
					"gap-0 rounded-none border-0 border-transparent bg-transparent p-0 shadow-none",
				)}
			>
				<DialogTitle className="sr-only">{label}</DialogTitle>
				<img
					src={src}
					alt={label}
					className={cn("max-h-[90vh] max-w-[90vw] object-contain")}
				/>
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className={cn("fixed top-4 right-4")}
						aria-label="Close image"
					>
						<X aria-hidden="true" />
					</Button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
};

ImageLightbox.displayName = "ImageLightbox";
