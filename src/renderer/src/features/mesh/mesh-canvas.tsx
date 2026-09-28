/**
 * The canvas: a world layer that holds the whole topology, and a viewport that
 * shows part of it.
 *
 * ONE TRANSFORM, ON ONE ELEMENT. Every node and every edge lives inside a single
 * layer carrying `translate3d(tx, ty, 0) scale(k)` with `transform-origin: 0 0`, so
 * a pan or a zoom is ONE style write rather than a position recomputed per node -
 * and that is what makes "pan/zoom does not re-render the canvas" a structural
 * assertion instead of a timing hope.
 *
 * POSITIONS COME FROM `mesh-positions.ts` AND NEVER FROM THIS FILE. A slot is
 * assigned once and retained, so a poll that adds or removes a device cannot move
 * the node the pointer is over. This component reads the geometry; it does not
 * decide it.
 *
 * WHY DOM NODES AND SVG EDGES TOGETHER (the plan § 2): the edges are decoration with
 * one meaning and no interactive state, so an `<svg>` with `pointer-events: none` is
 * the cheapest correct thing; the nodes must take focus, carry an accessible name
 * and act on activation, so they are real elements. `<canvas>`/WebGL was rejected
 * for exactly that reason and for a second one: it cannot read the twelve themes'
 * CSS custom properties without a `getComputedStyle` bridge per role per theme,
 * which would bypass `check-themes`'s contrast assertions entirely.
 *
 * REDUCED MOTION: nothing here animates. Fit and reset SET the transform; there is
 * no fly-to, so there is no entrance to cap.
 */

import { cn } from "@shared/lib/utils";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { MeshEdgeLayer } from "./mesh-edge";
import type { MeshGraph } from "./mesh-graph";
import { MeshDeviceNode, MeshNetworkNode } from "./mesh-node";
import {
	type MeshSlots,
	fitTransform,
	meshGeometry,
	zoomAbout,
} from "./mesh-positions";

/** How far one arrow key or one keyboard zoom step moves the view. */
const KEY_PAN_PX = 48;
const KEY_ZOOM_STEP = 1.25;
/**
 * A wheel notch is `deltaY ≈ 100` on a mouse and `1-3` on a trackpad in pixel mode,
 * so the zoom is EXPONENTIAL in the delta: linear-in-delta makes a trackpad's many
 * small events crawl and a mouse's single notch jump. 0.0015 puts one mouse notch
 * at ~14% - a step a reader can see and land from.
 */
const WHEEL_ZOOM_RATE = 0.0015;

export type MeshTransform = { k: number; tx: number; ty: number };

type MeshCanvasProps = {
	graph: MeshGraph;
	slots: MeshSlots;
	nowSeconds: number;
	/** The device the reader is on, from the list's own selection. */
	selectedDeviceId: string | null;
	onOpenDevice: (deviceId: string) => void;
	/** The summary sentence, which is also this region's accessible name. */
	summaryId: string;
};

export const MeshCanvas: FC<MeshCanvasProps> = ({
	graph,
	slots,
	nowSeconds,
	selectedDeviceId,
	onOpenDevice,
	summaryId,
}) => {
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState({ width: 0, height: 0 });
	const [transform, setTransform] = useState<MeshTransform>({
		k: 1,
		tx: 0,
		ty: 0,
	});
	const fitted = useRef(false);

	/*
	 * The geometry is keyed on the SLOT MAP, which is reference-stable across a poll
	 * that changed nothing (see `useMeshSlots`), so a poll cannot re-solve the
	 * layout and cannot move a node.
	 */
	const geometry = useMemo(() => meshGeometry(slots), [slots]);

	const fit = useCallback(() => {
		setTransform(fitTransform(geometry.bounds, viewport));
	}, [geometry.bounds, viewport]);

	/*
	 * The viewport's size, measured rather than assumed: a `BrowserWindow` includes
	 * platform chrome, the app rail and the list pane are both independently
	 * collapsible, and at 1024x768 the tab has a fraction of the window. Reading the
	 * box is what makes "fit" mean fit at both sizes the plan measures.
	 */
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			setViewport({ width: rect.width, height: rect.height });
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	/*
	 * FIT ONCE, on the first box we can measure - and then never again on our own.
	 * `fitted` is what keeps a later resize or a poll from throwing away a viewport
	 * the reader has moved: the invariant is "a poll never changes the transform",
	 * and a resize is handled by leaving the reader's transform alone.
	 */
	useEffect(() => {
		if (fitted.current) return;
		if (viewport.width <= 0 || viewport.height <= 0) return;
		fitted.current = true;
		setTransform(fitTransform(geometry.bounds, viewport));
	}, [viewport, geometry.bounds]);

	/*
	 * ONE STYLE WRITE PER ANIMATION FRAME.
	 *
	 * `pointermove` stores the latest event and schedules a frame; the frame applies
	 * it once. This is what keeps a pan smooth under a moving pointer (a 120Hz
	 * trackpad would otherwise cause several React renders per displayed frame) and
	 * it is COUNTABLE, which is why the plan states it as a structural property
	 * rather than as a frame-time target.
	 */
	const pendingPan = useRef<{ x: number; y: number } | null>(null);
	const pendingZoom = useRef<{ x: number; y: number; deltaY: number } | null>(
		null,
	);
	const frame = useRef<number | null>(null);
	const origin = useRef<{
		x: number;
		y: number;
		transform: MeshTransform;
	} | null>(null);

	const flush = useCallback(() => {
		frame.current = null;
		const pan = pendingPan.current;
		const zoom = pendingZoom.current;
		pendingPan.current = null;
		pendingZoom.current = null;
		if (pan) {
			const start = origin.current;
			if (!start) return;
			setTransform({
				k: start.transform.k,
				tx: start.transform.tx + (pan.x - start.x),
				ty: start.transform.ty + (pan.y - start.y),
			});
			return;
		}
		if (zoom) {
			setTransform((current) =>
				zoomAbout(
					current,
					{ x: zoom.x, y: zoom.y },
					current.k * Math.exp(-zoom.deltaY * WHEEL_ZOOM_RATE),
				),
			);
		}
	}, []);

	const schedule = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(flush);
	}, [flush]);

	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
		},
		[],
	);

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		/*
		 * PAN FROM EMPTY GROUND ONLY, and from the middle button anywhere: a node is a
		 * button and a drag that started on one must not move the canvas under it.
		 * (`event.target === event.currentTarget` is the background test; the world
		 * layer itself is `pointer-events: none`-free, so a node or a lane is what the
		 * pointer lands on when it is over one.)
		 */
		const onGround = event.target === event.currentTarget;
		if (!onGround && event.button !== 1) return;
		if (event.button !== 0 && event.button !== 1) return;
		origin.current = {
			x: event.clientX,
			y: event.clientY,
			transform,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
		event.preventDefault();
	};

	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!origin.current) return;
		pendingPan.current = { x: event.clientX, y: event.clientY };
		schedule();
	};

	const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!origin.current) return;
		origin.current = null;
		pendingPan.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	const onWheel = useCallback(
		(event: WheelEvent) => {
			if (event.deltaY === 0) return;
			/*
			 * `preventDefault` HERE RATHER THAN IN A REACT `onWheel`, and the difference is
			 * not stylistic: React attaches `wheel` at the root as a PASSIVE listener, so a
			 * `preventDefault()` from a React handler is ignored (and logs a warning), which
			 * would let the page scroll behind a zooming canvas. A native listener with
			 * `{ passive: false }` is the only spelling that actually cancels it.
			 */
			event.preventDefault();
			const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
			pendingZoom.current = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
				deltaY: event.deltaY,
			};
			schedule();
		},
		[schedule],
	);

	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, [onWheel]);

	/*
	 * KEYBOARD PARITY, on the canvas itself: every gesture a pointer can make has a
	 * key, which is the requirement the plan's § 2 states and the reason a drag-only
	 * canvas fails review. The keys are handled on the region rather than on a
	 * window listener so they only apply while the reader is on the canvas.
	 */
	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const step = event.shiftKey ? KEY_PAN_PX * 4 : KEY_PAN_PX;
		switch (event.key) {
			case "0":
				event.preventDefault();
				fit();
				return;
			case "+":
			case "=":
				event.preventDefault();
				setTransform((current) =>
					zoomAbout(
						current,
						{ x: viewport.width / 2, y: viewport.height / 2 },
						current.k * KEY_ZOOM_STEP,
					),
				);
				return;
			case "-":
			case "_":
				event.preventDefault();
				setTransform((current) =>
					zoomAbout(
						current,
						{ x: viewport.width / 2, y: viewport.height / 2 },
						current.k / KEY_ZOOM_STEP,
					),
				);
				return;
			case "ArrowLeft":
			case "ArrowRight":
			case "ArrowUp":
			case "ArrowDown": {
				event.preventDefault();
				const dx =
					event.key === "ArrowLeft"
						? step
						: event.key === "ArrowRight"
							? -step
							: 0;
				const dy =
					event.key === "ArrowUp"
						? step
						: event.key === "ArrowDown"
							? -step
							: 0;
				setTransform((current) => ({
					...current,
					tx: current.tx + dx,
					ty: current.ty + dy,
				}));
				return;
			}
			default:
		}
	};

	return (
		<div
			ref={viewportRef}
			data-mesh-canvas=""
			/*
			 * A focusable region, not a widget: `role="group"` with the summary line as
			 * its name describes what it contains, and the nodes inside are the
			 * controls. A `role="application"` here would take the arrow keys away from
			 * everything inside it.
			 *
			 * THE GROUP IS A LABELLING SCOPE, NOT A FORM BOUNDARY: the semantic element
			 * for `group` is `<fieldset>`, and it is the wrong one here - this app holds
			 * no form, and a fieldset would add the element's own default box and margin
			 * to a canvas measured to the pixel. What the role buys is the name the
			 * region announces itself with.
			 */
			// biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` is the semantic element for `group` and the wrong one here - there is no form, and its default box would be laid over a canvas measured to the pixel. The role buys a labelling scope for the summary line.
			role="group"
			aria-labelledby={summaryId}
			/*
			 * THE TAB STOP IS THE REMEDY for the keyboard parity below: a canvas whose
			 * only focusable things are its nodes leaves the pan, zoom and fit keys
			 * unreachable (WCAG 2.1.1), and this region is what carries them. The stop
			 * does not trap: the nodes inside are buttons, so Tab continues into them.
			 */
			// biome-ignore lint/a11y/noNoninteractiveTabindex: the region carries the pan/zoom/fit keys, so it must be reachable by keyboard; the buttons inside are the next stops, so the walk is not trapped.
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endPan}
			onPointerCancel={endPan}
			onKeyDown={onKeyDown}
			onDoubleClick={(event) => {
				// Empty ground only, the same test the pan uses: a double-click on a node
				// is two activations of that node, not a fit.
				if (event.target === event.currentTarget) fit();
			}}
			className={cn(
				"relative min-h-0 flex-1 overflow-hidden rounded-lg border border-hairline bg-sunken",
				/*
				 * `touch-action: none` ON THE CANVAS ONLY, as the plan's § 2 requires: a
				 * pans with one finger and a pinch is a browser gesture everywhere else in
				 * the app, and this is the one surface that owns those input events.
				 */
				"[touch-action:none]",
				/*
				 * THE PAN SURFACE SAYS IT CAN BE PANNED. `grab` at rest and `grabbing`
				 * while the press is down - the same pair the mermaid canvas uses,
				 * with `active:` standing in for that component's pointer-state hook
				 * because this pan runs through refs and never re-renders. The
				 * affordance belongs to the EMPTY GROUND and the middle button, which
				 * is where the pan actually runs: a press that starts on a node does
				 * not move the canvas, and the node's own button cursor (pointer, from
				 * the base layer) is what the pointer reads there.
				 */
				"cursor-grab active:cursor-grabbing",
				"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]",
			)}
		>
			<div
				data-mesh-world=""
				className="absolute top-0 left-0"
				style={{
					transform: `translate3d(${transform.tx}px, ${transform.ty}px, 0) scale(${transform.k})`,
					transformOrigin: "0 0",
					width: geometry.bounds.width,
					height: geometry.bounds.height,
				}}
			>
				<MeshEdgeLayer
					edges={graph.edges}
					geometry={geometry}
					selectedDeviceId={selectedDeviceId}
				/>
				{/*
				 * Two lists, so the arrow walk meets the networks before the devices that
				 * belong to them - the reading order the graph is drawn in.
				 */}
				<ul aria-label="Networks" className="m-0 list-none p-0">
					{graph.networks.map((network) => {
						const box = geometry.networks.get(network.id);
						if (!box) return null;
						return (
							<MeshNetworkNode
								key={network.id}
								network={network}
								x={box.x}
								y={box.y}
							/>
						);
					})}
				</ul>
				<ul aria-label="Devices" className="m-0 list-none p-0">
					{graph.devices.map((device) => {
						const box = geometry.devices.get(device.id);
						if (!box) return null;
						return (
							<MeshDeviceNode
								key={device.id}
								device={device}
								x={box.x}
								y={box.y}
								nowSeconds={nowSeconds}
								selected={device.id === selectedDeviceId}
								onOpen={onOpenDevice}
							/>
						);
					})}
				</ul>
			</div>
		</div>
	);
};
