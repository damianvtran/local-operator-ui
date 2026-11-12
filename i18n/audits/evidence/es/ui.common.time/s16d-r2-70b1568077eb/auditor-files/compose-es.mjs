/**
 * Compose REAL divider-label and hover-date output for `es` through the app's
 * own formatter (live-locale Intl), exactly as the S16d test does.
 * READ-ONLY on the repo: esbuild write:false, nothing is written.
 *
 * One bundle, one module instance: `registerCatalogue` must reach the same
 * module registry `t()` reads, or the second section silently falls back to
 * English (measured on the first draft of this script, which bundled `t`
 * separately and printed "Today 14:30" for es).
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const ROOT = "/Users/damian/local-operator-ui/.worktrees/i18n-s16d";

const bundle = await build({
	stdin: {
		contents: `
			export { formatDividerLabel } from "./src/renderer/src/features/chat/utils/message-grouping";
			export { formatMessageDateTime } from "./src/renderer/src/shared/utils/date-utils";
			export { setLocale } from "./src/i18n/locale";
			export { clearRegisteredCatalogues, registerCatalogue, t } from "./src/i18n/messages";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { "@shared": `${ROOT}/src/renderer/src/shared` },
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const catalogue = JSON.parse(
	readFileSync(`${ROOT}/src/i18n/catalogues/es/ui.common.time.json`, "utf8"),
);

for (const locale of ["en", "es"]) {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue("es", catalogue);
	mod.setLocale(locale);

	const now = new Date(2026, 10, 12, 15, 5); // 2026-11-12 15:05 local
	const cases = [
		["today", new Date(2026, 10, 12, 14, 30)],
		["yesterday", new Date(2026, 10, 11, 9, 5)],
		["weekday", new Date(2026, 10, 9, 14, 30)], // Monday 9 Nov
		["older", new Date(2026, 10, 5, 14, 30)], // 5 Nov 2026
	];
	console.log(`\n=== ${locale} ===`);
	for (const [name, d] of cases) {
		console.log(
			`${name.padEnd(10)} divider=${JSON.stringify(mod.formatDividerLabel(d, now))}  hover=${JSON.stringify(mod.formatMessageDateTime(d, now))}`,
		);
	}
}

// The formatter's ACTUAL ICU arguments, rendered with the same registered es
// catalogue the app would have.
mod.clearRegisteredCatalogues();
mod.registerCatalogue("es", catalogue);
mod.setLocale("es");
const at = (h, m) => new Date(2026, 10, 9, h, m);
const time = new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(at(14, 30));
const wd = new Intl.DateTimeFormat("es", { weekday: "long" }).format(at(14, 30));
const dt = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(new Date(2026, 10, 5));
console.log("\n=== real ICU arguments, es catalogue registered ===");
console.log("today_at    ", JSON.stringify(mod.t("ui.common.time.today_at", { time })));
console.log("yesterday_at", JSON.stringify(mod.t("ui.common.time.yesterday_at", { time })));
console.log("weekday_at  ", JSON.stringify(mod.t("ui.common.time.weekday_at", { weekday: wd, time })));
console.log("date_at     ", JSON.stringify(mod.t("ui.common.time.date_at", { date: dt, time })));
console.log("yesterday   ", JSON.stringify(mod.t("ui.common.time.yesterday")));
