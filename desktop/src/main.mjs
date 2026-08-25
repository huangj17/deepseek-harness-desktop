import { appendFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import {
  bundledHarnessRuntime,
  deactivateDownloadedHarnessRuntime,
  fetchLatestHarnessVersion,
  installHarnessRuntime,
  isNewerHarnessVersion,
  resolveHarnessRuntime,
} from './harness-updater.mjs'
import {
  DESKTOP_RELEASE_PAGE_URL,
  fetchLatestDesktopRelease,
  isNewerDesktopVersion,
  isSkippedDesktopVersion,
  pickInstallerUrl,
  readSkippedDesktopVersion,
  skipDesktopVersion,
} from './desktop-updater.mjs'
import { harnessWebArguments } from './harness-launch.mjs'
import { hideMainWindowOnClose, revealMainWindow } from './window-lifecycle.mjs'
import { installDesktopIntegration } from './desktop-integration.mjs'
import { OPEN_DSH_TERMINAL_CHANNEL, openDshTerminal } from './dsh-terminal.mjs'

const require = createRequire(import.meta.url)
const LEGACY_USER_DATA_DIRECTORY = 'DeepSeek Harness Desktop'
const dshPackagePath = require.resolve('@deepseek-ai/dsh/package.json')
const npmPackagePath = require.resolve('npm/package.json')
const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/
const STARTUP_TIMEOUT_MS = 120_000
const SHUTDOWN_TIMEOUT_MS = 8_000
const UPDATE_CHECK_DELAY_MS = 15_000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

app.setPath('userData', join(app.getPath('appData'), LEGACY_USER_DATA_DIRECTORY))

let harnessProcess
let harnessOrigin
let mainWindow
let tray
let activeHarnessRuntime
let runningHarnessRuntime
let desktopIntegrationPatchPath
let updateCheckInProgress = false
let desktopCheckInProgress = false
let updateCheckDelay
let updateCheckInterval
let quitting = false
let shutdownComplete = false

// compact 用于更新进度这类小窗：不画卡片、不画 macOS 假标题栏（小窗有真的标题栏，
// 两层叠在一起就是「卡中卡」），也不让内容溢出成滚动条。
function loadingPage(message = '正在启动本地 Agent 服务…', { compact = false } = {}) {
  const safeMessage = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const macTitlebar = !compact && process.platform === 'darwin'
    ? '<div class="titlebar-backdrop" aria-hidden="true"></div><div class="titlebar-drag-region" aria-hidden="true"></div>'
    : ''
  const compactStyle = compact
    ? `
    body { height: 100vh; min-height: 0; overflow: hidden; }
    main { width: 100%; padding: 28px 24px; }
    .mark { width: 58px; height: 58px; margin-bottom: 18px; border-radius: 17px; font-size: 29px; }
    h1 { font-size: 22px; }`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>DeepSeek Harness</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #172033; background: radial-gradient(circle at 50% 20%, #eaf1ff 0, #f7f9fc 52%, #edf1f7 100%); }
    main { width: min(460px, calc(100vw - 48px)); padding: 44px; text-align: center; }
    .card { background: rgba(255,255,255,.86); border: 1px solid rgba(125,145,180,.2); border-radius: 24px; box-shadow: 0 22px 70px rgba(30,50,90,.13); }
    .mark { width: 68px; height: 68px; margin: 0 auto 22px; display: grid; place-items: center; color: white; background: linear-gradient(145deg, #3d73ff, #1745c8); border-radius: 20px; box-shadow: 0 12px 30px rgba(44,99,235,.32); font-size: 34px; font-weight: 750; }
    h1 { margin: 0 0 12px; font-size: 25px; letter-spacing: -.4px; }
    p { margin: 0; color: #62708a; font-size: 14px; line-height: 1.6; }
    .spinner { width: 24px; height: 24px; margin: 26px auto 0; border: 3px solid #dbe4f7; border-top-color: #2f67ec; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .titlebar-backdrop { position: fixed; z-index: 9998; inset: 0 0 auto; height: 44px; pointer-events: none; background: rgba(255,255,255,.74); border-bottom: 1px solid rgba(125,145,180,.18); backdrop-filter: blur(18px); }
    .titlebar-drag-region { position: fixed; z-index: 9999; top: 0; right: 0; left: 88px; height: 44px; app-region: drag; -webkit-app-region: drag; user-select: none; }
    @media (prefers-color-scheme: dark) {
      body { color: #edf3ff; background: radial-gradient(circle at 50% 20%, #172441 0, #0d1320 58%, #090d15 100%); }
      .card { background: rgba(20,28,43,.9); border-color: rgba(140,165,210,.18); }
      p { color: #aebbd2; }
      .spinner { border-color: #293752; border-top-color: #7fa1ff; }
      .titlebar-backdrop { background: rgba(13,19,32,.76); border-bottom-color: rgba(140,165,210,.12); }
    }${compactStyle}
  </style>
</head>
<body>${macTitlebar}<main${compact ? '' : ' class="card"'}><div class="mark">D</div><h1>DeepSeek Harness</h1><p>${safeMessage}</p><div class="spinner"></div></main></body>
</html>`
}

async function appendLog(text) {
  const logsDirectory = app.getPath('logs')
  await mkdir(logsDirectory, { recursive: true })
  await appendFile(join(logsDirectory, 'deepseek-harness-desktop.log'), text).catch(() => {})
}

function dshHomeDirectory() {
  return join(app.getPath('userData'), 'harness-home')
}

function configureMenu() {
  const editMenu = { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
  const viewMenu = { label: '显示', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }
  const template = process.platform === 'darwin' ? [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: '检查客户端更新…', click: () => void checkForDesktopUpdate({ interactive: true }) },
        { label: '检查 Harness 更新…', click: () => void checkForHarnessUpdate({ interactive: true }) },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    editMenu,
    viewMenu,
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ] : [
    { label: '文件', submenu: [{ role: 'quit' }] },
    editMenu,
    viewMenu,
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    {
      label: '帮助',
      submenu: [
        { label: '检查客户端更新…', click: () => void checkForDesktopUpdate({ interactive: true }) },
        { label: '检查 Harness 更新…', click: () => void checkForHarnessUpdate({ interactive: true }) },
        { type: 'separator' },
        { role: 'about' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function requestQuit() {
  app.quit()
}

function showMainWindow() {
  return revealMainWindow(mainWindow)
}

function configureBackgroundControls() {
  const taskbarTemplate = [
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出客户端', click: requestQuit },
  ]

  if (process.platform === 'darwin') {
    app.dock.setMenu(Menu.buildFromTemplate(taskbarTemplate))
    return
  }

  try {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')).resize({ width: 20, height: 20 })
    if (icon.isEmpty()) throw new Error('tray icon is empty')
    tray = new Tray(icon)
    tray.setToolTip('DeepSeek Harness')
    tray.setContextMenu(Menu.buildFromTemplate(taskbarTemplate))
    tray.on('click', () => showMainWindow())
  } catch (error) {
    void appendLog(`[${new Date().toISOString()}] tray error: ${error instanceof Error ? error.message : String(error)}\n`)
  }

  if (process.platform === 'win32' && app.isPackaged) {
    app.setUserTasks([{
      program: process.execPath,
      arguments: '--quit-from-taskbar',
      iconPath: process.execPath,
      iconIndex: 0,
      title: '退出 DeepSeek Harness',
      description: '停止后台服务并退出客户端',
    }])
  }
}

function showMessageBox(options) {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) return dialog.showMessageBox(mainWindow, options)
  return dialog.showMessageBox(options)
}

function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function isTrustedMainFrame(event) {
  return mainWindow !== undefined
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
    && harnessOrigin !== undefined
    && originOf(event.senderFrame.url) === harnessOrigin
}

function registerDesktopIpc() {
  ipcMain.handle(OPEN_DSH_TERMINAL_CHANNEL, async (event, requestedCwd) => {
    if (!isTrustedMainFrame(event)) return { ok: false, error: '拒绝来自非 Harness 主页面的终端请求。' }
    try {
      if (runningHarnessRuntime === undefined) throw new Error('Harness 尚未完成启动。')
      const result = await openDshTerminal({
        terminalDirectory: join(app.getPath('userData'), 'dsh-terminal'),
        electronExecutable: process.platform === 'linux' && process.env.APPIMAGE !== undefined
          ? process.env.APPIMAGE
          : process.execPath,
        runtime: runningHarnessRuntime,
        dshHome: dshHomeDirectory(),
        requestedCwd,
        fallbackCwd: app.getPath('home'),
      })
      await appendLog(`[${new Date().toISOString()}] opened DSH terminal ${runningHarnessRuntime.version} at ${result.cwd}\n`)
      return { ok: true, cwd: result.cwd }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await appendLog(`[${new Date().toISOString()}] terminal error: ${message}\n`)
      await showMessageBox({
        type: 'error',
        title: '无法打开 DSH 终端',
        message: '系统终端未能启动。',
        detail: message,
        buttons: ['好'],
      })
      return { ok: false, error: message }
    }
  })
}

function installMacWindowChrome() {
  const styleId = 'deepseek-harness-desktop-titlebar-spacing'
  const backdropId = 'deepseek-harness-desktop-titlebar-backdrop'
  const dragRegionId = 'deepseek-harness-desktop-drag-region'
  const sidebarStyleSelector = 'style[data-plugin-css="@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css"]'
  const layoutStyleSelector = 'style[data-plugin-css="@deepseek-ai/dsh-client-ui-layout/AppFrame.module.css"]'

  if (document.getElementById(backdropId) === null) {
    const backdrop = document.createElement('div')
    backdrop.id = backdropId
    backdrop.setAttribute('aria-hidden', 'true')
    backdrop.style.cssText = 'position:fixed;z-index:2147483646;inset:0 0 auto;height:44px;box-sizing:border-box;pointer-events:none;background:var(--dsw-specific-sidebar-fill);border-bottom:1px solid var(--dsw-alias-border-l1);'
    document.body.appendChild(backdrop)
  }

  if (document.getElementById(dragRegionId) === null) {
    const dragRegion = document.createElement('div')
    dragRegion.id = dragRegionId
    dragRegion.setAttribute('aria-hidden', 'true')
    dragRegion.style.cssText = 'position:fixed;z-index:2147483647;top:0;right:0;left:88px;height:44px;app-region:drag;-webkit-app-region:drag;user-select:none;'
    document.body.appendChild(dragRegion)
  }

  const apply = () => {
    if (document.getElementById(styleId) !== null) return true
    const sidebarSource = document.querySelector(sidebarStyleSelector)?.textContent
    const layoutSource = document.querySelector(layoutStyleSelector)?.textContent
    if (sidebarSource === undefined || layoutSource === undefined) return false
    const className = (source, name) => source.match(new RegExp(`\\.([A-Za-z0-9_-]+_${name})(?=[\\s.{,:])`))?.[1]
    const root = className(sidebarSource, 'root')
    const collapsed = className(sidebarSource, 'collapsed')
    const logoRow = className(sidebarSource, 'logoRow')
    const frame = className(layoutSource, 'frame')
    if (root === undefined || collapsed === undefined || logoRow === undefined || frame === undefined) return false

    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .${frame} {
        box-sizing: border-box;
        padding-top: 44px !important;
      }
      .${root} {
        position: relative;
      }
      .${root}:not(.${collapsed}) .${logoRow} {
        height: 44px !important;
        margin-bottom: 6px !important;
        padding-top: 4px !important;
        padding-bottom: 4px !important;
      }
      .${root}.${collapsed} .${logoRow} {
        margin-bottom: 10px !important;
      }
      .${root} button,
      .${root} a,
      .${root} input,
      .${root} textarea,
      .${root} select {
        -webkit-app-region: no-drag;
      }
    `
    document.head.appendChild(style)
    return true
  }

  if (apply()) return
  const observer = new MutationObserver(() => {
    if (apply()) observer.disconnect()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

async function injectMacWindowChrome(window) {
  if (process.platform !== 'darwin' || window.isDestroyed()) return
  await window.webContents.executeJavaScript(`(${installMacWindowChrome.toString()})()`)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'DeepSeek Harness',
    backgroundColor: '#f7f9fc',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(app.getAppPath(), 'src', 'preload.cjs'),
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (harnessOrigin !== undefined && originOf(url) === harnessOrigin) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (harnessOrigin !== undefined && originOf(url) === harnessOrigin) return
    if (url.startsWith('data:text/html')) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  window.webContents.on('did-finish-load', () => {
    if (harnessOrigin === undefined || originOf(window.webContents.getURL()) !== harnessOrigin) return
    void injectMacWindowChrome(window).catch(error => {
      void appendLog(`[${new Date().toISOString()}] window chrome error: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  })

  window.on('close', event => {
    hideMainWindowOnClose(event, window, { quitting, shutdownComplete })
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPage())}`)
  window.once('ready-to-show', () => window.show())
  return window
}

// Windows 上 Harness 的原生文件夹对话框会让它的 picker 子进程硬崩溃（上游
// dsh-host-directory-picker-native 的 readUtf16 以固定 32768 字节 koffi.view 越界读取
// GetDisplayName 返回的路径），表现为「directory picker failed: win32 folder dialog
// worker exited before reporting a result」。Harness 的 directory-picker-auto 见到
// SSH_CONNECTION 就退回网页内的目录浏览器，该变量在 Harness 里只有这一处消费者。
// 上游修好后删掉这段即可。
function directoryPickerFallbackEnv() {
  if (process.platform !== 'win32') return {}
  return { SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0' }
}

function startHarness(runtime) {
  const dshHome = dshHomeDirectory()
  console.log(`DeepSeek Harness: starting Harness ${runtime.version} (${runtime.source}) with data in ${dshHome}`)
  const child = spawn(process.execPath, harnessWebArguments(runtime, { patchPath: desktopIntegrationPatchPath }), {
    cwd: app.getPath('home'),
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      ELECTRON_RUN_AS_NODE: '1',
      ...directoryPickerFallbackEnv(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  harnessProcess = child

  return new Promise((resolve, reject) => {
    let settled = false
    let ready = false
    let output = ''

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }

    const observe = (source, chunk) => {
      const text = chunk.toString()
      output = `${output}${text}`.slice(-40_000)
      void appendLog(`[${new Date().toISOString()}] ${source}: ${text}`)
      const match = output.match(READY_PATTERN)
      if (match?.[1] !== undefined) {
        ready = true
        runningHarnessRuntime = runtime
        finish(resolve, match[1])
      }
    }

    child.stdout.on('data', chunk => observe('stdout', chunk))
    child.stderr.on('data', chunk => observe('stderr', chunk))
    child.once('error', error => {
      if (harnessProcess === child) harnessProcess = undefined
      finish(reject, error)
    })
    child.once('exit', (code, signal) => {
      if (harnessProcess === child) {
        harnessProcess = undefined
        runningHarnessRuntime = undefined
      }
      if (!settled) finish(reject, new Error(`本地服务提前退出（退出码 ${String(code)}，信号 ${String(signal)}）。\n\n${output.slice(-4_000)}`))
      else if (ready && !quitting) {
        const message = `本地服务意外退出（退出码 ${String(code)}，信号 ${String(signal)}）。请退出后重新打开应用。`
        void appendLog(`[${new Date().toISOString()}] ${message}\n`)
        if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
          void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPage(message))}`)
        }
        dialog.showErrorBox('DeepSeek Harness 已停止', message)
      }
    })

    const timeout = setTimeout(() => {
      finish(reject, new Error(`本地服务在 ${STARTUP_TIMEOUT_MS / 1000} 秒内没有完成启动。\n\n${output.slice(-4_000)}`))
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    }, STARTUP_TIMEOUT_MS)
  })
}

async function startHarnessWithDesktopIntegration(runtime) {
  try {
    return await startHarness(runtime)
  } catch (error) {
    if (desktopIntegrationPatchPath === undefined) throw error
    const failedPatchPath = desktopIntegrationPatchPath
    desktopIntegrationPatchPath = undefined
    await stopHarness()
    await appendLog(`[${new Date().toISOString()}] desktop integration prevented Harness startup; retrying without it: ${error instanceof Error ? error.message : String(error)}\n`)
    let url
    try {
      url = await startHarness(runtime)
    } catch (retryError) {
      desktopIntegrationPatchPath = failedPatchPath
      throw retryError
    }
    await showMessageBox({
      type: 'warning',
      title: 'DSH 终端入口已停用',
      message: '当前 Harness 版本与桌面终端入口不兼容。',
      detail: 'Harness 已正常启动，但侧栏中的“打开 DSH 终端”暂时不可用。',
      buttons: ['好'],
    })
    return url
  }
}

async function stopHarness() {
  const child = harnessProcess
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return

  child.kill('SIGTERM')
  const exited = await new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
  if (!exited && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

function createUpdateProgressWindow(version) {
  const parent = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
  const window = new BrowserWindow({
    width: 440,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    modal: parent !== undefined,
    parent,
    autoHideMenuBar: true,
    title: '更新 DeepSeek Harness',
    backgroundColor: '#f7f9fc',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Windows/Linux 上小窗会继承应用菜单栏（文件/编辑/显示/…），进度窗里完全是噪音。
  if (process.platform !== 'darwin') window.removeMenu()
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPage(`正在下载并验证 DeepSeek Harness ${version}，请稍候…`, { compact: true }))}`)
  window.once('ready-to-show', () => window.show())
  return window
}

async function checkForHarnessUpdate({ interactive = false } = {}) {
  if (updateCheckInProgress || quitting) {
    if (interactive) {
      await showMessageBox({ type: 'info', title: '正在检查更新', message: '更新检查已经在进行中，请稍候。', buttons: ['好'] })
    }
    return
  }

  updateCheckInProgress = true
  let userStartedUpdate = false
  try {
    if (activeHarnessRuntime === undefined) {
      activeHarnessRuntime = await resolveHarnessRuntime({ userDataDirectory: app.getPath('userData'), bundledPackagePath: dshPackagePath })
    }
    const latestVersion = await fetchLatestHarnessVersion()
    if (!isNewerHarnessVersion(latestVersion, activeHarnessRuntime.version)) {
      if (interactive) {
        await showMessageBox({
          type: 'info',
          title: 'DeepSeek Harness 更新',
          message: '当前已经是最新版本。',
          detail: `已安装：${activeHarnessRuntime.version}\n官方最新：${latestVersion}`,
          buttons: ['好'],
        })
      }
      return
    }

    const choice = await showMessageBox({
      type: 'info',
      title: '发现 DeepSeek Harness 新版本',
      message: `可以更新到 ${latestVersion}`,
      detail: `当前版本：${activeHarnessRuntime.version}\n更新由官方 npm 发布渠道下载，验证成功后才会启用。`,
      buttons: ['下载并更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response !== 0) return
    userStartedUpdate = true

    const progressWindow = createUpdateProgressWindow(latestVersion)
    try {
      activeHarnessRuntime = await installHarnessRuntime({
        userDataDirectory: app.getPath('userData'),
        bundledNpmPackagePath: npmPackagePath,
        electronExecutable: process.execPath,
        version: latestVersion,
        onOutput: text => void appendLog(`[${new Date().toISOString()}] updater: ${text}`),
      })
    } finally {
      if (!progressWindow.isDestroyed()) progressWindow.close()
    }

    const restartChoice = await showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness 更新完成',
      message: `${latestVersion} 已安装并通过验证。`,
      detail: '重新启动客户端后，新版本将生效。原内置版本会保留，用于自动回退。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (restartChoice.response === 0) {
      app.relaunch()
      app.quit()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLog(`[${new Date().toISOString()}] update error: ${message}\n`)
    if (interactive || userStartedUpdate) {
      await showMessageBox({
        type: 'error',
        title: '检查更新失败',
        message: '暂时无法完成更新。',
        detail: message,
        buttons: ['好'],
      })
    }
  } finally {
    updateCheckInProgress = false
  }
}

// 客户端自身的更新只做「发现新版 -> 打开下载链接」：安装包没有 Apple Developer ID
// 签名，Squirrel 那套静默更新在 macOS 上装不上，三平台统一走手动安装更省事。
// 返回值表示「发现了新版本」，调度里用它决定要不要再叠一个 Harness 更新弹窗。
async function checkForDesktopUpdate({ interactive = false } = {}) {
  if (desktopCheckInProgress || quitting) {
    if (interactive) {
      await showMessageBox({ type: 'info', title: '正在检查更新', message: '更新检查已经在进行中，请稍候。', buttons: ['好'] })
    }
    return false
  }

  desktopCheckInProgress = true
  const currentVersion = app.getVersion()
  try {
    const release = await fetchLatestDesktopRelease()
    if (!isNewerDesktopVersion(release.version, currentVersion)) {
      if (interactive) {
        await showMessageBox({
          type: 'info',
          title: '客户端更新',
          message: '当前已经是最新版本。',
          detail: `已安装：${currentVersion}\n官方最新：${release.version}`,
          buttons: ['好'],
        })
      }
      return false
    }

    // 手动检查时无视跳过记录：用户主动问了就该给答案。
    if (!interactive && isSkippedDesktopVersion(release.version, await readSkippedDesktopVersion(app.getPath('userData')))) {
      return false
    }

    const downloadUrl = pickInstallerUrl(release) ?? release.pageUrl ?? DESKTOP_RELEASE_PAGE_URL
    const choice = await showMessageBox({
      type: 'info',
      title: '发现客户端新版本',
      message: `可以更新到 ${release.version}`,
      detail: `当前版本：${currentVersion}\n下载完成后请手动安装，安装包会覆盖当前客户端。`,
      buttons: ['前往下载', '跳过此版本', '稍后'],
      defaultId: 0,
      cancelId: 2,
    })
    if (choice.response === 0) await shell.openExternal(downloadUrl)
    if (choice.response === 1) await skipDesktopVersion(app.getPath('userData'), release.version)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLog(`[${new Date().toISOString()}] desktop update error: ${message}\n`)
    if (interactive) {
      await showMessageBox({
        type: 'error',
        title: '检查更新失败',
        message: '暂时无法检查客户端更新。',
        detail: message,
        buttons: ['好'],
      })
    }
    return false
  } finally {
    desktopCheckInProgress = false
  }
}

// 客户端本身要更新时就不再弹 Harness 更新了：新客户端自带更新过的内置 Harness。
async function runScheduledUpdateChecks() {
  if (await checkForDesktopUpdate()) return
  await checkForHarnessUpdate()
}

function startUpdateSchedule() {
  if (updateCheckDelay !== undefined || updateCheckInterval !== undefined) return
  updateCheckDelay = setTimeout(() => {
    updateCheckDelay = undefined
    void runScheduledUpdateChecks()
  }, UPDATE_CHECK_DELAY_MS)
  updateCheckInterval = setInterval(() => void runScheduledUpdateChecks(), UPDATE_CHECK_INTERVAL_MS)
}

async function boot() {
  configureMenu()
  mainWindow = createWindow()
  try {
    activeHarnessRuntime = await resolveHarnessRuntime({ userDataDirectory: app.getPath('userData'), bundledPackagePath: dshPackagePath })
    let url
    try {
      url = await startHarnessWithDesktopIntegration(activeHarnessRuntime)
    } catch (error) {
      if (activeHarnessRuntime.source !== 'downloaded') throw error
      await appendLog(`[${new Date().toISOString()}] downloaded Harness ${activeHarnessRuntime.version} failed; reverting to bundled runtime.\n`)
      await deactivateDownloadedHarnessRuntime(app.getPath('userData'))
      activeHarnessRuntime = await bundledHarnessRuntime(dshPackagePath)
      await showMessageBox({
        type: 'warning',
        title: '已自动回退 Harness',
        message: '新下载的 Harness 无法启动，已恢复使用内置版本。',
        detail: `当前版本：${activeHarnessRuntime.version}`,
        buttons: ['好'],
      })
      url = await startHarnessWithDesktopIntegration(activeHarnessRuntime)
    }
    harnessOrigin = originOf(url)
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) await mainWindow.loadURL(url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLog(`[${new Date().toISOString()}] startup error: ${message}\n`)
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPage('启动失败，请退出后重新打开。错误详情已写入系统日志。'))}`)
    }
    dialog.showErrorBox('DeepSeek Harness 启动失败', message)
  }
}

const singleInstanceLock = app.requestSingleInstanceLock()
const launchedToQuit = process.argv.includes('--quit-from-taskbar')
if (!singleInstanceLock || launchedToQuit) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--quit-from-taskbar')) {
      requestQuit()
      return
    }
    if (!showMainWindow() && !quitting) void boot()
  })

  app.on('activate', () => {
    if (!showMainWindow() && !quitting) void boot()
  })

  app.on('before-quit', event => {
    if (shutdownComplete) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    clearTimeout(updateCheckDelay)
    clearInterval(updateCheckInterval)
    void stopHarness().finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })

  void app.whenReady().then(async () => {
    console.log('DeepSeek Harness: Electron is ready')
    registerDesktopIpc()
    try {
      const integration = await installDesktopIntegration({ appPath: app.getAppPath(), userDataDirectory: app.getPath('userData') })
      desktopIntegrationPatchPath = integration.patchPath
    } catch (error) {
      await appendLog(`[${new Date().toISOString()}] desktop integration error: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    configureBackgroundControls()
    await boot()
    startUpdateSchedule()
  }).catch(error => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(message)
    dialog.showErrorBox('DeepSeek Harness 启动失败', message)
    app.quit()
  })
}
