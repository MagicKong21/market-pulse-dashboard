#!/bin/zsh

cd "${0:A:h}" || exit 1

URL="http://127.0.0.1:${PORT:-4173}"
NODE=""

if [[ -x "$PWD/runtime/node" ]]; then
  NODE="$PWD/runtime/node"
else
  NODE="$(command -v node 2>/dev/null)"
fi

# 在 Codex 工作区中开发时，Node.js 可能由 Codex 自带而没有加入 shell PATH。
# 使用 $HOME 和通用目录结构定位，避免把任何用户的绝对路径写进开源仓库。
if [[ -z "$NODE" ]]; then
  CODEX_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [[ -x "$CODEX_NODE" ]]; then
    NODE="$CODEX_NODE"
  fi
fi

if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "没有找到 Node.js。"
  echo "请从 GitHub Releases 下载与你的 Mac 对应的开箱即用版本。"
  echo "开发者也可以安装 Node.js 22 或更高版本后运行本项目。"
  read "?按回车键退出…"
  exit 1
fi

if ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  echo "Node.js 版本过旧，本项目需要 Node.js 22 或更高版本。"
  echo "建议从 GitHub Releases 下载已内置运行环境的版本。"
  read "?按回车键退出…"
  exit 1
fi

if curl --silent --fail --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

HOST=127.0.0.1 "$NODE" server.mjs &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

for _ in {1..80}; do
  if curl --silent --fail --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
    open "$URL"
    echo "股票看板正在运行：$URL"
    echo "关闭此窗口或按 Control-C 即可停止。"
    wait "$SERVER_PID"
    exit $?
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo "启动失败，请查看上方错误信息。"
read "?按回车键退出…"
exit 1
