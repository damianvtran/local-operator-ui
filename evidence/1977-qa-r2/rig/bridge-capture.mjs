#!/usr/bin/env node
/*
 * QA r2 UI #1977 capture: the BUILT app (headless Electron, hidden window) against a
 * REAL `lop serve` this run does not own (started by the lane, isolated config).
 * Boot/app-root machinery copied from node2's loading-capture rig (RIG.md §2/§4).
 *
 *   node bridge-capture.mjs --repo <worktree> --app-out <outDir> --arm after|before \
 *     --frames <dir> --backend http://127.0.0.1:<port> --records <backend cfg>/run/serve \
 *     --session abcdef012345 --theme localOperatorDark
 * Token: LOCAL_OPERATOR_DESKTOP_TOKEN in env (never argv).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const REPO = resolve(flag("repo", "."));
const APP_OUT = resolve(flag("app-out"));
const ARM = flag("arm", "after");
const FRAMES_OUT = resolve(flag("frames"));
const BACKEND = flag("backend");
const RECORDS = resolve(flag("records"));
const SESSION = flag("session", "abcdef012345");
const THEMES = String(flag("themes", "localOperatorDark")).split(",");
const CASES = String(flag("cases", "collapsed,e_admit,e_long,e_long_expanded,e_held,e_heldt,e_refused,e_deleted,e_offline,e_coal")).split(",");
mkdirSync(FRAMES_OUT, { recursive: true });
const HERE = new URL(".", import.meta.url).pathname;
const SCRATCH = resolve(flag("scratch", join(process.env.CAP_BASE ?? HERE, ".rig")));
const APPROOT = join(SCRATCH, `approot-${ARM}`);
rmSync(APPROOT, { recursive: true, force: true });
mkdirSync(APPROOT, { recursive: true });
copyFileSync(join(REPO, "package.json"), join(APPROOT, "package.json"));
for (const [name, target] of [["node_modules", join(REPO, "node_modules")], ["out", APP_OUT], ["resources", join(REPO, "resources")], ["build", join(REPO, "build")]])
	if (existsSync(target)) symlinkSync(target, join(APPROOT, name));
{
	const beside = join(APP_OUT, "..", "node_modules");
	if (!existsSync(beside)) symlinkSync(join(REPO, "node_modules"), beside);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Geometry behind the frames: every card's pane, body box, toggle, and the transcript scroller.
const PROBE = `(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const content = document.querySelector('[data-lo-transcript-content]');
  let sc = content; while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  const cards = [...document.querySelectorAll('[data-qa-card]')].map((row) => {
    const bodies = [...row.querySelectorAll('[data-detail-section="bridge-body"]')];
    const nested = [...row.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1; });
    return { id: row.getAttribute('data-qa-card'), row: R(row),
      expanded: document.querySelector('[data-qa-btn="' + row.getAttribute('data-qa-card') + '"]')?.getAttribute('aria-expanded') ?? null,
      states: [...row.querySelectorAll('[data-bridge-body-state]')].map((e) => e.getAttribute('data-bridge-body-state')),
      text: (row.querySelector('[data-bridge-card-body]') ?? row.querySelector('[data-detail-section="bridge-outcome"]'))?.innerText?.slice(0, 160) ?? null,
      body: bodies.slice(0, 2).map((b) => ({ ...R(b), scrollH: b.scrollHeight, clientH: b.clientHeight, scrollW: b.scrollWidth, clientW: b.clientWidth })),
      toggle: (() => { const t = row.querySelector('[data-bridge-body-toggle]'); return t ? { text: t.innerText, expanded: t.getAttribute('aria-expanded'), ...R(t) } : null; })(),
      more: row.querySelector('[data-bridge-body-more]')?.innerText ?? null,
      nestedScrollers: nested.map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 60), scrollH: e.scrollHeight, clientH: e.clientHeight })),
    }; });
  return { cards, scroller: sc ? { scrollTop: Math.round(sc.scrollTop), scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight } : null,
    viewport: { w: innerWidth, h: innerHeight }, theme: document.documentElement.getAttribute('data-theme'), hash: location.hash };
})()`;

async function main() {
	process.chdir(APPROOT);
	process.argv = [process.argv[0], process.argv[1], "--window-size", "1380x872"];
	const { rendererDriverApi: api } = await import(pathToFileURL(join(REPO, "scripts", "renderer-driver.mjs")).href);
	const ctx = api.prepareDriverContext({ apiUrl: BACKEND });
	// The app admits a daemon only when a serve record describes it: link the backend's own records.
	const recDir = join(ctx.config, "run", "serve");
	mkdirSync(recDir, { recursive: true });
	for (const e of readdirSync(RECORDS)) if (e.endsWith(".json") && !existsSync(join(recDir, e))) symlinkSync(join(RECORDS, e), join(recDir, e));
	if (!process.env.LOCAL_OPERATOR_DESKTOP_TOKEN) throw new Error("LOCAL_OPERATOR_DESKTOP_TOKEN missing");
	const manifest = { arm: ARM, appOut: APP_OUT, repo: REPO, backend: BACKEND,
		repoHead: spawnSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
		started: new Date().toISOString(), frames: [] };
	const save = () => writeFileSync(join(FRAMES_OUT, `manifest-${ARM}.json`), JSON.stringify(manifest, null, 2));
	const app = await api.launchApp({ armed: true, apiUrl: BACKEND, tag: `bridge1977-${ARM}-${Date.now()}` });
	manifest.app = { pid: app.pid, log: app.logPath };
	save();
	await api.waitForDevtools(app);
	const cdp = await api.CdpClient.attach(app.port, "out/renderer/index.html", 120_000);
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));' });
	await cdp.send("Page.reload", { ignoreCache: false });
	await api.waitForPage(cdp, 120_000);
	await api.waitForBridge(cdp);
	const facts = await cdp.evaluate("window.__loDevDriver.facts()");
	manifest.windowFacts = facts;
	if (facts.visible !== false || facts.focused !== false) throw new Error(`window not hidden/unfocused: ${JSON.stringify(facts)}`);
	const ev = (e) => cdp.evaluate(e);
	const waitFor = async (expr, ms = 30_000) => { const t = Date.now(); for (;;) { const v = await ev(expr).catch(() => null); if (v) return v; if (Date.now() - t > ms) return null; await pause(150); } };
	const capture = async (label, extra = {}) => {
		await pause(700);
		const probe = await ev(PROBE);
		let prev = null, frame, stable = false, attempts = 0;
		for (; attempts < 5; attempts++) {
			frame = await api.capture(cdp, label, { assertPalette: false });
			const bytes = readFileSync(frame.path);
			if (prev && prev.equals(bytes)) { stable = true; attempts++; break; }
			prev = bytes; await pause(150);
		}
		const dest = join(FRAMES_OUT, `${label}.png`);
		copyFileSync(frame.path, dest);
		manifest.frames.push({ label, file: dest, stable, attempts, pixels: frame.pixels, probe, ...extra });
		save();
		console.log(`[frame] ${label} ${frame.pixels?.width}x${frame.pixels?.height} stable=${stable}`);
		return probe;
	};
	await api.verb(cdp, "navigate", `/chat/${SESSION}`);
	const barUp = await waitFor(`[...document.querySelectorAll('button')].some((b) => /Peer messages/.test(b.innerText))`, 60_000);
	if (barUp) {
		await capture(`${ARM}-dark-00a-peer-fold-bar`);
		await ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => /Peer messages/.test(b.innerText)); b.click(); return true; })()`);
	}
	await pause(600);
	await ev(`(() => { const b = [...document.querySelectorAll('button[aria-expanded="false"]')].find((b) => /incoming messages/.test(b.innerText)); if (b) b.click(); return !!b; })()`);
	const ready = await waitFor(`[...document.querySelectorAll('button[aria-expanded]')].filter((b) => /Received from/.test(b.innerText)).length >= 8`, 30_000);
	manifest.readyProbe = await ev(PROBE);
	if (!ready) {
		manifest.bodyText = await ev("document.querySelector('[data-lo-transcript-content]')?.outerHTML.slice(0,6000) ?? document.body.innerText.slice(0,3000)");
		save();
		await capture(`${ARM}-not-ready`);
		throw new Error("transcript with bridge cards never painted");
	}
	const ORDER = ["e_admit","e_long","e_held","e_heldt","e_refused","e_deleted","e_offline","e_coal"];
	manifest.tagged = await ev(`(() => { const bs = [...document.querySelectorAll('button[aria-expanded]')].filter((b) => /Received from/.test(b.innerText)); const order = ${JSON.stringify(["e_admit","e_long","e_held","e_heldt","e_refused","e_deleted","e_offline","e_coal"])}; bs.forEach((b, i) => { b.setAttribute('data-qa-btn', order[i] ?? ('x' + i)); }); return bs.length; })()`);
	// A condensed quiet-cycle bar hides receipts until opened: open any closed fold bar first.
	manifest.foldOpened = await ev(`(() => { const rows = document.querySelectorAll('[data-record-id^="e_"]'); return rows.length; })()`);
	const openCard = async (id) => {
		await ev(`(() => { const b = document.querySelector('[data-qa-btn="${id}"]'); b.scrollIntoView({ block: 'start' }); if (b.getAttribute('aria-expanded') === 'false') b.click(); return true; })()`);
		await waitFor(`(() => { const b = document.querySelector('[data-qa-btn="${id}"]'); let c = b; while (c && !(c.querySelector('[data-bridge-provenance]') && c.querySelectorAll('[data-qa-btn]').length === 1)) { if (c.querySelectorAll('[data-qa-btn]').length > 1) { c = null; break; } c = c.parentElement; } if (!c) return false; document.querySelectorAll('[data-qa-card]').forEach((e) => e.removeAttribute('data-qa-card')); c.setAttribute('data-qa-card', '${id}'); return true; })()`, 10_000);
		// wait for the body read to settle (no loading state) or the legacy sentence
		await waitFor(`(() => { const row = document.querySelector('[data-qa-card="${id}"]'); return row && (row.querySelector('[data-bridge-body-state]:not([data-bridge-body-state="loading"])') || row.querySelector('[data-detail-section="bridge-outcome"]')) && !row.querySelector('[data-bridge-body-state="loading"]'); })()`, 20_000);
		await ev(`(() => { const row = document.querySelector('[data-qa-card="${id}"]'); const sc = (() => { let s = row.parentElement; while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement; return s; })(); row.scrollIntoView({ block: 'start' }); if (sc) sc.scrollTop -= 24; return true; })()`);
	};
	const closeCard = (id) => ev(`(() => { const b = document.querySelector('[data-qa-btn="${id}"][aria-expanded="true"]'); if (b) b.click(); return !!b; })()`);
	for (const theme of THEMES) {
		await api.verb(cdp, "setTheme", theme);
		const tag = theme === "localOperatorDark" ? "dark" : "light";
		for (const c of CASES) {
			if (c === "collapsed") {
				await ev(`document.querySelector('[data-qa-btn="e_admit"]').scrollIntoView({ block: 'center' })`);
				await capture(`${ARM}-${tag}-00b-collapsed-rows`);
				continue;
			}
			if (c === "e_long_expanded") {
				await openCard("e_long");
				await capture(`${ARM}-${tag}-03-long-collapsed`, { case: "e_long" });
				const clicked = await ev(`(() => { const t = document.querySelector('[data-qa-card="e_long"] [data-bridge-body-toggle]'); if (t) t.click(); return !!t; })()`);
				await capture(`${ARM}-${tag}-04-long-expanded`, { case: "e_long", clickedShowMore: clicked });
				// and the bottom of the expanded body, with its Show less toggle
				await ev(`document.querySelector('[data-qa-card="e_long"] [data-bridge-body-toggle]')?.scrollIntoView({ block: 'end' }) ?? document.querySelector('[data-qa-card="e_long"]').scrollIntoView({ block: 'end' })`);
				await capture(`${ARM}-${tag}-05-long-expanded-end`, { case: "e_long" });
				await closeCard("e_long");
				continue;
			}
			const names = { e_admit: "01-admitted-short", e_long: "02-long-open", e_held: "06-held-awaiting-review", e_heldt: "07-held-transient", e_refused: "08-refused", e_deleted: "09-deleted", e_offline: "10-offline", e_coal: "11-coalesced" };
			if (c === "e_long") continue; // covered by e_long_expanded
			await openCard(c);
			await capture(`${ARM}-${tag}-${names[c]}`, { case: c });
			if (c === "e_coal") {
				await ev(`(() => { const m = document.querySelector('[data-qa-card="e_coal"] [data-bridge-body-more]') ?? document.querySelector('[data-qa-card="e_coal"]'); m.scrollIntoView({ block: 'end' }); return true; })()`);
				await capture(`${ARM}-${tag}-12-coalesced-and-more`, { case: c });
			}
			await closeCard(c);
		}
	}
	manifest.finished = new Date().toISOString();
	save();
	await api.drainLiveBoots?.().catch(() => {});
	await api.reapLiveBoots?.().catch(() => {});
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
