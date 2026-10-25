/**
 * The window glass: the pure decisions behind the optional translucent window.
 *
 * WHAT THIS CAN AND CANNOT SEE. It asserts the platform matrix, the default-off
 * guarantee, the clamping, the per-role alpha floors and the argv round-trip over
 * the SHIPPED modules (bundled with esbuild, not re-implemented). It cannot see
 * pixels or a platform it is not running on: Windows 11 `backgroundMaterial` and
 * Linux are covered by their capability and option decisions here and by nothing
 * else - no CI job owns a display on either - so a green run is a statement about
 * the decisions, not about how Mica looks. The macOS pixels are the PR's own
 * evidence, captured from the real app.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
	LANE_ALPHA_CEILING,
	LANE_ROLES,
	deriveLaneWash,
} from "./derive-glass-floors.mjs";

const ROOT = process.cwd();

const bundleOf = async (entry) => {
	const bundle = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		loader: { ".json": "json" },
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
};

const BACKGROUND_COLOR_DECLARATION = /background-color:\s*([^;]+);/;
const TRANSPARENT_BACKGROUND_DECLARATION = /background-color:\s*transparent/;

const glass = await bundleOf("./src/shared/window-glass");
const floorsFile = JSON.parse(
	readFileSync(`${ROOT}/src/shared/window-glass-floors.json`, "utf8"),
);

/*
 * THE VEILED-BLOCK HOVER PROBE (G-11). Shared by the two-mount assertion and its
 * negative controls. It reads the real stylesheet, so a rule that stops matching
 * fails here the way it would fail in the app; the only synthesized input is
 * Tailwind's utility layer, which a clean checkout has not built.
 */
const HOVER_PROBE_CLASS = "glass-probe-hover";

const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

const matchingDelimiter = (text, start) => {
	const open = text[start];
	const close = open === "[" ? "]" : open === "(" ? ")" : "}";
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		if (text[i] === open) depth++;
		else if (text[i] === close) {
			depth--;
			if (depth === 0) return i;
		}
	}
	return text.length;
};

/** Qualified rules in source order, each with the enclosing `@layer` (or null). */
const cssRules = (text) => {
	const src = stripCssComments(text);
	const rules = [];
	const stack = [];
	let i = 0;
	let start = 0;
	let order = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === "{") {
			const prelude = src.slice(start, i).trim();
			if (prelude.startsWith("@")) {
				const layer = /^@layer\s+([\w.-]+)/.exec(prelude)?.[1];
				stack.push(layer ?? stack.at(-1) ?? null);
				i++;
				start = i;
				continue;
			}
			const close = matchingDelimiter(src, i);
			rules.push({
				selector: prelude,
				body: src.slice(i + 1, close),
				layer: stack.at(-1) ?? null,
				order: order++,
			});
			i = close + 1;
			start = i;
			continue;
		}
		if (ch === "}") {
			stack.pop();
			i++;
			start = i;
			continue;
		}
		if (ch === ";") {
			i++;
			start = i;
			continue;
		}
		i++;
	}
	return rules;
};

const splitSelectorList = (text) => {
	const out = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "(" || ch === "[") depth++;
		else if (ch === ")" || ch === "]") depth--;
		else if (ch === "," && depth === 0) {
			out.push(text.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(text.slice(start).trim());
	return out.filter(Boolean);
};

const skipIdent = (text, i) => {
	let j = i;
	while (j < text.length && /[\w-]/.test(text[j])) j++;
	return j;
};

/** CSS specificity as [ids, classes, types]; `:is()/:not()/:has()` take their
 * most specific argument and `:where()` contributes nothing. */
const specificityOf = (selector) => {
	const score = [0, 0, 0];
	let i = 0;
	while (i < selector.length) {
		const ch = selector[i];
		if (ch === "[") {
			score[1]++;
			i = matchingDelimiter(selector, i) + 1;
			continue;
		}
		if (ch === "#") {
			score[0]++;
			i = skipIdent(selector, i + 1);
			continue;
		}
		if (ch === ".") {
			score[1]++;
			i = skipIdent(selector, i + 1);
			continue;
		}
		if (ch === ":") {
			if (selector[i + 1] === ":") {
				score[2]++;
				i = skipIdent(selector, i + 2);
				continue;
			}
			const end = skipIdent(selector, i + 1);
			const name = selector.slice(i + 1, end).toLowerCase();
			if (selector[end] !== "(") {
				score[1]++;
				i = end;
				continue;
			}
			const close = matchingDelimiter(selector, end);
			const args = selector.slice(end + 1, close);
			if (name === "is" || name === "not" || name === "has") {
				let best = [0, 0, 0];
				for (const arg of splitSelectorList(args)) {
					const candidate = specificityOf(arg);
					const cmp =
						candidate[0] - best[0] ||
						candidate[1] - best[1] ||
						candidate[2] - best[2];
					if (cmp > 0) best = candidate;
				}
				score[0] += best[0];
				score[1] += best[1];
				score[2] += best[2];
			} else if (name !== "where") {
				score[1]++;
			}
			i = close + 1;
			continue;
		}
		if (/[a-zA-Z]/.test(ch) && !/[\w-]/.test(selector[i - 1] ?? " "))
			score[2]++;
		i++;
	}
	return score;
};

const UTILITY_LAYER_CSS = `
@layer utilities {
	.bg-sunken { background-color: var(--color-sunken); }
	.hover\\:bg-sunken:hover { background-color: var(--color-sunken); }
	.hover\\:bg-surface:hover { background-color: var(--color-surface); }
	.hover\\:bg-elevated:hover { background-color: var(--color-elevated); }
}
`;

const VEILED_HOVER_MOUNTS = {
	/* A route pane inside `<main>` (the canvas's own ask pane). */
	session: `<main data-glass-region="canvas-backing">
		<div data-glass-region="pane">
			<div data-glass-block=""><button class="probe-row hover:bg-sunken">option</button></div>
		</div>
	</main>`,
	/* The fleet asks drawer: its pane is a SIBLING of `<main>` (`chat-layout.tsx`). */
	fleet: `<div class="content-column">
		<main data-glass-region="canvas-backing"><div></div></main>
		<div data-glass-region="pane" data-ask-mode="docked">
			<div data-glass-block=""><button class="probe-row hover:bg-sunken">option</button></div>
		</div>
	</div>`,
};

/**
 * Resolve the winning `background-color` for a hovered row inside a veiled block,
 * in both mounts, the way CSS does: unlayered beats layered, then specificity,
 * then source order. Returns the block's veil state too (the precondition).
 * `keepBranches` drops one selector of the suppression rule to build the controls.
 */
const veiledHoverOutcome = (css, { keepBranches } = {}) => {
	const suppressionRule = cssRules(css).find(
		(rule) =>
			/background-color:\s*transparent/.test(rule.body) &&
			/\[data-glass-block\]/.test(rule.selector) &&
			/\[class~="hover:bg-sunken"\]/.test(rule.selector),
	);
	if (!suppressionRule)
		throw new Error(
			"no veiled-block hover suppression rule (data-glass-block + hover:bg-sunken + transparent)",
		);
	let subject = css;
	if (keepBranches) {
		const branches = splitSelectorList(suppressionRule.selector);
		const keep = (branch) =>
			keepBranches === "block"
				? !branch.includes("main[")
				: branch.includes("main[");
		const kept = branches.filter(keep);
		if (kept.length === 0 || kept.length === branches.length)
			throw new Error(
				`control has nothing to drop: keepBranches=${keepBranches}`,
			);
		subject = css.replace(suppressionRule.selector, kept.join(",\n"));
	}
	const rules = [...cssRules(UTILITY_LAYER_CSS), ...cssRules(subject)];
	const outcome = {};
	for (const [mount, markup] of Object.entries(VEILED_HOVER_MOUNTS)) {
		const dom = new JSDOM(
			`<!doctype html><html data-glass="canvas pane"><body>${markup}</body></html>`,
		);
		const { document } = dom.window;
		const row = document.querySelector(".probe-row");
		const block = document.querySelector("[data-glass-block]");
		row.classList.add(HOVER_PROBE_CLASS);
		const resolve = (element) => {
			const matches = [];
			for (const rule of rules) {
				const value = /background-color:\s*([^;]+);/
					.exec(rule.body)?.[1]
					.trim();
				if (!value) continue;
				for (const selector of splitSelectorList(rule.selector)) {
					const probe = selector.replace(/:hover\b/g, `.${HOVER_PROBE_CLASS}`);
					let hit = false;
					try {
						hit = element.matches(probe);
					} catch {
						hit = false;
					}
					if (hit)
						matches.push({
							selector,
							value,
							layer: rule.layer,
							order: rule.order,
							specificity: specificityOf(selector),
						});
				}
			}
			matches.sort((x, y) => {
				const rank = (entry) => (entry.layer === null ? 1 : 0);
				return (
					rank(x) - rank(y) ||
					x.specificity[0] - y.specificity[0] ||
					x.specificity[1] - y.specificity[1] ||
					x.specificity[2] - y.specificity[2] ||
					x.order - y.order
				);
			});
			return matches.at(-1) ?? null;
		};
		const veil = resolve(block);
		const winner = resolve(row);
		const translation = rules
			.filter((rule) => {
				const value = /background-color:\s*([^;]+);/.exec(rule.body)?.[1] ?? "";
				return value.includes("--color-row-hover");
			})
			.flatMap((rule) => splitSelectorList(rule.selector))
			.find((selector) => {
				try {
					return row.matches(
						selector.replace(/:hover\b/g, `.${HOVER_PROBE_CLASS}`),
					);
				} catch {
					return false;
				}
			});
		outcome[mount] = {
			veil: !!veil?.value.includes("--lo-ink"),
			value: winner?.value ?? "none",
			selector: winner?.selector ?? "none",
			translationSpecificity: translation
				? `(${specificityOf(translation).join(",")})`
				: "none",
		};
	}
	return outcome;
};

const MAC = {
	platform: "darwin",
	osVersion: "27.0.1",
	reducedTransparency: false,
};
const WIN11 = {
	platform: "win32",
	osVersion: "10.0.22631",
	reducedTransparency: false,
};
const ON = { ...glass.DEFAULT_GLASS_SETTINGS, enabled: true };

test("G-1 capability: one decision per platform, with a reason where it says no", () => {
	const mac = glass.glassCapabilityFor(MAC);
	assert.deepEqual(
		[mac.supported, mac.mechanism, mac.reason, mac.liveToggle],
		[true, "vibrancy", "ok", true],
	);
	assert.equal(
		mac.defaultEnabled,
		true,
		"macOS is the one platform whose effect is measured, so it is the default",
	);
	assert.equal(
		mac.liquid,
		true,
		"macOS 26+ renders vibrancy with the Liquid Glass materials",
	);
	assert.equal(
		glass.glassCapabilityFor({ ...MAC, osVersion: "15.4" }).liquid,
		false,
		"macOS 15 has vibrancy but not the new materials: a label, never a gate",
	);
	assert.equal(
		glass.glassCapabilityFor({ ...MAC, osVersion: "15.4" }).supported,
		true,
	);

	const win = glass.glassCapabilityFor(WIN11);
	assert.deepEqual(
		[win.supported, win.mechanism, win.reason, win.liveToggle],
		[false, "none", "windows-unverified", false],
		"Windows 11 has the mechanism but no verification: the row is greyed, not defaulted on",
	);
	assert.deepEqual([...win.materials], []);
	assert.equal(win.defaultEnabled, false);

	for (const build of ["10.0.19045", "10.0.22000", "10.0.22620"]) {
		const old = glass.glassCapabilityFor({ ...WIN11, osVersion: build });
		assert.deepEqual(
			[old.supported, old.mechanism, old.reason],
			[false, "none", "windows-too-old"],
			`${build}: Windows 10 and pre-22H2 Windows 11 have no working backgroundMaterial`,
		);
		assert.deepEqual([...old.materials], []);
	}
	assert.equal(
		glass.glassCapabilityFor({ ...WIN11, osVersion: "garbage" }).reason,
		"windows-too-old",
		"an unparseable version fails to the shipped look",
	);

	const linux = glass.glassCapabilityFor({
		platform: "linux",
		osVersion: "6.8.0",
		reducedTransparency: false,
	});
	assert.deepEqual(
		[linux.supported, linux.mechanism, linux.reason],
		[false, "none", "linux-compositor-dependent"],
		"no native blur on Linux: the control is explained, not faked",
	);
	assert.equal(
		glass.glassCapabilityFor({
			platform: "freebsd",
			osVersion: "14",
			reducedTransparency: false,
		}).reason,
		"unsupported-platform",
	);
});

test("G-1b the live environment gate: detect, then decide", () => {
	const env = (facts) =>
		glass.glassCapabilityFor({ ...MAC, environment: facts });
	const reason = (facts) => env(facts).reason;

	assert.equal(
		reason(undefined),
		"ok",
		"no facts read yet is undecided, not refused",
	);
	assert.equal(reason({}), "ok");
	assert.equal(
		reason({ gpu: {} }),
		"gpu-unavailable",
		"a status object that reported but lost its keys is a shape change: fail closed (R1-7)",
	);
	assert.equal(
		reason({ gpu: { compositing: "enabled", rasterization: "enabled" } }),
		"ok",
	);
	assert.equal(
		reason({ gpu: { compositing: "unavailable_software" } }),
		"gpu-unavailable",
		"software compositing cannot draw a blurred material",
	);
	assert.equal(
		reason({ gpu: { compositing: "enabled", rasterization: "disabled_off" } }),
		"gpu-unavailable",
		"rasterisation off is the same machine claim under the other status field",
	);
	assert.equal(
		reason({ gpu: { compositing: "enabled_force" } }),
		"gpu-unavailable",
		"a present status missing rasterisation fails closed rather than reading as fine",
	);
	assert.equal(
		reason({
			gpu: { compositing: "enabled_force", rasterization: "enabled" },
		}),
		"ok",
		"a forced-on compositor still composites when both facts are present",
	);
	assert.equal(
		reason({ hardwareAcceleration: false }),
		"hardware-acceleration-disabled",
	);
	assert.equal(
		reason({ accelerationDisabledByLaunch: true }),
		"hardware-acceleration-disabled",
		"--disable-gpu is named as the launch's own choice, not as a broken machine",
	);
	assert.equal(
		reason({ backdropFilter: false }),
		"backdrop-filter-unavailable",
	);
	assert.equal(
		reason({ backdropFilter: false, accelerationDisabledByLaunch: true }),
		"hardware-acceleration-disabled",
		"the launch flag is the first cause named, because it is the one the user can undo",
	);
	const refused = env({ hardwareAcceleration: false });
	assert.deepEqual(
		[refused.supported, refused.mechanism, refused.defaultEnabled],
		[false, "none", false],
	);
});

test("G-2 Reduce transparency wins on every platform it could otherwise support", () => {
	/* macOS is the one platform whose effect this build turns on, so it is the one
	 * where the OS switch has an effect to withdraw. Windows is already refused as
	 * unverified, and that reason is the more actionable one to name there. */
	const cap = glass.glassCapabilityFor({ ...MAC, reducedTransparency: true });
	assert.deepEqual(
		[cap.supported, cap.mechanism, cap.reason],
		[false, "none", "reduced-transparency"],
	);
	assert.deepEqual(
		glass.glassWindowOptions(ON, cap, "darwin"),
		{ visualEffectState: "active" },
		"the OS accessibility switch drops the window to the shipped opaque ground (darwin keeps only the inert visual-effect state)",
	);
	const win = glass.glassCapabilityFor({ ...WIN11, reducedTransparency: true });
	assert.equal(win.reason, "windows-unverified");
	assert.deepEqual(glass.glassWindowOptions(ON, win, "win32"), {});
});

test("G-3 THE DEFAULT FLIP: capability-aware, unset-only, and inert where refused", () => {
	const LINUX = {
		platform: "linux",
		osVersion: "6.8.0",
		reducedTransparency: false,
	};
	const capMac = glass.glassCapabilityFor(MAC);
	const capWin = glass.glassCapabilityFor(WIN11);
	const capLinux = glass.glassCapabilityFor(LINUX);

	/* 1. A launch with no stored choice: on at 80 where the machine is capable. */
	assert.deepEqual(glass.defaultGlassSettings(capMac), {
		enabled: true,
		coverage: "full",
		intensity: 80,
		material: "window",
	});
	assert.equal(glass.DEFAULT_GLASS_INTENSITY, 80);
	for (const cap of [capWin, capLinux]) {
		const settings = glass.defaultGlassSettings(cap);
		assert.equal(
			settings.enabled,
			false,
			`${cap.reason}: an unverified/unsupported platform never defaults on`,
		);
		assert.equal(settings.intensity, 80, "the chosen intensity still travels");
	}
	/* The unset baseline is the opaque floor, never itself a launch default. */
	assert.equal(glass.DEFAULT_GLASS_SETTINGS.enabled, false);

	/* 2. Where refused, an ENABLED value in a stale profile is inert at render time. */
	for (const [cap, platform] of [
		[capWin, "win32"],
		[capLinux, "linux"],
		[
			glass.glassCapabilityFor({
				...MAC,
				environment: { hardwareAcceleration: false },
			}),
			"darwin",
		],
	]) {
		assert.equal(
			glass.glassIsActive(ON, cap),
			false,
			`${platform}: the gate wins`,
		);
		const opts = glass.glassWindowOptions(ON, cap, platform);
		assert.equal(
			"backgroundColor" in opts,
			false,
			`${platform}: a refused glass must not make the window transparent`,
		);
		assert.equal("vibrancy" in opts, false);
		assert.equal("backgroundMaterial" in opts, false);
	}
	const ground = "#22201c";
	assert.equal(
		glass.groundWithGlass(
			ground,
			ON,
			glass.glassCapabilityFor({
				...MAC,
				environment: { gpu: { compositing: "unavailable_software" } },
			}),
			"darwin",
		).backgroundColor,
		ground,
		"unsupported + stale enabled: the palette ground, byte for byte",
	);

	/* 3. An explicit OFF on a capable Mac keeps the shipped window. */
	const explicitOff = { ...glass.defaultGlassSettings(capMac), enabled: false };
	assert.deepEqual(
		glass.glassWindowOptions(explicitOff, capMac, "darwin"),
		{ visualEffectState: "active" },
		"the one inert darwin exception, and nothing else",
	);
	assert.equal(
		JSON.stringify(
			glass.groundWithGlass(ground, explicitOff, capMac, "darwin"),
		),
		JSON.stringify({ backgroundColor: ground, visualEffectState: "active" }),
	);

	/* 4. The launch default on a capable Mac IS the active glass. */
	assert.equal(
		glass.glassIsActive(glass.defaultGlassSettings(capMac), capMac),
		true,
	);
	assert.equal(
		glass.groundWithGlass(
			ground,
			glass.defaultGlassSettings(capMac),
			capMac,
			"darwin",
		).backgroundColor,
		"#00000000",
		"no stored choice on macOS: the default paints the transparent ground",
	);

	/* 5. Reduce transparency is still the shipped ground, even for a stored ON. */
	assert.equal(
		glass.groundWithGlass(
			ground,
			ON,
			glass.glassCapabilityFor({ ...MAC, reducedTransparency: true }),
			"darwin",
		).backgroundColor,
		ground,
	);
});

test("G-4 enabled + supported: the constructor options per mechanism", () => {
	/*
	 * A SYNTHETIC VERIFIED WINDOWS CAPABILITY. The shipped gate says
	 * `windows-unverified` (no Windows machine has run this), so the mechanism's
	 * option mapping cannot be reached from `glassCapabilityFor` any more. It is
	 * still the code Windows will use the day it is verified, so the mapping is
	 * driven directly here rather than left untested until then.
	 */
	const WIN_CAP = {
		supported: true,
		mechanism: "background-material",
		reason: "ok",
		materials: glass.GLASS_WIN_MATERIALS,
		defaultMaterial: "mica",
		liquid: false,
		defaultEnabled: false,
		liveToggle: false,
	};
	const mac = glass.glassWindowOptions(
		ON,
		glass.glassCapabilityFor(MAC),
		"darwin",
	);
	assert.deepEqual(mac, {
		backgroundColor: "#00000000",
		vibrancy: "under-window",
		visualEffectState: "active",
	});
	assert.equal(
		glass.glassWindowOptions(
			{ ...ON, material: "menu" },
			glass.glassCapabilityFor(MAC),
			"darwin",
		).vibrancy,
		"menu",
	);
	assert.equal(
		glass.glassWindowOptions(
			{ ...ON, material: "popover" },
			glass.glassCapabilityFor(MAC),
			"darwin",
		).vibrancy,
		"popover",
	);
	const win = glass.glassWindowOptions(
		{ ...ON, material: "acrylic" },
		WIN_CAP,
		"win32",
	);
	assert.deepEqual(win, {
		backgroundColor: "#00000000",
		backgroundMaterial: "acrylic",
	});
	assert.equal(
		glass.glassWindowOptions({ ...ON, material: "window" }, WIN_CAP, "win32")
			.backgroundMaterial,
		"mica",
		"a macOS material id never reaches setBackgroundMaterial: it falls to the platform's own",
	);
	assert.deepEqual(
		glass.glassWindowOptions(
			ON,
			glass.glassCapabilityFor({
				platform: "linux",
				osVersion: "6",
				reducedTransparency: false,
			}),
			"linux",
		),
		{},
		"Linux: enabled in a persisted file from another machine still does nothing",
	);
});

test("G-5 sanitising an untrusted settings value", () => {
	const mac = glass.glassCapabilityFor(MAC);
	const win = glass.glassCapabilityFor(WIN11);
	assert.deepEqual(
		glass.sanitizeGlassSettings(undefined, mac),
		glass.DEFAULT_GLASS_SETTINGS,
	);
	assert.deepEqual(
		glass.sanitizeGlassSettings("nope", mac),
		glass.DEFAULT_GLASS_SETTINGS,
	);
	const merged = glass.sanitizeGlassSettings(
		{
			enabled: true,
			coverage: "full",
			intensity: 130.4,
			material: "popover",
		},
		mac,
	);
	assert.deepEqual(
		merged,
		{ enabled: true, coverage: "full", intensity: 100, material: "popover" },
		"intensity clamps to 0..100 and rounds",
	);
	/* The retired middle tier reads back as the nearest real one (design D1). */
	assert.equal(
		glass.sanitizeGlassSettings({ coverage: "chrome" }, mac).coverage,
		"sidebars",
		"a profile written by the three-tier build migrates 'chrome' to 'sidebars'",
	);
	assert.deepEqual(glass.GLASS_COVERAGES, ["sidebars", "full"], "two tiers");
	assert.equal(
		glass.sanitizeGlassSettings({ intensity: -5 }, mac).intensity,
		0,
	);
	assert.equal(
		glass.sanitizeGlassSettings({ intensity: Number.NaN }, mac).intensity,
		glass.DEFAULT_GLASS_SETTINGS.intensity,
	);
	assert.equal(
		glass.sanitizeGlassSettings({ intensity: "80" }, mac).intensity,
		glass.DEFAULT_GLASS_SETTINGS.intensity,
		"a string is not a number",
	);
	assert.equal(
		glass.sanitizeGlassSettings({ enabled: "yes" }, mac).enabled,
		false,
		"only a real boolean enables it",
	);
	assert.equal(
		glass.sanitizeGlassSettings({ coverage: "everything" }, mac).coverage,
		"full",
	);
	/* One bad field keeps its previous value and spares the rest. */
	assert.deepEqual(
		glass.sanitizeGlassSettings({ coverage: "bogus", enabled: true }, mac, {
			...ON,
			coverage: "sidebars",
		}),
		{ ...ON, coverage: "sidebars", enabled: true },
	);
	/* A material this platform does not offer never reaches Electron, which throws. */
	assert.equal(
		glass.sanitizeGlassSettings({ material: "mica" }, mac).material,
		"window",
	);
	/* The read path passes the platform's defaults as the base; do the same here. */
	const winBase = glass.defaultGlassSettings(win);
	assert.equal(
		glass.sanitizeGlassSettings({ material: "popover" }, win, winBase).material,
		"popover",
		"an unsupported moment keeps the stored material (it is not the user's fault)",
	);
	assert.equal(
		glass.sanitizeGlassSettings({ material: "../../etc" }, win, winBase)
			.material,
		"mica",
		"a material this platform does not know falls to its own default",
	);
});

test("G-6 alphas: monotone in intensity, ordered by role, never below the measured floor", () => {
	for (const mechanism of ["vibrancy", "background-material"]) {
		const materials =
			mechanism === "vibrancy"
				? glass.GLASS_MAC_MATERIALS
				: glass.GLASS_WIN_MATERIALS;
		for (const material of materials)
			for (const scheme of ["dark", "light"]) {
				const floors = glass.glassAlphaFloors(mechanism, material, scheme);
				let prev = null;
				for (let intensity = 0; intensity <= 100; intensity += 5) {
					const a = glass.glassAlphas({
						intensity,
						mechanism,
						material,
						scheme,
					});
					for (const role of ["canvas", "surface", "elevated"]) {
						assert.ok(
							a[role] >= floors[role] - 1e-9,
							`${material}/${scheme}/${role} at ${intensity}: ${a[role]} < floor ${floors[role]}`,
						);
						assert.ok(
							a[role] <=
								Math.max(glass.GLASS_ALPHA_CEILING, floors[role]) + 1e-9,
						);
						if (prev)
							assert.ok(
								a[role] <= prev[role] + 1e-9,
								"more see-through never raises an alpha",
							);
					}
					prev = a;
				}
				const end = glass.glassAlphas({
					intensity: 100,
					mechanism,
					material,
					scheme,
				});
				for (const role of ["canvas", "surface", "elevated"])
					assert.equal(
						end[role],
						floors[role],
						"100 is exactly the floor: as clear as text allows",
					);
				const start = glass.glassAlphas({
					intensity: 0,
					mechanism,
					material,
					scheme,
				});
				assert.equal(
					start.canvas,
					Math.max(glass.GLASS_ALPHA_CEILING, floors.canvas),
					"frosted is veiled, never solid unless the floor says so",
				);
			}
	}
	assert.deepEqual(
		glass.glassAlphas({
			intensity: 250,
			mechanism: "vibrancy",
			material: "window",
			scheme: "dark",
		}),
		glass.glassAlphas({
			intensity: 100,
			mechanism: "vibrancy",
			material: "window",
			scheme: "dark",
		}),
		"out-of-range intensity clamps",
	);
});

test("G-7 the committed floors cover every tier, scheme and role and are not hand-lowered", () => {
	for (const tier of ["under-window", "menu", "popover"])
		for (const scheme of ["dark", "light"])
			for (const role of ["canvas", "surface", "elevated"]) {
				const v = floorsFile.alphaFloor[tier][scheme][role];
				assert.ok(
					typeof v === "number" && v > 0 && v <= 1,
					`${tier}/${scheme}/${role}`,
				);
			}
	/* A denser material needs a higher floor: its tone is closer to the ink's. */
	for (const scheme of ["dark", "light"])
		for (const role of ["canvas", "surface", "elevated"])
			assert.ok(
				floorsFile.alphaFloor["under-window"][scheme][role] <=
					floorsFile.alphaFloor.popover[scheme][role],
				`${scheme}/${role}: the clearest material has the lowest floor`,
			);
});

test("G-7b the block veil and the work alpha are committed as derived, not chosen", () => {
	for (const scheme of ["dark", "light"]) {
		const veil = floorsFile.blockVeil?.[scheme];
		assert.ok(
			typeof veil === "number" && veil > 0 && veil < 1,
			`blockVeil/${scheme} is a committed alpha`,
		);
	}
	/*
	 * The work alpha is the SELECTED step under its own name: an in-flight row and
	 * a selected row are the same claim, and two hand-tuned numbers for one idea
	 * are a divergence waiting to happen.
	 */
	assert.equal(
		floorsFile.stateAlpha.work,
		floorsFile.stateAlpha.selected,
		"the work overlay aliases the selected step",
	);
});

test("G-7c the lane wash is committed as derived, and its mirrored constants are the module's", () => {
	for (const scheme of ["dark", "light"]) {
		const wash = floorsFile.laneWash?.[scheme];
		assert.ok(
			wash !== null &&
				typeof wash === "object" &&
				LANE_ROLES.includes(wash.role) &&
				typeof wash.scale === "number" &&
				wash.scale > 0 &&
				wash.scale <= 1,
			`laneWash/${scheme} is a derived {role, scale}`,
		);
	}
	/*
	 * THE DERIVATION MIRRORS ONE CONSTANT because it has no build step. If the
	 * ceiling moves in `src/shared/window-glass.ts` without being carried into
	 * `scripts/derive-glass-floors.mjs`, the lane family would be derived against
	 * a different ground alpha than the slider actually ships - a silent second
	 * opinion about the same number. This is the check that makes the mirror a
	 * contract. (The round-1 `LANE_DEFAULT_INTENSITY` mirror is gone with the
	 * fixed-alpha derivation: the family now covers every slider position, so
	 * there is no "default" the number could disagree about.)
	 */
	assert.equal(LANE_ALPHA_CEILING, glass.GLASS_ALPHA_CEILING);
	assert.deepEqual(
		deriveLaneWash(
			JSON.parse(
				readFileSync(`${ROOT}/src/shared/window-glass-floors.json`, "utf8"),
			).alphaFloor,
		),
		floorsFile.laneWash,
		"the committed lane wash is the derived one (never hand-lowered)",
	);
});

test("G-8 paint: which kinds a coverage turns translucent, and the net alphas", () => {
	const paint = (coverage) =>
		glass.glassPaintFor({
			coverage,
			intensity: 60,
			mechanism: "vibrancy",
			material: "window",
			scheme: "dark",
		});
	assert.equal(paint("sidebars").kinds, "sidebar");
	assert.equal(paint("full").kinds, "sidebar canvas pane");
	assert.notEqual(
		paint("sidebars").kinds,
		paint("full").kinds,
		"the two tiers must paint different kinds, or one of them is a label for nothing",
	);
	const v = paint("full").vars;
	const a = (name) => Number(v[name]);
	assert.ok(a("--lo-glass-a-canvas") > 0 && a("--lo-glass-a-canvas") <= 1);
	/* Stacking: a surface over the canvas backing composites back to ITS target. */
	for (const [net, target] of [
		["--lo-glass-in-surface", "--lo-glass-a-surface"],
		["--lo-glass-in-elevated", "--lo-glass-a-elevated"],
	]) {
		const stacked = 1 - (1 - a(net)) * (1 - a("--lo-glass-a-canvas"));
		assert.ok(
			stacked >= a(target) - 0.011 &&
				stacked <= 1 &&
				(a(net) === 0 || Math.abs(stacked - a(target)) < 0.011),
			`${net}: stacked ${stacked.toFixed(3)} vs target ${a(target)}`,
		);
	}
	/* A target BELOW the backing's alpha clamps to 0: more opaque than the floor, never less. */
	const clear = glass.glassPaintFor({
		coverage: "full",
		intensity: 100,
		mechanism: "vibrancy",
		material: "window",
		scheme: "light",
	}).vars;
	assert.ok(Number(clear["--lo-glass-in-elevated"]) >= 0);
	/* The round-2 overlays are published from the committed table, per scheme. */
	assert.equal(a("--lo-glass-a-row-work"), floorsFile.stateAlpha.work);
	assert.equal(a("--lo-glass-a-block-veil"), floorsFile.blockVeil.dark);
	/* The lane is a SCALE of the page's own alpha, so it tracks the slider. */
	assert.equal(
		a("--lo-glass-a-lane"),
		Math.round(
			a("--lo-glass-a-canvas") * floorsFile.laneWash.dark.scale * 100,
		) / 100,
		"the lane alpha is the page alpha at the derived scale",
	);
	assert.equal(
		v["--lo-glass-lane-tone"],
		`var(--lo-${floorsFile.laneWash.dark.role})`,
		"the lane tone is the derived role, published once",
	);
	const lightVars = glass.glassPaintFor({
		coverage: "full",
		intensity: 60,
		mechanism: "vibrancy",
		material: "window",
		scheme: "light",
	}).vars;
	assert.equal(
		Number(lightVars["--lo-glass-a-block-veil"]),
		floorsFile.blockVeil.light,
		"the veil follows the palette's scheme",
	);
	assert.equal(
		Number(lightVars["--lo-glass-a-lane"]),
		Math.round(
			Number(lightVars["--lo-glass-a-canvas"]) *
				floorsFile.laneWash.light.scale *
				100,
		) / 100,
		"the lane alpha follows the palette's scheme",
	);
	assert.equal(
		lightVars["--lo-glass-lane-tone"],
		`var(--lo-${floorsFile.laneWash.light.role})`,
		"the lane tone follows the palette's scheme",
	);
	/* Every numeric var is a bare number the CSS multiplies by 100%; the tone is
	 * the one non-numeric reference, and it must stay a single palette var(). */
	for (const [name, value] of Object.entries(v)) {
		if (name === "--lo-glass-lane-tone") {
			assert.match(value, /^var\(--lo-(?:surface|sunken)\)$/);
			continue;
		}
		assert.match(value, /^\d(\.\d+)?$/);
	}
});

test("G-9 argv round-trip: the first-frame fact fails closed", () => {
	const cap = glass.glassCapabilityFor(MAC);
	const state = {
		capability: cap,
		settings: { ...ON, coverage: "full", intensity: 35, material: "menu" },
		active: true,
		restartRequired: false,
	};
	const arg = glass.windowGlassArgument(state, "light");
	assert.equal(arg, "--lo-window-glass=vibrancy:full:35:menu:light");
	assert.deepEqual(glass.readWindowGlassArgument(["x", arg]), {
		mechanism: "vibrancy",
		coverage: "full",
		intensity: 35,
		material: "menu",
		scheme: "light",
	});
	assert.equal(
		glass.windowGlassArgument({ ...state, active: false }, "dark"),
		"--lo-window-glass=off",
	);
	for (const bad of [
		"--lo-window-glass=off",
		"--lo-window-glass=",
		"--lo-window-glass=vibrancy:full:35:menu",
		"--lo-window-glass=vibrancy:full:35:menu:light:extra",
		"--lo-window-glass=none:full:35:menu:light",
		"--lo-window-glass=vibrancy:full:101:menu:light",
		"--lo-window-glass=vibrancy:full:3.5:menu:light",
		"--lo-window-glass=vibrancy:chrome:35:bogus:light",
		"--lo-window-glass=vibrancy:all:35:menu:light",
		"--lo-window-glass=vibrancy:chrome:35:menu:light",
		"--lo-window-glass=vibrancy:full:35:menu:sepia",
	])
		assert.equal(glass.readWindowGlassArgument([bad]), null, bad);
	assert.equal(glass.readWindowGlassArgument([]), null, "no entry is off");
});

test("G-10 a restart is demanded exactly where the toggle cannot be live", () => {
	/* The main-process half (`restartRequired` on a live enable) is driven by
	 * `window-glass-main.test.mjs` M-3; here the capability that decides it. */
	assert.equal(glass.glassCapabilityFor(MAC).liveToggle, true);
	assert.equal(glass.glassCapabilityFor(WIN11).liveToggle, false);
});

test("G-11 every region, state and well the CSS names is a marker some component carries", async () => {
	const css = readFileSync(`${ROOT}/src/renderer/src/styles/index.css`, "utf8");
	/*
	 * THE MARKER VOCABULARY IS CLOSED. Round 2 added three more ways a surface can
	 * opt in (`data-glass-block`, `data-glass-state`, `data-glass-well`), and a CSS
	 * rule naming a value no component wears is a rule that measures nothing while
	 * reading as coverage. The check is the same for all four: every attribute value
	 * the stylesheet selects on must exist in at least one component (or, for a
	 * valueless marker, the attribute itself must).
	 */
	const { execFileSync } = await import("node:child_process");
	const files = execFileSync(
		"git",
		["grep", "-l", "data-glass-", "--", "src/renderer/src"],
		{ cwd: ROOT, encoding: "utf8" },
	)
		.split("\n")
		.filter((f) => f && !f.endsWith(".css"));
	const sources = files.map((f) => readFileSync(`${ROOT}/${f}`, "utf8"));

	const valuesNamedBy = (attribute) =>
		new Set(
			[...css.matchAll(new RegExp(`${attribute}="([\\w-]*)"`, "g"))].map(
				(m) => m[1],
			),
		);
	const carried = (attribute, value) => {
		const pattern =
			value === ""
				? new RegExp(`${attribute}(?=[\\s>])|${attribute}=""`)
				: new RegExp(`${attribute}="${value}"`);
		return sources.some((source) => pattern.test(source));
	};

	const regions = valuesNamedBy("data-glass-region");
	assert.ok(regions.size >= 5);
	for (const region of regions)
		assert.ok(
			carried("data-glass-region", region),
			`CSS names region "${region}" but no component carries it`,
		);
	const states = valuesNamedBy("data-glass-state");
	for (const state of states)
		assert.ok(
			carried("data-glass-state", state),
			`CSS names state "${state}" but no component carries it`,
		);
	const wells = valuesNamedBy("data-glass-well");
	for (const well of wells)
		assert.ok(
			carried("data-glass-well", well),
			`CSS names well "${well}" but no component carries it`,
		);
	/* Round 3: a plane is a clear surface or a masking band, and a lane is the
	 * board's surface wash. Both are attribute markers, so the same closed-
	 * vocabulary check holds them. */
	const planes = valuesNamedBy("data-glass-plane");
	assert.ok(planes.has("clear") && planes.has("band"));
	for (const plane of planes)
		assert.ok(
			carried("data-glass-plane", plane),
			`CSS names plane "${plane}" but no component carries it`,
		);
	if (/\[data-glass-lane\]/.test(css))
		assert.ok(
			sources.some((source) => /data-glass-lane/.test(source)),
			"CSS names data-glass-lane but no component carries it",
		);
	/*
	 * THE STACKED INK IS FORBIDDEN, NOT MEASURED. A row inside a veiled
	 * block once took `hover:bg-row-hover` over the veil - ink 5% over ink 9% -
	 * and the stack measured `inkMuted` 4.03:1 on synthwave and `inkDim` 3.11 on
	 * cyberpunk (review round 1, R2). The decision is suppression (the card's own
	 * no-hover rule one level down), so the assertion is that the suppression
	 * still exists; a contract row would certify a paint nothing may wear.
	 */
	assert.match(
		css,
		/\[data-glass-block\]\s*\[class~="hover:bg-row-hover"\]:hover\s*\{\s*background-color:\s*transparent;/,
		"a row inside a veiled block must paint no hover fill: veil + row-hover stacks two inks and breaks AA",
	);
	/*
	 * ROUND 1, F1 + ROUND 2, MAJOR: THE PANE TRANSLATION IS THE SAME STACK, AND THE
	 * SUPPRESSION MUST REACH WHEREVER THE VEIL DOES. A hovered option row or footer
	 * button inside the ask card took the pane rule's `row-hover` (ink 5%) over the
	 * card's veil and measured `inkMuted` 4.30:1 on synthwave - the
	 * `hover:bg-row-hover` suppression above did not cover it, because the ask rows
	 * wear `hover:bg-sunken` and let the PANE rewrite them.
	 *
	 * A REGEX CANNOT SEE SCOPE, and that is how round 1 passed while the FLEET asks
	 * drawer still painted an opaque hover over its veil: the suppression repeated
	 * the pane rule's `main[...]` path, the drawer's pane is a SIBLING of `<main>`,
	 * and no pattern over the rule's own text noticed that the rule could not match
	 * there. The assertion below is therefore the real cascade: both mounts are
	 * built as DOM, the stylesheet is the shipped `index.css`, Tailwind's utilities
	 * are injected at the layer and specificity it emits, and jsdom does the
	 * selector matching. `:hover` is rewritten to a class because jsdom has no
	 * pointer state. Two control variants then prove both halves are load-bearing:
	 * drop the block-only selector and the FLEET mount fills again; drop the
	 * structural one and the SESSION mount's translation out-specifies the
	 * suppression and fills again.
	 */
	const hover = veiledHoverOutcome(css);
	assert.equal(
		hover.session.veil,
		true,
		"the session mount's card must be veiled for the suppression to matter",
	);
	assert.equal(
		hover.fleet.veil,
		true,
		"the fleet mount's card must be veiled: the veil is canvas-gated, not main-scoped",
	);
	assert.equal(
		hover.session.value,
		"transparent",
		`session mount: the pane translation (${hover.session.translationSpecificity}) must lose to the suppression, got ${hover.session.value} from ${hover.session.selector}`,
	);
	assert.equal(
		hover.fleet.value,
		"transparent",
		`fleet mount: the raw hover utility must paint no fill over the veil, got ${hover.fleet.value} from ${hover.fleet.selector}`,
	);
	assert.match(
		hover.fleet.selector,
		/html\[data-glass~="canvas"\]/,
		"the fleet-reachable selector must be gated on the veil's own gate",
	);
	assert.ok(
		!hover.fleet.selector.includes("main["),
		"the fleet mount is a sibling of <main>: the selector that wins there cannot be the pane path",
	);
	const withoutFleet = veiledHoverOutcome(css, { keepBranches: "pane" });
	assert.notEqual(
		withoutFleet.fleet.value,
		"transparent",
		"control: with the block-only selector dropped, the fleet mount must fill again - otherwise the assertion is vacuous",
	);
	const withoutPane = veiledHoverOutcome(css, { keepBranches: "block" });
	assert.notEqual(
		withoutPane.session.value,
		"transparent",
		"control: with the structural selector dropped, the pane translation out-specifies the suppression - the second selector is not redundant",
	);
	if (/\[data-glass-block\]/.test(css))
		assert.ok(
			sources.some((source) => /data-glass-block/.test(source)),
			"CSS names data-glass-block but no component carries it",
		);
	/* The row hooks the veil's nested-row rule selects (round 1, R2): a CSS rule
	 * keyed on an attribute no component wears reads as coverage and measures
	 * nothing, the same rule the block/state/well checks above enforce. */
	for (const attribute of [
		"data-glass-block-row",
		"data-glass-block-row-label",
	]) {
		if (!new RegExp(`\\[${attribute}\\]`).test(css)) continue;
		assert.ok(
			sources.some((source) => new RegExp(attribute).test(source)),
			`CSS names ${attribute} but no component carries it`,
		);
	}
});

test("G-11b nested panes clear instead of compounding raw, net, or split alpha", () => {
	const css = readFileSync(`${ROOT}/src/renderer/src/styles/index.css`, "utf8");
	const dom = new JSDOM(`<!doctype html><html data-glass="canvas pane"><body>
		<div id="raw" data-glass-region="pane"><div id="raw-inner" data-glass-region="pane"></div></div>
		<main data-glass-region="canvas-backing">
			<div id="net" data-glass-region="pane"><div id="net-inner" data-glass-region="pane"></div></div>
			<div id="split" data-glass-region="pane" data-glass-split><div id="split-inner" data-glass-region="pane"></div></div>
		</main>
	</body></html>`);
	const { document } = dom.window;
	const winningBackground = (source, element) => {
		let winner;
		for (const rule of cssRules(source)) {
			/* Every pane paint is unlayered, so a layered utility cannot win
			 * these mounts regardless of its position in the stylesheet. */
			if (rule.layer !== null) continue;
			const value = BACKGROUND_COLOR_DECLARATION.exec(rule.body)?.[1].trim();
			if (!value) continue;
			for (const selector of splitSelectorList(rule.selector)) {
				if (!element.matches(selector)) continue;
				const candidate = {
					value,
					order: rule.order,
					specificity: specificityOf(selector),
				};
				if (!winner) {
					winner = candidate;
					continue;
				}
				const specific =
					[0, 1, 2]
						.map(
							(index) =>
								candidate.specificity[index] - winner.specificity[index],
						)
						.find((difference) => difference !== 0) ?? 0;
				if (specific > 0 || (specific === 0 && candidate.order > winner.order))
					winner = candidate;
			}
		}
		return winner?.value ?? "none";
	};
	for (const outer of ["raw", "net", "split"]) {
		const outerElement = document.getElementById(outer);
		const innerElement = document.getElementById(`${outer}-inner`);
		assert.notEqual(
			winningBackground(css, outerElement),
			"transparent",
			`${outer}: the outer pane remains the alpha owner`,
		);
		assert.equal(
			winningBackground(css, innerElement),
			"transparent",
			`${outer}: the nested pane cannot repaint a second alpha`,
		);
	}
	/* Negative control: without the clear branches the same cascade must paint
	 * the child. A test that only sees transparency could otherwise be vacuous. */
	const withoutClears = cssRules(css)
		.filter(
			(rule) =>
				!(
					TRANSPARENT_BACKGROUND_DECLARATION.test(rule.body) &&
					rule.selector.includes(
						'[data-glass-region="pane"] [data-glass-region="pane"]',
					)
				),
		)
		.map((rule) => `${rule.selector}{${rule.body}}`)
		.join("\n");
	assert.notEqual(
		winningBackground(withoutClears, document.getElementById("net-inner")),
		"transparent",
		"the net-pane paint wins when its clear is removed",
	);
});

test("G-12 unset vs explicit: a default change never overturns a recorded choice", () => {
	const cap = glass.glassCapabilityFor(MAC);
	const win = glass.glassCapabilityFor(WIN11);

	/* NO FILE AT ALL: every field is today's default. */
	assert.equal(glass.resolveStoredGlass(null, cap), null, "missing is missing");
	assert.equal(
		glass.resolveStoredGlass("nope", cap),
		null,
		"corrupt is missing",
	);
	assert.equal(glass.resolveStoredGlass({}, cap), null);

	/* A version-2 file records only what the user touched. */
	const intensityOnly = glass.resolveStoredGlass(
		{ version: 2, settings: { intensity: 50 }, explicit: ["intensity"] },
		cap,
	);
	assert.deepEqual(
		intensityOnly,
		{
			settings: {
				enabled: true,
				coverage: "full",
				intensity: 50,
				material: "window",
			},
			explicit: ["intensity"],
			scheme: "dark",
		},
		"a stored 50 is kept; enabled comes from today's default",
	);

	const explicitOff = glass.resolveStoredGlass(
		{ version: 2, settings: { enabled: false }, explicit: ["enabled"] },
		cap,
	);
	assert.equal(
		explicitOff.settings.enabled,
		false,
		"an explicit OFF stays off across the default flip",
	);
	assert.equal(
		explicitOff.settings.intensity,
		80,
		"its untouched intensity is the new default",
	);

	const fullChoice = glass.resolveStoredGlass(
		{
			version: 2,
			settings: {
				enabled: false,
				coverage: "sidebars",
				intensity: 35,
				material: "menu",
			},
			explicit: ["enabled", "coverage", "intensity", "material"],
			scheme: "light",
		},
		cap,
	);
	assert.deepEqual(fullChoice.settings, {
		enabled: false,
		coverage: "sidebars",
		intensity: 35,
		material: "menu",
	});
	assert.equal(fullChoice.scheme, "light");

	/* A v1 file (no `explicit`) carries a FULL settings object and no intent.
	 * Every field it holds is preserved: the conservative reading, because an
	 * OFF copied from the old default is indistinguishable from a chosen OFF. */
	const legacy = glass.resolveStoredGlass(
		{
			settings: {
				enabled: false,
				coverage: "full",
				intensity: 40,
				material: "window",
			},
			scheme: "dark",
		},
		cap,
	);
	assert.deepEqual(legacy.settings, {
		enabled: false,
		coverage: "full",
		intensity: 40,
		material: "window",
	});
	assert.deepEqual(legacy.explicit, [
		"enabled",
		"coverage",
		"intensity",
		"material",
	]);

	/* A version-2 file MISSING the list is treated as legacy, not as "nothing was
	 * chosen": otherwise an explicit off would be silently re-enabled. */
	const missingList = glass.resolveStoredGlass(
		{ version: 2, settings: { enabled: false } },
		cap,
	);
	assert.equal(missingList.settings.enabled, false);

	/* A CORRUPT explicit value falls to the opaque floor, not to today's ON. */
	const corrupt = glass.resolveStoredGlass(
		{ version: 2, settings: { enabled: "yes" }, explicit: ["enabled"] },
		cap,
	);
	assert.equal(
		corrupt.settings.enabled,
		false,
		"a corrupt explicit enabled keeps the shipped opaque look (R1-1)",
	);
	const missingEnabledLegacy = glass.resolveStoredGlass(
		{ settings: { intensity: 50 } },
		cap,
	);
	assert.equal(
		missingEnabledLegacy.settings.enabled,
		false,
		"a legacy file whose enabled is missing resolves opaque, never default-ON",
	);
	assert.equal(missingEnabledLegacy.settings.intensity, 50);

	/* The version marker is read: an old marker gets the legacy (all-explicit)
	 * treatment even if a list somehow rides along (R1-9). */
	const oldVersion = glass.resolveStoredGlass(
		{
			version: 1,
			settings: { enabled: true, intensity: 70 },
			explicit: ["intensity"],
		},
		cap,
	);
	assert.deepEqual(oldVersion.explicit, [
		"enabled",
		"coverage",
		"intensity",
		"material",
	]);
	assert.equal(oldVersion.settings.enabled, true);

	/* Unknown explicit entries are ignored; the rest are honoured. */
	const junk = glass.resolveStoredGlass(
		{
			version: 2,
			settings: { intensity: 20 },
			explicit: ["intensity", "bogus"],
		},
		cap,
	);
	assert.deepEqual(junk.explicit, ["intensity"]);
	assert.equal(junk.settings.intensity, 20);

	/* Windows never defaults on, whatever the file says about enabled. */
	const winUnset = glass.resolveStoredGlass(
		{ version: 2, settings: {}, explicit: [] },
		win,
	);
	assert.equal(winUnset.settings.enabled, false);
	const winStaleOn = glass.resolveStoredGlass(
		{ version: 2, settings: { enabled: true }, explicit: ["enabled"] },
		win,
	);
	assert.equal(
		winStaleOn.settings.enabled,
		true,
		"the choice is kept in storage for a future verified Windows",
	);
	assert.equal(
		glass.glassIsActive(winStaleOn.settings, win),
		false,
		"but it is INERT at render time - the gate is below the UI",
	);
});

test("G-13 the launch gate line names platform, support, default, value and reason", () => {
	const mac = glass.glassCapabilityFor(MAC);
	const line = glass.glassGateLine(
		mac,
		glass.defaultGlassSettings(mac),
		"darwin",
	);
	assert.match(line, /^\[window-glass\] launch gate /);
	for (const part of [
		"platform=darwin",
		"supported=true",
		"default=true",
		"enabled=true",
		"intensity=80",
		"reason=ok",
		"mechanism=vibrancy",
	])
		assert.ok(line.includes(part), `gate line names ${part}`);

	const win = glass.glassCapabilityFor(WIN11);
	const refused = glass.glassGateLine(
		win,
		glass.defaultGlassSettings(win),
		"win32",
	);
	assert.ok(refused.includes("supported=false"));
	assert.ok(refused.includes("reason=windows-unverified"));
	assert.ok(refused.includes("enabled=false"));
});
