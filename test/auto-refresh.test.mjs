import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AUTO_REFRESH_OPTIONS, DEFAULT_AUTO_REFRESH_MS, autoRefreshCountdownLabel, autoRefreshCountdownSeconds, autoRefreshLabel, normalizeAutoRefreshMs } from "../public/auto-refresh.js";

test("自动刷新默认十秒且不提供一秒高频选项",()=>{
  assert.equal(DEFAULT_AUTO_REFRESH_MS,10_000);
  assert.equal(AUTO_REFRESH_OPTIONS.some(option=>option.value===1_000),false);
  assert.deepEqual(AUTO_REFRESH_OPTIONS.map(option=>option.value),[0,5_000,10_000,30_000,60_000,300_000]);
});

test("自动刷新配置只接受安全预设并兼容关闭",()=>{
  assert.equal(normalizeAutoRefreshMs(0),0);
  assert.equal(normalizeAutoRefreshMs("30000"),30_000);
  assert.equal(normalizeAutoRefreshMs(1_000),10_000);
  assert.equal(normalizeAutoRefreshMs(undefined),10_000);
  assert.equal(autoRefreshLabel(60_000),"1 分钟");
});

test("自动刷新倒计时向上取整且不会显示负数",()=>{
  assert.equal(autoRefreshCountdownSeconds(10_000),10);
  assert.equal(autoRefreshCountdownSeconds(9_001),10);
  assert.equal(autoRefreshCountdownSeconds(-1),0);
  assert.equal(autoRefreshCountdownLabel(10_000),"10 秒后更新");
  assert.equal(autoRefreshCountdownLabel(9_001),"10 秒后更新");
  assert.equal(autoRefreshCountdownLabel(9_000),"9 秒后更新");
  assert.equal(autoRefreshCountdownLabel(-1),"0 秒后更新");
});

test("设置结构先自动更新再连续展示布局与窗格",async()=>{
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const autoIndex=html.indexOf('id="autoRefreshSection"'),layoutIndex=html.indexOf('id="layoutSection"'),previewIndex=html.indexOf('class="settings-section layout-preview-section"');
  assert.ok(autoIndex>0&&autoIndex<layoutIndex&&layoutIndex<previewIndex);
  assert.match(html,/<h1>MARKET PULSE<\/h1>/);
  assert.match(html,/互联网 · 半导体 · AI 行情看板<span id="watchCount" hidden>/);
  assert.doesNotMatch(html,/brand-meta">\s*<span>互联网/);
});

test("发布默认大盘名单不重新加入用户已删除的半导体指数",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const defaults=app.match(/const DEFAULT_MARKET_STOCKS = \[([\s\S]*?)\n\]\.map/)?.[1]||"";
  assert.doesNotMatch(defaults,/512480\.SS/);
  assert.doesNotMatch(defaults,/881121\.TI/);
  assert.match(app,/if\(schemaVersion===6\)stocks=stocks\.filter\(item=>!\["512480\.SS","881121\.TI"\]\.includes\(item\.symbol\)\)/);
});

test("在线版使用独立配置版本以展示当前默认名单",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/const IS_HOSTED_SITE=/);
  assert.match(app,/STORAGE_KEY=IS_HOSTED_SITE\?"market-pulse-settings-hosted-v1":"market-pulse-settings-v3"/);
});
