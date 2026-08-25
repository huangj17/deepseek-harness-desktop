const { contextBridge, ipcRenderer } = require('electron')

const OPEN_DSH_TERMINAL_CHANNEL = 'desktop:open-dsh-terminal'

contextBridge.exposeInMainWorld('deepseekHarnessDesktop', {
  openDshTerminal(cwd) {
    return ipcRenderer.invoke(OPEN_DSH_TERMINAL_CHANNEL, typeof cwd === 'string' ? cwd : undefined)
  },
})
