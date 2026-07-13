import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAu9999BrowserPayload } from "../public/au-utils.js";

test("浏览器侧 AU9999 回退只保留当前交易日的有效分时",()=>{
  const payload={data:{preKPrice:897,klines:[
    "2026-07-10 15:30,0,897,0,0,10",
    "2026-07-13 09:00,0,898,0,0,10",
    "2026-07-13 09:05,0,899,0,0,10",
    "2026-07-13 15:30,0,900,0,0,10"
  ]}};
  const result=normalizeAu9999BrowserPayload(payload);
  assert.deepEqual(result.points.map(([,value])=>value),[898,899,900]);
  assert.equal(result.previousClose,897);
});
