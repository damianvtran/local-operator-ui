/*
 * Fixture for `scripts/i18n/typed-keys.test.mjs` — NOT product code. Compiled
 * against the FIXTURE-generated `keys.gen.ts` (its catalogue lives beside this
 * file); every line here must pass `tsc --strict`. Each parameter kind the
 * generator maps appears at least once, and the date argument accepts both a
 * `Date` and epoch milliseconds (the RFC §2.4 map types it `Date | number`).
 */

import { t } from "./messages";

export const hello = t("demo.words.hello", { name: "Ada" });
export const files = t("demo.words.files", { count: 3 });
export const updated = t("demo.words.updated", { when: new Date() });
export const updatedMs = t("demo.words.updated", { when: 1_760_000_000_000 });
export const plain = t("demo.words.plain");
export const pick = t("demo.words.pick", { choice: "a" });
