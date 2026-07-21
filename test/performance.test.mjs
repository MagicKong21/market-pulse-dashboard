import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("首屏行情、涨跌家数和市值并行请求", async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(server,/const marketCapsPromise = fetchMarketCaps/);
  assert.match(server,/const marketBreadthPromise = fetchMarketBreadth/);
  assert.match(server,/mapConcurrent\(selected, INSTRUMENT_CONCURRENCY/);
});

test("刷新页面会优先显示当前看板的本机缓存", async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/RENDER_CACHE_PREFIX/);
  assert.match(app,/restoreRenderCache\(\)/);
  assert.match(app,/saveRenderCache\(\)/);
});
