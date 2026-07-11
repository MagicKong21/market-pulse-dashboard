import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("网站图标使用黑白绿三色并接入页面",async()=>{
  const [html,icon]=await Promise.all([
    readFile(new URL("../public/index.html",import.meta.url),"utf8"),
    readFile(new URL("../public/favicon.svg",import.meta.url),"utf8")
  ]);
  assert.match(html,/rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
  assert.match(html,/<div class="brand-block">\s*<img class="brand-icon" src="\/favicon\.svg"[^>]*>\s*<div class="brand-copy">/);
  assert.match(icon,/#080c0e/);
  assert.match(icon,/#edf4f2/);
  assert.match(icon,/#b7f34a/);
});

test("关闭按钮紧随刷新按钮并提供关闭后备页面",async()=>{
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const refreshIndex=html.indexOf('id="refresh"'),shutdownIndex=html.indexOf('id="shutdownButton"'),fallbackIndex=html.indexOf('id="shutdownScreen"');
  assert.ok(refreshIndex>0&&refreshIndex<shutdownIndex&&shutdownIndex<fallbackIndex);
  assert.match(html,/id="shutdownButton"[^>]*>[\s\S]*?<path d="M12 2v10"\/>/);
});

test("关闭按钮默认白色且仅在悬停时使用红色警示",async()=>{
  const css=await readFile(new URL("../public/toolbar-and-layout.css",import.meta.url),"utf8");
  assert.match(css,/\.shutdown-action \{\s*color: var\(--text\);\s*\}/);
  assert.match(css,/\.shutdown-action:hover \{[^}]*color: var\(--down\);/s);
});

test("自动更新与看板布局共用桌面和窄屏基线",async()=>{
  const css=await readFile(new URL("../public/design-refresh.css",import.meta.url),"utf8");
  assert.match(css,/#autoRefreshSection\{[^}]*grid-template-columns:auto minmax\(0,1fr\) auto[^}]*align-items:center[^}]*padding:14px 28px/);
  assert.match(css,/@media\(max-width:560px\)\{#autoRefreshSection\{[^}]*padding:14px 18px/);
});

test("底部更新时间使用固定槽位避免倒计时跳闪",async()=>{
  const [app,css]=await Promise.all([
    readFile(new URL("../public/app.js",import.meta.url),"utf8"),
    readFile(new URL("../public/toolbar-and-layout.css",import.meta.url),"utf8")
  ]);
  assert.match(app,/class="timestamp-duration"/);
  assert.match(app,/class="timestamp-countdown"/);
  assert.match(app,/&nbsp;秒后更新/);
  assert.ok(app.indexOf('class="timestamp-countdown"')<app.indexOf('class="timestamp-label">当前'));
  assert.match(css,/#status,\s*#timestamp \{[^}]*width: max-content[^}]*text-align: right/s);
  assert.match(css,/#timestamp \{[^}]*grid-template-columns: max-content 8px auto max-content 8px auto max-content[^}]*align-items: center[^}]*column-gap: 5px[^}]*font-variant-numeric: tabular-nums/s);
  assert.match(css,/\.timestamp-duration \{[^}]*grid-template-columns: 4ch max-content[^}]*align-items: center/s);
  assert.match(css,/\.timestamp-countdown \{[^}]*grid-template-columns: 3ch max-content[^}]*align-items: center/s);
  assert.match(css,/\.timestamp-separator \{[^}]*text-align: center/s);
});

test("页脚包含个人学习项目风险提示",async()=>{
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/个人学习项目，数据可能延迟、缺失或有误/);
  assert.match(html,/不构成投资建议或交易依据/);
  assert.match(html,/风险自担。投资有风险，入市需谨慎/);
});
