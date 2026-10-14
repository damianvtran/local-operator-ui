/** Real CDP events over the shipped Files view; no alternate UI or layout model. */
export async function finderDelta({
	cdp,
	capture,
	sleep,
	label,
	theme,
	expectOld = false,
}) {
	const result = {};
	const read = () =>
		cdp.evaluate(
			`(()=>{const s=document.querySelector('[data-tour-tag="files-scroller"]');const input=document.querySelector('[data-tour-tag="files-scanner-head"] input');const dock=document.querySelector('[data-tour-tag="canvas-dock"]');const box=n=>{const r=n?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height}:null};return {dock:box(dock),rows:document.querySelectorAll('[data-tour-tag="file-row"]').length,query:input?.value,body:s?.innerText,active:document.activeElement?.innerText,activeRow:document.activeElement?.closest('[data-file-id]')?.getAttribute('data-file-id'),scroll:box(s),controlBoxes:[...document.querySelectorAll('[data-tour-tag="files-scanner-head"] input,[data-tour-tag="files-scanner-head"] button')].map(box),headers:[...s?.querySelectorAll('h3')??[]].map(h=>({label:h.innerText,top:h.getBoundingClientRect().top})),overflow:s?{client:s.clientWidth,scroll:s.scrollWidth}:null};})()`,
		);
	const key = async (k, modifiers = 0) => {
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: k,
			modifiers,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: k,
			modifiers,
		});
		await sleep(150);
	};
	const click = async (expression) => {
		const point = await cdp.evaluate(
			`(()=>{const el=${expression};if(!el)throw new Error('Missing click target');const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`,
		);
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...point,
		});
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			clickCount: 1,
			...point,
		});
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			clickCount: 1,
			...point,
		});
		await sleep(300);
	};
	const shot = async (name) =>
		(await capture(cdp, `finder-${label}-${name}-${theme}`)).path;
	const search = async (text) => {
		await click(
			`document.querySelector('[data-tour-tag="files-scanner-head"] input')`,
		);
		await key("a", 4);
		await cdp.send("Input.insertText", { text });
		await sleep(300);
	};
	const menuItem = (text) =>
		`[...document.querySelectorAll('[role="menuitemcheckbox"],[role="menuitem"]')].find(n=>n.textContent.trim()===${JSON.stringify(text)})`;
	result.initial = await read();
	const working = await cdp.evaluate(
		"[...document.querySelectorAll('h3 button')].some(n=>n.textContent.includes('Working files')&&n.getAttribute('aria-expanded')==='false')",
	);
	if (working)
		await click(
			"[...document.querySelectorAll('h3 button')].find(n=>n.textContent.includes('Working files'))",
		);
	await sleep(600);
	result.expanded = await read();
	result.sortActivation = "pointer";
	await click(`document.querySelector('button[aria-label^="Sort"]')`);
	// A prior portal can consume the outside press only to dismiss itself.
	// Observe the actual menu before photographing it; keyboard activation on
	// the same shipped trigger is the deterministic accessibility fallback.
	if (
		!(await cdp.evaluate(
			"Boolean(document.querySelector('[role=menuitemcheckbox]'))",
		))
	) {
		await cdp.evaluate(
			"document.querySelector('button[aria-label^=Sort]').focus()",
		);
		await key("Enter");
		result.sortActivation = "keyboard-after-outside-dismissal";
	}
	if (
		!(await cdp.evaluate(
			"Boolean(document.querySelector('[role=menuitemcheckbox]'))",
		))
	)
		throw new Error("Sort menu did not open");
	result.sortFrame = await shot("sort-menu");
	await click(menuItem("Size"));
	// The pointer deliberately remains where the menu item was, over the list.
	result.sortSamples = [];
	for (let n = 0; n < 10; n++) {
		await sleep(250);
		result.sortSamples.push(await read());
	}
	if (
		!expectOld &&
		result.sortSamples.some((s) => !s.rows || s.body?.includes("No files yet"))
	)
		throw new Error("Pointer-engaged sort painted a false empty inventory");
	result.sortedFrame = await shot("sort-pointer");
	await click(`document.querySelector('button[aria-label^="Filter:"]')`);
	result.filterFrame = await shot("filter-menu");
	await key("Escape");
	await click(
		"[...document.querySelectorAll('h3 button')].find(n=>n.textContent.includes('Highlights'))",
	);
	await search("file-0000");
	result.narrowed = await read();
	result.narrowedFrame = await shot("narrowed");
	if (!expectOld && !result.narrowed.rows)
		throw new Error("Collapsed Highlights hid its narrowed match");
	await key("Escape");
	result.searchEscape = await read();
	if (
		!expectOld &&
		(!result.searchEscape.dock || result.searchEscape.query !== "")
	)
		throw new Error("Search Escape escaped its scope");
	if (!result.searchEscape.dock) {
		await click(
			`document.querySelector('[data-tour-tag="open-canvas-button"]')`,
		);
		await sleep(600);
		await click(
			`document.querySelector('button[aria-label^="Files"][aria-pressed]')`,
		);
		await sleep(800);
	}
	// The live scroller and sticky header positions, not a pure layout guess.
	await cdp.evaluate(
		`(()=>{const s=document.querySelector('[data-tour-tag="files-scroller"]');s.scrollTop=s.scrollHeight/2;s.dispatchEvent(new Event('scroll'));})()`,
	);
	await sleep(350);
	result.scrolling = await read();
	result.scrollingFrame = await shot("scrolling");
	await sleep(1200);
	result.resting = await read();
	result.restingFrame = await shot("resting");
	const pinned = result.resting.headers.filter(
		(h) =>
			h.top >= result.resting.scroll.y - 1 &&
			h.top <= result.resting.scroll.y + 12,
	);
	result.stickyOffset = pinned.length
		? Math.min(...pinned.map((h) => h.top)) - result.resting.scroll.y
		: null;
	if (
		!expectOld &&
		result.stickyOffset !== null &&
		Math.abs(result.stickyOffset) > 1
	)
		throw new Error("Sticky header does not meet scroller top");
	await cdp.evaluate(
		`(()=>{const s=document.querySelector('[data-tour-tag="files-scroller"]');s.scrollTop=0;s.dispatchEvent(new Event('scroll'));})()`,
	);
	await sleep(300);
	await search("file-0001.mp4");
	result.video = await read();
	result.videoFrame = await shot("video-band");
	await key("Escape");
	if (!result.searchEscape.dock) {
		// Old-control Escape closes the dock again; reopen without changing its code.
		await click(
			`document.querySelector('[data-tour-tag="open-canvas-button"]')`,
		);
		await sleep(600);
		await click(
			`document.querySelector('button[aria-label^="Files"][aria-pressed]')`,
		);
		await sleep(800);
	}
	await cdp.evaluate(
		`document.querySelector('[data-tour-tag="file-row"] > button')?.focus()`,
	);
	await key("F10", 8);
	await key("Escape");
	result.menuClose = await read();
	if (!expectOld && !result.menuClose.activeRow)
		throw new Error("Menu close left focus outside its visible file row");
	await key("ArrowDown");
	result.afterArrow = await read();
	result.focusFrame = await shot("focus");
	return result;
}
