# DeepSeek Harness Desktop

这是 DeepSeek Harness Desktop：DeepSeek Harness 的免命令行 macOS 与 Windows 桌面封装。安装后打开应用，它会自动启动随安装包附带的 Harness 服务，并在桌面窗口中打开官方 Web 界面。

## 使用

1. macOS 打开 DMG 并拖入“应用程序”；Windows 运行 EXE 安装程序。
2. 打开 `DeepSeek Harness`。
3. 首次进入时，按界面提示填写 DeepSeek API Key 并选择工作目录。

应用数据、设置和会话保存在操作系统的应用数据目录中；关闭应用时，后台 Harness 服务也会一起退出。

## 应用内更新

客户端启动 15 秒后会检查一次 Harness 官方 npm 发布版本，之后每 6 小时检查一次。发现新版时会先询问，再由客户端完成下载和验证；更新不会覆盖内置版本，如果新版启动失败会自动回退。

也可以从应用菜单中选择“检查 Harness 更新…”立即检查。自动检查失败时不会打扰正常使用，错误会记录到应用日志。

## 开发

本目录是 Electron 客户端；同级的 `../upstream` 是保留了 Git 历史和官方远程地址的 DeepSeek Harness 源码。

```sh
npm install
npm start
```

构建 Apple 芯片版 DMG：

```sh
npm run dist:mac
```

构建 Windows x64 安装程序：

```sh
npm run dist:win
```

## 版本

- Desktop wrapper: 0.2.6
- DeepSeek Harness: 0.1.0-rc.6
- Electron: 43.4.0

DeepSeek Harness 使用 MIT 许可证。对应许可证与第三方声明会随应用一起安装。
