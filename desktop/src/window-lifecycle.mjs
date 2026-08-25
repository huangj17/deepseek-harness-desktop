export function hideMainWindowOnClose(event, window, { quitting = false, shutdownComplete = false } = {}) {
  if (quitting || shutdownComplete) return false
  event.preventDefault()
  window.hide()
  return true
}

export function revealMainWindow(window) {
  if (window === undefined || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}
