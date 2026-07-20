import assert from "node:assert/strict";
import test from "node:test";
import { marketClosedToday } from "../market-calendar.mjs";

test("日本单独休市日会标注本日休市",()=>{
  const marineDay=Date.parse("2026-07-20T03:00:00+08:00");
  assert.equal(marketClosedToday("TSE",marineDay),"本日休市");
  assert.equal(marketClosedToday("SSE",marineDay),null);
  assert.equal(marketClosedToday("KRX",marineDay),null);
});

test("中日韩市场周末均标注本日休市，其他市场不误标",()=>{
  const saturday=Date.parse("2026-07-18T12:00:00+08:00");
  assert.equal(marketClosedToday("SSE",saturday),"本日休市");
  assert.equal(marketClosedToday("TSE",saturday),"本日休市");
  assert.equal(marketClosedToday("KRX",saturday),"本日休市");
  assert.equal(marketClosedToday("CRYPTO",saturday),null);
});
