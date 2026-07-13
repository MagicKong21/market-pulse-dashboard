import assert from "node:assert/strict";
import test from "node:test";
import { normalizeA50BrowserPayload } from "../public/a50-utils.js";

test("浏览器侧 A50 回退按当前交易日截取，与本地服务一致",()=>{
  const payload={data:{preKPrice:14962,klines:[
    "2026-07-10 16:30,0,14962,0,0,10",
    "2026-07-13 09:05,0,14926,0,0,10",
    "2026-07-13 09:10,0,14942,0,0,10",
    "2026-07-13 16:10,0,14808,0,0,10"
  ]}};
  const result=normalizeA50BrowserPayload(payload,"1d");
  assert.equal(result.points.length,3);
  assert.equal(result.points[0][1],14926);
  assert.equal(result.price,14808);
  assert.equal(result.previousClose,14962);
  assert.ok(result.session?.start<result.points[0][0]);
  assert.ok(result.session?.end>result.asOf);
});
