/** Identity-neutral crop interaction shared by human and agent editors.
 * Callers own copy, preview semantics, output size and persistence. No identity
 * or storage reaches this component, so a person photo cannot become an agent. */
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
import { Button } from "@shared/components/ui";
import {
	dispatchWhileCurrent,
	useMutationLifetime,
} from "@shared/lib/mutation-lifetime";
import { cn } from "@shared/lib/utils";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

const VIEWPORT = 288;

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
export async function renderAvatarCrop(
	source: CropSource,
	zoom: number,
	offset: CropOffset,
	edge = CROP_OUTPUT_EDGE,
): Promise<Blob | null> {
	const canvas = document.createElement("canvas");
	canvas.width = edge;
	canvas.height = edge;
	const context = canvas.getContext("2d");
	if (!context) return null;
	const rect = drawRect(source, VIEWPORT, zoom, offset, edge);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(source, rect.dx, rect.dy, rect.dw, rect.dh);
	return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export type AvatarCropperCopy = {
	cropArea: string;
	instructions: (width: number, height: number) => string;
	zoom: string;
	zoomOut: string;
	zoomIn: string;
	zoomValue: (value: string) => string;
	recenter: string;
	previews: string;
	save: string;
	saving: string;
	cancel: string;
	errorEncode: string;
};
export type AvatarCropPreview = {
	id: string;
	px: number;
	label: string;
	caption: string;
};

export type AvatarCropperProps = {
	copy: AvatarCropperCopy;
	previewSizes: readonly AvatarCropPreview[];
	outputEdge?: number;
	/** The caller's actual frame, so agent borders and human photos stay distinct. */
	previewFrame?: (children: ReactNode, edge: number) => ReactNode;
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

export function AvatarCropper({
	source,
	onSave,
	onCancel,
	saving = false,
	error = null,
	initialZoom = CROP_MIN_ZOOM,
	initialOffset,
	viewportRef,
	copy,
	previewSizes,
	outputEdge = CROP_OUTPUT_EDGE,
	previewFrame = (children, edge) => (
		<span
			className="inline-flex shrink-0 overflow-hidden rounded-full"
			style={{ width: edge, height: edge }}
		>
			{children}
		</span>
	),
}: AvatarCropperProps) {
	const instructionsId = useId();
	const lifetime = useMutationLifetime(source);
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
	const previews = useRef<Record<string, HTMLCanvasElement | null>>({});
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
	const busy = saving || encoding;
	const live = useRef({ zoom, offset, busy });
	live.current = { zoom, offset, busy };

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
		setEncoding(false);
		setEncodeFailed(false);
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
			// The page still must not scroll under the square, but the frame is locked.
			event.preventDefault();
			if (live.current.busy) return;
			applyZoom(live.current.zoom - event.deltaY * 0.002);
		};
		canvas.addEventListener("wheel", onWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", onWheel);
	}, [applyZoom]);

	// ONE draw path for the square and every preview: they must never disagree.
	useEffect(() => {
		paint(ownViewport.current, source, zoom, offset, VIEWPORT);
		for (const preview of previewSizes) {
			paint(previews.current[preview.id], source, zoom, offset, preview.px);
		}
	}, [source, zoom, offset, previewSizes]);

	/*
	 * THE FRAME IS LOCKED WHILE THE UPLOAD IS IN FLIGHT, on the canvas as well as
	 * the buttons (design review round 1 D7, agent review round 2 m-D). The bytes
	 * being sent are the ones the frame produced when Save was pressed, so a drag,
	 * an arrow, `0` or the wheel mid-upload would leave the person looking at a
	 * crop that is not the one saved. A drag already begun when Save is pressed is
	 * dropped rather than finished.
	 */
	const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
		if (busy) return;
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
		if (busy) {
			drag.current = null;
			return;
		}
		active.latest = { x: event.clientX, y: event.clientY };
		// One redraw per frame: pointermove outpaces the screen, and each redraw
		// draws the full source four times (the square and three previews).
		if (framePending.current) return;
		framePending.current = true;
		requestAnimationFrame(() => {
			framePending.current = false;
			const current = drag.current;
			if (!current || live.current.busy) return;
			setOffset(
				clampOffset(source, VIEWPORT, live.current.zoom, {
					x:
						current.origin.x +
						((current.latest.x - current.startX) * VIEWPORT) /
							Math.max(
								1,
								ownViewport.current?.getBoundingClientRect().width ?? VIEWPORT,
							),
					y:
						current.origin.y +
						((current.latest.y - current.startY) * VIEWPORT) /
							Math.max(
								1,
								ownViewport.current?.getBoundingClientRect().height ?? VIEWPORT,
							),
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
		// Tab and the rest still move focus; only the framing keys are locked.
		if (busy) return;
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
		const ticket = lifetime.capture();
		try {
			await dispatchWhileCurrent(
				lifetime,
				ticket,
				() => renderAvatarCrop(source, zoom, offset, outputEdge),
				(blob) => {
					if (blob) onSave(blob);
					else setEncodeFailed(true);
				},
			);
		} finally {
			if (lifetime.isCurrent(ticket)) setEncoding(false);
		}
	};

	const fill = `${((zoom - CROP_MIN_ZOOM) / (CROP_MAX_ZOOM - CROP_MIN_ZOOM)) * 100}%`;
	const shownError = encodeFailed ? copy.errorEncode : error;

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
						aria-label={copy.cropArea}
						aria-describedby={instructionsId}
						data-agent-avatar-crop=""
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
						onKeyDown={onKeyDown}
						style={{
							width: VIEWPORT,
							height: "auto",
							maxWidth: "100%",
							aspectRatio: "1",
						}}
						className={cn(
							"touch-none rounded-sm border border-control bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
							busy
								? "cursor-not-allowed"
								: "cursor-grab active:cursor-grabbing",
						)}
					/>
					<p id={instructionsId} className="max-w-72 text-ink-dim text-meta">
						{copy.instructions(source.width, source.height)}
					</p>
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<div className="flex flex-col gap-2">
						<span className="text-ink-muted text-meta">{copy.zoom}</span>
						<div className="flex max-w-xs items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="icon-sm"
								aria-label={copy.zoomOut}
								onClick={() => applyZoom(zoom - CROP_ZOOM_STEP)}
								/*
								 * LOCKED WHILE THE UPLOAD IS IN FLIGHT (design review round 1, D7).
								 * The bytes being sent are the ones this frame produced at the moment
								 * Save was pressed, so a re-frame mid-upload would leave the person
								 * looking at a crop that is not the one being saved. The controls stay
								 * rendered - they are where the next framing starts - but inert until
								 * the answer lands.
								 */
								disabled={busy || zoom <= CROP_MIN_ZOOM}
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
								disabled={busy}
								aria-label={copy.zoom}
								aria-valuetext={copy.zoomValue(zoom.toFixed(2))}
								style={{ "--fill": fill } as CSSProperties}
								className={
									/* The app's one slider look (`window-glass-setting.tsx`):
									   accent to the fill, sunken past it, a round accent thumb. */
									"h-4 w-full cursor-pointer appearance-none bg-transparent bg-center bg-no-repeat disabled:cursor-not-allowed " +
									"bg-[length:100%_6px] " +
									"bg-[linear-gradient(to_right,var(--color-accent)_0_var(--fill),var(--color-sunken)_var(--fill)_100%)] " +
									"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent " +
									"[&::-webkit-slider-thumb]:hover:bg-accent-hover " +
									/* DISABLED CHANGES COLOUR, NEVER OPACITY (`docs/branding.md`; design
									   review round 2, D8): while saving the thumb and the filled run
									   take the disabled ink, so the one control that stayed accent
									   no longer looks live. */
									"disabled:[&::-webkit-slider-thumb]:bg-ink-disabled disabled:[&::-webkit-slider-thumb]:hover:bg-ink-disabled " +
									"disabled:bg-[linear-gradient(to_right,var(--color-ink-disabled)_0_var(--fill),var(--color-sunken)_var(--fill)_100%)]"
								}
							/>
							<Button
								type="button"
								variant="secondary"
								size="icon-sm"
								aria-label={copy.zoomIn}
								onClick={() => applyZoom(zoom + CROP_ZOOM_STEP)}
								disabled={busy || zoom >= CROP_MAX_ZOOM}
							>
								<Plus aria-hidden="true" />
							</Button>
						</div>
						<span className="text-ink-dim text-meta tabular-nums">
							{copy.zoomValue(zoom.toFixed(2))}
						</span>
					</div>

					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={recenter}
						disabled={busy}
						className="w-fit"
					>
						<RotateCcw aria-hidden="true" />
						{copy.recenter}
					</Button>

					{/* The sizes the app actually draws this picture at. */}
					<div className="flex flex-col gap-2">
						<span className="text-ink-muted text-meta">{copy.previews}</span>
						<div className="flex items-end gap-4">
							{previewSizes.map((preview) => (
								<figure
									key={preview.id}
									className="m-0 flex flex-col items-center gap-1"
									data-agent-avatar-preview={preview.id}
								>
									{previewFrame(
										<canvas
											ref={(node) => {
												previews.current[preview.id] = node;
											}}
											role="img"
											aria-label={preview.label}
											className="size-full"
										/>,
										preview.px,
									)}
									<figcaption className="text-ink-dim text-meta">
										{preview.caption}
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

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="primary"
					size="sm"
					onClick={() => void save()}
					aria-disabled={busy}
					aria-busy={busy || undefined}
					/*
					 * ONE WIDTH ACROSS THE SAVE (design review round 1, D6; round 2, D6 for
					 * other locales). "Save picture" and "Saving..." measure 86 and 62px in
					 * English, so the primary action contracted 24px at the exact moment the
					 * person was watching it for a result, and Cancel slid left with it. A
					 * fixed `min-w` only fits the language it was measured in (fr/ru/es are
					 * wider in both states, hi/ur grow), so both labels are stacked in one
					 * grid cell: the pill is always as wide as the LONGER of the two in the
					 * active locale, and the inactive one is `invisible` (and `aria-hidden`,
					 * so it is not part of the name).
					 */
					className="aria-disabled:text-ink-disabled!"
					data-agent-avatar-save=""
				>
					<span className="inline-grid">
						<span
							aria-hidden={busy || undefined}
							className={cn("col-start-1 row-start-1", busy && "invisible")}
						>
							{copy.save}
						</span>
						<span
							aria-hidden={!busy || undefined}
							className={cn("col-start-1 row-start-1", !busy && "invisible")}
						>
							{copy.saving}
						</span>
					</span>
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onCancel}
					disabled={busy}
				>
					{copy.cancel}
				</Button>
			</div>
		</div>
	);
}
