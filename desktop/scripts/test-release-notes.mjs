import assert from 'node:assert/strict'
import { commitSubjects, extractChangelogSection, releaseNotes } from './release-notes.mjs'

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

// 真实仓库：CHANGELOG 里写了的版本走 CHANGELOG，标签区间的提交标题作为兜底。
const notes = await releaseNotes('v0.2.9')
assert.match(notes, /跳过此版本/)
assert.match(commitSubjects('v0.2.9'), /^- Check for desktop client updates in the app$/m)

console.log('Release notes tests passed')
