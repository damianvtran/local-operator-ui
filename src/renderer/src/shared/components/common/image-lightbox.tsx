import { useSuppressBrowserView } from "@shared/browser-view-policy";
import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	VIEWER_PAN_ORIGIN,
	VIEWER_ZOOM_MAX,
	VIEWER_ZOOM_MIN,
	type ViewerPan,
	clampViewerPan,
	groupPositionLabel,
	stepZoom,
} from "@shared/lib/image-viewer-model";
import { SCROLLBAR_HOLD_MS } from "@shared/lib/scrollbar-activity";
import { cn } from "@shared/lib/utils";
import {
	ChevronLeft,
	ChevronRight,
	RotateCcw,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import {
	type FC,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

/**
 * The box the picture is fitted into — on the layer and on the picture alike.
 *
 * `min(90vh, 100vh - 104px)` rather than a bare `90vh`, and the subtraction is
 * the close button's lane rather than a taste. The button is a 28px box 16px
 * from the top and right edges (see `DialogClose` below) and its focus ring
 * reaches 48px from each of them — a 2px outline at a 2px offset, measured off
 * the frames. A picture fitted to 90vh can therefore put its top-right corner
 * UNDER that ring: 0.05 x 900 = 45px of clearance against a ring that needs 48,
 * and the button's own description of the overlap as "a pixel or two" is what
 * design round 1 filed as D1-3, with QA round 1's Q-5 recording that no frame
 * carried the aspect band where it happens.
 *
 * The `min()` keeps the operator's 5% a side wherever 5% is wider than the lane
 * (any axis 1040px or longer, which is both axes of the app's default 1380x900
 * window) and takes the lane otherwise. The guaranteed clearance is then
 * `min(0.05 x axis, 52)` — and 52 clears the ring's 48 by 4px at every viewport
 * the app allows, including the 800x760 floor it enforces. The aspect frames in
 * `docs/evidence/chat-image-expand/` photograph the three bands that bound it: a
 * picture at the viewport's own aspect (the case that used to collide), a
 * portrait one, and the smallest window.
 *
 * THE SAME BOX IS NOW THE ZOOM FRAME, which is why it is written on the wrapper
 * as well as on the picture: the fitted box is the fixed window the picture is
 * enlarged INSIDE (clipped by it, panned within it), so the layer's geometry —
 * and with it the outside-click semantics the header's "Geometry" note relies
 * on — does not move when the reader zooms. The picture's own `max-*` are kept
 * on the `<img>` for the fit: the wrapper is the fitted size at zoom 1, and the
 * transform scales the picture visually without touching the wrapper.
 */
const PICTURE_BOX =
	"max-h-[min(90vh,calc(100vh-104px))] max-w-[min(90vw,calc(100vw-104px))]";

/**
 * THE STRIP LANE (design round 1, D1-4 = QA round 1's Q3). A filmstrip rides
 * `bottom-4` and needs 104px: its 78px tiles plus `py-1` measure 86, and the
 * inset adds 16 — the same number the close button's ring takes at the top.
 * Without the reservation a full-height picture loses its bottom band UNDER the
 * strip: measured on the 400x1200 portrait frame, the picture fitted to
 * y 52-848 while the strip's tiles span y 801-879, so 47px of the picture
 * across ~94% of its width was covered — and nothing could reveal it, because
 * pan is clamped so the picture always covers the frame and the strip never
 * fades. Landscape pictures are width-limited and unaffected; a portrait shrinks
 * by the lane and never sits under chrome. `208` is both lanes: 2 x 104.
 */
const PICTURE_BOX_WITH_STRIP =
	"max-h-[min(90vh,calc(100vh-208px))] max-w-[min(90vw,calc(100vw-104px))]";

/**
 * The reserved box, shared by the two states that have no picture to size
 * them: `pending` (the caller's bytes are still resolving — a carousel switch
 * onto a neighbour the cache has not warmed) and the decoded-failure fallback.
 * The layer's content box IS the picture's box (see the header), so a source
 * that never arrives leaves nothing to size it — QA round 1 induced the failure
 * and measured the layer at 1152x38, a strip of label text on an empty scrim.
 * `min-h-16 min-w-64` is the floor the fallback draws inside, and it is
 * `AttachmentFrame`'s own floor unit and the `sunken` ground the caller's copy
 * brings. It takes the box IN FORCE (the strip lane included, when a filmstrip
 * is up) so a receipt cannot sit under the strip either.
 */
const reservedBox = (box: string) =>
	cn(box, "flex min-h-16 min-w-64 items-center justify-center p-6");

/**
 * Fraction of full strength the controls rest at once the reader has been idle.
 *
 * THE FADE'S RESTING STATE IS NOT INVISIBLE, and that is the standing rule this
 * lightbox is following rather than re-deciding: the scrollbar fade was amended
 * (issue #845) so idle no longer means absent — "the thumb dims to a low-alpha
 * resting state and still goes solid on hover and during scrolling" — because a
 * control a reader must already know about is the discoverability defect the
 * operator filed against this very surface ("no controls... discoverable, not
 * hover-only-hidden"). The number is NOT `SCROLLBAR_RESTING_FLOOR` re-used: the
 * thumb's 0.45 is a colour-mix fraction measured against the grounds, and this
 * is an opacity on a cluster of buttons.
 *
 * 0.85 IS A MEASURED CONTRAST FLOOR, NOT A TASTE CALL (design round 2, D1).
 * The fade multiplies BOTH the glyph and its `surface/85` plate, and at the
 * earlier 0.45 the resting composite measured 1.67-2.25:1 worst-ground across
 * the twelve captured themes — under the 3:1 non-text floor, for controls that
 * still work (WCAG 1.4.11 exempts inactive controls, not active ones waiting
 * for a pointer). The designer composed the diminished glyph against the plate
 * over every pixel a picture can hold (pure white and pure black bound them)
 * and swept all 59 selectable palettes: the limiting threshold is ~0.84022,
 * and 0.80 fails (2.788:1 Nightfox, 2.915:1 Dracula) while 0.85 clears 3:1
 * everywhere — worst 3.05493:1 (Nightfox over white), worst of the twelve
 * captured 3.20265:1 (Dracula). The fade stays because a resting state must
 * still read as a step down from awake; it now stops above the floor instead
 * of under it. Re-derive the number if the plate stops being `surface/85`:
 * the two compose, and a different plate moves the threshold.
 *
 * AND IT WAS UNREACHABLE UNTIL DESIGN ROUND 1'S D1-2 SETTLED WHERE FOCUS GOES
 * AT OPEN. Radix's autofocus parked focus on the cluster's first control, the
 * guard below never rests while focus is inside the cluster (a focused control
 * must not dim), so the floor only ever appeared after the whole app lost
 * focus - exactly when nobody is looking. The open-focus policy in the
 * component body now anchors focus on the layer instead; the jsdom suite
 * mounts the full cycle (dim, wake on pointer, kept awake while focused).
 *
 * It is an opacity and not a colour step because it fades FIVE controls at four
 * positions at once, including their hover fills; the "disabled changes colour,
 * never opacity" rule is about disabled controls, and this is not a disabled
 * state — every control works at rest, and the next pointer move or key press
 * brings the cluster back to full inside `duration-fast`.
 */
export const CONTROLS_RESTING_CLASS = "opacity-85";

/**
 * THE CHROME'S GROUND IS A THEME ROLE, NOT THE PICTURE (design round 1, D1).
 *
 * The controls are ghost buttons, so their glyphs used to be painted straight
 * onto whatever pixels the page put behind the overlay: the light palette's Next
 * glyph measured `#4e4940` over `#241a37` = 1.84:1, under the 3:1 non-text
 * floor. A `surface` plate at 85% keeps the borderless look and makes the glyph's
 * ground a role rather than the media. Measured against the worst picture for
 * each palette (the plate blended over pure white and pure black, whose extremes
 * bound every pixel a picture can hold): dark `#c2bcaf` over `#4b4742` 4.87:1,
 * light `#4e4940` over `#d2d0ca` 5.79:1. The hover and active steps are the
 * ghost variant's own opaque `accent-wash`, unchanged; the disabled step keeps
 * the plate so an unreachable zoom step still reads as a control.
 *
 * THIS IS SHARED CHROME. The chat transcript and the project feed mount the same
 * component, so a review of this change must re-check their frames as well as
 * the Library's; only the button's ground changed, not its geometry or behaviour.
 */
const CHROME_PLATE = "bg-surface/85 disabled:bg-surface/85";

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
 * its `bg-scrim` (a per-theme role — a hardcoded black alpha is wrong in the
 * THREE light themes, `iceberg`, `localOperatorLight` and `sage`, whose scrims
 * are their own near-blacks at 0.35 alpha against the other nine themes' 0.6-0.65;
 * only `localOperatorLight`'s is warm, `iceberg`'s being a cool blue-grey — design
 * round 3, D3-2), and
 * Escape, the outside click, the focus trap and the close button are all Radix's
 * rather than a hand-rolled overlay, key handler or backdrop click.
 *
 * The close button is OURS rather than `DialogContent`'s own, and that is the
 * one thing here that looks like a duplication worth explaining. The panel's
 * button is `absolute top-4 right-4`, so it anchors to whatever box the content
 * has; here that box is the picture, which would put a 28px glyph on a small
 * image's corner. `fixed` anchors it to the viewport instead — the corner the
 * reader reaches for — and it is now one member of the controls cluster below
 * (zoom out / in / reset view / close, plus the carousel's arrows and strip),
 * every member anchored the same way for the same reason.
 *
 * The `fixed` anchor has one prerequisite: no ancestor may carry a transform.
 * A transformed ancestor makes `fixed` behave as `absolute` against it (the
 * individual `translate` properties all establish one), which would silently
 * drag the controls back onto the picture. `translate-none` on the content is
 * what upholds that, and the picture's own zoom transform is applied to the
 * `<img>` INSIDE its wrapper, never to an ancestor of the cluster. If a future
 * caller mounts this inside something transformed, the controls degrade to the
 * picture's corner rather than breaking: that is the accepted direction.
 *
 * ## The size rule
 *
 * `max-w`/`max-h` and never a width: an `<img>` constrained only by its maxima
 * renders at its intrinsic size and is never enlarged, so a 24x18 PNG stays
 * 24x18 while a 2760-wide screenshot is fitted to the viewport. The margin is
 * 5% a side, stated as 90vw/90vh — less the close button's lane, because a
 * fitted picture's corner and the button's focus ring collide at the 5% edge:
 * see `PICTURE_BOX`. Upscaling to the viewport is the other candidate rule and
 * it is rejected on purpose — a small picture blown up 40x is a blur that hides
 * nothing — but it is the design round's call to make, and the frames in
 * `docs/evidence/chat-image-expand/` exist to make it.
 *
 * ## The states, because a bare `<img>` has four once bytes come from elsewhere
 *
 * `attachment-frame.tsx` lists three for the transcript and they are here too:
 * decoding, decoded, unreadable. Decoding is now TWO states on this surface,
 * and the distinction is the carousel's doing: the transcript's picture is
 * already painted by the time a press lands on it, so the overlay shows the
 * fade rather than a spinner — but a LEFT/RIGHT switch can land on a neighbour
 * whose bytes the caller has not resolved yet, and that state is `pending`
 * (the reserved box, `aria-hidden`, no spinner for the frame's own reason).
 * Decoded is the fitted picture, and unreadable is `fallback` inside a reserved
 * box — see the branch below. The overlay is not allowed to be the ONE place a
 * picture fails to the browser's torn-page glyph, which is what a bare `<img>`
 * would do on the day the bytes do not arrive.
 *
 * ## Zoom and pan, the model in one paragraph
 *
 * Zoom steps are FIT, then 2x, 3x, 4x of the fitted size (`image-viewer-model`).
 * Zooming in/out is a discrete state change with no transition — the motion
 * budget in `branding.md` § 5 is spent on entrances, and a viewer that animates
 * a 4x jump is a viewer you wait for; the frames capture the states, not a
 * tween. Pan is a pointer drag on the picture that exists ONLY while zoomed
 * beyond fit (the clamp's range is zero at 1x, so the disable is arithmetic
 * rather than a guard — see `clampViewerPan`), it is clamped so the picture
 * always covers the frame (no rubber-banding, zero slack), and Reset returns to
 * fit and recentres. Zooming is centre-anchored rather than pointer-anchored:
 * the pointer's own position is not where a button press happened, and a
 * centre zoom is the one the buttons can be reasoned about from — the frames
 * carry the states a reader gets.
 *
 * ## The group carousel
 *
 * When the caller passes a `group`, the picture on screen is one of a set and
 * the overlay grows two pieces of chrome: L/R arrows (WRAP-AROUND — the
 * argument is in `wrapGroupIndex`) and a filmstrip of the set, drawn by the
 * CALLER as a node because the tiles are `CanonicalImage`s: a tile that has no
 * bytes yet shows the reserved box and one that cannot be fetched shows the
 * receipt, the same states the transcript's strip shows, rather than a second
 * loading UI invented for the overlay. The strip marks the current picture;
 * clicking a tile switches; ArrowLeft/ArrowRight do the same from anywhere in
 * the layer; Escape stays Radix's. Switching resets zoom and pan (a fitted
 * view per picture is the one rule a reader can predict), and the position is
 * announced through a polite live region — "Image 2 of 3" — because the
 * `DialogTitle` (the picture's own name, for screen readers and for the test
 * that pins it) does not change to a position when the set does.
 *
 * The strip and the arrows live in the same viewport-fixed cluster as the zoom
 * controls and share its fade: at rest the whole cluster sits at
 * `CONTROLS_RESTING_CLASS`, and the first pointer move, key press or focus
 * brings it back to full. The cluster is a `pointer-events-none` layer so
 * presses on the scrim still reach Radix's outside-click — each control
 * re-enables its own pointer events — and it fades as one unit so the corner
 * and the edges never disagree about being awake.
 *
 * ## Geometry, and why the caller must know this
 *
 * The content box is the PICTURE's box, not the viewport's. That is what makes
 * "a click on the scrim outside the picture" a genuine outside click for Radix:
 * the layer is the picture, the scrim around it belongs to `DialogOverlay`, and
 * the dismissal needs no `pointer-events` juggling that would silently stop
 * working the day somebody reordered a class. The zoom frame is the SAME box
 * (see `PICTURE_BOX`), so a zoomed picture never paints outside the layer the
 * press semantics were measured on. The cost is that the content is only as
 * large as the picture, which is why the controls are `fixed`.
 *
 * Driven by state the caller owns, because the caller owns the button that opens
 * it and therefore the focus this returns to. Radix's own restore targets
 * `DialogTrigger`, and there is no trigger in this composition.
 */
export type ImageLightboxProps = {
	/**
	 * The picture to show, at the same URL the transcript renders it from.
	 *
	 * Optional as of the carousel: a caller whose bytes are still resolving, or
	 * known absent, omits it and says which of the two states that is — see
	 * `pending`. Every caller that has a URL passes one, exactly as before.
	 */
	src?: string;
	/**
	 * The caller's bytes are still on their way, and `src` is omitted for it.
	 *
	 * This is the reserved box, not the failure receipt: a local blob resolves in
	 * a frame or two and a relay fetch on a cold cache is the carousel's normal
	 * path, so painting "unavailable" while an attempt is outstanding is the
	 * false statement `use-attachment-url`'s three states exist to end.
	 */
	pending?: boolean;
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
	/**
	 * What to draw when the picture will not decode. Optional, and left to the
	 * caller on purpose: this component lives in `shared/` and the attachment
	 * treatment — `BrokenAttachment` and the two sentences it can say — lives in
	 * the chat feature, so the shared component owns the STATE and the reserved
	 * box while the caller owns the copy. Every in-tree caller passes one; omitted
	 * means the reserved box is drawn empty rather than the browser's torn-page
	 * glyph, which is the failure `attachment-frame.tsx` was written to remove.
	 */
	fallback?: ReactNode;
	/**
	 * The set the picture belongs to, when the caller has one. Omitted for a
	 * solitary picture, which is the same overlay without carousel chrome; a
	 * one-member group (a row that held one picture) renders no chrome either,
	 * because there is nothing to walk — the count decides, not the caller.
	 */
	group?: ImageLightboxGroup;
	/**
	 * The dialog's own layer element, handed out for a caller that must move
	 * focus OFF the controls — the carousel's walk, when it lands on a picture
	 * whose slot has no control to take focus (design round 1, D1-3). The
	 * lightbox creates one when this is omitted, so every existing caller keeps
	 * its behaviour.
	 */
	layerRef?: RefObject<HTMLDivElement>;
	/**
	 * What the slide IS, for a gallery that mixes pictures and clips.
	 *
	 * `image` is the component's original and only behaviour, so every existing
	 * caller is unchanged by omission. `video` renders the same fitted frame
	 * with a `<video controls autoPlay>` instead of the zoomable `<img>`: the
	 * zoom ladder is an image-reading affordance (fit, 100%, 200% — no meaning
	 * for a clip with its own player controls), so a video slide takes the frame
	 * and the carousel chrome but not the zoom cluster.
	 */
	mediaKind?: "image" | "video";
	/**
	 * What the carousel calls its slides.
	 *
	 * `image` is the transcript's vocabulary and the default, so existing
	 * callers are unchanged. `asset` is for a mixed gallery (the project feed's
	 * update set): "Previous asset"/"Asset 2 of 3" stays true whether the slide
	 * is a picture or a clip, while "Previous image" would misname half of them.
	 */
	mediaLabel?: "image" | "asset";
	/**
	 * Extra attributes for the dialog's layer element.
	 *
	 * Data attributes only, and only for a caller whose capture rig or test has
	 * to tell THIS overlay from any other lightbox in the document: the
	 * component's own hooks (`data-image-viewport`, `data-image-viewer-controls`)
	 * are generic and deliberately say nothing about the surface that mounted it.
	 * Kept off the props list above because it is not behaviour.
	 */
	layerAttributes?: Partial<Record<`data-${string}`, string>>;
};

/**
 * The set descriptor the carousel runs on. The caller owns the pictures (and
 * their resolution — this component never resolves anything), so the walk is
 * two callbacks and the chrome is a node; what lives here is only the position
 * the reader is at and how many there are.
 */
export type ImageLightboxGroup = {
	/** Zero-based position of the picture on screen. */
	index: number;
	/** How many the set holds. 1 renders no carousel chrome. */
	count: number;
	/**
	 * The reader's left/right walk. Wrap-around is the caller's, through
	 * `wrapGroupIndex`, so both directions and both input paths (buttons,
	 * arrows) exercise one rule.
	 */
	onPrev: () => void;
	onNext: () => void;
	/**
	 * The strip of the set's pictures, drawn by the caller — `CanonicalImage`
	 * tiles in a list — because the reserved and missing states are the chat
	 * feature's and a second loading UI here is the defect § 9 opens with.
	 */
	filmstrip?: ReactNode;
};

export const ImageLightbox: FC<ImageLightboxProps> = ({
	src,
	label,
	open,
	onOpenChange,
	restoreFocusTo,
	fallback,
	pending = false,
	group,
	layerRef,
	mediaKind = "image",
	mediaLabel = "image",
	layerAttributes,
}) => {
	useI18nLocale();
	const isVideo = mediaKind === "video";
	const positionLabel = (index: number, count: number) =>
		mediaLabel === "asset"
			? t("ui.common.viewer.image_lightbox.asset_of", {
					index: index + 1,
					count: count,
				})
			: groupPositionLabel(index, count);
	/*
	 * WHICH PICTURE FAILED, rather than a boolean this component resets. The
	 * transcript's picture failed once and the store is content-addressed, so a
	 * second open has the same bytes to fail on and a reset on close would flash
	 * the empty layer a reader has already been told is unavailable. A carousel,
	 * though, swaps `src` under a mounted layer, and a boolean would then pin the
	 * receipt over the NEXT picture's bytes. Keying the record to the source it
	 * describes is both behaviours at once: same `src`, same receipt; new `src`,
	 * a clean decode.
	 */
	const [failedFor, setFailedFor] = useState<string | null>(null);
	const failed = src !== undefined && failedFor === src;

	/*
	 * The zoom frame's view: one step of the ladder and one pan offset, reset
	 * when the PICTURE changes (a carousel switch; the resolver landing; the
	 * caller swapping in another source) rather than when the layer closes —
	 * reopening the same picture is the same view, which is what "same bytes,
	 * same state" means here too.
	 *
	 * IN A LAYOUT EFFECT, deliberately: a passive effect would let React paint
	 * one frame of the previous picture's zoom over the new picture's first
	 * paint — the visible pop this whole surface's comments are about — while a
	 * layout effect's re-render lands before the browser paints.
	 */
	const [zoom, setZoom] = useState(VIEWER_ZOOM_MIN);
	const [pan, setPan] = useState<ViewerPan>(VIEWER_PAN_ORIGIN);
	const viewSource = useRef(src);
	useLayoutEffect(() => {
		if (viewSource.current === src) return;
		viewSource.current = src;
		setZoom(VIEWER_ZOOM_MIN);
		setPan(VIEWER_PAN_ORIGIN);
	}, [src]);

	/*
	 * Whether the controls are at full strength. One state for the whole
	 * cluster — the arrows, the strip, the zoom cluster and the close — so the
	 * surfaces cannot disagree about being awake, and the counter is reset
	 * (below) by pointer movement, key presses and focus, which is the
	 * fade-after-inactivity pattern the scrollbar fade established: a clocked
	 * hold from the last activity, with the paint itself in CSS.
	 */
	const [awake, setAwake] = useState(true);
	const controlsRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		/*
		 * Held from the LAST activity, not from the open: a reader who is
		 * dragging a zoomed picture or walking the strip is never left with a
		 * cluster that faded mid-gesture, and a reader who stops touching the
		 * layer gets the quiet state after one hold. The hold IS the scrollbar
		 * fade's own constant, imported rather than re-declared, so a future
		 * change to one chrome clock cannot leave the other behind.
		 */
		let timer: ReturnType<typeof setTimeout>;
		const arm = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				const controls = controlsRef.current;
				/*
				 * Never fade out from under a reader who is ON a control: a
				 * hovered cluster or a focused control re-arms instead. Both are
				 * read from the DOM rather than tracked in state because the
				 * browser owns `:hover` and `document.activeElement`, and a copy
				 * of either here would be the stale one.
				 */
				if (
					controls &&
					(controls.matches(":hover") ||
						controls.contains(document.activeElement))
				) {
					arm();
					return;
				}
				setAwake(false);
			}, SCROLLBAR_HOLD_MS);
		};
		const wake = () => {
			setAwake(true);
			arm();
		};
		setAwake(true);
		arm();
		/*
		 * Observational and passive, like the scrollbar module's listeners and
		 * for its reason: they decide WHEN, and nothing here reads or writes
		 * scroll or focus state. `focusin` because a Tab onto a faded control
		 * must bring the cluster back (the keyboard door the scrollbar fade's
		 * own round added), and `pointerdown` beside `pointermove` so a press
		 * that starts on a control counts as activity even when the pointer
		 * never moved.
		 */
		document.addEventListener("pointermove", wake, { passive: true });
		document.addEventListener("pointerdown", wake, { passive: true });
		document.addEventListener("keydown", wake);
		document.addEventListener("focusin", wake);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("pointermove", wake);
			document.removeEventListener("pointerdown", wake);
			document.removeEventListener("keydown", wake);
			document.removeEventListener("focusin", wake);
		};
	}, [open]);

	/*
	 * The arrow keys, on the document because the layer is modal — wherever
	 * focus sits inside it, the arrows are the reader's left/right. Modifier
	 * chords are left alone (⌘← is "back" in the app's own vocabulary and must
	 * not be swallowed here), and Escape is not handled at all: Radix owns it.
	 */
	const onPrev = group?.onPrev;
	const onNext = group?.onNext;
	const showCarousel = group !== undefined && group.count > 1;
	/*
	 * The box in force: the close button's lane, plus the strip's when a
	 * filmstrip is up (see `PICTURE_BOX_WITH_STRIP`).
	 */
	const box = showCarousel ? PICTURE_BOX_WITH_STRIP : PICTURE_BOX;
	/*
	 * WHAT TAKES FOCUS ON OPEN, and why it is not the first control.
	 *
	 * Radix's modal path autofocuses the first tabbable inside the dialog, which
	 * here is a controls-cluster button (or the strip's first tile). The fade's
	 * own guard never rests while focus is inside the cluster — by design, a
	 * focused control must not dim — so parking focus there made the resting
	 * state UNREACHABLE while the app had focus at all (design round 1, D1-2:
	 * measured live, the layer sat at `opacity-100` through minutes of idling and
	 * a 3.2s explicit hold) and left the first strip tile wearing the focus ring
	 * and its hover-revealed actions chip while another picture was current
	 * (D1-3). The layer's own anchor takes focus instead: the picture's frame
	 * when there is one, else the dialog layer — both outside the cluster, so the
	 * reader who stops touching the overlay gets the quiet state the operator
	 * asked for, and Tab still enters the cluster at its first enabled control.
	 */
	const localLayerRef = useRef<HTMLDivElement>(null);
	const layer = layerRef ?? localLayerRef;
	useEffect(() => {
		if (!open || !showCarousel) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			) {
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				onPrev?.();
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				onNext?.();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, showCarousel, onPrev, onNext]);

	/*
	 * A native `WebContentsView` paints above all DOM, so an overlay opened over
	 * the browser route is invisible unless the view is hidden. `BaseDialog` is
	 * the funnel for the dialogs that use it; this one is not a `BaseDialog` —
	 * it has no header, body or actions to divide — so it registers here, and
	 * that registration is the reason it may not be built on the primitive
	 * without it.
	 */
	useSuppressBrowserView(open, "lightbox");

	/*
	 * The zoom frame's own element, read at gesture time rather than stored:
	 * `clampViewerPan` needs the FITTED box, and the fitted box is whatever the
	 * layout just made it (a window resize moves it too), so a cached rect
	 * would be the wrong bound one resize after the cache was filled.
	 */
	const frameRef = useRef<HTMLDivElement>(null);
	// A clip's own controls are its zoom; the ladder stays an image affordance.
	const canZoom = !isVideo && src !== undefined && !failed;
	/*
	 * BY VALUE, not by reference: the pan state holds a fresh object after every
	 * drag and clamp, so `pan === VIEWER_PAN_ORIGIN` is false for a view that is
	 * at the origin — which would leave Reset enabled (and the transform written)
	 * on a picture that is already fitted and centred.
	 */
	const atFit =
		zoom === VIEWER_ZOOM_MIN &&
		pan.x === VIEWER_PAN_ORIGIN.x &&
		pan.y === VIEWER_PAN_ORIGIN.y;
	const applyZoom = (next: number) => {
		if (!canZoom) return;
		setZoom(next);
		const frame = frameRef.current;
		if (frame) {
			setPan((current) =>
				clampViewerPan(
					current,
					{ width: frame.clientWidth, height: frame.clientHeight },
					next,
				),
			);
		}
	};
	const resetView = () => {
		if (!canZoom) return;
		setZoom(VIEWER_ZOOM_MIN);
		setPan(VIEWER_PAN_ORIGIN);
	};

	/*
	 * The pan gesture, and the three things it is careful about.
	 *
	 * POINTER CAPTURE, because a drag that leaves the picture's box must keep
	 * tracking the pointer — the frame is small when zoomed and the reader's
	 * hand keeps moving; without capture the gesture ends at the box's edge.
	 *
	 * A REF rather than state for the in-flight gesture: `pointermove` fires at
	 * pointer rate and only the final pan lands in state (the clamp is pure, so
	 * lost frames are lost deltas, not lost state). The start pan is captured
	 * when the gesture begins, so the drag is delta-based and re-clamping at the
	 * walls cannot accumulate error.
	 *
	 * PRIMARY BUTTON ONLY, and no drag at fit: the clamp's range at zoom 1 is
	 * zero (see `clampViewerPan`), so the guard here is the button and the
	 * capture, not the bound.
	 */
	const drag = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		pan: ViewerPan;
	} | null>(null);
	const [dragging, setDragging] = useState(false);
	const canPan = canZoom && zoom > VIEWER_ZOOM_MIN;
	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!canPan || event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			pan,
		};
		setDragging(true);
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const gesture = drag.current;
		const frame = frameRef.current;
		if (!gesture || gesture.pointerId !== event.pointerId || !frame) return;
		setPan(
			clampViewerPan(
				{
					x: gesture.pan.x + (event.clientX - gesture.startX),
					y: gesture.pan.y + (event.clientY - gesture.startY),
				},
				{ width: frame.clientWidth, height: frame.clientHeight },
				zoom,
			),
		);
	};
	const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (drag.current?.pointerId !== event.pointerId) return;
		drag.current = null;
		setDragging(false);
	};

	/*
	 * The picture, in the three states the bytes can be in (see the header):
	 * ready is the zoom frame — a clipping wrapper holding the `<img>`, which is
	 * what lets a scaled picture be panned inside a fixed window while the
	 * layer's own box stays the fitted one; `pending` is the reserved box,
	 * empty and `aria-hidden` because the picture's own button names it the
	 * moment it arrives; anything else is the caller's fallback. The
	 * `draggable={false}` is not decoration: a browser-native image drag would
	 * start its own ghost during a pan and swallow the gesture.
	 */
	const picture =
		src !== undefined && !failed ? (
			<div
				ref={frameRef}
				data-image-viewport=""
				/*
				 * A focus ANCHOR, not a tab stop: the open-focus policy above parks
				 * focus here, and `outline-none` keeps that parking from painting a
				 * ring — the reader never asked for this element, and the global
				 * `:focus-visible` rule would otherwise draw one around the picture
				 * the moment the open came from the keyboard.
				 */
				tabIndex={-1}
				className={cn(
					box,
					/*
					 * The clipping window itself: `overflow-hidden` is what keeps a
					 * zoomed picture inside the box the outside-click geometry was
					 * measured against, and `leading-none` collapses the line box a
					 * replaced element would otherwise sit in (the strip's own note
					 * measured that strut at 4.7px and it would show here as margin).
					 * `w-fit h-fit` shrink-wraps the window to the picture's fitted box
					 * rather than relying on the dialog's grid track to size it, so the
					 * wrapper is the fitted size wherever a future caller mounts it.
					 */
					"relative h-fit w-fit overflow-hidden leading-none outline-none",
					canPan && (dragging ? "cursor-grabbing" : "cursor-grab"),
					canPan && "touch-none",
				)}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endPan}
				onPointerCancel={endPan}
			>
				{isVideo ? (
					/*
					 * The clip sits in the SAME fitted box the picture uses, so a mixed
					 * gallery does not change frame between slides. No zoom transform: a
					 * scaled video would scale its controls too, and the reader's own
					 * fullscreen control is the larger view.
					 */
					// biome-ignore lint/a11y/useMediaCaption: a project attachment's own audio is the content; no caption track is stored with it.
					<video
						src={src}
						controls
						autoPlay
						className={cn(box, "block object-contain")}
						data-lightbox-video=""
						onError={() => setFailedFor(src)}
					>
						{label}
					</video>
				) : (
					<img
						src={src}
						alt={label}
						draggable={false}
						className={cn(box, "block select-none object-contain")}
						/*
						 * No transform at fit and origin, so the resting DOM is exactly
						 * the one the pre-zoom frames measured; the transform appears
						 * only once the view has something to say.
						 */
						style={
							atFit
								? undefined
								: {
										transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
									}
						}
						onError={() => setFailedFor(src)}
					/>
				)}
			</div>
		) : src === undefined && pending ? (
			/* The bytes are on their way: an empty reserved box, `aria-hidden` because
			   there is nothing to announce yet — the same reserved state the
			   transcript's strip draws, and the same reason it draws no spinner. */
			<div className={reservedBox(box)} aria-hidden="true" />
		) : (
			/*
			 * The caller's fallback, for both halves of unreadable: a source that
			 * cannot be resolved (`src` omitted, not pending) and one that failed to
			 * decode (`onError` on the picture above). The transcript's copy of a
			 * failed picture is not a button at all — it draws `BrokenAttachment` and
			 * nothing to press — so what this catches is the press landing before the
			 * picture decodes, and a source that dies between the press and the paint.
			 */
			<div className={reservedBox(box)}>{fallback}</div>
		);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				/*
				 * The layer ref + the open-focus policy: see `box`'s neighbour note in
				 * the component body — the anchor takes focus so the cluster can rest
				 * and no strip tile wears a ring the walk did not put there.
				 */
				ref={layer}
				tabIndex={-1}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					(frameRef.current ?? layer.current)?.focus();
				}}
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
					"inset-0 top-0 left-0 m-auto h-fit w-fit translate-none outline-none",
					// The fit box, with the close button's lane taken off it: see
					// `PICTURE_BOX` and `PICTURE_BOX_WITH_STRIP`.
					box,
					// Every panel clothes the primitive puts on, removed. `p-0` is
					// load-bearing rather than tidy: padding would enlarge the content
					// box past the picture, and the click-outside region would grow with
					// it. `border-transparent` is not redundancy beside `border-0` —
					// tailwind-merge drops the earlier width and keeps the earlier
					// COLOUR, which this is the only way to take off.
					"gap-0 rounded-none border-0 border-transparent bg-transparent p-0 shadow-none",
				)}
				{...layerAttributes}
			>
				<DialogTitle className="sr-only">{label}</DialogTitle>
				{showCarousel && group ? (
					/*
					 * Position as a polite announcement, because the title above is
					 * the picture's NAME and stays that — it is what the dialog is
					 * called, and the round that required it asserts the equality. A
					 * switch changes this node alone, which is what a screen reader
					 * hears: "Image 2 of 3", the same sentence the strip marks
					 * visually.
					 */
					<div aria-live="polite" className="sr-only">
						{positionLabel(group.index, group.count)}
					</div>
				) : null}
				{picture}
				{/*
				 * THE CONTROLS CLUSTER. One viewport-fixed layer for four
				 * positions — close top-right, arrows centred on each edge, the
				 * carousel's strip bottom-centre, zoom bottom-right — because they
				 * share one awake state and are one thing to a reader ("the chrome
				 * over the picture"). The layer itself is `pointer-events-none`, so
				 * every press that is not ON a control passes through to the scrim
				 * and Radix's outside click still works; each control re-enables
				 * its own events.
				 */}
				<div
					ref={controlsRef}
					data-image-viewer-controls=""
					className={cn(
						"pointer-events-none fixed inset-0 transition-opacity ease-out-quart",
						// The two directions take their duration from the after-change
						// style, the scrollbar fade's own split: arriving is the shorter
						// half (`duration-fast`), leaving is the slower one.
						awake
							? "opacity-100 duration-fast"
							: `${CONTROLS_RESTING_CLASS} duration-base`,
					)}
				>
					{showCarousel && group?.filmstrip ? (
						<div className="pointer-events-auto fixed inset-x-0 bottom-4 mx-auto w-fit max-w-[calc(100vw-256px)]">
							{group.filmstrip}
						</div>
					) : null}
					{showCarousel ? (
						<>
							{/*
							 * The arrows NEVER disable, because the walk wraps (the
							 * argument is in `wrapGroupIndex`): a disabled control cannot
							 * hold focus, so an end stop would drop a keyboard reader's
							 * focus to `<body>` the moment a press landed on it, and the
							 * filmstrip already says where in the set the reader is.
							 * Centred by auto margins rather than a transform, the same
							 * reason the content is (`fixed` + `my-auto` + the button's own
							 * height). The lane arithmetic does not move: `PICTURE_BOX`
							 * guarantees `min(5% of the axis, 52px)` of margin, and the
							 * arrow's ring reaches 48.
							 */}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.common.viewer.image_lightbox.previous", {
									medialabel: mediaLabel,
								})}
								title={t("ui.common.viewer.image_lightbox.previous", {
									medialabel: mediaLabel,
								})}
								onClick={group?.onPrev}
								className={cn(
									"pointer-events-auto fixed top-0 bottom-0 left-4 my-auto",
									CHROME_PLATE,
								)}
								data-image-viewer-prev=""
							>
								<ChevronLeft aria-hidden="true" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.common.viewer.image_lightbox.next", {
									medialabel: mediaLabel,
								})}
								title={t("ui.common.viewer.image_lightbox.next", {
									medialabel: mediaLabel,
								})}
								onClick={group?.onNext}
								className={cn(
									"pointer-events-auto fixed top-0 right-4 bottom-0 my-auto",
									CHROME_PLATE,
								)}
								data-image-viewer-next=""
							>
								<ChevronRight aria-hidden="true" />
							</Button>
						</>
					) : null}
					{!isVideo && (
						<div className="pointer-events-auto fixed right-4 bottom-4 flex items-center gap-1">
							{/*
							 * Disabled is a COLOUR step on the shared button (see its
							 * `ghost` variant), never an opacity, and the three disabled
							 * states fall out of the view's own arithmetic rather than out
							 * of a mode: no zoom-out below fit, no zoom-in past the ladder's
							 * top, nothing for Reset when the view is already fit and
							 * centred.
							 */}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.common.viewer.zoom_out")}
								title={t("ui.common.viewer.zoom_out")}
								disabled={!canZoom || zoom === VIEWER_ZOOM_MIN}
								onClick={() => applyZoom(stepZoom(zoom, -1))}
								className={CHROME_PLATE}
							>
								<ZoomOut aria-hidden="true" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.common.viewer.zoom_in")}
								title={t("ui.common.viewer.zoom_in")}
								disabled={!canZoom || zoom === VIEWER_ZOOM_MAX}
								onClick={() => applyZoom(stepZoom(zoom, 1))}
								className={CHROME_PLATE}
							>
								<ZoomIn aria-hidden="true" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.common.viewer.reset_view")}
								title={t("ui.common.viewer.reset_view")}
								disabled={!canZoom || atFit}
								onClick={resetView}
								className={CHROME_PLATE}
							>
								<RotateCcw aria-hidden="true" />
							</Button>
						</div>
					)}
					<DialogClose asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							className={cn(
								"pointer-events-auto fixed top-4 right-4",
								CHROME_PLATE,
							)}
							aria-label={t("ui.common.viewer.image_lightbox.close", {
								medialabel: mediaLabel,
							})}
							title={t("ui.common.viewer.image_lightbox.close", {
								medialabel: mediaLabel,
							})}
						>
							<X aria-hidden="true" />
						</Button>
					</DialogClose>
				</div>
			</DialogContent>
		</Dialog>
	);
};

ImageLightbox.displayName = "ImageLightbox";
