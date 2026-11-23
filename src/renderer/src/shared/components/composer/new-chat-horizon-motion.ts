const TAU = 2 * Math.PI;
const ARRIVAL_MS = 4500;
// A stationary target gets ~26% of the turn on the first 60 Hz paint and
// ~90% by 127 ms. This is a response constant, not a per-event duration.
const STEER_RESPONSE_MS = 55;
const STEER_SETTLE_FRACTION = 0.002; // The residual roll/lift is subpixel.
const PAINT_PERIOD = 1000 / 60;
const RAF_LEEWAY_MS = 1; // 60/120 Hz timestamps jitter around the paint deadline.
const LATE_FRAME_MS = 28;
const LATE_FRAME_STREAK = 4;
const MAX_DPR = 1.5;
const LIGHT_LEVELS = 8;
const MARK_Y = 150; // Matches the canvas's CSS offset from the fixed mark slot.
const TURN_INPUT = 0.32;
const LIFT_INPUT = 10;

const unit = (value: number) => Math.max(0, Math.min(1, value));
const sameClamped = (a: number, b: number, min: number, max: number) =>
	a === b || (a <= min && b <= min) || (a >= max && b >= max);
const feather = (value: number) => {
	const t = unit(value);
	return t * t * (3 - 2 * t);
};

type Pose = { advance: number; roll: number; lift: number };
const REST: Pose = { advance: 0.14, roll: 0, lift: 0 };
const arrival = (time: number): Pose => ({
	// Keep some axial speed after the initial turn, then coast to a stop.
	advance: REST.advance * (1 - (1 - time) ** 2),
	roll: -1.85 * (1 - time) ** 2.7,
	lift: 0,
});

type Grain = {
	u: number;
	phase: number;
	spread: number;
	grain: number;
	weight: number;
	size: number;
	speed: number;
};

function etch(): Grain[] {
	let seed = 0x93b1;
	const sample = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	const grains: Grain[] = [];
	for (const [count, phase, spread, weight] of [
		[730, 0, 1, 1],
		[590, Math.PI, 1, 0.91],
		[198, 0.24, 0.84, 0.52],
		[143, Math.PI - 0.27, 0.81, 0.46],
	]) {
		for (let i = 0; i < count; i++) {
			grains.push({
				u: (i + sample()) / count,
				phase: phase + (sample() + sample() - 1) * 0.18,
				spread: spread + (sample() + sample() - 1) * 0.15,
				grain: (sample() + sample() - 1) * 8,
				// Let the continuous body carry the twist. Reserve thinner ink
				// for the inner filaments rather than breaking the main lanes.
				weight: weight * (0.72 + 0.28 * sample()),
				size: 0.46 + 1.16 * sample() ** 2.4,
				speed: 0.87 + 0.26 * sample(),
			});
		}
	}
	return grains;
}

const GRAINS = etch();

const AXIAL_STEPS = 1024;
const AXIAL_STRIDE = 7;
let axialTable: Float32Array | undefined;

function axialProfile() {
	// Axial shaping depends only on the wrapped position, not on pose, grain,
	// or sheet width. Interpolate the smooth terms from one shared 28 KiB table;
	// keep the twist, depth, recess and quantization in projected coordinates.
	const table = new Float32Array((AXIAL_STEPS + 1) * AXIAL_STRIDE);
	for (let i = 0; i <= AXIAL_STEPS; i++) {
		const u = i / AXIAL_STEPS;
		const axis = u - 0.5;
		const flank = feather(Math.abs(axis) / 0.16);
		const taper = feather(u / 0.25) * feather((1 - u) / 0.26);
		const open = feather(u / 0.145) * feather((1 - u) / 0.17);
		const side = feather((axis + 0.24) / 0.53);
		const offset = i * AXIAL_STRIDE;
		table[offset] = TAU * (2.76 * axis + 0.031 * Math.sin(TAU * axis));
		table[offset + 1] = flank;
		table[offset + 2] = taper;
		// Asymmetric lobes borrow headroom above the mark, not from the copy.
		table[offset + 3] = (91 - 20 * side + 10 * Math.sin(TAU * u)) * taper;
		table[offset + 4] = -flank * (44 - 27 * side);
		table[offset + 5] = open ** 1.75 * (0.88 + 0.12 * (1 - side));
		table[offset + 6] = feather((0.31 - Math.abs(axis)) / 0.17);
	}
	return table;
}

function axialAt(table: Float32Array, offset: number, fraction: number) {
	const left = table[offset];
	return left + (table[offset + AXIAL_STRIDE] - left) * fraction;
}

// Sample the helix at each grain's NEW axial position as it streams right.
// Roll changes projected depth and width as well as height. All three would
// stay identical under an affine move of an already-rendered flat texture.
export function projectHelix(
	point: Grain,
	pose: Pose,
	width: number,
	target: {
		x: number;
		y: number;
		alpha: number;
		radius: number;
		near: boolean;
	},
) {
	const position = point.u + pose.advance * point.speed;
	const u = position - Math.floor(position);
	const axis = u - 0.5;
	axialTable ??= axialProfile();
	const table = axialTable;
	const sample = u * AXIAL_STEPS;
	const index = Math.floor(sample);
	const offset = index * AXIAL_STRIDE;
	const fraction = sample - index;
	const flank = axialAt(table, offset + 1, fraction);
	const taper = axialAt(table, offset + 2, fraction);
	const squeeze = Math.min(1, width / 680);
	const phase =
		axialAt(table, offset, fraction) +
		point.phase +
		pose.roll * (0.12 + 0.88 * flank);
	const depth = Math.cos(phase);
	const envelope = axialAt(table, offset + 3, fraction);
	// Collapse axial foreshortening at the crossing so both centerlines, not
	// just the mean of the two strands, actually meet the stationary glyph.
	const x = width * (0.5 + axis * 0.96) + depth * 9 * taper * squeeze * flank;
	const y =
		MARK_Y +
		squeeze *
			(axialAt(table, offset + 4, fraction) +
				Math.sin(phase) * envelope * point.spread +
				point.grain * (0.33 + 0.67 * taper) +
				pose.lift * flank * taper);
	// The engraving survives on bare paper: the crossing passes through a
	// soft elliptical gap rather than painting a hard plate behind the mark.
	const dx = (x - width / 2) / 21;
	let recess = 1;
	// The vast majority of the sheet is outside the recess. Only the narrow
	// transition needs a square root; the interior and exterior already clip.
	if (Math.abs(dx) < 1.28) {
		const dy = (y - MARK_Y) / 23;
		const r2 = dx * dx + dy * dy;
		if (r2 < 1.28 ** 2) {
			recess = r2 <= 0.92 ** 2 ? 0 : feather((Math.sqrt(r2) - 0.92) / 0.36);
		}
	}
	const copySpace =
		y <= MARK_Y + 24
			? 1
			: 1 -
				feather((y - MARK_Y - 24) / 21) * axialAt(table, offset + 6, fraction);
	const breakup = 0.9 + 0.1 * Math.cos(43 * u + point.phase * 1.3) ** 2;
	const front = (depth + 1) / 2;
	target.x = x;
	target.y = y;
	target.alpha =
		axialAt(table, offset + 5, fraction) *
		recess *
		copySpace ** 2 *
		breakup *
		point.weight *
		(0.59 + 0.41 * front);
	target.radius = point.size * (0.72 + 0.28 * front) * (0.8 + 0.2 * squeeze);
	target.near = depth > -0.1;
}

export function trackNewChatHorizon(
	paper: HTMLElement,
	canvas: HTMLCanvasElement,
	initialQuiet: boolean,
	previewEnabled = false,
	initiallySuppressed = false,
) {
	const doc = paper.ownerDocument;
	const view = doc.defaultView;
	const ctx = view?.IntersectionObserver ? canvas.getContext("2d") : null;
	if (!view || !ctx) return;

	const reduced = view.matchMedia("(prefers-reduced-motion: reduce)");
	const forced = view.matchMedia("(forced-colors: active)");
	let frame: number | undefined;
	let width = 0;
	let height = 0;
	let dpr = 1;
	let visible: boolean | undefined;
	let quiet = initialQuiet;
	let suppressed = initiallySuppressed;
	let contextLost = false;
	// Picker and context events share one check in the paint/scheduling path.
	let canvasUnavailable = suppressed;
	let restoreTransform = false;
	let arriving =
		!quiet && !suppressed && !reduced.matches && !forced.matches && !doc.hidden;
	let pose = arriving ? arrival(0) : REST;
	let arrivalStarted: number | undefined;
	let pointerPaintedAt: number | undefined;
	let nextPaintAt: number | undefined;
	let wakeRequestedAt: number | undefined;
	let previousTick: number | undefined;
	let lateFrames = 0;
	let budgetLimited = false;
	const pointer = { roll: 0, lift: 0 };
	const toward = { roll: 0, lift: 0 };
	let latestX: number | undefined;
	let latestY = 0;
	let samplePending = false;
	let bounds: DOMRect | undefined;
	let near: string;
	let far: string;
	let light = false;
	const batches = Array.from(
		{ length: 2 * LIGHT_LEVELS },
		() => [] as number[],
	);
	const grain = { x: 0, y: 0, alpha: 0, radius: 0, near: false };

	const paint = () => {
		if (
			canvasUnavailable ||
			!width ||
			!height ||
			doc.hidden ||
			visible === false ||
			forced.matches
		) {
			return;
		}
		ctx.clearRect(0, 0, width, height);
		for (const batch of batches) batch.length = 0;
		for (const point of GRAINS) {
			projectHelix(point, pose, width, grain);
			const level = Math.round(grain.alpha * LIGHT_LEVELS);
			if (level === 0 || grain.y < -2 || grain.y > height + 2) continue;
			batches[(grain.near ? LIGHT_LEVELS : 0) + level - 1].push(
				grain.x,
				grain.y,
				grain.radius,
			);
		}
		// Only 16 fills, far ink first. The canvas is a bounded sheet; neither
		// particle nodes nor display lists for the rest of the pane change.
		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			if (!batch.length) continue;
			ctx.fillStyle = i < LIGHT_LEVELS ? far : near;
			const level = 1 + (i % LIGHT_LEVELS);
			const opacity = (level / LIGHT_LEVELS) * 0.92;
			// Lift only light paper's midtones: the finest grains still fade
			// at the same point and the brightest ink never exceeds dark's peak.
			ctx.globalAlpha =
				light && level > 1 && level < LIGHT_LEVELS ? opacity * 1.12 : opacity;
			ctx.beginPath();
			for (let j = 0; j < batch.length; j += 3) {
				const x = batch[j];
				const y = batch[j + 1];
				const radius = batch[j + 2];
				ctx.moveTo(x + radius, y);
				ctx.arc(x, y, radius, 0, TAU);
			}
			ctx.fill();
		}
	};
	const readPalette = () => {
		// Read resolved CSS colours (including light-dark), never the raw
		// custom property expression, and only on setup/palette changes.
		const style = view.getComputedStyle(canvas);
		near = style.color;
		far = style.outlineColor;
		light = style.colorScheme === "light";
	};
	const palette = () => {
		if (canvasUnavailable) return;
		readPalette();
		paint();
	};
	const resize = () => {
		if (canvasUnavailable) return false;
		bounds = undefined;
		const nextWidth = canvas.clientWidth;
		const nextHeight = canvas.clientHeight;
		const nextDpr = Math.min(view.devicePixelRatio || 1, MAX_DPR);
		if (width !== nextWidth || height !== nextHeight || dpr !== nextDpr) {
			width = nextWidth;
			height = nextHeight;
			dpr = nextDpr;
			canvas.width = Math.round(width * dpr);
			canvas.height = Math.round(height * dpr);
		} else if (!restoreTransform) return false;
		// Restoration resets drawing state even when backing dimensions are unchanged.
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		restoreTransform = false;
		paint();
		return true;
	};
	const canMove = () =>
		!canvasUnavailable &&
		!quiet &&
		!budgetLimited &&
		!reduced.matches &&
		!forced.matches &&
		!doc.hidden &&
		visible === true;
	const idle = () => {
		pointerPaintedAt = undefined;
		canvas.dataset.loHorizonMotion = "still";
	};
	const stop = () => {
		if (frame !== undefined) view.cancelAnimationFrame(frame);
		frame = undefined;
		arrivalStarted = nextPaintAt = wakeRequestedAt = previousTick = undefined;
		lateFrames = 0;
		idle();
	};
	const resetPointer = () => {
		latestX = bounds = undefined;
		samplePending = false;
		pointerPaintedAt = undefined;
		pointer.roll = toward.roll = 0;
		pointer.lift = toward.lift = 0;
	};
	const settle = () => {
		arriving = false;
		stop();
		pose = REST;
		resetPointer();
	};
	const steering = () =>
		pointer.roll !== toward.roll || pointer.lift !== toward.lift;
	const samplePointer = () => {
		samplePending = false;
		if (latestX === undefined) {
			toward.roll = toward.lift = 0;
			return;
		}
		bounds ??= paper.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		toward.roll =
			(unit((latestX - bounds.left) / bounds.width) * 2 - 1) * TURN_INPUT;
		toward.lift =
			(unit((latestY - bounds.top) / bounds.height) * 2 - 1) * LIFT_INPUT;
	};
	const tick = (now: number) => {
		frame = undefined;
		if (!canMove()) {
			stop();
			return;
		}
		// A dropped frame can be ordinary input or a resize; don't react to
		// one. A sustained ~30 Hz renderer should keep its time for the
		// composer. Settle once and don't retry until the next draft's splash.
		const waking = wakeRequestedAt !== undefined;
		// Small moves can settle on every paint, even on a busy renderer. Keep
		// counting across adjacent wakes; reset only if nobody requested work
		// for two late-frame intervals. Use the request time, not a potentially
		// delayed callback, to distinguish that input lapse from renderer lag.
		if (
			wakeRequestedAt !== undefined &&
			previousTick !== undefined &&
			wakeRequestedAt - previousTick > 2 * LATE_FRAME_MS
		) {
			previousTick = undefined;
		}
		wakeRequestedAt = undefined;
		lateFrames =
			previousTick !== undefined && now - previousTick > LATE_FRAME_MS
				? lateFrames + 1
				: 0;
		previousTick = now;
		if (lateFrames === LATE_FRAME_STREAK) {
			budgetLimited = true;
			settle();
			paint();
			return;
		}
		// Keep one time-based motion on 60/120/144 Hz displays without
		// repainting at the display refresh rate or accumulating drift.
		// Preserve the unsteered arrival's exact endpoint between deadlines;
		// active pointer motion (including its final snap) uses the paint budget.
		const arrivalEnded =
			arrivalStarted !== undefined && now - arrivalStarted >= ARRIVAL_MS;
		const sampledAtEnd = arrivalEnded && samplePending;
		if (sampledAtEnd) samplePointer();
		if (arrivalEnded && !steering()) {
			nextPaintAt = now + PAINT_PERIOD;
		} else {
			nextPaintAt ??= now;
			const eligibleAt = now + RAF_LEEWAY_MS;
			if (eligibleAt < nextPaintAt) {
				// This sample was only inspected to decide on the endpoint.
				// Resolve it at paint time too if the bounds change meanwhile.
				if (sampledAtEnd) samplePending = true;
				frame = view.requestAnimationFrame(tick);
				return;
			}
			// Keep the deadline across short idle gaps so a burst that settles
			// inside one step can't wake the canvas at the full refresh rate.
			if (waking) nextPaintAt = now + PAINT_PERIOD;
			else {
				const passed = Math.floor((eligibleAt - nextPaintAt) / PAINT_PERIOD);
				nextPaintAt += (1 + passed) * PAINT_PERIOD;
			}
		}
		if (samplePending) samplePointer();
		if (arrivalStarted === undefined && !steering()) {
			idle();
			return;
		}
		let base = REST;
		if (arrivalStarted !== undefined) {
			const t = unit((now - arrivalStarted) / ARRIVAL_MS);
			base = arrival(t);
			if (t === 1) arrivalStarted = undefined;
		}
		if (steering()) {
			// Time belongs to the painted pose, so even frame-aligned samples
			// can't starve it. On wake or a late paint, take one nominal step:
			// the latest target may have arrived just now and must not inherit
			// the idle/stall gap. Don't spend the surplus with catch-up draws.
			const elapsed =
				pointerPaintedAt === undefined ? PAINT_PERIOD : now - pointerPaintedAt;
			const step = elapsed > LATE_FRAME_MS ? PAINT_PERIOD : elapsed;
			const blend = -Math.expm1(-step / STEER_RESPONSE_MS);
			pointer.roll += (toward.roll - pointer.roll) * blend;
			pointer.lift += (toward.lift - pointer.lift) * blend;
			if (
				Math.abs(toward.roll - pointer.roll) <=
					TURN_INPUT * STEER_SETTLE_FRACTION &&
				Math.abs(toward.lift - pointer.lift) <=
					LIFT_INPUT * STEER_SETTLE_FRACTION
			) {
				pointer.roll = toward.roll;
				pointer.lift = toward.lift;
			}
		}
		pointerPaintedAt = steering() ? now : undefined;
		pose = {
			advance: base.advance,
			roll: base.roll + pointer.roll,
			lift: pointer.lift,
		};
		paint();
		if (arrivalStarted === undefined && !steering()) idle();
		else frame = view.requestAnimationFrame(tick);
	};
	const schedule = () => {
		if (frame !== undefined) return;
		wakeRequestedAt = view.performance.now();
		canvas.dataset.loHorizonMotion = "running";
		frame = view.requestAnimationFrame(tick);
	};
	const begin = () => {
		arriving = false;
		arrivalStarted = view.performance.now();
		resetPointer();
		pose = arrival(0);
		paint();
		schedule();
	};
	const move = (event: PointerEvent) => {
		if (event.pointerType !== "mouse" || !canMove()) return;
		const { clientX, clientY } = event;
		if ((bounds || samplePending) && latestX === clientX && latestY === clientY)
			return;
		// Off-paper coordinates already clamped to the same edge don't wake
		// an idle canvas, either. While running, leave all mapping to the paint.
		if (
			frame === undefined &&
			bounds &&
			latestX !== undefined &&
			sameClamped(clientX, latestX, bounds.left, bounds.left + bounds.width) &&
			sameClamped(clientY, latestY, bounds.top, bounds.top + bounds.height)
		)
			return;
		// Many events can land between paints. Keep only the newest coordinates;
		// even the surface rect is read lazily on the first eligible paint.
		latestX = clientX;
		latestY = clientY;
		samplePending = true;
		schedule();
	};
	const leave = (event: PointerEvent) => {
		if (event.pointerType !== "mouse" || !canMove()) return;
		bounds = undefined;
		if (latestX === undefined) return;
		latestX = undefined;
		samplePending = true;
		schedule();
	};
	const suspend = () => {
		if (canvasUnavailable) return;
		// A hidden or interrupted arrival never restarts by itself. On return
		// the paper already holds its full settled impression.
		settle();
		if (forced.matches && width && height) ctx.clearRect(0, 0, width, height);
		resize();
		paint();
	};
	const loseContext = () => {
		// Leave the event uncancelled so Chromium attempts restoration. Neither
		// rendering pressure nor a lost backing store should replay the entrance.
		contextLost = canvasUnavailable = true;
		settle();
	};
	const restoreContext = () => {
		if (!contextLost) return;
		contextLost = false;
		canvasUnavailable = suppressed;
		restoreTransform = true;
		if (canvasUnavailable) return;
		readPalette();
		resize();
	};
	const setPresentation = (nextQuiet: boolean, nextSuppressed: boolean) => {
		if (quiet === nextQuiet && suppressed === nextSuppressed) return;
		const revealing = suppressed && !nextSuppressed;
		quiet = nextQuiet;
		suppressed = nextSuppressed;
		canvasUnavailable = suppressed || contextLost;
		// The picker and readiness changes are interruptions of this draft,
		// not a fresh entrance. In particular, leave its budget fallback intact.
		settle();
		if (canvasUnavailable) return;
		if (revealing) readPalette();
		if (!resize()) paint();
	};
	const preview = (event: Event) => {
		if (!canMove()) return;
		const time: unknown = (event as CustomEvent<unknown>).detail;
		stop();
		if (typeof time === "number" && Number.isFinite(time)) {
			// Capture tools can seek a deterministic instant without wall-clock
			// races. No controls or other public UI are introduced for this hook.
			resetPointer();
			pose = arrival(unit(time));
			paint();
		} else begin();
	};

	palette();
	resize();
	stop();
	const size = new view.ResizeObserver(resize);
	size.observe(canvas);
	size.observe(paper);
	const windowed = new view.IntersectionObserver(([entry]) => {
		if (!entry || entry.isIntersecting === visible) return;
		visible = entry.isIntersecting;
		if (canvasUnavailable) return;
		// Layout paint is immediate, but autoplay needs actual intersection.
		if (arriving && canMove() && width && height) begin();
		else suspend();
	});
	windowed.observe(canvas);
	const theme = new view.MutationObserver(palette);
	const themeOptions = { attributeFilter: ["data-theme"] };
	theme.observe(doc.documentElement, themeOptions);
	const scopedTheme = canvas.closest("[data-theme]");
	if (scopedTheme && scopedTheme !== doc.documentElement) {
		theme.observe(scopedTheme, themeOptions);
	}
	reduced.addEventListener("change", suspend);
	forced.addEventListener("change", suspend);
	view.addEventListener("resize", resize);
	doc.addEventListener("visibilitychange", suspend);
	paper.addEventListener("pointermove", move, { passive: true });
	paper.addEventListener("pointerleave", leave, { passive: true });
	paper.addEventListener("pointercancel", leave, { passive: true });
	if (previewEnabled) canvas.addEventListener("lo:horizon-preview", preview);
	canvas.addEventListener("contextlost", loseContext);
	canvas.addEventListener("contextrestored", restoreContext);
	return {
		setPresentation,
		dispose() {
			stop();
			size.disconnect();
			windowed.disconnect();
			theme.disconnect();
			reduced.removeEventListener("change", suspend);
			forced.removeEventListener("change", suspend);
			view.removeEventListener("resize", resize);
			doc.removeEventListener("visibilitychange", suspend);
			paper.removeEventListener("pointermove", move);
			paper.removeEventListener("pointerleave", leave);
			paper.removeEventListener("pointercancel", leave);
			if (previewEnabled)
				canvas.removeEventListener("lo:horizon-preview", preview);
			canvas.removeEventListener("contextlost", loseContext);
			canvas.removeEventListener("contextrestored", restoreContext);
		},
	};
}
