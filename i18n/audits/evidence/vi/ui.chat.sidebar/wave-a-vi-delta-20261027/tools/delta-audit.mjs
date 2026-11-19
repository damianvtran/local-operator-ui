#!/usr/bin/env node
/**
 * Delta audit tool — wave A / vi, head 80ee119bbd (locale vi, 4 namespaces, 38 keys).
 *
 * WHAT IT DOES, and nothing more: reads the English catalogue, its context sidecar
 * and the Vietnamese catalogue from a git-archive export, then
 *   - parses every value with the repository's own ICU parser
 *     (@formatjs/icu-messageformat-parser) and compares argument names/types and
 *     plural/select arms against the English message;
 *   - renders every message through the repository's own intl-messageformat with
 *     locale "vi", using sample arguments derived from the English message's own
 *     argument types, and records any throw;
 *   - records NFC form, bidi controls, ASCII ellipsis, straight quotes, leading or
 *     trailing whitespace, and display cells.
 * It is a STRUCTURAL validator. It is not a translation source and never suggests
 * wording: every wording judgement in the audit is the auditor's own reading.
 *
 * WHY THE REPO'S OWN PACKAGES: a structural claim about ICU agreement should be
 * made by the same parser the renderer uses, not by a regex over braces.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { TYPE, parse } from "@formatjs/icu-messageformat-parser";
import IntlMessageFormat from "intl-messageformat";

const ROOT = process.argv[2];
const OUT = process.argv[3] ?? null;
const NS = ["ui.chat", "ui.chat.header", "ui.chat.response_actions", "ui.chat.sidebar"];
const KEYLIST = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : null;

const SEVERITY = null; // findings are the auditor's; this tool reports facts only.

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

/** Width in terminal cells: 2 for East-Asian Wide/Fullwidth, 0 for combining marks. */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const ZERO = /[\u0300-\u036F\u200B-\u200F\uFE00-\uFE0F\u20D0-\u20F0]/;
function cells(text) {
  let n = 0;
  for (const ch of text.normalize("NFC")) {
    if (ZERO.test(ch)) continue;
    n += WIDE.test(ch) ? 2 : 1;
  }
  return n;
}

/** Argument names/types and select/plural arms, in source order. */
function shape(message) {
  let ast;
  try {
    ast = parse(message);
  } catch (error) {
    return { parseError: error.message, args: [], arms: [] };
  }
  const args = [];
  const arms = [];
  const walk = (nodes, pluralPath) => {
    for (const node of nodes) {
      if (node.type === TYPE.argument) args.push(`${node.value}:argument`);
      else if (node.type === TYPE.number) args.push(`${node.value}:number`);
      else if (node.type === TYPE.date) args.push(`${node.value}:date`);
      else if (node.type === TYPE.time) args.push(`${node.value}:time`);
      else if (node.type === TYPE.plural || node.type === TYPE.select) {
        const kind = node.type === TYPE.plural ? node.pluralType ?? "cardinal" : "select";
        args.push(`${node.value}:${node.type === TYPE.plural ? `plural(${kind})` : "select"}`);
        const here = pluralPath ? `${pluralPath}/${node.value}` : node.value;
        for (const [selector, option] of Object.entries(node.options)) {
          arms.push(`${here}=${selector}`);
          walk(option.value, here);
        }
        continue;
      } else if (node.type === TYPE.pound) {
        arms.push(`${pluralPath ?? "?"}=#`);
        continue;
      } else if (node.type === TYPE.tag) {
        walk(node.children ?? [], pluralPath);
        continue;
      }
      walk(node.children ?? [], pluralPath);
    }
  };
  walk(ast, null);
  return { parseError: null, args: args.sort(), arms: arms.sort() };
}

/** Sample args for rendering: numbers where the English declares a number/plural/date. */
function sampleArgs(message) {
  const args = {};
  let ast;
  try {
    ast = parse(message);
  } catch {
    return args;
  }
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === TYPE.number || node.type === TYPE.plural) {
        args[node.value] = node.type === TYPE.plural ? 2 : 1234.5;
        if (node.type === TYPE.plural) {
          for (const [selector, option] of Object.entries(node.options)) {
            if (/=/.test(selector)) continue;
            walk(option.value);
          }
        }
        continue;
      }
      if (node.type === TYPE.date) args[node.value] = Date.UTC(2026, 9, 27);
      else if (node.type === TYPE.time) args[node.value] = Date.UTC(2026, 9, 27, 13, 5);
      else if (node.type === TYPE.argument) args[node.value] = "Mẫu";
      if (node.type === TYPE.select) {
        const first = Object.values(node.options)[0];
        if (first) walk(first.value);
        continue;
      }
      walk(node.children ?? []);
    }
  };
  walk(ast);
  return args;
}

const rows = [];
for (const ns of NS) {
  const en = read(`src/i18n/catalogues/en/${ns}.json`);
  const vi = read(`src/i18n/catalogues/vi/${ns}.json`);
  let ctx = {};
  try {
    ctx = read(`src/i18n/catalogues/en/${ns}.context.json`);
  } catch {
    ctx = {};
  }
  const keys = KEYLIST ? (KEYLIST[ns] ?? []) : Object.keys(en);
  for (const key of keys) {
    const e = en[key];
    const v = vi[key];
    const es = shape(e);
    const vs = shape(v);
    const args = sampleArgs(e);
    let viRendered = null;
    let viError = null;
    try {
      viRendered = new IntlMessageFormat(v, "vi").format(args);
    } catch (error) {
      viError = String(error.message ?? error);
    }
    let enRendered = null;
    try {
      enRendered = new IntlMessageFormat(e, "en").format(args);
    } catch (error) {
      enRendered = `<en threw: ${error.message}>`;
    }
    const c = ctx[key];
    rows.push({
      namespace: ns,
      key,
      en: e,
      vi: v,
      ctx_role: typeof c === "object" && c ? c.role : c ?? null,
      enParseError: es.parseError,
      viParseError: vs.parseError,
      enArgs: es.args,
      viArgs: vs.args,
      argsMatch: isDeepStrictEqual(es.args, vs.args),
      enArms: es.arms,
      viArms: vs.arms,
      armsMatch: isDeepStrictEqual(es.arms, vs.arms),
      nfc: v === v.normalize("NFC"),
      bidiControls: (v.match(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g) ?? []).length,
      asciiEllipsis: v.includes("..."),
      straightQuote: v.includes('"') || v.includes("'"),
      leadingTrailingSpace: v !== v.trim(),
      enCells: cells(e),
      viCells: cells(v),
      deltaCells: cells(v) - cells(e),
      ratio: Number((cells(v) / cells(e)).toFixed(2)),
      rendered: { args, en: enRendered, vi: viRendered, viError },
      maxCells: (typeof c === "object" && c && c.maxCells) || null,
    });
  }
}

const summary = {
  tool: "delta-audit.mjs (repo-installed @formatjs/icu-messageformat-parser + intl-messageformat)",
  root: ROOT,
  node: process.version,
  keyCount: rows.length,
  parseErrors: rows.filter((r) => r.viParseError).map((r) => [r.key, r.viParseError]),
  argsMismatch: rows.filter((r) => !r.argsMatch).map((r) => r.key),
  armsMismatch: rows.filter((r) => !r.armsMatch).map((r) => r.key),
  renderErrors: rows.filter((r) => r.rendered.viError).map((r) => [r.key, r.rendered.viError]),
  notNfc: rows.filter((r) => !r.nfc).map((r) => r.key),
  bidiControls: rows.filter((r) => r.bidiControls > 0).map((r) => [r.key, r.bidiControls]),
  asciiEllipsis: rows.filter((r) => r.asciiEllipsis).map((r) => r.key),
  straightQuote: rows.filter((r) => r.straightQuote).map((r) => r.key),
  leadTrailSpace: rows.filter((r) => r.leadingTrailingSpace).map((r) => r.key),
  overMaxCells: rows
    .filter((r) => r.maxCells && r.viCells > r.maxCells)
    .map((r) => [r.key, r.viCells, r.maxCells]),
};
console.log(JSON.stringify({ summary, rows }, null, 1));
if (OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
}
