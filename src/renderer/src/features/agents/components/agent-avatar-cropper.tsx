/**
 * The square crop step of an agent's profile picture: drag to pan,
 * wheel/slider/buttons to zoom over 1-4x, recenter, and live previews at the
 * sizes the app actually draws the picture.
 *
 * PORTED, NOT INVENTED. The behaviour is the Radient console's account cropper
 * (`radient-ml/user-console/src/components/account/avatar-cropper.tsx`), which
 * the operator named as the editor to match: hand-rolled, no crop dependency,
 * a "cover" fit times a zoom multiplier with the offset clamped so the square is
 * never left with empty space. The maths lives in
 * `shared/agent-avatar/crop-geometry.ts` so it is asserted in Node; this file is
 * the canvases, the gestures and the copy.
 *
 * PREVIEWS ARE THE POINT. The three live previews draw the EXACT crop at the
 * header's, the sidebar row's and the roster's box sizes. A cropper that
 * previews at one size and ships another is how a face ends up cut in the one
 * place nobody checked - and the sidebar row's 16px is where that happens.
 *
 * KEYBOARD. The crop square is focusable: arrows pan, + / - zoom, 0 recenters.
 * The slider is the primary control for assistive tech and every button has a
 * name, so nothing here needs a pointer.
 *
 * OUTPUT. One 512x512 PNG (the contract's stored edge) - PNG so a transparent
 * logo stays transparent. Core re-normalises whatever it is sent and owns the
 * 1 MiB cap (it falls back to JPEG itself), so this step does not re-encode.
 */

import {
	CROP_KEYBOARD_PAN,
	CROP_MAX_ZOOM,
	CROP_MIN_ZOOM,
	CROP_OUTPUT_EDGE,
	CROP_ZOOM_STEP,
	type CropOffset,
	centredOffset,
	clampOffset,
	drawRect,
	zoomAround,
} from "@shared/agent-avatar/crop-geometry";
import { AgentAvatar, Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

/** The crop square's edge in CSS pixels (the console's 288). */
const VIEWPORT = 288;

/**
 * The sizes the app draws an agent's picture at, each with its surface's own
 * box, so the previews are the real thing rather than a generic thumbnail.
 *
 * THE IDS ARE THE SURFACES' OWN, in the order a picture is met - but two of the
 * names no longer say what their box is, and this note is the record (agent
 * review round 1, n2): `header` is the chat header's mark (20px), `sidebar` is
 * a conversation row's mark (16px), and `roster` is the AGENTS LIST sidebar's
 * row disc (32px) - the id kept from the roster row it was measured for, while
 * its copy and caption have named the surface it previews since, "Agents list".
 * Renaming the id would rewrite three catalogue keys in eight locales to say
 * what this paragraph says.
 */
export const AGENT_AVATAR_PREVIEW_SIZES = [
	{ id: "header", px: 20 },
	{ id: "sidebar", px: 16 },
	{ id: "roster", px: 32 },
] as const;

type PreviewId = (typeof AGENT_AVATAR_PREVIEW_SIZES)[number]["id"];

/*
 * Each preview's name and caption, spelled out per key: the typed catalogue
 * rejects a computed key, and that check is what keeps a renamed preview from
 * shipping an untranslated label.
 */
const previewCopy: Record<
	PreviewId,
	{ label: () => string; caption: () => string }
> = {
	header: {
		label: () => t("ui.agents.avatar.editor.preview_header"),
		caption: () => t("ui.agents.avatar.editor.preview_header_caption"),
	},
	sidebar: {
		label: () => t("ui.agents.avatar.editor.preview_sidebar"),
		caption: () => t("ui.agents.avatar.editor.preview_sidebar_caption"),
	},
	roster: {
		label: () => t("ui.agents.avatar.editor.preview_roster"),
		caption: () => t("ui.agents.avatar.editor.preview_roster_caption"),
	},
};

/** The drawable a crop is cut from: a decoded bitmap, or an image in a story. */
export type CropSource = CanvasImageSource & { width: number; height: number };

function paint(
	canvas: HTMLCanvasElement | null,
	source: CropSource,
	zoom: number,
	offset: CropOffset,
	target: number,
): void {
	if (!canvas) return;
	// Device pixels, so a 16px preview on a 2x display is drawn at 32 and is as
	// sharp as the surface it predicts.
	const ratio = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
	const edge = target * ratio;
	if (canvas.width !== edge) canvas.width = edge;
	if (canvas.height !== edge) canvas.height = edge;
	const context = canvas.getContext("2d");
	if (!context) return;
	const rect = drawRect(source, VIEWPORT, zoom, offset, edge);
	context.clearRect(0, 0, edge, edge);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(source, rect.dx, rect.dy, rect.dw, rect.dh);
}

/** The crop as a 512px PNG blob, or null when the canvas cannot encode. */
export async function renderAgentAvatarCrop(
	source: CropSource,
	zoom: number,
	offset: CropOffset,
): Promise<Blob | null> {
	const canvas = document.createElement("canvas");
	canvas.width = CROP_OUTPUT_EDGE;
	canvas.height = CROP_OUTPUT_EDGE;
	const context = canvas.getContext("2d");
	if (!context) return null;
	const rect = drawRect(source, VIEWPORT, zoom, offset, CROP_OUTPUT_EDGE);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(source, rect.dx, rect.dy, rect.dw, rect.dh);
	return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export type AgentAvatarCropperProps = {
	source: CropSource;
	/** Called with the 512px PNG. The caller owns the upload and its state. */
	onSave: (blob: Blob) => void;
	onCancel: () => void;
	/** True for the WHOLE upload, so Save cannot send a second PUT. */
	saving?: boolean;
	/** The failure to state beside the buttons (an encode or an upload). */
	error?: string | null;
	/** Initial framing, for stories that show a panned/zoomed state. */
	initialZoom?: number;
	initialOffset?: CropOffset;
	/**
	 * Receives the crop square, so a deep link can focus it. A mutable box rather
	 * than a `RefObject`: this component WRITES it (React 19 types the latter's
	 * `current` read-only, which is right for a ref the component only reads).
	 */
	viewportRef?: { current: HTMLCanvasElement | null };
};

export function AgentAvatarCropper({
	source,
	onSave,
	onCancel,
	saving = false,
	error = null,
	initialZoom = CROP_MIN_ZOOM,
	initialOffset,
	viewportRef,
}: AgentAvatarCropperProps) {
	useI18nLocale();
	const instructionsId = useId();
	const [zoom, setZoom] = useState(initialZoom);
	const [offset, setOffset] = useState<CropOffset>(() =>
		clampOffset(
			source,
			VIEWPORT,
			initialZoom,
			initialOffset ?? centredOffset(source, VIEWPORT, initialZoom),
		),
	);
	const [encoding, setEncoding] = useState(false);
	const [encodeFailed, setEncodeFailed] = useState(false);
	const ownViewport = useRef<HTMLCanvasElement | null>(null);
	const previews = useRef<Record<PreviewId, HTMLCanvasElement | null>>({
		header: null,
		sidebar: null,
		roster: null,
	});
	const drag = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		origin: CropOffset;
		latest: { x: number; y: number };
	} | null>(null);
	const framePending = useRef(false);
	/*
	 * The wheel listener is bound once with `passive: false` (a React `onWheel`
	 * is passive and cannot stop the page scrolling under the square), so it
	 * reads the latest zoom/offset through refs rather than closing over a
	 * render's values.
	 */
	const live = useRef({ zoom, offset });
	live.current = { zoom, offset };

	const setViewport = useCallback(
		(node: HTMLCanvasElement | null) => {
			ownViewport.current = node;
			if (viewportRef) viewportRef.current = node;
		},
		[viewportRef],
	);

	const applyZoom = useCallback(
		(next: number) => {
			const result = zoomAround(
				source,
				VIEWPORT,
				live.current.zoom,
				next,
				live.current.offset,
			);
			setZoom(result.zoom);
			setOffset(result.offset);
		},
		[source],
	);

	const recenter = useCallback(() => {
		setOffset(centredOffset(source, VIEWPORT, live.current.zoom));
	}, [source]);

	/*
	 * A NEW SOURCE STARTS FRAMED AT 1x, CENTRED - and only a new source resets it.
	 * The initial values exist for stories that show a panned/zoomed state, so they
	 * are the starting point rather than live inputs: listing them as dependencies
	 * would re-frame the square whenever a parent re-rendered with a fresh object,
	 * which for the real editor is a re-render of the pane under the person's hands.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: seeding, not reacting (see above).
	useEffect(() => {
		setZoom(initialZoom);
		setOffset(
			clampOffset(
				source,
				VIEWPORT,
				initialZoom,
				initialOffset ?? centredOffset(source, VIEWPORT, initialZoom),
			),
		);
	}, [source]);

	useEffect(() => {
		const canvas = ownViewport.current;
		if (!canvas) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			applyZoom(live.current.zoom - event.deltaY * 0.002);
		};
		canvas.addEventListener("wheel", onWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", onWheel);
	}, [applyZoom]);

	// ONE draw path for the square and every preview: they must never disagree.
	useEffect(() => {
		paint(ownViewport.current, source, zoom, offset, VIEWPORT);
		for (const preview of AGENT_AVATAR_PREVIEW_SIZES) {
			paint(previews.current[preview.id], source, zoom, offset, preview.px);
		}
	}, [source, zoom, offset]);

	const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: offset,
			latest: { x: event.clientX, y: event.clientY },
		};
	};

	const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
		const active = drag.current;
		if (!active || active.pointerId !== event.pointerId) return;
		active.latest = { x: event.clientX, y: event.clientY };
		// One redraw per frame: pointermove outpaces the screen, and each redraw
		// draws the full source four times (the square and three previews).
		if (framePending.current) return;
		framePending.current = true;
		requestAnimationFrame(() => {
			framePending.current = false;
			const current = drag.current;
			if (!current) return;
			setOffset(
				clampOffset(source, VIEWPORT, live.current.zoom, {
					x: current.origin.x + (current.latest.x - current.startX),
					y: current.origin.y + (current.latest.y - current.startY),
				}),
			);
		});
	};

	const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
		if (drag.current?.pointerId === event.pointerId) drag.current = null;
	};

	const pan = (dx: number, dy: number) =>
		setOffset((current) =>
			clampOffset(source, VIEWPORT, zoom, {
				x: current.x + dx,
				y: current.y + dy,
			}),
		);

	const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
		const actions: Record<string, () => void> = {
			// The console's direction: an arrow moves the PICTURE that way, the
			// same thing a drag in that direction does.
			ArrowLeft: () => pan(-CROP_KEYBOARD_PAN, 0),
			ArrowRight: () => pan(CROP_KEYBOARD_PAN, 0),
			ArrowUp: () => pan(0, -CROP_KEYBOARD_PAN),
			ArrowDown: () => pan(0, CROP_KEYBOARD_PAN),
			"+": () => applyZoom(zoom + CROP_ZOOM_STEP),
			"=": () => applyZoom(zoom + CROP_ZOOM_STEP),
			"-": () => applyZoom(zoom - CROP_ZOOM_STEP),
			"0": recenter,
		};
		const action = actions[event.key];
		if (!action) return;
		event.preventDefault();
		action();
	};

	const save = async () => {
		// `aria-disabled` keeps focus on the button during an upload, so the
		// guard is here: a second press must not send a second PUT.
		if (saving || encoding) return;
		setEncoding(true);
		setEncodeFailed(false);
		try {
			const blob = await renderAgentAvatarCrop(source, zoom, offset);
			if (!blob) {
				setEncodeFailed(true);
				return;
			}
			onSave(blob);
		} finally {
			setEncoding(false);
		}
	};

	const busy = saving || encoding;
	const fill = `${((zoom - CROP_MIN_ZOOM) / (CROP_MAX_ZOOM - CROP_MIN_ZOOM)) * 100}%`;
	const shownError = encodeFailed
		? t("ui.agents.avatar.editor.error_encode")
		: error;

	return (
		<div
			className="@container flex flex-col gap-4"
			data-agent-avatar-cropper=""
		>
			<div className="flex flex-col gap-4 @md:flex-row @md:items-start">
				<div className="flex flex-col gap-2">
					{/*
					 * A FOCUSABLE REGION, NOT A PICTURE (agent review round 1, n4). This was
					 * `role="img"` - a leaf role a screen reader announces as a static
					 * picture - on the one element that carries the pan/zoom keys, which told
					 * a reader the widget could not be operated moments after the keyboard
					 * operated it. `role="group"` names what it contains and leaves the keys
					 * where they are (the same reading `mesh-canvas.tsx` states for the same
					 * shape); the `aria-describedby` instructions stay the operating manual.
					 *
					 * The suppression is the rule's own shape, not a disagreement with it: the
					 * canvas is interactive ONLY because this tab stop makes the keys
					 * reachable, and the group role is what gives it a name.
					 */}
					{/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: the tab stop exists so the pan/zoom keys are reachable (WCAG 2.1.1), and `role="group"` supplies the name a static `img` role would lie about - see the note above. */}
					<canvas
						ref={setViewport}
						tabIndex={0}
						role="group"
						aria-label={t("ui.agents.avatar.editor.crop_area")}
						aria-describedby={instructionsId}
						data-agent-avatar-crop=""
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
						onKeyDown={onKeyDown}
						style={{ width: VIEWPORT, height: VIEWPORT }}
						className="cursor-grab touch-none rounded-sm border border-control bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 active:cursor-grabbing"
					/>
					<p id={instructionsId} className="max-w-72 text-ink-dim text-meta">
						{t("ui.agents.avatar.editor.instructions", {
							width: String(source.width),
							height: String(source.height),
						})}
					</p>
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<div className="flex flex-col gap-2">
						<span className="text-ink-muted text-meta">
							{t("ui.agents.avatar.editor.zoom")}
						</span>
						<div className="flex max-w-xs items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="icon-sm"
								aria-label={t("ui.agents.avatar.editor.zoom_out")}
								onClick={() => applyZoom(zoom - CROP_ZOOM_STEP)}
								disabled={zoom <= CROP_MIN_ZOOM}
							>
								<Minus aria-hidden="true" />
							</Button>
							<input
								type="range"
								min={CROP_MIN_ZOOM}
								max={CROP_MAX_ZOOM}
								step={0.01}
								value={zoom}
								onChange={(event) => applyZoom(Number(event.target.value))}
								aria-label={t("ui.agents.avatar.editor.zoom")}
								aria-valuetext={t("ui.agents.avatar.editor.zoom_value", {
									value: zoom.toFixed(2),
								})}
								style={{ "--fill": fill } as CSSProperties}
								className={
									/* The app's one slider look (`window-glass-setting.tsx`):
									   accent to the fill, sunken past it, a round accent thumb. */
									"h-4 w-full cursor-pointer appearance-none bg-transparent bg-center bg-no-repeat " +
									"bg-[length:100%_6px] " +
									"bg-[linear-gradient(to_right,var(--color-accent)_0_var(--fill),var(--color-sunken)_var(--fill)_100%)] " +
									"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent " +
									"[&::-webkit-slider-thumb]:hover:bg-accent-hover"
								}
							/>
							<Button
								type="button"
								variant="secondary"
								size="icon-sm"
								aria-label={t("ui.agents.avatar.editor.zoom_in")}
								onClick={() => applyZoom(zoom + CROP_ZOOM_STEP)}
								disabled={zoom >= CROP_MAX_ZOOM}
							>
								<Plus aria-hidden="true" />
							</Button>
						</div>
						<span className="text-ink-dim text-meta tabular-nums">
							{t("ui.agents.avatar.editor.zoom_value", {
								value: zoom.toFixed(2),
							})}
						</span>
					</div>

					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={recenter}
						className="w-fit"
					>
						<RotateCcw aria-hidden="true" />
						{t("ui.agents.avatar.editor.recenter")}
					</Button>

					{/* The sizes the app actually draws this picture at. */}
					<div className="flex flex-col gap-2">
						<span className="text-ink-muted text-meta">
							{t("ui.agents.avatar.editor.previews")}
						</span>
						<div className="flex items-end gap-4">
							{AGENT_AVATAR_PREVIEW_SIZES.map((preview) => (
								<figure
									key={preview.id}
									className="m-0 flex flex-col items-center gap-1"
									data-agent-avatar-preview={preview.id}
								>
									<AgentAvatar
										style={{ width: preview.px, height: preview.px }}
									>
										<canvas
											ref={(node) => {
												previews.current[preview.id] = node;
											}}
											role="img"
											aria-label={previewCopy[preview.id].label()}
											className="size-full"
										/>
									</AgentAvatar>
									<figcaption className="text-ink-dim text-meta">
										{previewCopy[preview.id].caption()}
									</figcaption>
								</figure>
							))}
						</div>
					</div>
				</div>
			</div>

			{shownError ? (
				<p role="alert" className="text-danger text-meta">
					{shownError}
				</p>
			) : null}

			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="primary"
					size="sm"
					onClick={() => void save()}
					aria-disabled={busy}
					aria-busy={busy || undefined}
					className="aria-disabled:text-ink-disabled!"
					data-agent-avatar-save=""
				>
					{busy
						? t("ui.agents.avatar.editor.saving")
						: t("ui.agents.avatar.editor.save")}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onCancel}
					disabled={busy}
				>
					{t("ui.common.actions.cancel")}
				</Button>
			</div>
		</div>
	);
}
