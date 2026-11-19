/**
 * Own grid: the four S16d keys through intl-messageformat with REAL arguments,
 * after parsing with the repo's own ICU parser (the one locale-parity uses).
 * Also asserts argument NAME/TYPE identity against English and the locale's
 * plural categories (none of these keys is a plural, but the script reports it).
 */
import { readFileSync } from "node:fs";
import { TYPE, parse } from "/Users/damian/local-operator-ui/.worktrees/i18n-s16d/node_modules/@formatjs/icu-messageformat-parser/index.js";
import IntlMessageFormat from "/Users/damian/local-operator-ui/.worktrees/i18n-s16d/node_modules/intl-messageformat/index.js";

const ROOT = "/Users/damian/local-operator-ui/.worktrees/i18n-s16d/src/i18n/catalogues";
const es = JSON.parse(readFileSync(`${ROOT}/es/ui.common.time.json`, "utf8"));
const en = JSON.parse(readFileSync(`${ROOT}/en/ui.common.time.json`, "utf8"));
const KEYS = [
	"ui.common.time.today_at",
	"ui.common.time.yesterday_at",
	"ui.common.time.yesterday",
	"ui.common.time.weekday_at",
	"ui.common.time.date_at",
];

const argsOf = (msg) => {
	const out = new Map();
	const walk = (els) => {
		for (const el of els) {
			if (el.type === TYPE.argument) out.set(el.value, "string");
			else if (el.type === TYPE.plural || el.type === TYPE.select) {
				const cats = Object.keys(el.options).sort();
				out.set(el.value, `${el.type}:${cats.join(",")}`);
				for (const o of Object.values(el.options)) walk(o.value);
			} else if (el.type === TYPE.tag) walk(el.children);
		}
	};
	walk(parse(msg));
	return out;
};

const fmt = (locale, msg, args) =>
	new IntlMessageFormat(msg, locale).format(args);

const d = (h, m) => new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 10, 9, h, m));
const wd = new Intl.DateTimeFormat("es", { weekday: "long" });
const ld = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" });

const CLOCKS = [[0, 5], [9, 5], [12, 0], [14, 30], [23, 59]];
const DAYS = [new Date(2026, 10, 5), new Date(2026, 10, 8), new Date(2026, 10, 9), new Date(2026, 10, 11)];

let bad = 0;
console.log("args en:", JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, Object.fromEntries(argsOf(en[k]))]))));
console.log("args es:", JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, Object.fromEntries(argsOf(es[k]))]))));

for (const key of KEYS) {
	const a = argsOf(en[key]);
	const b = argsOf(es[key]);
	const same = a.size === b.size && [...a].every(([n, t]) => b.get(n) === t);
	if (!same) { bad++; console.log(`MISMATCH ${key}: en=${[...a]} es=${[...b]}`); }
	else console.log(`args ok ${key} (${[...a.keys()].join(",") || "none"})`);
}

console.log("\n--- composed grid, es ---");
for (const [h, m] of CLOCKS) {
	const time = d(h, m);
	console.log(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`.padEnd(6),
		"today_at=", JSON.stringify(fmt("es", es["ui.common.time.today_at"], { time })),
		"weekday_at=", JSON.stringify(fmt("es", es["ui.common.time.weekday_at"], { weekday: wd.format(DAYS[2]), time })));
}
for (const day of DAYS) {
	console.log(day.toDateString(),
		"weekday_at=", JSON.stringify(fmt("es", es["ui.common.time.weekday_at"], { weekday: wd.format(day), time: d(14, 30) })),
		"date_at=", JSON.stringify(fmt("es", es["ui.common.time.date_at"], { date: ld.format(day), time: d(14, 30) })));
}
console.log("yesterday_at=", JSON.stringify(fmt("es", es["ui.common.time.yesterday_at"], { time: d(9, 5) })),
	"yesterday=", JSON.stringify(fmt("es", es["ui.common.time.yesterday"], {})));

// English left behind? Any ASCII letter run in the RENDERED output that is not a named exception.
const rendered = [
	fmt("es", es["ui.common.time.today_at"], { time: "14:30" }),
	fmt("es", es["ui.common.time.yesterday_at"], { time: "9:05" }),
	fmt("es", es["ui.common.time.yesterday"], {}),
	fmt("es", es["ui.common.time.weekday_at"], { weekday: "lunes", time: "14:30" }),
	fmt("es", es["ui.common.time.date_at"], { date: "5 de noviembre de 2026", time: "14:30" }),
];
console.log("\nrendered:", rendered.map((s) => JSON.stringify(s)).join(" | "));
const englishWords = rendered.join(" ").match(/\b(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|AM|PM)\b/g);
console.log("English words found:", englishWords ?? "none");
console.log("\nARG/GRID problems:", bad);
