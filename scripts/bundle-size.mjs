/**
 * Reports renderer bundle size: total JS, largest chunks, chunk count.
 *
 * Exists because `electron-vite build` prints a per-file list but no totals, and
 * bundle work needs a single comparable number between runs. Reads out/renderer
 * rather than instrumenting rollup so it stays independent of build config.
 *
 * Usage: node scripts/bundle-size.mjs [label]
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = "out/renderer/assets";
const label = process.argv[2] ?? "unlabelled";

const files = readdirSync(dir).map((name) => ({
	name,
	size: statSync(join(dir, name)).size,
}));

const sum = (list) => list.reduce((n, f) => n + f.size, 0);
// kB (1000 bytes) to match vite's own build output units.
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;

const js = files.filter((f) => f.name.endsWith(".js"));
const css = files.filter((f) => f.name.endsWith(".css"));
const fonts = files.filter((f) => /\.(otf|ttf|woff2?)$/.test(f.name));

js.sort((a, b) => b.size - a.size);

const row = [
	label,
	`js=${kb(sum(js))}`,
	`chunks=${js.length}`,
	`main=${kb(js[0]?.size ?? 0)}`,
	`css=${kb(sum(css))}`,
	`fonts=${kb(sum(fonts))}`,
].join("\t");

console.log(row);
console.log("top 10 JS chunks:");
for (const f of js.slice(0, 10)) console.log(`  ${kb(f.size).padStart(12)}  ${f.name}`);
