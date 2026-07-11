# 全球科技与半导体股票看板

一个面向个人研究的本地股票看板，覆盖全球科技、A/H 股和主要市场指标。页面支持自选股布局、前收参考线、公司总市值、跨币种折算以及行情缓存与失败降级。

> 行情来自 Yahoo Finance、腾讯、东方财富、同花顺和新浪等公开网络接口。这些接口并非带有服务等级保证的商业 API，可能延迟、限流、调整或停止服务。本项目不提供投资建议，也不授予任何第三方行情数据的再分发权。

## 普通用户：下载后双击启动

不要下载 GitHub 自动生成的 `Source code` 压缩包。请进入项目的 **Releases** 页面，下载与你电脑对应的开箱即用版本：

- Apple 芯片 Mac：`stock-dashboard-macos-arm64.zip`
- Intel Mac：`stock-dashboard-macos-x64.zip`
- Windows 10/11 64 位：`stock-dashboard-windows-x64.zip`

解压后：

- macOS 双击 `【Mac】启动看板.command`
- Windows 双击 `【Windows】启动看板.bat`

启动器会运行本地服务并自动打开浏览器。关闭启动窗口或按 `Control-C` / `Ctrl+C` 即可停止。

发布包内已包含 Node.js LTS，不需要另装 Node.js、npm 或其他依赖。首次启动需要联网获取行情。

页面标题区会显示当前软件版本。应用每两天最多检查一次 GitHub Releases；发现新版本时会显示更新提示，可直接前往 Release 页面下载，也可以关闭当前版本的提示。检查失败不会影响行情功能。

### macOS 首次运行提示

如果 macOS 阻止启动，请在 Finder 中按住 Control 点击启动文件，选择“打开”，再确认一次。不要把程序放在只读目录中，否则行情缓存无法保存。

## 开发者：从源码运行

源码仓库不提交 Node.js 二进制文件。开发环境需要当前受支持的 Node.js LTS：

```sh
npm start
```

浏览器访问 <http://127.0.0.1:4173>。项目没有 npm 运行时依赖，因此不需要执行 `npm install`。

运行测试：

```sh
npm test
```

## 项目结构

```text
.
├── 【Mac】启动看板.command       # Mac 用户入口
├── 【Windows】启动看板.bat      # Windows 用户入口
├── server.mjs                   # 本地 HTTP 服务与数据源适配
├── market.mjs                   # 行情标准化与业务逻辑
├── public/                      # 浏览器页面、样式和交互
├── scripts/                     # 跨平台启动辅助脚本
├── test/                        # 自动化测试
└── .github/workflows/release.yml # 自动生成开箱即用发布包
```

运行后产生的 `.cache/` 只保存本地行情缓存，不应提交到 Git。

## 发布维护者

发布前运行 `npm run release:prepare`，它会递增补丁位并同步 `package.json` 与 `public/version.js`。确认测试通过后提交变更并创建同版本标签，例如：

```bash
npm run release:prepare
node --test
git add package.json public/version.js
git commit -m "chore: bump version"
git tag -a v0.0.8 -m "Release v0.0.8"
git push origin main --tags
```

GitHub Actions 只响应 `v*.*.*` 标签，使用标签对应的同一个提交运行测试、打包并创建 GitHub Release。Sites 发布也必须使用这个提交，确保本地版、GitHub 版和在线版显示同一个版本号。

## 许可

程序代码采用 [MIT License](LICENSE)。第三方图标和随发布包分发的 Node.js 运行时遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。行情数据不包含在本项目许可证内。
