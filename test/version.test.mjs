import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APP_VERSION, GITHUB_REPOSITORY, isNewerVersion, normalizeVersion } from "../public/version.js";

test("界面版本与软件包版本一致并指向正式仓库",async()=>{
  const packageJson=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  assert.equal(APP_VERSION,packageJson.version);
  assert.match(APP_VERSION,/^\d+\.\d+\.\d+$/);
  assert.equal(GITHUB_REPOSITORY,"MagicKong21/market-pulse-dashboard");
});

test("语义版本比较只在候选版本更新时返回真",()=>{
  assert.deepEqual(normalizeVersion("v0.0.12"),[0,0,12]);
  assert.equal(isNewerVersion("0.0.2","0.0.1"),true);
  assert.equal(isNewerVersion("0.0.1","0.0.1"),false);
  assert.equal(isNewerVersion("0.0.0","0.0.1"),false);
  assert.equal(isNewerVersion("无效版本","0.0.1"),false);
});
