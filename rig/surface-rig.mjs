/**
 * Evidence rig for the surface pass: the built app, headless, driven through the
 * app's own dev driver, photographed with `capturePage()`. The checkerboard is
 * the two-layer reconstruction the glass work uses: it is painted on <html> (the
 * document is transparent under glass), so a translucent ground shows it through.
 *
 * Scratch only; not committed. Run: node surface-rig.mjs --out <dir>
 */
/* The driver bundles against THIS checkout's node_modules (electron), so the rig is
 * run with the product repo as cwd; the import is resolved from there rather than
 * from a machine-local absolute path. */
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";

const { rendererDriverApi } = await import(`${process.cwd()}/scripts/renderer-driver.mjs`);

const {
	CdpClient,
	launchApp,
	prepareDriverContext,
	waitForPage,
	waitForBridge,
	verb,
	capture,
	reapLiveBoots,
} = rendererDriverApi;

const API = "http://127.0.0.1:8080";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const ctx = prepareDriverContext({ apiUrl: API });
/*
 * The daemon's own serve record is how the app learns the token this run's
 * backend minted; the CLI does this in `main()` and an importable caller has to
 * do it itself (`linkServeRecords` is not exported).
 */
{
	const { mkdirSync, readdirSync, symlinkSync, existsSync } = await import("node:fs");
	const from = process.env.RIG_SERVE_RECORDS;
	const to = joinPath(ctx.config, "run", "serve");
	mkdirSync(to, { recursive: true });
	if (from && existsSync(from)) {
		for (const entry of readdirSync(from)) {
			if (!entry.endsWith(".json")) continue;
			const target = joinPath(to, entry);
			if (!existsSync(target)) symlinkSync(joinPath(from, entry), target);
		}
		log("serve record linked from", from);
	} else log("NO SERVE RECORD (set RIG_SERVE_RECORDS)", from ?? "");
}
const handle = await launchApp({ armed: true, apiUrl: API, tag: "surface" });
log("launched", handle.pid, "port", handle.port);

let cdp;
try {
	cdp = await CdpClient.attach(handle.port, "index.html", 90_000);
	await waitForPage(cdp);
	await waitForBridge(cdp);

	/* Onboarding off, so no modal covers the frames. One reload, once. */
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source: `try{localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));}catch(e){}`,
	});
	await cdp.send("Page.reload", { ignoreCache: true });
	await waitForPage(cdp);
	await waitForBridge(cdp);
	await wait(1200);

	async function setTheme(name) {
		await verb(cdp, "setTheme", name);
		await wait(500);
	}
	async function setGlass(patch) {
		await cdp.evaluate(
			`window.api.windowGlass.set(${JSON.stringify(patch)}).then(() => true)`,
		);
		await wait(900);
	}
	async function flat(hex) {
		await cdp.evaluate(`(() => {
      const e = document.documentElement;
      e.style.backgroundImage = "none";
      e.style.backgroundColor = ${JSON.stringify(hex)};
      return true;
    })()`);
		await wait(300);
	}
	async function checker() {
		await cdp.evaluate(`(() => {
      const e = document.documentElement;
      e.style.backgroundColor = "#6f6f6f";
      e.style.backgroundImage =
        "linear-gradient(45deg,#9a9a9a 25%,transparent 25%,transparent 75%,#9a9a9a 75%)," +
        "linear-gradient(45deg,#9a9a9a 25%,transparent 25%,transparent 75%,#9a9a9a 75%)";
      e.style.backgroundSize = "24px 24px";
      e.style.backgroundPosition = "0 0,12px 12px";
      return true;
    })()`);
	}
	async function state() {
		return cdp.evaluate(`(() => ({
      glass: document.documentElement.dataset.glass ?? null,
      theme: document.documentElement.dataset.theme ?? null,
      route: location.hash,
      panes: [...document.querySelectorAll('[data-glass-region="pane"]')].map(e => {
        const s = getComputedStyle(e);
        return { label: e.getAttribute("aria-label") || e.dataset.tourTag || "", bg: s.backgroundColor };
      }),
      planes: [...document.querySelectorAll('[data-glass-plane]')].slice(0, 8).map(e => ({
        plane: e.dataset.glassPlane,
        bg: getComputedStyle(e).backgroundColor,
      })),
      lanes: [...document.querySelectorAll('[data-glass-lane]')].map(e => ({
        bg: getComputedStyle(e).backgroundColor,
      })),
    }))()`);
	}
	async function go(path) {
		await verb(cdp, "navigate", path);
		await wait(1300);
	}
	async function press(selector, ms = 500) {
		const r = await verb(cdp, "press", { selector });
		await wait(ms);
		return r;
	}
	async function shot(label) {
		const frame = await capture(cdp, label);
		log("frame", label, frame?.path ?? frame);
		return frame;
	}

	const OUT = process.argv.includes("--out")
		? process.argv[process.argv.indexOf("--out") + 1]
		: "frames";
	await checker();
	await setTheme("localOperatorDark");
	await setGlass({
		enabled: true,
		coverage: "full",
		intensity: 80,
		material: "window",
	});
	log("state after glass", JSON.stringify(await state(), null, 2));

	await go("/chat");
	await wait(1500);
	await shot("00-chat-dark-glass80");

	/* Open the rail pane on the Files view. */
	await press('[data-tour-tag="open-canvas-button"]', 900);
	await shot("01-canvas-open-empty");
	const docs = [
		"docs/branding.md",
		"AGENTS.md",
		"package.json",
		"src/renderer/src/styles/index.css",
		"src/renderer/src/features/projects/components/project-board.tsx",
		"README.md",
		"docs/agent-driver.md",
		"build/icon.png",
		"build/icon.icns",
		"build/license_en.txt",
		"tsconfig.json",
		"biome.json",
		"electron.vite.config.js",
		"pnpm-lock.yaml",
		"CODE_OF_CONDUCT.md",
		"SECURITY.md",
		"CONTRIBUTING.md",
		"THIRD_PARTY_NOTICES.md",
	];
	for (const [i, p] of docs.entries()) {
		await verb(cdp, "openCanvasDocument", {
			path: joinPath(process.env.RIG_REPO ?? process.cwd(), p),
			mention: true,
		});
	}
	await wait(800);
	await press('[data-tour-tag="canvas-files-view-button"]', 900);
	await shot("02-files-empty-dark");
	log("files state", JSON.stringify(await state(), null, 2));
	/* The grid is EMPTY on this isolated daemon: the index capability is present
	 * but no session tool call produced files, and the canvas store's mentioned
	 * files feed the fallback mode only (see the PR's stated limitation). The old
	 * `02-files-populated` / `03-files-scrolled` labels claimed a populated grid
	 * the frames did not show - round 1, F4/D1. One honest empty frame here. */
	await cdp.evaluate(
		`document.querySelector('[data-tour-tag="files-scroller"]')?.scrollTo(0, 900)`,
	);
	await wait(600);
	log("files scroll", JSON.stringify(await cdp.evaluate(`(() => {
      const el = document.querySelector('[data-tour-tag="files-scroller"]');
      return el ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight } : null;
    })()`)));
	await cdp.evaluate(
		`document.querySelector('[data-tour-tag="files-scroller"]')?.scrollTo(0, 0)`,
	);
	await press('[data-tour-tag="canvas-documents-view-button"]', 900);
	await shot("04-document-markdown");
	await flat("#515151");
	await shot("04b-document-flat-dark");
	await checker();

	/* The four media viewers (round 1, F3 / Q2): each was an opaque `bg-surface`
	 * bar and the audio body a second opaque plane. Fixtures are generated in
	 * this rig's scratchpad; the image is the repo's own icon. */
	const RIG_DIR = dirname(fileURLToPath(import.meta.url));
	const MEDIA = process.env.RIG_MEDIA ?? joinPath(RIG_DIR, "media");
	for (const [label, path] of [
		["20-image-viewer", joinPath(process.env.RIG_REPO ?? process.cwd(), "build/icon.png")],
		["21-video-viewer", `${MEDIA}/surface-clip.mp4`],
		["22-audio-viewer", `${MEDIA}/surface-tone.wav`],
		["23-pdf-viewer", `${MEDIA}/surface-doc.pdf`],
	]) {
		await verb(cdp, "openCanvasDocument", { path, mention: true });
		await wait(900);
		await shot(label);
		const chrome = await cdp.evaluate(`(() => {
      const bar = document.querySelector('[data-glass-plane="band"]');
      return { bar: bar ? getComputedStyle(bar).backgroundColor : null, glass: document.documentElement.dataset.glass ?? null };
    })()`);
		log(`${label} chrome`, JSON.stringify(chrome));
	}
	await press('[data-tour-tag="canvas-documents-view-button"]', 700);

	/* The other rail panes. */
	await press('[data-panel-rail-item="run"]', 900);
	await shot("05-run-details");
	log("run state", JSON.stringify(await state(), null, 2));
	/* No ASKS frame: the rail press is a no-op without a live `askScope` and this
	 * isolated daemon serves no queued asks (round 1, Q4/D1). Stated in the PR
	 * body rather than captured as the unchanged Run pane. */
	await press('[data-panel-rail-item="browser"]', 900);
	await shot("07-browser");
	await press('[data-panel-rail-item="console"]', 900);
	await shot("08-console");
	await press('[data-panel-rail-item="code"]', 900);
	await shot("09-code-review");

	/* Projects. */
	await go("/projects");
	await wait(1500);
	try {
		await press('[data-tour-tag="projects-view-switcher"] [role="tab"]', 500);
	} catch (e) {
		log("board tab press failed", String(e));
	}
	await shot("10-projects-view");
	/* Real pointer sequence for the Board tab (Radix activates on pointerdown). */
	const boardTab = await cdp.evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[data-tour-tag="projects-view-switcher"] [role="tab"]')];
    const tab = tabs.find(n => (n.textContent||'').trim() === 'Board');
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
	log("boardTab", JSON.stringify(boardTab));
	if (boardTab) {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: boardTab.x,
			y: boardTab.y,
			button: "left",
			clickCount: 1,
		});
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: boardTab.x,
			y: boardTab.y,
			button: "left",
			clickCount: 1,
		});
		await wait(1200);
	}
	await shot("11-projects-board-dark-glass80");
	await flat("#515151");
	await shot("11b-projects-board-flat-dark");
	await checker();
	log("board lanes", JSON.stringify(await state(), null, 2));

	/* The List view, scrolled, so the sticky team header sits over moving rows. */
	const listTab = await cdp.evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[data-tour-tag="projects-view-switcher"] [role="tab"]')];
    const tab = tabs.find(n => (n.textContent||'').trim() === 'List');
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
	if (listTab) {
		await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: listTab.x, y: listTab.y, button: "left", clickCount: 1 });
		await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: listTab.x, y: listTab.y, button: "left", clickCount: 1 });
		await wait(1200);
		const scrolled = await cdp.evaluate(`(() => {
      const list = [...document.querySelectorAll('main ul')].find(n => n.scrollHeight > n.clientHeight + 40);
      if (!list) return null;
      list.scrollTop = 700;
      return { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight };
    })()`);
		log("list scroll", JSON.stringify(scrolled));
		await wait(500);
	}
	await shot("16-projects-list-scrolled");

	/* BOARD, not the List tab, for the glass-off pair (round 1, F4): the rig used
	 * to disable glass right after the List scroll, so 12 depicted List while the
	 * table claimed Board. Press Board first, then disable; the same press is
	 * reused for the light frame below. */
	if (boardTab) {
		await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: boardTab.x, y: boardTab.y, button: "left", clickCount: 1 });
		await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: boardTab.x, y: boardTab.y, button: "left", clickCount: 1 });
		await wait(1200);
	}
	await setGlass({ enabled: false });
	await wait(1000);
	await shot("12-projects-board-dark-glass-off");
	await setGlass({ enabled: true, coverage: "full", intensity: 80, material: "window" });

	/* Light theme, board + rail. */
	await setTheme("localOperatorLight");
	await wait(800);
	if (boardTab) {
		await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: boardTab.x, y: boardTab.y, button: "left", clickCount: 1 });
		await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: boardTab.x, y: boardTab.y, button: "left", clickCount: 1 });
		await wait(1000);
	}
	await shot("13-projects-board-light-glass80");
	await setGlass({ enabled: false });
	await wait(1000);
	await shot("12b-projects-board-light-glass-off");
	await setGlass({ enabled: true, coverage: "full", intensity: 80, material: "window" });
	log("light board", JSON.stringify(await state(), null, 2));
	log("light board grounds", JSON.stringify(await cdp.evaluate(`(() => {
    const pick = (sel) => { const e = document.querySelector(sel); return e ? { bg: getComputedStyle(e).backgroundColor, cls: String(e.className).slice(0,80) } : null; };
    return {
      columnHeader: pick('header[data-board-column]'),
      lane: pick('[data-glass-lane]'),
      card: pick('[data-glass-block]'),
      main: pick('main[data-glass-region="canvas-backing"]'),
      page: pick('main [data-glass-region="canvas"]'),
      theme: document.documentElement.dataset.theme,
    };
  })()`), null, 2));
	await go("/chat");
	await press('[data-tour-tag="open-canvas-button"]', 800);
	await press('[data-tour-tag="canvas-files-view-button"]', 800);
	await shot("14-files-light");
	await press('[data-panel-rail-item="run"]', 800);
	await shot("15-run-details-light");
	log("done");
} catch (error) {
	console.error("RIG ERROR", error?.stack ?? error);
} finally {
	if (cdp) cdp.close();
	await reapLiveBoots({ code: 0, why: "surface rig finished" });
}
