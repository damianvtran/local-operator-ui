#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
while ! grep -q 'chain7a done' chain7a.log 2>/dev/null; do sleep 15; done
echo "===== chain7b start $(date -u +%H:%M:%S) ====="
bash run7.sh btw-r6        r7narrow       800x900
bash run7.sh btw-r6        r7wide        1380x900
bash run7.sh btw-r5-adopt  r7adoptnarrow  800x900
bash run7.sh btw-r6-capq   r7capq         800x900
QA_ASIDE_FIRST=1 QA_SEED_TURNS=2 bash run7.sh r3-479 r7479 800x900
echo "===== chain7b done $(date -u +%H:%M:%S) ====="
