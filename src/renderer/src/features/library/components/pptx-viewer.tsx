/**
 * The PPTX preview: a real multi-slide renderer, not an OS hand-off.
 *
 * WHY `pptx-browser`: it is MIT, has zero dependencies, and renders slides onto
 * a canvas with no server round trip - which is exactly the constraint the
 * design contract sets ("PPTX rendering is client-side", non-goal: no server
 * rasterisation). The renderer instance is owned by this component and
 * destroyed on unmount, because it holds object URLs for embedded media.
 *
 * THE THREE STATES ARE ALL DESIGNED: loading shows the parse progress, ready
 * shows the slide plus its thumbnail rail, and an unparseable/corrupt file
 * gets an honest sentence with the two actions that can still work (download,
 * open externally). A renderer that failed must not leave a blank canvas
 * looking like a loading state.
 *
 * KEYBOARD: Left/Right (and PageUp/PageDown) change slides while the viewer
 * has focus; the control buttons carry the same actions for pointer users.
 */

import { Button, Progress } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import {
	ChevronLeft,
	ChevronRight,
	Download,
	ExternalLink,
	LoaderCircle,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import { PptxRenderer } from "pptx-browser";
import type { FC } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import { saveAssetCopy } from "../library-download";

type PptxViewerProps = {
	asset: DesktopLibraryAsset;
	bytes: Uint8Array;
	onOpenExternal?: () => void;
	/** The preview's short layout: the slide wins over the thumbnail rail. */
	dense?: boolean;
	/**
	 * The standalone/full-view route.
	 *
	 * WHY IT CHANGES THE FIT. Contain-to-box (`max-h-full max-w-full`) letterboxes
	 * a 16:9 slide inside a wide pane: the width is pinned by the pane's HEIGHT, so
	 * most of the width the reader just asked for sits empty on both sides. That is
	 * the right rule in the 448px dock, where the pane is the constraint in both
	 * directions. Expanded, the slide fits the WIDTH and the pane scrolls
	 * vertically for its height — the same choice a slide deck makes on a wide
	 * screen.
	 */
	expanded?: boolean;
};

type PptxState =
	| { phase: "loading"; progress: number }
	| { phase: "ready"; slideCount: number; thumbnails: string[] }
	| { phase: "error"; detail: string };

export const PptxViewer: FC<PptxViewerProps> = ({
	asset,
	bytes,
	onOpenExternal,
	dense = false,
	expanded = false,
}) => {
	const rendererRef = useRef<PptxRenderer | null>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [state, setState] = useState<PptxState>({
		phase: "loading",
		progress: 0,
	});
	const [slide, setSlide] = useState(0);
	const [zoom, setZoom] = useState(1);
	const [attempt, setAttempt] = useState(0);
	const [saving, setSaving] = useState(false);
	const [transcript, setTranscript] = useState<string[]>([]);
	const [transcriptOpen, setTranscriptOpen] = useState(!dense);
	const rootRef = useRef<HTMLDivElement>(null);
	/*
	 * SHORT VIEWERS DROP THE THUMBNAIL RAIL rather than overflowing their own
	 * column. At a 720px window the dock has ~300px for the viewer after the
	 * compact metadata and composer; a 72px rail plus a 40px toolbar left the
	 * slide at zero. The rail is a convenience, the slide is the content, so the
	 * rail yields first and the toolbar wraps if its controls need a second line.
	 */
	const [short, setShort] = useState(false);
	useEffect(() => {
		setTranscriptOpen(!dense);
	}, [dense]);
	useLayoutEffect(() => {
		const node = rootRef.current;
		if (!node) return;
		const measure = () => setShort(node.getBoundingClientRect().height < 360);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger the effect must observe.
	useEffect(() => {
		let cancelled = false;
		const renderer = new PptxRenderer();
		rendererRef.current = renderer;
		setState({ phase: "loading", progress: 0 });
		setSlide(0);
		setZoom(1);
		void renderer
			.load(bytes, (progress) => {
				if (!cancelled) setState({ phase: "loading", progress });
			})
			.then(async () => {
				if (cancelled) return;
				const count = renderer.slideCount;
				/*
				 * Thumbnails are rendered once at 160px. A deck is usually a dozen
				 * slides; a 200-slide export is bounded by the same one pass and its
				 * canvases are held as data URLs rather than live canvases, so the
				 * rail does not keep a second render tree alive.
				 */
				const canvases = await renderer.renderAllSlides(160);
				const thumbnails = canvases.map((canvas) =>
					canvas.toDataURL("image/png"),
				);
				if (cancelled) return;
				setState({ phase: "ready", slideCount: count, thumbnails });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setState({
					phase: "error",
					detail:
						error instanceof Error && error.message
							? error.message
							: t("ui.library.preview.pptx_failed_detail"),
				});
			});
		return () => {
			cancelled = true;
			renderer.destroy();
			rendererRef.current = null;
		};
	}, [bytes, attempt]);

	const renderCanvas = useCallback(async () => {
		const renderer = rendererRef.current;
		const canvas = canvasRef.current;
		if (!renderer || !canvas || state.phase !== "ready") return;
		try {
			await renderer.renderSlide(slide, canvas, Math.round(960 * zoom));
		} catch (error) {
			setState({
				phase: "error",
				detail:
					error instanceof Error && error.message
						? error.message
						: t("ui.library.preview.pptx_failed_detail"),
			});
		}
	}, [slide, state.phase, zoom]);

	useEffect(() => {
		void renderCanvas();
	}, [renderCanvas]);

	useEffect(() => {
		const renderer = rendererRef.current;
		if (!renderer || state.phase !== "ready") return;
		let cancelled = false;
		void renderer
			.extractSlide(slide)
			.then((content) => {
				if (cancelled) return;
				setTranscript(
					content.textShapes.map((shape) => shape.text.trim()).filter(Boolean),
				);
			})
			.catch(() => {
				if (!cancelled) setTranscript([]);
			});
		return () => {
			cancelled = true;
		};
	}, [slide, state.phase]);

	const slideCount = state.phase === "ready" ? state.slideCount : 0;
	const go = (next: number) => {
		if (slideCount === 0) return;
		setSlide(Math.min(Math.max(next, 0), slideCount - 1));
	};

	if (state.phase === "error") {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				<p className="text-body text-ink">
					{t("ui.library.preview.pptx_failed")}
				</p>
				<p className="max-w-90 text-body-sm text-ink-muted">{state.detail}</p>
				<div className="flex items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setAttempt((value) => value + 1)}
					>
						{t("ui.library.preview.retry")}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						disabled={saving}
						onClick={() => {
							setSaving(true);
							void saveAssetCopy(asset)
								.catch((error: unknown) =>
									showErrorToast(
										error instanceof Error && error.message
											? error.message
											: t("ui.library.menu.save_failed"),
									),
								)
								.finally(() => setSaving(false));
						}}
					>
						<Download aria-hidden="true" />
						{t("ui.library.menu.download")}
					</Button>
					{onOpenExternal && (
						<Button variant="ghost" size="sm" onClick={onOpenExternal}>
							<ExternalLink aria-hidden="true" />
							{t("ui.library.preview.open_externally")}
						</Button>
					)}
				</div>
			</div>
		);
	}

	return (
		<div
			ref={rootRef}
			className="flex min-h-0 flex-1 flex-col gap-2 p-3"
			data-pptx-viewer=""
			onKeyDown={(event) => {
				if (event.key === "ArrowRight" || event.key === "PageDown") {
					event.preventDefault();
					go(slide + 1);
				} else if (event.key === "ArrowLeft" || event.key === "PageUp") {
					event.preventDefault();
					go(slide - 1);
				} else if (event.key === "Home") {
					event.preventDefault();
					go(0);
				} else if (event.key === "End") {
					event.preventDefault();
					go(slideCount - 1);
				}
			}}
		>
			<div className="flex min-h-0 flex-1 flex-col gap-2">
				<div
					data-pptx-slide=""
					className={cn(
						"flex min-h-[120px] min-w-0 flex-1 flex-col items-center rounded-md bg-canvas p-2",
						expanded ? "justify-start overflow-y-auto" : "justify-center",
					)}
				>
					{state.phase === "loading" ? (
						<div className="flex w-60 flex-col items-center gap-2">
							<LoaderCircle
								size={18}
								aria-hidden="true"
								className="motion-safe:animate-spin text-ink-muted"
							/>
							<Progress value={Math.round(state.progress * 100)} />
							<span className="text-meta text-ink-muted">
								{t("ui.library.preview.pptx_preparing")}
							</span>
						</div>
					) : (
						<canvas
							ref={canvasRef}
							className={cn(
								"rounded-xs bg-surface",
								expanded ? "h-auto max-w-full w-full" : "max-h-full max-w-full",
							)}
							aria-label={t("ui.library.preview.slide_of", {
								index: String(slide + 1),
								count: String(slideCount),
							})}
						/>
					)}
				</div>
				{state.phase === "ready" && !short && !dense && (
					<div className="flex h-[72px] shrink-0 flex-row gap-1 overflow-x-auto overflow-y-hidden">
						{state.thumbnails.map((thumbnail, index) => (
							<button
								// biome-ignore lint/suspicious/noArrayIndexKey: a slide IS its index.
								key={index}
								type="button"
								onClick={() => setSlide(index)}
								aria-pressed={index === slide}
								aria-label={t("ui.library.preview.go_to_slide", {
									index: String(index + 1),
								})}
								className={cn(
									"h-16 w-24 shrink-0 rounded-xs border p-0.5",
									index === slide
										? "border-accent"
										: "border-hairline hover:border-control",
								)}
							>
								<img
									src={thumbnail}
									alt=""
									loading="lazy"
									className="h-full w-full rounded-xs object-contain"
								/>
							</button>
						))}
					</div>
				)}
			</div>
			{state.phase === "ready" && (
				<div
					className="shrink-0 rounded-md bg-canvas px-2 py-1"
					data-pptx-transcript=""
				>
					{dense ? (
						<Button
							variant="ghost"
							size="sm"
							aria-expanded={transcriptOpen}
							onClick={() => setTranscriptOpen((open) => !open)}
						>
							{t("ui.library.preview.pptx_text")}
						</Button>
					) : null}
					{transcriptOpen && (
						<div className="max-h-24 overflow-y-auto text-meta text-ink-muted">
							{transcript.length ? (
								transcript.map((line, index) => (
									<p
										key={`${index}:${line}`}
										data-pptx-transcript-line=""
										className="truncate"
									>
										{line}
									</p>
								))
							) : (
								<p>{t("ui.library.preview.pptx_no_text")}</p>
							)}
						</div>
					)}
				</div>
			)}
			<div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-1 px-1 py-1">
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.preview.previous_slide")}
						disabled={slide === 0 || state.phase !== "ready"}
						onClick={() => go(slide - 1)}
					>
						<ChevronLeft aria-hidden="true" />
					</Button>
					<span className="text-meta tabular-nums text-ink-muted">
						{t("ui.library.preview.slide_of", {
							index: String(slideCount ? slide + 1 : 0),
							count: String(slideCount),
						})}
					</span>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.preview.next_slide")}
						disabled={slide >= slideCount - 1 || state.phase !== "ready"}
						onClick={() => go(slide + 1)}
					>
						<ChevronRight aria-hidden="true" />
					</Button>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.preview.zoom_out")}
						onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
					>
						<ZoomOut aria-hidden="true" />
					</Button>
					<span className="w-10 text-center text-meta tabular-nums text-ink-muted">
						{Math.round(zoom * 100)}%
					</span>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.preview.zoom_in")}
						onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
					>
						<ZoomIn aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setZoom(1)}
						disabled={zoom === 1}
					>
						{t("ui.library.preview.fit")}
					</Button>
				</div>
			</div>
		</div>
	);
};
