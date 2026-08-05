/**
 * Reports how much JS the renderer must parse before it can paint.
 *
 * Total bundle size is a poor proxy for that: code splitting moves bytes out of
 * the startup path without deleting them. This walks the *static* import graph
 * from the entry <script> in the built HTML, so a chunk reached only through a
 * dynamic import() is excluded, exactly as the browser would.
 *
 * Usage: node scripts/startup-closure.mjs [out/renderer] [entry.html]
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.argv[2] ?? "out/renderer";
const entryHtml = process.argv[3] ?? "index.html";

const html = readFileSync(join(root, entryHtml), "utf8");
const entryMatch = html.match(/<script[^>]+src="([^"]+\.js)"/);
if (!entryMatch) throw new Error(`no entry script in ${entryHtml}`);

// Static ESM imports only. A dynamic import() is spelled `import(` and never
// matches these, which is the whole point of the measurement.
const STATIC_IMPORT =
	/(?:^|[\s;}])(?:import|export)[^;'"]*?from\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']/g;

const seen = new Set();
const queue = [resolve(root, entryMatch[1].replace(/^\.?\//, ""))];

while (queue.length > 0) {
	const file = queue.pop();
	if (seen.has(file) || !existsSync(file)) continue;
	seen.add(file);
	const src = readFileSync(file, "utf8");
	for (const m of src.matchAll(STATIC_IMPORT)) {
		const spec = m[1] ?? m[2];
		if (!spec.startsWith(".")) continue;
		queue.push(resolve(dirname(file), spec));
	}
}

const files = [...seen].map((f) => ({ f, size: statSync(f).size }));
files.sort((a, b) => b.size - a.size);
const total = files.reduce((n, x) => n + x.size, 0);

console.log(
	`${entryHtml}: startup JS ${(total / 1000).toFixed(1)} kB across ${files.length} chunk(s)`,
);
for (const x of files.slice(0, 8)) {
	console.log(
		`  ${(x.size / 1000).toFixed(1).padStart(10)} kB  ${x.f.split("/").pop()}`,
	);
}
