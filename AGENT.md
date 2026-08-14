# DeepSeek Harness Desktop — Agent Guide

本文档供维护本项目的开发 Agent 使用。面向用户的英文说明请查看根目录的 `README.md`，中文说明请查看 `README.zh-CN.md`。

## 项目结构

- `desktop/`：Electron 桌面客户端，是本项目自主维护的代码。
- `upstream/`：DeepSeek 官方 `deepseek-harness` Git 子模块。
- `更新官方源码.command`：同步 `upstream/` 到官方远程设置的最新提交。

## 修改边界

1. 默认只修改 `desktop/` 和根目录文档。
2. 除非用户明确要求，不要修改 `upstream/` 中的文件、提交历史或远程地址。
3. `upstream/` 应保持为根仓库的 Git 子模块，并跟踪：

   ```text
   https://github.com/deepseek-ai/deepseek-harness.git
   ```

4. 不要把应用运行数据、API Key、日志或下载后的 Harness 运行时提交到项目中。
5. 不要删除已有安装包或用户改动；生成新版本时使用新的版本号。

## 桌面客户端架构

Electron 主进程位于 `desktop/src/main.mjs`，负责：

- 启动本地 Harness Web 服务。
- 在安全隔离的 `BrowserWindow` 中显示官方 Web UI。
- 在 macOS 上注入独立的 44px 顶部标题栏，让窗口按钮和侧栏布局互不干扰。
- 关闭应用时停止后台 Harness 进程。
- 检查、下载、验证和切换 Harness 运行版本。

更新模块位于 `desktop/src/harness-updater.mjs`：

- 版本来源：官方 npm 包 `@deepseek-ai/dsh`。
- 官方元数据地址：`https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest`。
- 启动后延迟 15 秒检查，之后每 6 小时检查一次。
- 下载到 Electron 的 `userData` 目录，而不是改写已安装的应用。
- 完整安装并验证入口文件后才写入激活状态。
- 下载版本无法启动时，自动停用并回退到安装包内置版本。

源码同步和运行时更新是两个独立通道：`upstream/` 用于跟踪官方源码，应用内更新使用官方 npm 发布版本。

## 常用验证命令

在 `desktop/` 中执行：

```sh
npm run check
npm run smoke:runtime
npm run smoke:updater
npm run smoke:packaged
```

- `check`：语法、内置包和更新模块测试。
- `smoke:runtime`：启动 Harness 并验证 Web UI 返回 HTTP 200。
- `smoke:updater`：使用 Electron 内置 Node 环境完成一次真实的临时下载和安装验证。
- `smoke:packaged`：从最终 `.app` 内启动 Harness，防止打包工具遗漏 peer 依赖。

涉及网络或本地端口的测试可能需要系统授权。测试产生的临时运行时必须在结束后清理。

## 发布流程

1. 更新 `desktop/package.json` 和 `desktop/package-lock.json` 中的桌面版本号。
2. 更新 `desktop/README.md`、`README.md` 和 `README.zh-CN.md` 中记录的版本。
3. 依次通过 `check`、`smoke:runtime` 和 `smoke:updater`。
4. 构建 Apple 芯片版安装包：

   ```sh
   cd desktop
   npm run dist:mac
   ```

5. 确认以下内容存在于应用包内：

   - `src/harness-updater.mjs`
   - `node_modules/npm/bin/npm-cli.js`
   - `node_modules/semver/`

6. 构建完成后必须执行 `npm run smoke:packaged`，确认最终应用包能启动 Harness 并返回 HTTP 200。
7. 使用 `codesign --verify --deep --strict` 检查应用，并使用 `hdiutil verify` 验证 DMG。
8. 安装包位于 `desktop/dist/`。不要覆盖不同版本的历史安装包。

## 版本策略

- Electron 客户端版本与 Harness 版本分别管理。
- 客户端内置 Harness 版本由 `desktop/package.json` 锁定。
- 应用内更新只接受语义化版本号，并只从官方 npm 包名安装。
- 新版本安装失败时必须保留旧版本和用户会话数据。
- 如果新版 Electron 本身内置了更高版本 Harness，应优先使用较新的内置版本，而不是用户目录中的旧下载版本。
