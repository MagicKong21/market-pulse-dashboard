import { execFileSync } from "node:child_process";

const latestTag = execFileSync("git", ["tag", "--list", "v*.*.*", "--sort=-v:refname"], { encoding: "utf8" }).trim().split("\n")[0] || "";
execFileSync(process.execPath, [new URL("./bump-version.mjs", import.meta.url).pathname, latestTag], { stdio: "inherit" });
console.log("\n版本已更新。请运行 npm test，然后提交并创建对应的 v<版本号> 标签。Site 发布必须使用同一个提交。");
