#!/usr/bin/env bash
# 在 Xvfb 下运行全部界面测试并截图（Linux）
set -u
cd "$(dirname "$0")/.."
SHOTS="$PWD/screenshots"; mkdir -p "$SHOTS"; rm -f "$SHOTS"/[0-3]*.png "$SHOTS"/*.csv
XV='xvfb-run -a -s "-screen 0 1440x960x24"'
filter() { grep -E '^\[(i18n|mock-llm|shot|summary|export|e2e|instance|offers|demo-diff)\]|xvfb-run: error'; sleep 2; }
echo "== screenshots (live data) =="; rm -rf /tmp/dr-data
DEAL_RADAR_LANG=zh-CN DEAL_RADAR_MOCK_LLM=1 DEAL_RADAR_DATA=/tmp/dr-data DEAL_RADAR_SHOT="$SHOTS" timeout 240 xvfb-run -a -s "-screen 0 1440x960x24" npx electron . --no-sandbox 2>&1 | filter
echo "== offline / dead proxy =="; rm -rf /tmp/dr-off && mkdir -p /tmp/dr-off
node -e 'const {Store}=require("./src/core/store"); new Store("/tmp/dr-off").updateSettings({proxyMode:"custom",proxyUrl:"http://127.0.0.1:9"});'
DEAL_RADAR_LANG=zh-CN DEAL_RADAR_DATA=/tmp/dr-off DEAL_RADAR_SHOT="$SHOTS" DEAL_RADAR_SHOT_SET=offline timeout 240 xvfb-run -a -s "-screen 0 1440x960x24" npx electron . --no-sandbox 2>&1 | filter
echo "== e2e interactions =="; rm -rf /tmp/dr-e2e
DEAL_RADAR_LANG=zh-CN DEAL_RADAR_MOCK_LLM=1 DEAL_RADAR_DATA=/tmp/dr-e2e DEAL_RADAR_SHOT="$SHOTS" DEAL_RADAR_SHOT_SET=e2e timeout 300 xvfb-run -a -s "-screen 0 1440x960x24" npx electron . --no-sandbox 2>&1 | filter
echo "== English UI (live data) + leftover scan =="; rm -rf /tmp/dr-en
DEAL_RADAR_LANG=en DEAL_RADAR_MOCK_LLM=1 DEAL_RADAR_DATA=/tmp/dr-en DEAL_RADAR_SHOT="$SHOTS" DEAL_RADAR_SHOT_SET=en timeout 300 xvfb-run -a -s "-screen 0 1440x960x24" npx electron . --no-sandbox 2>&1 | filter
