const TAU = 2 * Math.PI;
const ARRIVAL_MS = 4500;
const STEER_MS = 620;
const MAX_DPR = 1.5;
const LIGHT_LEVELS = 8;
const MARK_Y = 150; // Matches the canvas's CSS offset from the fixed mark slot.
const TURN_INPUT = 0.32;
const LIFT_INPUT = 10;

const unit = (value: number) => Math.max(0, Math.min(1, value));
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
	const flank = feather(Math.abs(axis) / 0.16);
	const taper = feather(u / 0.25) * feather((1 - u) / 0.26);
	const open = feather(u / 0.145) * feather((1 - u) / 0.17);
	const squeeze = Math.min(1, width / 680);
	const phase =
		TAU * (2.76 * axis + 0.031 * Math.sin(TAU * axis)) +
		point.phase +
		pose.roll * (0.12 + 0.88 * flank);
	const depth = Math.cos(phase);
	const side = feather((axis + 0.24) / 0.53);
	// Unequal lobes borrow headroom above the glyph, not space from the
	// welcome line. At rest the two centerlines intersect at the mark.
	const envelope = (91 - 20 * side + 10 * Math.sin(TAU * u)) * taper;
	// Collapse axial foreshortening at the crossing so both centerlines, not
	// just the mean of the two strands, actually meet the stationary glyph.
	const x = width * (0.5 + axis * 0.96) + depth * 9 * taper * squeeze * flank;
	const y =
		MARK_Y +
		squeeze *
			(-flank * (44 - 27 * side) +
				Math.sin(phase) * envelope * point.spread +
				point.grain * (0.33 + 0.67 * taper) +
				pose.lift * flank * taper);
	// The engraving survives on bare paper: the crossing passes through a
	// soft elliptical gap rather than painting a hard plate behind the mark.
	const recess = feather(
		(Math.hypot((x - width / 2) / 21, (y - MARK_Y) / 23) - 0.92) / 0.36,
	);
	const lower = feather((y - MARK_Y - 24) / 21);
	const copySpace = 1 - lower * feather((0.31 - Math.abs(axis)) / 0.17);
	const breakup = 0.9 + 0.1 * Math.cos(43 * u + point.phase * 1.3) ** 2;
	const front = (depth + 1) / 2;
	target.x = x;
	target.y = y;
	target.alpha =
		open ** 1.75 *
		recess *
		copySpace ** 2 *
		breakup *
		point.weight *
		(0.59 + 0.41 * front) *
		(0.88 + 0.12 * (1 - side));
	target.radius = point.size * (0.72 + 0.28 * front) * (0.8 + 0.2 * squeeze);
	target.near = depth > -0.1;
}

export function trackNewChatHorizon(
	paper: HTMLElement,
	canvas: HTMLCanvasElement,
	quiet: boolean,
	previewEnabled = false,
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
	let arriving = !quiet && !reduced.matches && !forced.matches && !doc.hidden;
	let pose = arriving ? arrival(0) : REST;
	let arrivalStarted: number | undefined;
	let steerStarted: number | undefined;
	let pointer: { roll: number; lift: number } = { roll: 0, lift: 0 };
	let from = pointer;
	let toward = pointer;
	let bounds: DOMRect | undefined;
	let near: string;
	let far: string;
	const batches = Array.from(
		{ length: 2 * LIGHT_LEVELS },
		() => [] as number[],
	);
	const grain = { x: 0, y: 0, alpha: 0, radius: 0, near: false };

	const paint = () => {
		if (
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
			ctx.globalAlpha = ((1 + (i % LIGHT_LEVELS)) / LIGHT_LEVELS) * 0.92;
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
	const palette = () => {
		// Read resolved CSS colours (including light-dark), never the raw
		// custom property expression, and only on setup/palette changes.
		const style = view.getComputedStyle(canvas);
		near = style.color;
		far = style.outlineColor;
		paint();
	};
	const resize = () => {
		bounds = undefined;
		const nextWidth = canvas.clientWidth;
		const nextHeight = canvas.clientHeight;
		const nextDpr = Math.min(view.devicePixelRatio || 1, MAX_DPR);
		if (width === nextWidth && height === nextHeight && dpr === nextDpr) return;
		width = nextWidth;
		height = nextHeight;
		dpr = nextDpr;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		paint();
	};
	const canMove = () =>
		!quiet &&
		!reduced.matches &&
		!forced.matches &&
		!doc.hidden &&
		visible === true;
	const stop = () => {
		if (frame !== undefined) view.cancelAnimationFrame(frame);
		frame = undefined;
		arrivalStarted = steerStarted = undefined;
		canvas.dataset.loHorizonMotion = "still";
	};
	const tick = (now: number) => {
		frame = undefined;
		if (!canMove()) {
			stop();
			return;
		}
		let base = REST;
		if (arrivalStarted !== undefined) {
			const t = unit((now - arrivalStarted) / ARRIVAL_MS);
			base = arrival(t);
			if (t === 1) arrivalStarted = undefined;
		}
		if (steerStarted !== undefined) {
			// Even a late pointer move eases from the last painted pose, not
			// from the already-nearly-finished arrival clock.
			const t = unit((now - steerStarted) / STEER_MS);
			const ease = 1 - (1 - t) ** 3;
			pointer = {
				roll: from.roll + (toward.roll - from.roll) * ease,
				lift: from.lift + (toward.lift - from.lift) * ease,
			};
			if (t === 1) steerStarted = undefined;
		}
		pose = {
			advance: base.advance,
			roll: base.roll + pointer.roll,
			lift: pointer.lift,
		};
		paint();
		if (arrivalStarted === undefined && steerStarted === undefined) stop();
		else frame = view.requestAnimationFrame(tick);
	};
	const schedule = () => {
		if (frame !== undefined) return;
		canvas.dataset.loHorizonMotion = "running";
		frame = view.requestAnimationFrame(tick);
	};
	const begin = () => {
		arriving = false;
		arrivalStarted = view.performance.now();
		steerStarted = undefined;
		from = pointer = toward = { roll: 0, lift: 0 };
		pose = arrival(0);
		paint();
		schedule();
	};
	const steer = (roll: number, lift: number) => {
		if (roll === toward.roll && lift === toward.lift) return;
		toward = { roll, lift };
		steerStarted = view.performance.now();
		from = pointer;
		schedule();
	};
	const move = (event: PointerEvent) => {
		if (event.pointerType !== "mouse" || !canMove()) return;
		bounds ??= paper.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		const x = unit((event.clientX - bounds.left) / bounds.width) * 2 - 1;
		const y = unit((event.clientY - bounds.top) / bounds.height) * 2 - 1;
		steer(x * TURN_INPUT, y * LIFT_INPUT);
	};
	const leave = (event: PointerEvent) => {
		if (event.pointerType !== "mouse" || !canMove()) return;
		bounds = undefined;
		steer(0, 0);
	};
	const suspend = () => {
		// A hidden or interrupted arrival never restarts by itself. On return
		// the paper already holds its full settled impression.
		arriving = false;
		stop();
		pose = REST;
		from = pointer = toward = { roll: 0, lift: 0 };
		bounds = undefined;
		if (forced.matches && width && height) ctx.clearRect(0, 0, width, height);
		resize();
		paint();
	};
	const preview = (event: Event) => {
		if (!canMove()) return;
		const time: unknown = (event as CustomEvent<unknown>).detail;
		stop();
		if (typeof time === "number" && Number.isFinite(time)) {
			// Capture tools can seek a deterministic instant without wall-clock
			// races. No controls or other public UI are introduced for this hook.
			from = pointer = toward = { roll: 0, lift: 0 };
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
	return () => {
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
	};
}
