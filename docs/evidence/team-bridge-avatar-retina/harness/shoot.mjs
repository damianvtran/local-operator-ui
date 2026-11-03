/**
 * Retina avatar evidence (operator report 2026-11-03: "The avatar images show up
 * blurry in team bridge, can you make sure they're sharp at their sizes on retina
 * displays").
 *
 * One private headless Chrome (`withMockKeychain`, so a scratch profile never
 * reaches Keychain Services) driven over raw CDP at deviceScaleFactor 2 against a
 * Storybook the caller booted with `scripts/with-storybook.mjs`. For every avatar
 * surface it records, per <img>: naturalWidth, clientWidth, DPR and the
 * coverage ratio naturalWidth / (clientWidth x DPR) — below 1 means the browser
 * is upscaling the file, which is the blur — plus the Team Bridge agent mark's
 * box, and saves the full frame and a 4x nearest-neighbour crop of one plate.
 *
 * WHY THE MEDIA STUB IS WRAPPED. The shipped stories answer every avatar read
 * with the same asset whatever `size` was asked for, so a story frame cannot
 * show the variant choice at all. The hub stores exactly two square derivatives
 * (64 and 256 px, CatmullRom, JPEG q85 - agent-server
 * `account_avatar_image.go`), so this rig injects, before any story script
 * runs, a wrapper that answers a sized read with the matching derivative of a
 * synthetic 512 px test pattern (fine lines, text, rings: blur is visible).
 * `agent.avatar` (core's local agent picture) is answered with the 512 px
 * source whole, as core serves it. A failed/never-settling stub answer is
 * passed through untouched. No real person's picture is used.
 *
 * usage: node shoot.mjs <storybook-origin> <out-dir> <label>
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ORIGIN = process.argv[2] ?? process.env.STORYBOOK_ORIGIN;
const OUT = process.argv[3] ?? "frames";
const LABEL = process.argv[4] ?? "run";
const DPR = 2;
const WAIT_MS = 45_000;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* A detailed synthetic portrait: 1 px line pairs, small text and rings, so an
   upscaled 64 px file is visibly soft next to a 256 px one. */
const pattern = (hue, glyph) =>
	Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<defs><pattern id="l" width="4" height="4" patternUnits="userSpaceOnUse">
<rect width="2" height="4" fill="hsl(${hue},70%,30%)"/></pattern></defs>
<rect width="512" height="512" fill="hsl(${hue},60%,82%)"/>
<rect x="0" y="0" width="512" height="128" fill="url(#l)"/>
${Array.from({ length: 12 }, (_, i) => `<circle cx="256" cy="300" r="${20 + i * 16}" fill="none" stroke="hsl(${hue},70%,${25 + i * 4}%)" stroke-width="5"/>`).join("")}
<text x="256" y="360" font-family="Helvetica" font-weight="700" font-size="190" text-anchor="middle" fill="hsl(${hue},80%,20%)">${glyph}</text>
<text x="256" y="490" font-family="Helvetica" font-size="34" text-anchor="middle" fill="#111">FIXTURE 512</text>
</svg>`);
async function derivatives(hue, glyph) {
	const source = await sharp(pattern(hue, glyph)).png().toBuffer();
	const sized = async (side) =>
		(
			await sharp(source)
				.resize(side, side, { kernel: "cubic" })
				.jpeg({ quality: 85 })
				.toBuffer()
		).toString("base64");
	return {
		64: await sized(64),
		256: await sized(256),
		512: source.toString("base64"),
	};
}
const person = await derivatives(210, "P");
const agent = await derivatives(28, "A");

/* Runs before every story script: wraps whatever `desktop.media` a story
   installs (on `window.api` or later on `window.api.desktop`). */
const INJECT = `(() => {
	const P = ${JSON.stringify(person)}, A = ${JSON.stringify(agent)};
	const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	window.__avatarReads = [];
	const wrap = (media) => media && media.__wrapped ? media : Object.assign(async (input, body) => {
		const answer = await media(input, body);
		if (!answer || answer.kind !== "bytes" || answer.status !== 200) return answer;
		const set = input.op === "team_bridge.avatar" ? P
			: input.op === "team_bridge.endpoint_avatar" || input.op === "agent.avatar" ? A : null;
		if (!set) return answer;
		const side = input.op === "agent.avatar" ? 512 : input.size;
		window.__avatarReads.push(input.op + ":" + side);
		return { ...answer, mimeType: side === 512 ? "image/png" : "image/jpeg", data: bytes(set[side]) };
	}, { __wrapped: true });
	const hookDesktop = (api) => {
		if (!api || typeof api !== "object") return api;
		let desktop = api.desktop;
		if (desktop) desktop.media = wrap(desktop.media);
		Object.defineProperty(api, "desktop", { configurable: true, enumerable: true,
			get: () => desktop,
			set: (next) => { desktop = next; if (desktop) desktop.media = wrap(desktop.media); } });
		return api;
	};
	let api = hookDesktop(window.api);
	Object.defineProperty(window, "api", { configurable: true,
		get: () => api, set: (next) => { api = hookDesktop(next); } });
})();`;

/* [name, story id, readiness selector, crop selector] */
const SURFACES = [
	[
		"message-row",
		"team-bridge-page--agent-own-picture-messages",
		'[data-message-id="agent-avatar-agent"] [data-team-bridge-avatar] img',
		'[data-message-id="agent-avatar-agent"] [data-team-bridge-avatar]',
	],
	[
		"profile-card",
		"team-bridge-page--agent-own-picture-profile-card",
		'[role="dialog"] [data-team-bridge-avatar] img',
		'[role="dialog"] [data-team-bridge-avatar]',
	],
	[
		"rail",
		"team-bridge-page--agent-own-picture-messages",
		"[data-team-bridge-person] [data-team-bridge-avatar] img",
		"[data-team-bridge-person] [data-team-bridge-avatar]",
	],
	[
		"sidebar-account",
		"navigation-user-profile--account-photo",
		"button img",
		"button span:has(> img)",
	],
	[
		"chat-header",
		"features-agents-agent-avatar--header-geometry",
		"[data-agent-mark] img",
		"[data-agent-mark]",
	],
];

const PROBE = `(() => {
	const dpr = window.devicePixelRatio;
	const imgs = [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth && i.clientWidth && i.clientWidth <= 96);
	const marks = [...document.querySelectorAll("[data-team-bridge-avatar] [data-agent-mark]")].map((m) => {
		const r = m.getBoundingClientRect(), inner = m.firstElementChild.getBoundingClientRect();
		return { plate: m.parentElement.getBoundingClientRect().width, outer: r.width, inner: inner.width };
	});
	return {
		dpr,
		images: imgs.map((i) => ({
			where: i.closest("[data-team-bridge-avatar]") ? "team-bridge-plate" : i.closest("[data-agent-mark]") ? "agent-mark" : "other",
			naturalWidth: i.naturalWidth,
			clientWidth: i.clientWidth,
			devicePx: i.clientWidth * dpr,
			coverage: +(i.naturalWidth / (i.clientWidth * dpr)).toFixed(3),
		})),
		marks,
		reads: window.__avatarReads,
	};
})()`;

const dataDir = mkdtempSync(join(tmpdir(), "avatar-retina-"));
const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
);
let chromeExited = false;
chrome.on("exit", () => {
	chromeExited = true;
});
const report = { label: LABEL, dpr: DPR, surfaces: {}, failures: [] };
try {
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(() => reject(new Error("no debug port")), 30_000);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_URL);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
	});
	const browser = new WebSocket(wsUrl);
	await new Promise((resolve) => {
		browser.onopen = resolve;
	});
	let nextId = 1;
	const pending = new Map();
	browser.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error
				? reject(new Error(JSON.stringify(msg.error)))
				: resolve(msg.result);
		}
	};
	const raw = (method, params, sessionId) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			browser.send(
				JSON.stringify({
					id,
					method,
					params: params ?? {},
					...(sessionId ? { sessionId } : {}),
				}),
			);
		});
	const target = await raw("Target.createTarget", { url: "about:blank" });
	const { sessionId } = await raw("Target.attachToTarget", {
		targetId: target.targetId,
		flatten: true,
	});
	const send = (method, params = {}) => raw(method, params, sessionId);
	const evaluate = async (expression) => {
		const res = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (res.exceptionDetails)
			throw new Error(res.exceptionDetails.exception?.description ?? "error");
		return res.result.value;
	};
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });
	await send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 800,
		deviceScaleFactor: DPR,
		mobile: false,
	});
	mkdirSync(OUT, { recursive: true });
	for (const [name, id, ready, crop] of SURFACES) {
		try {
			await send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${id}&viewMode=story`,
			});
			const start = Date.now();
			while (
				!(await evaluate(
					`(() => { const i = document.querySelector(${JSON.stringify(ready)}); return !!(i && i.complete && i.naturalWidth); })()`,
				))
			) {
				if (Date.now() - start > WAIT_MS)
					throw new Error(`${name}: ${ready} never loaded`);
				await wait(200);
			}
			await wait(800);
			const probe = await evaluate(PROBE);
			const box = await evaluate(
				`(() => { const e = document.querySelector(${JSON.stringify(crop)}); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
			);
			const { data } = await send("Page.captureScreenshot", {
				format: "png",
			});
			writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
			const pad = 6;
			const clip = await send("Page.captureScreenshot", {
				format: "png",
				clip: {
					x: Math.max(0, box.x - pad),
					y: Math.max(0, box.y - pad),
					width: box.width + 2 * pad,
					height: box.height + 2 * pad,
					scale: 1,
				},
			});
			const cropPng = Buffer.from(clip.data, "base64");
			const meta = await sharp(cropPng).metadata();
			await sharp(cropPng)
				.resize(meta.width * 4, meta.height * 4, { kernel: "nearest" })
				.toFile(join(OUT, `${name}-zoom4x.png`));
			report.surfaces[name] = { story: id, box, ...probe };
		} catch (error) {
			report.failures.push(String(error?.stack ?? error));
		}
	}
	try {
		await raw("Browser.close");
	} catch {
		/* already gone */
	}
} catch (error) {
	report.failures.push(String(error?.stack ?? error));
} finally {
	writeFileSync(
		join(OUT, "probe.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report, null, 2));
	// Reap OUR Chrome by its exact pid, wait for it to be gone, then remove its
	// profile: removing first races Chrome's own last writes (ENOTEMPTY,
	// measured on the first run of this rig).
	if (!chromeExited) chrome.kill("SIGKILL");
	for (let i = 0; i < 50 && !chromeExited; i++) await wait(100);
	rmSync(dataDir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 200,
	});
	process.exit(report.failures.length ? 1 : 0);
}
