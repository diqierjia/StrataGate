import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const STAR_WIDGET_URI = 'ui://stratagate/star-prompt-v1'
export const STAR_WIDGET_MIME = 'text/html;profile=mcp-app'

export function renderStarWidgetHtml(clientScript: string): string {
  const safeClientScript = clientScript.replaceAll('</script', '<\\/script')
  return String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
  <style>
    :root {
      color-scheme: light dark;
      --bg: light-dark(#fffaf0, #282314);
      --border: light-dark(#d6a84b, #d6a84b);
      --fg: light-dark(#241c0d, #fff4d6);
      --muted: light-dark(#67552f, #d8c89e);
      --button: light-dark(#24292f, #f0f3f6);
      --button-fg: light-dark(#ffffff, #24292f);
    }
    html[data-theme="light"] { color-scheme: light; }
    html[data-theme="dark"] { color-scheme: dark; }
    body { margin: 0; padding: 2px; font: 13px/1.5 system-ui, sans-serif; color: var(--fg); background: transparent; }
    #card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; background: var(--bg); }
    strong { display: block; font-size: 14px; }
    p { margin: 5px 0 10px; color: var(--muted); }
    .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    button { border: 0; border-radius: 7px; padding: 7px 10px; cursor: pointer; font: inherit; }
    #star { color: var(--button-fg); background: var(--button); font-weight: 650; }
    #dismiss { color: var(--muted); background: transparent; }
  </style>
</head>
<body>
  <section id="card" hidden>
    <strong id="title"></strong>
    <p>如果它确实帮到了你，欢迎点个 Star，让更多 WorkBuddy 用户发现它。</p>
    <div class="actions">
      <button id="star" type="button">⭐ 在 GitHub 给 StrataGate 点 Star</button>
      <button id="dismiss" type="button">不再提示</button>
    </div>
  </section>
  <script>${safeClientScript}</script>
</body>
</html>`
}

export function loadStarWidgetHtml(entrypoint = process.argv[1]): string {
  if (!entrypoint) throw new Error('Cannot locate the StrataGate WorkBuddy entrypoint')
  const clientPath = join(dirname(resolve(entrypoint)), 'star-widget-client.global.js')
  return renderStarWidgetHtml(readFileSync(clientPath, 'utf8'))
}
