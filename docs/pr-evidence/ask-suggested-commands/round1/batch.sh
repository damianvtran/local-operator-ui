#!/usr/bin/env bash
S=$LOCAL_OPERATOR_SCRATCHPAD/r1
C500="$(cat $S/cmd500.txt)"
R=$S/run.sh
$R focus focus
$R insert insert
$R stale stale
$R fleet fleet
R1_N=10 $R latency latency
for i in 1 2 3 4 5; do $R fleetlat fleetlat-$i; done
ASKCMD_COMMAND="glab auth login" $R frames frames-short-1380 1380x900
ASKCMD_COMMAND="echo ASKCMD-\$((40+2)) | tee -a qa-side.log" $R frames frames-local-1380 1380x900
ASKCMD_COMMAND="glab auth login" ASKCMD_REMOTE=1 $R frames frames-remote-1380 1380x900
ASKCMD_COMMAND="glab auth login" ASKCMD_REMOTE=1 $R frames frames-remote-1024 1024x700
ASKCMD_COMMAND="$C500" $R frames frames-500-1024 1024x700
ASKCMD_COMMAND="glab auth login" ASKCMD_REMOTE=1 ASKCMD_LANG=ru $R frames frames-remote-ru-1024 1024x700
ASKCMD_COMMAND="glab auth login" ASKCMD_LANG=vi $R frames frames-local-vi-1024 1024x700
echo BATCH-DONE
