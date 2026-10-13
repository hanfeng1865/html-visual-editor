import { EDITOR_SOURCE_RULES } from './ai-source-rules.mjs';

// All editable content lives in HTML. No CDN, build step or editor runtime.
export function blankProjectFiles() {
  return {
    'index.html': `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>新项目</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="./styles.css">
  <script src="./app.js" defer></script>
</head>
<body>
  <main id="project-main" class="project-main">
    <header id="project-header" class="project-header">
      <h1 id="project-title" class="project-title">新项目</h1>
      <p id="project-description" class="project-description">从这里开始，构建你的页面。</p>
    </header>
    <section id="project-content" class="project-content" aria-label="页面内容">
      <article id="starter-card" class="content-card">
        <h2 id="starter-card-title" class="card-title">内容区域</h2>
        <p id="starter-card-description" class="card-description">添加文字、图片或组件，也可以用 AI 描述你想构建的页面。</p>
        <p id="starter-metric" class="metric"><span id="starter-value" class="metric-value">0</span><span id="starter-unit" class="metric-unit">项</span></p>
        <p id="starter-data-note" class="data-note">静态演示数值，可直接编辑</p>
      </article>
    </section>
  </main>
</body>
</html>
`,
    'styles.css': `:root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #17243a; background: #f5f7fb; }
* { box-sizing: border-box; }
body { margin: 0; }
[hidden] { display: none; }
.project-main { width: min(1080px, 100%); margin: 0 auto; padding: 64px 32px; }
.project-header { margin-bottom: 32px; }
.project-title { margin: 0 0 12px; font-size: 36px; line-height: 1.3; }
.project-description, .card-description { color: #617087; line-height: 1.7; }
.project-content { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 24px; }
.content-card { padding: 28px; border: 1px solid #dce3ee; border-radius: 16px; background: #fff; }
.card-title { margin: 0; font-size: 22px; }
.metric { display: flex; align-items: baseline; gap: 8px; margin: 24px 0 8px; }
.metric-value { font-size: 36px; font-weight: 650; }
.metric-unit, .data-note { color: #617087; font-size: 14px; }
@media (max-width: 600px) { .project-main { padding: 32px 20px; } }
`,
    'app.js': `"use strict";

// 在这里绑定交互事件。通过稳定 id 或 data-action 定位控件。
// 初始文案和演示数值保留在 index.html 中，不在页面加载时重新赋值。
// 动态更新仅限必要的数据区域，避免重建可编辑容器。
`,
    'PROJECT-RULES.md': `# 项目代码与验收要求\n\n${EDITOR_SOURCE_RULES}\n`,
  };
}
