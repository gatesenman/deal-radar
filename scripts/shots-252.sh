#!/bin/bash
cd /workspace/deal-monitor
run(){ rm -rf /tmp/drud-$1; DEAL_RADAR_SHOT=/workspace/deal-monitor/screenshots DEAL_RADAR_SHOT_SET=gaps DEAL_RADAR_SHOT_PREFIX=$1 timeout 330 xvfb-run -a -s "-screen 0 1440x900x24" ./node_modules/.bin/electron . --no-sandbox --user-data-dir=/tmp/drud-$1 2>&1 | grep -E "\[gaps\]|\[shot\]"; }
npm test 2>&1 | grep -E "^# (pass|fail|skip)|^not ok"
mkdir -p /tmp/new && cp src/renderer/app.js src/renderer/styles.css /tmp/new/
cp .v251/app.js .v251/styles.css src/renderer/; run j0-before
cp /tmp/new/app.js /tmp/new/styles.css src/renderer/; run j1-after
echo DONE
