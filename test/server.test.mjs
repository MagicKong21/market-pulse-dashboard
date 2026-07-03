import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.CACHE_FILE = "/tmp/stock-dashboard-test-cache.json";
const { server } = await import("../server.mjs");

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

test("健康检查只暴露预期标的数", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, instruments: 15 });
});

test("拒绝未知周期", async () => {
  const response = await fetch(`${base}/api/market?period=all`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "不支持的周期" });
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
