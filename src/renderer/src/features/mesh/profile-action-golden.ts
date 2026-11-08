/**
 * The GOLDEN wire artifact, vendored so a fixture cannot drift from the daemon.
 *
 * WHY A JSON FILE AND NOT A TS LITERAL. The values below are the daemon's own
 * serialisation, not copy this repo authors: leaving them in a `.ts` file made the
 * added-copy checker read fixture `description`/`label`/`text` values as unkeyed UI
 * strings. Keeping the artifact verbatim in `profile-action-golden.json` is both
 * honest (the artifact's own values, reformatted by this repo's formatter - every
 * value parsed equal to the export, checked when it was vendored) and outside that
 * checker's remit, which is about code that renders copy.
 *
 * PROVENANCE (verbatim from the artifact's own `meta`). The artifact is a fresh
 * export each run - the synthetic ids and digests move between exports, the SHAPE and
 * `source_sha` do not - so the parity test pins provenance and shape, never an id:
 *   source_sha:         7c44dfbb3b9e9cfee86c55fc4a1437717cdf1439 (core PR #3449 head)
 *   uncommitted_source: false — exported from a clean checkout of that commit.
 *   generator_command:  PYTHONPATH=. <primary-python> -m pytest -n0 -q -p no:cacheprovider
 *                       tests/unit/session/test_profile_actions.py -k export_golden_profile_wires
 *                       (run with LOCAL_OPERATOR_SCRATCHPAD=<out dir>; `<primary-python>`
 *                       replaces the exporting machine's interpreter path, the one
 *                       value changed from the export)
 *   assurance:          synthetic ES256 signatures; test-only presence stand-in; no OS signing
 *   list_row_proof:     actual approval_rows(root), function serialization only; not HTTP
 *
 * WHAT IT IS NOT: a product action-success claim. Core ships the status route and
 * registers `profile_save` at that commit, but these are function serialisations
 * with synthetic signatures, so nothing here proves a live approve, apply or revert. The fixtures exist so the parsers and the stories are
 * exercised against the real serialisation instead of a hand-built prop bag - which
 * is how the previous fixture photographed a shape no daemon serves.
 */
import artifact from "./profile-action-golden.json";

/** The artifact's own provenance, so a test can assert which artifact is vendored. */
export const PROFILE_ACTION_GOLDEN_META = artifact.meta;

/** `GET /v1/desktop/approvals`' rows — `approval_rows(root)`, function serialisation. */
export const GOLDEN_APPROVAL_ROWS = artifact.approval_rows;

/** The live action's ACK frames: available, applied, duplicate, reconciled, refused. */
export const GOLDEN_LIVE_ACTION_ACK = artifact.live_action_ack;

/** A queued ToolResult, exactly as `_queued_profile_receipt` returned it. */
export const GOLDEN_QUEUED_TOOL_RESULT = artifact.queued_tool_result;

/** A saved AGENT ToolResult: real `details`, including the legacy `revert` hint. */
export const GOLDEN_SAVED_AGENT_TOOL_RESULT = artifact.saved_agent_tool_result;

/** A saved TEAM ToolResult: the other family, whose saved details carry no `kind`. */
export const GOLDEN_SAVED_TEAM_TOOL_RESULT = artifact.saved_team_tool_result;

/** The signed applied receipt, carrying its verified `profile_action` descriptor. */
export const GOLDEN_SIGNED_APPLIED_RECEIPT = artifact.signed_applied_receipt;
