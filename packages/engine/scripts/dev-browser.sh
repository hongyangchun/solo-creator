#!/bin/bash
# SoloCreator 联调浏览器一键启动脚本
# 启动独立的 Edge 调试实例（独立用户目录，不影响日常浏览器）
# 登录态会保存在 ~/.solo-creator/browser-profile，下次启动无需重新扫码

PROFILE_DIR="$HOME/.solo-creator/browser-profile"
CDP_PORT="${CDP_PORT:-9333}"
EDGE_BIN="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"

# 已有实例在监听：校验占用者身份，避免端口被其他应用（如 Electron 应用）占用时误报"已在运行"
if lsof -i :"$CDP_PORT" >/dev/null 2>&1; then
  version_json="$(curl -s --max-time 3 "http://127.0.0.1:$CDP_PORT/json/version")"
  user_agent="$(printf '%s' "$version_json" | sed -n 's/.*"User-Agent"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  browser_field="$(printf '%s' "$version_json" | sed -n 's/.*"Browser"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if printf '%s' "$user_agent" | grep -q "Edg"; then
    echo "✅ 调试浏览器已在运行 (端口 $CDP_PORT)"
    echo "   验证: curl -s http://127.0.0.1:$CDP_PORT/json/version"
    exit 0
  fi
  echo "❌ 端口 $CDP_PORT 已被其他应用占用（检测到: ${browser_field:-未知，且不响应 CDP 协议}），无法启动调试浏览器"
  echo "   建议: CDP_PORT=9334 bash scripts/dev-browser.sh 换端口启动"
  echo "   并配合设置 CHROME_CDP_ENDPOINT=http://127.0.0.1:9334 供 engine 连接"
  exit 1
fi

if [ ! -x "$EDGE_BIN" ]; then
  echo "❌ 未找到 Microsoft Edge，请修改脚本中的 EDGE_BIN 路径"
  exit 1
fi

mkdir -p "$PROFILE_DIR"

echo "🚀 启动独立 Edge 调试实例..."
echo "   端口: $CDP_PORT"
echo "   独立用户目录: $PROFILE_DIR (登录态持久化)"
echo ""

nohup "$EDGE_BIN" \
  --remote-debugging-port=$CDP_PORT \
  --user-data-dir="$PROFILE_DIR" \
  --no-sandbox \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  "https://mp.weixin.qq.com" \
  "https://creator.xiaohongshu.com" \
  >/dev/null 2>&1 &

sleep 3

if lsof -i :"$CDP_PORT" >/dev/null 2>&1; then
  echo "✅ 启动成功！已自动打开 3 个平台登录页："
  echo "   1. 微信公众平台  - 扫码登录"
  echo "   2. 小红书创作平台 - 扫码登录"
  echo "   3. X (Twitter)   - 账号登录"
  echo ""
  echo "👉 请在弹出的浏览器窗口中完成登录（只需这一次，之后会话持久保存）"
  echo "👉 登录完成后，回到终端运行:"
  echo "   cd /Users/hongyangchun/Codebase/solo-creator"
  echo "   pnpm exec tsx src/cli/index.ts publish --master-id M-xxx --channels wechat"
else
  echo "❌ 启动失败，请手动检查: $EDGE_BIN --remote-debugging-port=$CDP_PORT --user-data-dir=$PROFILE_DIR"
  exit 1
fi
