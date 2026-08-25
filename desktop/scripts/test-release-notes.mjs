import assert from 'node:assert/strict'
import { extractChangelogSection, releaseNotes } from './release-notes.mjs'

const changelog = [
  '# 更新日志',
  '',
  '## 0.3.0',
  '',
  '- 新增：甲',
  '- 修复：乙',
  '',
  '## 0.2.9',
  '',
  '- 修复：丙',
  '',
].join('\n')

assert.equal(extractChangelogSection(changelog, '0.3.0'), '- 新增：甲\n- 修复：乙')
assert.equal(extractChangelogSection(changelog, '0.2.9'), '- 修复：丙')
assert.equal(extractChangelogSection(changelog, '0.2.8'), undefined)
assert.equal(extractChangelogSection('# 更新日志\n\n## 0.1.0\n', '0.1.0'), undefined)

// 真实仓库：两份 CHANGELOG 都写了就出双语。
const notes = await releaseNotes('v0.2.11')
assert.match(notes, /^### English$/m)
assert.match(notes, /Open DSH Terminal/)
assert.match(notes, /^### 简体中文$/m)
assert.match(notes, /打开 DSH 终端/)
assert.ok(notes.indexOf('### English') < notes.indexOf('### 简体中文'))

console.log('Release notes tests passed')
