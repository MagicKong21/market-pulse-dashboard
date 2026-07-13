import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProfile } from "../public/profile-utils.js";

const defaults=[
  {symbol:"A",name:"默认 A",market:"CUSTOM"},
  {symbol:"B",name:"默认 B",market:"CUSTOM"}
];

test("已有看板配置保留用户的名单和排序",()=>{
  const saved={stocks:[{symbol:"B",name:"我的 B",market:"CUSTOM"},{symbol:"A",name:"我的 A",market:"CUSTOM"}],columns:2,rows:1};
  assert.deepEqual(normalizeProfile(saved,defaults).stocks.map(item=>item.symbol),["B","A"]);
  assert.equal(normalizeProfile(saved,defaults).stocks[0].name,"我的 B");
});

test("用户清空看板后不会在版本更新时恢复默认名单",()=>{
  const profile=normalizeProfile({stocks:[],columns:2,rows:1},defaults);
  assert.deepEqual(profile.stocks,[]);
});

test("仅缺少配置的新用户才获得默认名单",()=>{
  assert.deepEqual(normalizeProfile(null,defaults).stocks,defaults);
});
