#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
echo "===== chain7d start $(date -u +%H:%M:%S) ====="
bash run7.sh btw-r7-fold r7fold 800x900
QA_ASIDE_FIRST=1 QA_SEED_TURNS=2 bash run7.sh r3-479 r7479b 800x900
echo "===== chain7d done $(date -u +%H:%M:%S) ====="
