window.__ModuleLoader__.load({
  id: '@deepseek-harness-desktop/dsh-terminal-button',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const LOCALE_NAMESPACE = 'desktop-terminal'
    const STYLE_ID = 'deepseek-harness-desktop-terminal-button-style'
    const dictionaries = {
      zh: { open: '打开 DSH 终端', opening: '正在打开终端…', error: '打开终端失败' },
      en: { open: 'Open DSH Terminal', opening: 'Opening terminal…', error: 'Failed to open terminal' },
    }

    function TerminalIcon() {
      return React.createElement(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('rect', { x: 2.25, y: 3, width: 13.5, height: 12, rx: 2.25, stroke: 'currentColor', strokeWidth: 1.4 }),
        React.createElement('path', { d: 'M5.25 7.1 7.4 9l-2.15 1.9M9.25 11h3.25', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function TerminalButton({ wide, useSessions, useWorkspaces, t }) {
      const current = useSessions(state => state.current === undefined ? undefined : state.byId[state.current])
      const workspaceState = useWorkspaces(state => state)
      const [status, setStatus] = React.useState('idle')
      const memberWorkspace = current === undefined
        ? undefined
        : workspaceState.items.find(workspace => workspace.sessionIds.includes(current.id))
      const recentWorkspace = workspaceState.items.find(workspace => workspace.workspaceId === workspaceState.recentWorkspaceId)
      const cwd = current?.cwd ?? memberWorkspace?.path ?? recentWorkspace?.path
      const api = window.deepseekHarnessDesktop
      const available = api !== undefined && typeof api.openDshTerminal === 'function'
      const label = t(status === 'opening' ? 'opening' : status === 'error' ? 'error' : 'open')

      async function openTerminal() {
        if (!available || status === 'opening') return
        setStatus('opening')
        try {
          const result = await api.openDshTerminal(cwd)
          setStatus(result?.ok === true ? 'idle' : 'error')
        } catch {
          setStatus('error')
        }
      }

      return React.createElement(
        'button',
        {
          type: 'button',
          className: `dsh-desktop-terminal-button${wide ? '' : ' rail'}`,
          disabled: !available || status === 'opening',
          title: wide ? undefined : label,
          'aria-label': label,
          onClick: () => { void openTerminal() },
        },
        React.createElement(TerminalIcon),
        wide ? React.createElement('span', null, label) : null,
      )
    }

    const inject = ['slots', 'locale']
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, dictionaries), 'desktop-terminal-button: dictionaries')
      ctx.effect(() => {
        if (document.getElementById(STYLE_ID) !== null) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = `
          [data-slot="sidebar.footer.action"]:has(.dsh-desktop-terminal-button) {
            display: flex !important; flex-direction: column; align-items: stretch;
            width: 100%; min-width: 0;
          }
          .dsh-desktop-terminal-button {
            flex: none; display: flex; align-items: center; gap: 8px;
            width: calc(100% + 4px); height: 42px; margin: 4px -2px;
            padding: 0 10px 0 8px; box-sizing: border-box; border: none;
            border-radius: 12px; background: transparent; cursor: pointer;
            overflow: hidden; color: var(--dsw-alias-label-primary);
            font-family: inherit; font-size: 14px; line-height: 22px; text-align: left;
          }
          .dsh-desktop-terminal-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-desktop-terminal-button:disabled { cursor: default; opacity: .55; }
          .dsh-desktop-terminal-button svg { flex: none; }
          .dsh-desktop-terminal-button span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
          .dsh-desktop-terminal-button.rail {
            flex: none; width: 36px; height: 36px; margin: 8px 0 2px;
            justify-content: center; gap: 0; padding: 0; border-radius: 50%;
          }
        `
        document.head.appendChild(style)
        return () => { style.remove() }
      }, 'desktop-terminal-button: styles')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'desktop-terminal-button',
        order: 100,
        locale: LOCALE_NAMESPACE,
      }, TerminalButton))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
