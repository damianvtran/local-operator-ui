// Re-derivable mechanical checks used for this audit (read-only; run from the repo root).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const d = "src/i18n/catalogues/";
const en = JSON.parse(readFileSync(d + "en/ui.chat.composer.json", "utf8"));
const ur = JSON.parse(readFileSync(d + "ur/ui.chat.composer.json", "utf8"));
const ctx = JSON.parse(readFileSync(d + "en/ui.chat.composer.context.json", "utf8"));
const P = "ui.chat.composer.";
const keys = ["secret_closure_notice","insert_transcript","insert_transcript_hint","send_recording","send_recording_hint","steer_hint"];
const cells = (s) => [...s].filter((c) => !/[\p{Mn}\p{Cf}]/u.test(c)).length;
console.log("key sets equal:", JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(ur).sort()), Object.keys(en).length);
for (const k of keys) {
  const v = ur[P + k];
  console.log(k, { cells: cells(v), maxCells: ctx[P + k]?.maxCells ?? null, nfc: v === v.normalize("NFC"), padded: v !== v.trim() || v.includes("  "), placeholders: (v.match(/[{}<>`]/g) || []).length, formatChars: (v.match(/\p{Cf}/gu) || []).length, latin: v.match(/[A-Za-z]+/g) || [] });
}
for (const f of ["en/ui.chat.composer.json","en/ui.chat.composer.context.json","ur/ui.chat.composer.json"]) console.log(createHash("sha256").update(readFileSync(d + f)).digest("hex"), f);
