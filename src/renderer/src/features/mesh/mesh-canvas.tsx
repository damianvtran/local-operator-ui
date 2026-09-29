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
import {
	type DragState,
	IDLE_DRAG,
	dragReducer,
	draggedSessionId,
} from "./mesh-drag";
import {
	type DragPayload,
	type DropContext,
	type DropTarget,
	type MovePlan,
	type Remedy,
	hoverSentence,
	resolveDrop,
} from "./mesh-drop";
import { MeshEdgeLayer } from "./mesh-edge";
import type { MeshGraph } from "./mesh-graph";
import {
	MeshDeviceNode,
	MeshNetworkNode,
	type NodeDropState,
} from "./mesh-node";
import {
	KEEP_MARGIN_PX,
	type MeshSlots,
	fitTransform,
	keepNodeVisible,
	meshGeometry,
	zoomAbout,
} from "./mesh-positions";
import type { DeviceSessions } from "./mesh-sessions";
import type { MeshSessionRow } from "./mesh-types";

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
	/** What each drawn device holds, joined and capped by `mesh-sessions.ts`. */
	sessions: ReadonlyMap<string, DeviceSessions>;
	/** The total the peer catalogue claims per device, which may exceed the rows. */
	sessionTotals: ReadonlyMap<string, number>;
	/** The chip whose move is in flight, if any. */
	movingSessionId: string | null;
	/**
	 * Whether this backend can move a conversation at all (`features.session_transfer`).
	 *
	 * ABSENT MEANS THE CHIPS STILL DRAW AND STILL OPEN THEIR MENU, with the move items
	 * left out: a backend that can list a peer's sessions and cannot move one is a real
	 * shape (`routes/capabilities.py` says so in those words), and hiding the sessions
	 * too would withhold the fact the tab exists to show.
	 */
	canMove: boolean;
	/** Open this device's detail panel. */
	onOpenDevice: (deviceId: string) => void;
	/** A drop landed on a valid target: the page confirms and asks. */
	onAskMove: (ask: {
		plan: MovePlan;
		alternatives: MovePlan[];
		risky: boolean;
	}) => void;
	/** A drop the CLIENT refused, with the code and the sentence to show. */
	onDropRefused: (refusal: {
		code: string;
		sentence: string;
		remedy: Remedy | null;
		/** The move the refusal was about, for the `wait` remedy - see `DropVerdict`. */
		plan: MovePlan | null;
	}) => void;
	/** The "+N more" affordance: the panel shows the rest. */
	onShowAllSessions: (deviceId: string) => void;
	/** The summary sentence, which is also this region's accessible name. */
	summaryId: string;
};

export const MeshCanvas: FC<MeshCanvasProps> = ({
	graph,
	slots,
	nowSeconds,
	selectedDeviceId,
	sessions,
	sessionTotals,
	movingSessionId,
	canMove,
	onOpenDevice,
	onAskMove,
	onDropRefused,
	onShowAllSessions,
	summaryId,
}) => {
	const viewportRef = useRef<HTMLDivElement | null>(null);
	/*
	 * The canvas's own box, POSITION INCLUDED. The size is what "fit" needs; the
	 * position is what the drag ghost needs, because the ghost is drawn in this
	 * element's coordinates rather than the world's (it must not scale with the zoom),
	 * and reading `getBoundingClientRect()` during a render to find that out would be a
	 * forced synchronous layout on every frame of a drag - the one thing this
	 * component's frame budget cannot afford.
	 */
	const [viewport, setViewport] = useState({
		width: 0,
		height: 0,
		/*
		 * THE CLIP BOX, which is the PADDING box rather than the border box (QA review round 3,
		 * Q-1). `overflow: hidden` clips content at the padding edge, so a node clamped to
		 * `width` sits one border pixel under the border - measured at 1024x768 as a clicked node
		 * that was 199 of its 200 px visible, genuinely clipped. Geometry that centres or maps a
		 * point (fit, pan, the ghost) uses the border box; "this must be visible" uses this one.
		 */
		clipWidth: 0,
		clipHeight: 0,
		left: 0,
		top: 0,
	});
	const [transform, setTransform] = useState<MeshTransform>({
		k: 1,
		tx: 0,
		ty: 0,
	});
	const fitted = useRef(false);
	/*
	 * WHETHER THE GESTURE THAT JUST ENDED WAS A DRAG, for the click that follows it.
	 *
	 * A DRAG OWES THE CHIP NOTHING AFTER THE RELEASE. The chip takes pointer capture
	 * on press (`onChipPointerDown`), so the release is retargeted to the chip and the
	 * browser then fires the chip's own `click` - which opens the device's panel. The
	 * measured consequence (UX review round 1, U1) was that every drag, including one
	 * released over empty ground where the app correctly asks for nothing, opened the
	 * panel, narrowed the canvas by 335 px and clipped the node column the drag was
	 * aimed at. The reducer already knows the answer - a press that travelled is
	 * `dragging`, one that did not is a click - so the flag is read from that
	 * transition rather than reconstructed from coordinates here.
	 */
	const dragEndedAsDrag = useRef(false);
	const lastViewport = useRef<{ width: number; height: number } | null>(null);

	/*
	 * The geometry is keyed on the SLOT MAP, which is reference-stable across a poll
	 * that changed nothing (see `useMeshSlots`), so a poll cannot re-solve the
	 * layout and cannot move a node.
	 */
	const geometry = useMemo(() => meshGeometry(slots), [slots]);

	/*
	 * THE DROP CONTEXT IS BUILT FROM WHAT THE CANVAS DREW, once per graph: the verdict
	 * needs a device's state (a suspect device outranks reachability) and a network's
	 * existence, and looking either up from the raw reads would let the verdict answer
	 * about a node the picture does not contain.
	 */
	const dropContext = useMemo<DropContext>(
		() => ({
			selfDeviceId: graph.selfDeviceId,
			devices: new Map(graph.devices.map((device) => [device.id, device])),
			networks: new Map(graph.networks.map((network) => [network.id, network])),
		}),
		[graph],
	);

	/*
	 * THE DRAG IS A REDUCER OVER POINTER EVENTS, and every transition lives in
	 * `mesh-drag.ts` - including the ones that exist to stop a ghost outliving its
	 * pointer. What is local to this component is the thing a reducer cannot know: how
	 * far the pointer is from the canvas's own box (the ghost is placed in the
	 * VIEWPORT's coordinates, outside the world layer, because a ghost inside the
	 * transform would scale with the zoom).
	 */
	const [drag, setDrag] = useState<DragState>(IDLE_DRAG);
	const dragTargetRef = useRef<DropTarget>({ kind: "ground" });

	/**
	 * What the pointer is over, resolved from the DOM.
	 *
	 * `closest()` RATHER THAN A HIT-TEST OF OUR OWN, and rather than a map of boxes:
	 * the nodes are real elements, so the browser's own hit-testing is the answer - the
	 * same answer a keyboard user gets, which is the property the plan's §2 bought when
	 * it refused `<canvas>`. The GHOST IS `pointer-events: none`, so it can never be
	 * the element under the pointer; that is why no `elementFromPoint` offset
	 * arithmetic is needed here.
	 */
	const targetAt = useCallback((x: number, y: number): DropTarget => {
		const hit = document.elementFromPoint(x, y);
		const device = hit?.closest("[data-mesh-device]");
		if (device) {
			const deviceId = device.getAttribute("data-mesh-device");
			if (deviceId) return { kind: "device", deviceId };
		}
		const network = hit?.closest("[data-mesh-network]");
		if (network) {
			const networkId = network.getAttribute("data-mesh-network");
			if (networkId) return { kind: "network", networkId };
		}
		return { kind: "ground" };
	}, []);

	/** The verdict for the target the pointer is over, live, for the node's own edge. */
	const liveVerdict = useMemo(() => {
		if (drag.kind !== "dragging" && drag.kind !== "settling") return null;
		return resolveDrop(drag.payload, drag.target, dropContext);
	}, [drag, dropContext]);

	/** Which node is showing the drop affordance, and which way it reads. */
	const dropStateFor = useCallback(
		(deviceId: string): NodeDropState => {
			if (!liveVerdict) return null;
			if (liveVerdict.kind === "plan") {
				const target =
					drag.kind === "dragging" || drag.kind === "settling"
						? drag.target
						: null;
				if (target && target.kind === "device" && target.deviceId === deviceId)
					return "accept";
				return null;
			}
			if (liveVerdict.kind === "refused") {
				const target =
					drag.kind === "dragging" || drag.kind === "settling"
						? drag.target
						: null;
				if (target && target.kind === "device" && target.deviceId === deviceId)
					return "refuse";
				return null;
			}
			return null;
		},
		[liveVerdict, drag],
	);

	/**
	 * A press on a chip: the first half of the click-versus-drag decision.
	 *
	 * THE POINTER IS CAPTURED HERE, on the chip, and not by the canvas: every later
	 * move and the release must arrive at THIS chip even if the pointer leaves it during
	 * the drag, which is what pointer capture is for. The canvas sees the same events as
	 * they bubble, which is where the target resolution happens.
	 */
	const onChipPointerDown = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>, session: MeshSessionRow) => {
			if (!canMove || event.button !== 0) return;
			// A new press is a new gesture: whatever the last one ended as, this one is
			// not its echo.
			dragEndedAsDrag.current = false;
			const ownerDeviceId =
				session.locality === "local"
					? (graph.selfDeviceId ?? "")
					: session.owner_device;
			const owner = dropContext.devices.get(ownerDeviceId);
			const payload: DragPayload = {
				session,
				ownerDeviceId,
				ownerLabel: owner?.label ?? session.owner_device_name,
			};
			/*
			 * CAPTURE IS BEST-EFFORT, and the guard is not defensive padding: a
			 * `PointerEvent` dispatched by a story, a test or a rig has no ACTIVE pointer
			 * behind it, and `setPointerCapture` throws `InvalidPointerId` for one. The
			 * capture is what keeps a drag's moves coming when the pointer leaves the chip
			 * - a real pointer always grants it - so a synthetic press loses only the
			 * capture, never the drag, and the frame a story photographs is the real one.
			 */
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// No active pointer: see the comment above.
			}
			setDrag((current) =>
				dragReducer(current, {
					kind: "press",
					payload,
					x: event.clientX,
					y: event.clientY,
					pointerId: event.pointerId,
				}),
			);
		},
		[canMove, dropContext, graph.selfDeviceId],
	);

	/**
	 * Pointer motion, whichever gesture is in flight.
	 *
	 * TWO GESTURES SHARE THIS HANDLER and they are told apart by what is in flight: a
	 * chip drag is `pressing`/`dragging` in the reducer, and a pan is `origin.current`.
	 * The drag is fed EVERY move (the reducer is what decides whether the threshold was
	 * crossed); the pan keeps slice 1's one-write-per-frame scheduling.
	 */
	const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (drag.kind === "pressing" || drag.kind === "dragging") {
			const target = targetAt(event.clientX, event.clientY);
			dragTargetRef.current = target;
			setDrag((current) =>
				dragReducer(current, {
					kind: "move",
					x: event.clientX,
					y: event.clientY,
					target,
				}),
			);
			return;
		}
		onPointerMove(event);
	};

	/**
	 * The release: a click, a drop, or nothing.
	 *
	 * `settling` IS THE STATE THAT DECIDES, and the verdict is computed from the target
	 * the pointer was ACTUALLY over - carried through the reducer rather than re-resolved
	 * here, because re-resolving would answer about wherever the pointer ended up after
	 * the last frame, which is not where the user let go.
	 */
	const onCanvasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		endPan(event);
		if (drag.kind !== "pressing" && drag.kind !== "dragging") return;
		if (drag.kind === "pressing") {
			// A press that never travelled is a CLICK: the chip's own activation runs, the
			// canvas asks for nothing, and no ghost was ever drawn.
			setDrag((current) => dragReducer(current, { kind: "cancel" }));
			return;
		}
		const decided = resolveDrop(drag.payload, drag.target, dropContext);
		// THE ONE TRANSITION THAT SUPPRESSES THE CHIP'S OWN CLICK: the press travelled
		// far enough to be a drag, so the trailing `click` is the gesture's echo rather
		// than an activation (see `dragEndedAsDrag`).
		dragEndedAsDrag.current = true;
		setDrag((current) => dragReducer(current, { kind: "release" }));
		if (decided.kind === "plan") {
			onAskMove({
				plan: decided.plan,
				alternatives: decided.alternatives,
				risky: decided.risky,
			});
		} else if (decided.kind === "refused") {
			onDropRefused({
				code: decided.code,
				sentence: decided.sentence,
				remedy: decided.remedy,
				plan: decided.plan ?? null,
			});
		}
		setDrag((current) => dragReducer(current, { kind: "settled" }));
	};

	useEffect(() => {
		// A drag that is still in flight when the tab unmounts would leave nothing to
		// settle it: the reducer's own `cancel` is the transition, and it runs on every
		// teardown rather than only on the ones that happened to be clean.
		return () => setDrag(IDLE_DRAG);
	}, []);

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
			setViewport({
				width: rect.width,
				height: rect.height,
				clipWidth: element.clientWidth,
				clipHeight: element.clientHeight,
				left: rect.left,
				top: rect.top,
			});
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
	 * A SHRINK IS NOT A POLL, and this is the half the fit-once rule left out (design
	 * review round 1, D1). The panel opening - or the rail and list pane collapsing -
	 * takes a third of the canvas in one step, and the transform then points past the
	 * new edge: at 1024x768 the reader's own node was clipped to 26 px of its 200, so
	 * the act of clicking a device to inspect it was what hid it.
	 *
	 * WHAT DOES NOT MOVE, deliberately: scale, and any pan or zoom the reader chose.
	 * This is a CLAMP on the selected node (see `keepNodeVisible`), not a re-fit - a
	 * re-fit here would discard the reader's viewport on every panel toggle, which is
	 * the defect the fit-once rule exists to remove. It runs only when the measured box
	 * actually shrank, never on a poll, and it moves the world only by the amount that
	 * puts the node back, so a reader panned somewhere else stays where they put it.
	 */
	useEffect(() => {
		const previous = lastViewport.current;
		lastViewport.current = { width: viewport.width, height: viewport.height };
		if (!previous || !fitted.current) return;
		if (viewport.width <= 0 || viewport.height <= 0) return;
		if (viewport.width >= previous.width && viewport.height >= previous.height)
			return;
		if (!selectedDeviceId) return;
		const box = geometry.devices.get(selectedDeviceId);
		if (!box) return;
		setTransform((current) => {
			/*
			 * THE CLIP BOX, NOT THE BORDER BOX (QA review round 3, Q-1): the canvas clips at its
			 * padding edge, so a clamp against `viewport.width` leaves the node's last pixel under
			 * the border - 199 of 200 px visible at 1024x768. The slack is measured against the same
			 * box, since the margin is only spent where the world fits inside it.
			 */
			const clip = { width: viewport.clipWidth, height: viewport.clipHeight };
			const slack = Math.max(
				0,
				Math.min(
					clip.width - geometry.bounds.width * current.k,
					clip.height - geometry.bounds.height * current.k,
				),
			);
			return keepNodeVisible(
				current,
				box,
				clip,
				Math.min(KEEP_MARGIN_PX, slack),
			);
		});
	}, [viewport, selectedDeviceId, geometry]);

	/**
	 * Where the ghost is drawn, in this canvas's own coordinates.
	 *
	 * FROM THE MEASURED BOX RATHER THAN A LIVE `getBoundingClientRect()`, and the
	 * difference is a forced layout per frame: the drag already produces one style write
	 * per animation frame, and a layout read here would turn that into a read-write
	 * pair that the browser cannot batch. The measurement is kept fresh by the
	 * `ResizeObserver` above and by the scroll a pan already invalidates.
	 */
	const ghost =
		drag.kind === "dragging"
			? { x: drag.x - viewport.left + 12, y: drag.y - viewport.top + 12 }
			: { x: 0, y: 0 };

	/** The one line the drop indicator shows, if any. */
	const indicator = liveVerdict ? hoverSentence(liveVerdict) : null;

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
			/*
			 * ESCAPE CANCELS A DRAG, which is the one gesture state with no key of its
			 * own (UX review round 1, U5): a release is the universal cancel and it is
			 * clean, but a reader who has already committed the press has no way to take
			 * it back from the keyboard. The reducer's own `cancel` is the transition -
			 * the same one the unmount teardown runs - so the canvas does not invent a
			 * second way to end a gesture.  Nothing is sent: a drag is a request, and a
			 * cancelled one was never made.
			 *
			 * AND THE CANCEL TAKES THE TRAILING CLICK WITH IT (UX review round 2, U8). A
			 * travelled press retargets the browser's own `click` to the chip (pointer
			 * capture), and the release path is where that click is suppressed - but the
			 * release after an Escape sees `idle` and returns before it can suppress
			 * anything, so a reader who pressed Escape and then let go got the panel they
			 * had cancelled (measured: the panel opened and the canvas fell 1072 -> 736 px).
			 * The suppression is therefore set HERE as well, on the same rule the release
			 * uses - the press had travelled, so its click is an echo rather than an
			 * activation - and it stays false for a press that never moved, which is still
			 * a click and still opens the panel.
			 */
			case "Escape":
				if (drag.kind !== "pressing" && drag.kind !== "dragging") return;
				event.preventDefault();
				if (drag.kind === "dragging") dragEndedAsDrag.current = true;
				setDrag((current) => dragReducer(current, { kind: "cancel" }));
				return;
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
			onPointerMove={onCanvasPointerMove}
			onPointerUp={onCanvasPointerUp}
			onPointerCancel={(event) => {
				/*
				 * A CANCELLED POINTER ENDS THE DRAG, it does not settle it. The browser takes the
				 * pointer for a system gesture or because the capture was lost, so there is no
				 * position the user "let go" at - and any other reading of it invents a drop
				 * nobody made.
				 *
				 * It also suppresses the trailing activation for the same reason Escape does
				 * (UX review round 2, U8): the gesture was cancelled while the pointer was down,
				 * so whatever click the browser retargets to the chip afterwards is an echo of a
				 * drag the reader took back, not a request to open a panel.
				 */
				if (drag.kind === "dragging") dragEndedAsDrag.current = true;
				setDrag((current) => dragReducer(current, { kind: "cancel" }));
				endPan(event);
			}}
			data-mesh-gesture={drag.kind}
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
								refused={
									liveVerdict?.kind === "refused" &&
									drag.kind === "dragging" &&
									drag.target.kind === "network" &&
									drag.target.networkId === network.id
								}
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
								sessions={
									sessions.get(device.id) ?? {
										rows: [],
										shown: [],
										hidden: 0,
									}
								}
								sessionTotal={
									sessionTotals.get(device.id) ?? device.sessionCount ?? 0
								}
								dropState={dropStateFor(device.id)}
								movingSessionId={movingSessionId}
								draggedSessionId={draggedSessionId(drag)}
								onOpen={onOpenDevice}
								onChipPointerDown={onChipPointerDown}
								/*
								 * A CHIP'S CLICK OPENS ITS DEVICE'S PANEL, which is where the conversations and
								 * their move menu live. The chip does NOT open a menu of its own: a menu opens on
								 * pointerdown, which would swallow the drag before it started - so the two
								 * cannot share one press, and the feature keeps ONE menu (`mesh-card.tsx`)
								 * rather than two spellings of the same list.
								 */
								onChipClick={() => {
									/*
									 * A CHIP'S CLICK OPENS ITS DEVICE'S PANEL, which is where the conversations and
									 * their move menu live. The chip does NOT open a menu of its own: a menu opens on
									 * pointerdown, which would swallow the drag before it started - so the two
									 * cannot share one press, and the feature keeps ONE menu (`mesh-card.tsx`)
									 * rather than two spellings of the same list.
									 *
									 * AND A DRAG'S ECHO IS NOT AN ACTIVATION: the release retargets to the chip
									 * (pointer capture), so the browser fires this click after every drag. The flag
									 * is consumed here rather than in the chip so the node stays a presentational
									 * component and only the canvas knows what the gesture did.
									 */
									if (dragEndedAsDrag.current) {
										dragEndedAsDrag.current = false;
										return;
									}
									onOpenDevice(device.id);
								}}
								onShowAllSessions={onShowAllSessions}
							/>
						);
					})}
				</ul>
			</div>
			{/*
			 * THE DRAG GHOST LIVES OUTSIDE THE WORLD LAYER, and that is deliberate: a ghost
			 * inside the transform would scale with the zoom, so a chip dragged out of a
			 * zoomed-in canvas would grow under the pointer - and its own size is the one
			 * thing about it the user is comparing against the target. It is positioned in
			 * the VIEWPORT's coordinates, from the canvas's own measured box.
			 *
			 * `pointer-events: none` is load-bearing rather than tidy: the ghost sits under the
			 * pointer by definition, so if it took pointer events it would be the element the
			 * drop resolved against - the drop would then always land on the ghost and never on
			 * a device.
			 */}
			{drag.kind === "dragging" && (
				<div
					data-mesh-ghost=""
					aria-hidden="true"
					className="pointer-events-none absolute z-10 max-w-40 truncate rounded-sm border border-ink-dim bg-surface px-1.5 py-0.5 text-meta text-ink"
					style={{
						left: ghost.x,
						top: ghost.y,
					}}
				>
					{drag.payload.session.name || "untitled"}
				</div>
			)}
			{/*
			 * THE INDICATOR STATES THE RESULTING OPERATION, which is the rule the drop has
			 * to satisfy to be honest: "Move to devon-laptop", never a generic "+", and a
			 * refusal says which refusal before the drop rather than after it.
			 *
			 * IT TRAVELS WITH THE POINTER (design review round 1, D4). It used to sit at the
			 * canvas's bottom-left corner, which measured ~610 px from the card it named -
			 * diagonally opposite, in the corner of the frame the reader is not looking at,
			 * while the pointer is on the target. The one sentence that has to be read
			 * before committing is now beside the thing being dragged, on the side with
			 * room: below the pointer in the upper two thirds, above it near the floor, and
			 * never wider than the box it is drawn in.
			 */}
			{drag.kind === "dragging" && indicator && (
				<div
					data-mesh-indicator=""
					className={cn(
						"pointer-events-none absolute z-10 rounded-sm border bg-surface px-2 py-1 text-meta",
						liveVerdict?.kind === "refused"
							? "border-warning text-warning"
							: "border-control text-ink",
					)}
					style={{
						left: ghost.x,
						maxWidth: Math.max(160, viewport.width - ghost.x - 12),
						...(ghost.y > viewport.height * 0.6
							? { bottom: Math.max(12, viewport.height - ghost.y + 8) }
							: { top: ghost.y + 24 }),
					}}
				>
					{indicator}
				</div>
			)}
		</div>
	);
};
