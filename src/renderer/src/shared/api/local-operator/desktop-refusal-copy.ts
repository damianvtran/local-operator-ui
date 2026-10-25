/**
 * The sentence a refused desktop control composes into, resolved per draw.
 *
 * WHY THIS IS A MODULE OF ITS OWN, beside the transport rather than inside it.
 * The transport's docstring states the rule this follows ("the translator lives
 * here rather than at nine call sites"), and this is that translator: the ONE
 * place a refusal code becomes words. It cannot live in `desktop-api.ts` itself,
 * though, because the renderer suites STUB that module wholesale to drive the
 * IPC seam - and a stub that has to grow a copy export every time a new consumer
 * appears is a test fixture writing the production interface. `canonical-sessions-
 * store.ts` and `mcp-failure.ts` import this module directly, so their bundles
 * take the real resolver instead of a lookalike; the transport imports it too,
 * which is what keeps every surface on one table.
 *
 * THE TWO HALVES. The key table lives in the shared contract, because main and
 * renderer must agree on which code maps to which message. The words live in the
 * catalogue, so a locale change is picked up by the next draw rather than frozen
 * into a constant at import time.
 */

import { t } from "../../../../../i18n";
import {
	DESKTOP_REFUSAL_COPY_KEY,
	type DesktopRefusalCode,
} from "../../../../../shared/desktop-contract";

export function desktopRefusalSentence(code: DesktopRefusalCode): string {
	return t(DESKTOP_REFUSAL_COPY_KEY[code]);
}
