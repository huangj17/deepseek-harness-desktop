import assert from 'node:assert/strict'
import { hideMainWindowOnClose, revealMainWindow } from '../src/window-lifecycle.mjs'

function fakeWindow({ destroyed = false, minimized = false } = {}) {
  const calls = []
  return {
    calls,
    focus: () => calls.push('focus'),
    hide: () => calls.push('hide'),
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
  }
}

{
  const window = fakeWindow()
  const event = { preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true } }
  assert.equal(hideMainWindowOnClose(event, window), true)
  assert.equal(event.preventDefaultCalled, true)
  assert.deepEqual(window.calls, ['hide'])
}

for (const state of [{ quitting: true }, { shutdownComplete: true }]) {
  const window = fakeWindow()
  const event = { preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true } }
  assert.equal(hideMainWindowOnClose(event, window, state), false)
  assert.equal(event.preventDefaultCalled, false)
  assert.deepEqual(window.calls, [])
}

{
  const window = fakeWindow({ minimized: true })
  assert.equal(revealMainWindow(window), true)
  assert.deepEqual(window.calls, ['restore', 'show', 'focus'])
}

assert.equal(revealMainWindow(undefined), false)
assert.equal(revealMainWindow(fakeWindow({ destroyed: true })), false)

console.log('Verified close-to-background window lifecycle')
