#!/usr/bin/env bash
# The her-row pass: `run.sh` with the assistant ON.
#
#   bash run-aida.sh <tree> <label>
#
# Two switches, both halves of the one gate (`aida/bootstrap.py::config_enabled`):
# the seed writes `aida.enabled: true` (`ACK_AIDA_ENABLED=1`), and the launches
# carry `LOCAL_OPERATOR_NO_AIDA=0` - the env switch reads truthiness with
# `0`/`false`/`no`/`off` meaning "on" (`local_operator/aida/state.py`), so this is
# the spelling that opens it rather than a var that looks switched off.
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec env ACK_AIDA_ENABLED=1 ACK_NO_AIDA=0 ACK_DRIVE="$HARNESS/drive-aida.mjs" \
	bash "$HARNESS/run.sh" "$@"
