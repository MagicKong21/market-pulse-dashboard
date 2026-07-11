import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.CACHE_FILE = "/tmp/stock-dashboard-test-cache.json";
const { autoRefreshMaxAge, isShutdownAuthorized, server } = await import("../server.mjs");

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

test("健康检查只暴露预期标的数", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, instruments: 18 });
});

test("拒绝未知周期", async () => {
  const response = await fetch(`${base}/api/market?period=all`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "不支持的周期" });
});

test("关闭服务只接受带专用请求头的操作",async()=>{
  assert.equal(isShutdownAuthorized({headers:{"x-market-pulse-action":"shutdown"}}),true);
  assert.equal(isShutdownAuthorized({headers:{}}),false);
  const rejected=await fetch(`${base}/api/shutdown`,{method:"POST"});
  assert.equal(rejected.status,403);
  const accepted=await fetch(`${base}/api/shutdown`,{method:"POST",headers:{"x-market-pulse-action":"shutdown"}});
  assert.equal(accepted.status,200);
  assert.deepEqual(await accepted.json(),{ok:true});
});

test("服务端限制一秒轮询并降低长周期上游请求频率",()=>{
  assert.equal(autoRefreshMaxAge("1d",1_000),5_000);
  assert.equal(autoRefreshMaxAge("5d",5_000),5_000);
  assert.equal(autoRefreshMaxAge("1mo",5_000),60_000);
  assert.equal(autoRefreshMaxAge("1d",null,false),60_000);
});

test("拒绝恶意自定义股票代码", async () => {
  const response = await fetch(`${base}/api/market?symbols=..%2F..%2Fsecret`);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /格式无效/);
});

test("股票查询拒绝空代码", async () => {
  const response = await fetch(`${base}/api/lookup`);
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{ error:"请输入股票代码" });
});

test("路径穿越和未知方法不会读取文件", async () => {
  const missing = await fetch(`${base}/..%2Fpackage.json`);
  assert.equal(missing.status, 404);
  const post = await fetch(`${base}/api/health`, { method: "POST" });
  assert.equal(post.status, 404);
});

test.after(() => new Promise(resolve => server.close(resolve)));
