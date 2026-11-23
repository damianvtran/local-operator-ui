// Serialized into the route-tops CDP evaluation. Keep the read in the same
// layout snapshot as the lane and strip probes; no outer-scope dependencies.
export function readRouteFrame(document, main, box, roleGround) {
	const outletFrames = Array.from(
		main?.querySelectorAll(
			":scope > [data-workspace-frame-shell] > [data-workspace-frame]",
		) ?? [],
	);
	// Count structural outlet ownership separately from painted body ownership.
	// The latter includes route-owned bodies, but not a hidden Suspense copy.
	const visibleBox = (el) => {
		const bounds = box(el);
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
		const style = getComputedStyle(el);
		return style.visibility === "visible" &&
			style.display !== "none" &&
			style.display !== "contents" &&
			style.opacity !== "0"
			? bounds
			: null;
	};
	const effectiveFrames = Array.from(
		document.querySelectorAll("[data-workspace-frame]"),
	).filter(visibleBox);
	const frame = effectiveFrames.length === 1 ? effectiveFrames[0] : null;
	const shell = frame?.parentElement?.matches("[data-workspace-frame-shell]")
		? frame.parentElement
		: null;
	const frameOwner =
		!frame || !main?.contains(frame)
			? null
			: outletFrames.includes(frame)
				? "outlet"
				: frame.hasAttribute("data-workspace-inset")
					? "chat"
					: frame.hasAttribute("data-workspace-browser")
						? "browser"
						: null;
	const routeChild = (el) =>
		Array.from(el?.children ?? []).find(
			(child) =>
				!child.hasAttribute("data-chrome-route-band") &&
				getComputedStyle(child).display !== "none",
		) ?? null;
	let route = routeChild(outletFrames[0] ?? main);
	while (route && getComputedStyle(route).display === "contents") {
		route = routeChild(route);
	}
	// The chrome has to be a sibling of the body, not a row found inside it
	// (e.g. Chat's embedded Browser). Read Browser's reserved pending row too.
	const chromeHost = shell?.parentElement ?? null;
	const chrome =
		frameOwner === "chat"
			? chromeHost?.querySelector(":scope > [data-workspace-tabs]")
			: frameOwner === "browser"
				? chromeHost?.querySelector(
						":scope > :is([data-browser-route-chrome], [data-browser-route-pending-chrome])",
					)
				: null;
	const browserPending =
		chrome?.hasAttribute("data-browser-route-pending-chrome") ?? false;
	const chromeTail =
		chromeHost && frameOwner === "browser" && !browserPending
			? Array.from(
					chromeHost.querySelectorAll(
						':scope > div[aria-live="polite"], :scope > [data-tour-tag="browser-error"]',
					),
				)
					.map(visibleBox)
					.filter(Boolean)
			: [];
	const frameStyle = frame ? getComputedStyle(frame) : null;
	const perimeterStyle = shell ? getComputedStyle(shell, "::before") : null;
	const sidebarGlass = document.documentElement.matches(
		'html[data-glass~="sidebar"]',
	);
	const perimeterRole = sidebarGlass ? "--lo-glass-g-surface" : "--lo-surface";
	return {
		route,
		geometry: {
			outletFrames: outletFrames.length,
			effectiveFrames: effectiveFrames.length,
			frameOwner,
			frame: visibleBox(frame),
			shell: visibleBox(shell),
			frameRadius: frameStyle?.borderStartStartRadius ?? null,
			frameShadow: frameStyle?.boxShadow ?? null,
			frameBorder: frameStyle?.borderInlineStartWidth ?? null,
			frameClip: frameStyle?.overflow ?? null,
			chrome: visibleBox(chrome),
			chromeTail,
			chromePad: chrome
				? Number.parseFloat(getComputedStyle(chrome).paddingTop)
				: null,
			browserPending,
			perimeter: {
				shapeSupported: CSS.supports(
					"clip-path",
					"shape(from 0 0, line to 100% 100%, close)",
				),
				content: perimeterStyle?.content ?? null,
				display: perimeterStyle?.display ?? null,
				clip: perimeterStyle?.clipPath ?? null,
				paint: perimeterStyle?.backgroundColor ?? null,
				role: perimeterRole,
				rolePaint: roleGround(perimeterRole),
			},
		},
	};
}

export function checkRouteFrame(path, owner, reading, check) {
	const { frame, shell, main, band, bandDisplay, chrome, perimeter } = reading;
	const near = (a, b) => Math.abs(a - b) < 0.5; // CDP boxes are rounded to 0.01px.
	const end = (box) => box.top + box.height;
	const visibleBand = band && bandDisplay !== "none" ? band.height : 0;
	check(
		`${path}: ${owner} owns the one visible workspace frame`,
		reading.outletFrames === (owner === "outlet" ? 1 : 0) &&
			reading.effectiveFrames === 1 &&
			reading.frameOwner === owner,
		`outlet ${reading.outletFrames}; visible ${reading.effectiveFrames}; owner ${reading.frameOwner}`,
	);
	if (owner === "outlet") {
		check(
			`${path}: the outlet uses one clearance and the route body starts at the frame top`,
			!!frame &&
				!!main &&
				!!reading.route &&
				near(frame.top, main.top + reading.mainPad + visibleBand) &&
				near(reading.route.top, frame.top),
			JSON.stringify({
				frame,
				main,
				route: reading.route,
				pad: reading.mainPad,
				visibleBand,
			}),
		);
	} else {
		// Integrated Chat moves the tabs into the OS clearance; fullscreen/native
		// leaves the shell pad above them. Browser's chrome starts at the main top
		// and spends the shell pad inside its own row (or pending placeholder).
		const chromeTop =
			main &&
			main.top +
				(owner === "chat" &&
				!(reading.mode === "integrated" && !reading.fullscreen)
					? reading.mainPad
					: 0);
		let chromeEnd = chrome ? end(chrome) : null;
		let rowsAbut = true;
		for (const row of reading.chromeTail) {
			rowsAbut &&= chromeEnd !== null && near(row.top, chromeEnd);
			chromeEnd = end(row);
		}
		check(
			`${path}: one clearance with route chrome outside and directly above its body frame`,
			!!main &&
				!!chrome &&
				!!frame &&
				band === null &&
				near(chrome.top, chromeTop) &&
				rowsAbut &&
				near(frame.top, chromeEnd) &&
				end(chrome) >= main.top + reading.mainPad - 0.5 &&
				(owner !== "browser" ||
					reading.browserPending ||
					near(reading.chromePad, reading.mainPad)),
			JSON.stringify({
				frame,
				main,
				chrome,
				chromeTop,
				chromeEnd,
				chromeTail: reading.chromeTail,
				pad: reading.mainPad,
				chromePad: reading.chromePad,
				band,
			}),
		);
	}
	check(
		`${path}: the frame keeps 8px side and bottom gutters and no extra top gap`,
		!!frame &&
			!!shell &&
			!!main &&
			near(shell.left, main.left) &&
			near(shell.width, main.width) &&
			near(end(shell), end(main)) &&
			near(frame.top, shell.top) &&
			near(frame.left - shell.left, 8) &&
			near(shell.left + shell.width - frame.left - frame.width, 8) &&
			near(end(shell) - end(frame), 8),
		JSON.stringify({ frame, shell, main }),
	);
	check(
		`${path}: 10px clipped corners without an edge or shadow`,
		reading.frameRadius === "10px" &&
			reading.frameClip === "clip" &&
			reading.frameBorder === "0px" &&
			reading.frameShadow === "none",
		`radius ${reading.frameRadius}, overflow ${reading.frameClip}, border ${reading.frameBorder}, shadow ${reading.frameShadow}`,
	);
	// This is computed CSS only: shape/role readback does not sample the PNG
	// or tell us what a native material composites behind translucent paint.
	const generated = perimeter.content === '""' && perimeter.display !== "none";
	const painted =
		perimeter.paint !== null &&
		!["transparent", "rgba(0, 0, 0, 0)"].includes(perimeter.paint) &&
		perimeter.paint === perimeter.rolePaint;
	check(
		`${path}: computed gutter paint follows shape() support and the shell surface role`,
		!!shell &&
			(perimeter.shapeSupported
				? generated && perimeter.clip?.startsWith("shape(") && painted
				: ["none", "normal"].includes(perimeter.content) &&
					perimeter.clip === "none"),
		JSON.stringify(perimeter),
		JSON.stringify(perimeter),
	);
}
