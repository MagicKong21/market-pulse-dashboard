import { readFile, writeFile } from "node:fs/promises";

const latestTag = process.argv[2] || "";
const packagePath = new URL("../package.json", import.meta.url);
const versionPath = new URL("../public/version.js", import.meta.url);
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const currentMatch = String(packageJson.version).match(/^(\d+)\.(\d+)\.(\d+)$/);

if (!currentMatch) throw new Error(`package.json 版本格式无效：${packageJson.version}`);

const [,major,minor,currentPatch] = currentMatch;
const tagMatch = latestTag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
let patch = Number(currentPatch);

if (tagMatch && tagMatch[1] === major && tagMatch[2] === minor) {
  patch = Math.max(patch,Number(tagMatch[3])+1);
}

const nextVersion = `${major}.${minor}.${patch}`;
packageJson.version = nextVersion;
await writeFile(packagePath,`${JSON.stringify(packageJson,null,2)}\n`);

const versionSource = await readFile(versionPath,"utf8");
const updatedSource = versionSource.replace(/export const APP_VERSION = "[^"]+";/,`export const APP_VERSION = "${nextVersion}";`);
if (updatedSource === versionSource && !versionSource.includes(`APP_VERSION = "${nextVersion}"`)) throw new Error("未找到 APP_VERSION");
await writeFile(versionPath,updatedSource);
process.stdout.write(nextVersion);
