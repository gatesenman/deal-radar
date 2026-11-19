#!/bin/bash
cd /workspace/deal-monitor
npm test 2>&1 | grep -E "^# (pass|fail|skip)|^not ok"
node scripts/i18n-extract.js --check | tail -1
rm -rf /tmp/drud-26; DEAL_RADAR_SHOT=/workspace/deal-monitor/screenshots DEAL_RADAR_SHOT_SET=v26 timeout 600 xvfb-run -a -s "-screen 0 1440x900x24" ./node_modules/.bin/electron . --no-sandbox --user-data-dir=/tmp/drud-26 2>&1 | grep -E "\[v26\]|\[shot\]|Error|rror:" | head -40
echo DONE
