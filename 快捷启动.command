#!/bin/zsh -l

cd -- "${0:A:h}" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

editor_url="http://127.0.0.1:4174/editor/editor.html"

fail() {
  print -r -- "$1"
  read -r "reply?按回车关闭窗口……"
  exit 1
}

editor_ready() {
  /usr/bin/curl --silent --fail --max-time 2 "$editor_url" | /usr/bin/cmp -s editor.html -
}

if editor_ready; then
  print '编辑器已经启动，正在打开页面……'
  /usr/bin/open "$editor_url"
  exit 0
fi

command -v node >/dev/null 2>&1 || fail '没有找到 Node.js，请先安装 Node.js 后重新双击。'

print '正在启动原型编辑器……'
node dev-server.mjs --port 4174 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null' EXIT
trap 'exit 0' INT TERM HUP

for attempt in {1..30}; do
  if editor_ready; then
    /usr/bin/open "$editor_url"
    print '编辑器已打开。使用期间请保持这个窗口开着，按 Ctrl + C 可停止服务。'
    wait "$server_pid"
    exit $?
  fi
  kill -0 "$server_pid" 2>/dev/null || fail '启动失败，请查看上方错误信息；4174 端口可能被其他程序占用。'
  sleep 0.3
done

fail '服务启动超时，请查看上方错误信息。'
