// s16a zh-CN independent audit — mechanical checks. READ-ONLY on the repo.
// Captured verbatim into audit.log by run-audit.sh; report.md reasons on top.
import { IntlMessageFormat } from '/Users/damian/local-operator-ui/.worktrees/i18n-s16a/node_modules/intl-messageformat/index.js'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

const REPO = '/Users/damian/local-operator-ui/.worktrees/i18n-s16a'
const DRAFTS = '/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts'
const LOCALE = 'zh-CN'
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')

const sections = []
const out = (s = '') => { sections.push(s) }

// §1 input identity
out('## §1 input hashes (sha256)')
for (const [label, p] of [
  ['en catalogue', `${REPO}/src/i18n/catalogues/en/ui.chat.canonical.json`],
  ['en context', `${REPO}/src/i18n/catalogues/en/ui.chat.canonical.context.json`],
  [`${LOCALE} catalogue on disk`, `${REPO}/src/i18n/catalogues/${LOCALE}/ui.chat.canonical.json`],
  [`${LOCALE} draft (translator output)`, `${DRAFTS}/${LOCALE}-s16a.json`],
]) out(`  ${sha(p)}  ${label}  ${p.replace(REPO, '<repo>')}`)

const draft = JSON.parse(fs.readFileSync(`${DRAFTS}/${LOCALE}-s16a.json`, 'utf8'))
const en = JSON.parse(fs.readFileSync(`${REPO}/src/i18n/catalogues/en/ui.chat.canonical.json`, 'utf8'))
const enCtx = JSON.parse(fs.readFileSync(`${REPO}/src/i18n/catalogues/en/ui.chat.canonical.context.json`, 'utf8'))
const onDisk = JSON.parse(fs.readFileSync(`${REPO}/src/i18n/catalogues/${LOCALE}/ui.chat.canonical.json`, 'utf8'))

// §2 key set parity
const enNew = Object.keys(en).filter((k) => /tool\.(composing|queued)_|image_gen\.state\./.test(k))
out('\n## §2 key set')
out(`  en keys for this group: ${enNew.length}   draft keys: ${Object.keys(draft).length}`)
out(`  missing from draft: ${JSON.stringify(enNew.filter((k) => !(k in draft)))}`)
out(`  extra in draft:     ${JSON.stringify(Object.keys(draft).filter((k) => !enNew.includes(k)))}`)
out(`  keys already in ${LOCALE} catalogue on disk: ${JSON.stringify(enNew.filter((k) => k in onDisk))}`)
out(`  context sidecar entries for the group: ${enNew.filter((k) => k in enCtx).length}/${enNew.length}`)
out('  valid JSON: yes (both files parsed)')

// §3 placeholder / ICU / plural / select integrity
const CATS = new Intl.PluralRules(LOCALE).resolvedOptions().pluralCategories
out(`\n## §3 ICU integrity (Intl.PluralRules('${LOCALE}') -> ${JSON.stringify(CATS)})`)
const SKIP = new Set(['plural', 'select', 'number', 'other', 'zero', 'one', 'two', 'few', 'many', 'video', 'voiceover', 'sound_effect', 'image'])
const nameOf = (m) => [...new Set([...m.matchAll(/\{\s*([a-zA-Z_][\w]*)\s*[,}]/g)].map((x) => x[1]))].filter((n) => !SKIP.has(n)).sort()
const SELECT_BRANCHES = ['video', 'voiceover', 'sound_effect', 'other']
const SELECT_KEYS = ['video', 'voiceover', 'sound_effect']
const counts = [0, 1, 2, 3, 5, 11, 21, 22, 100, 1000000]
const materials = ['video', 'voiceover', 'sound_effect', 'image']
const fmt = {}

for (const k of Object.keys(draft)) {
  const msg = draft[k], src = en[k]
  const phOk = JSON.stringify(nameOf(src)) === JSON.stringify(nameOf(msg))
  const pluralCats = [...msg.matchAll(/\{\s*\w+\s*,\s*plural\s*,((?:\s*(?:zero|one|two|few|many|other)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)/g)]
    .map((m) => [...m[1].matchAll(/(zero|one|two|few|many|other)\s*\{/g)].map((x) => x[1]))
  const pluralOk = pluralCats.every((c) => JSON.stringify(c) === JSON.stringify(CATS))
  const selOk = SELECT_BRANCHES.every((b) => new RegExp(`(?:^|[,\\s])${b} \\{`).test(msg))
  const selBranchesOk = SELECT_BRANCHES.every((b) => msg.includes(` ${b} {`))
  const groupOff = [ (src.match(/::group-off/g) || []).length, (msg.match(/::group-off/g) || []).length ]
  const groupOk = k.endsWith('queue_ahead') ? groupOff[1] === 1 : groupOff[0] === groupOff[1]
  let parsed = 'ok', err = ''
  try { fmt[k] = new IntlMessageFormat(msg, LOCALE) } catch (e) { parsed = 'PARSE FAIL'; err = e.message }
  out(`  ${k}`)
  out(`    placeholders en=${JSON.stringify(nameOf(src))} zh=${JSON.stringify(nameOf(msg))} ${phOk ? 'OK' : 'MISMATCH'}`)
  if (pluralCats.length) out(`    plural categories per message: ${JSON.stringify(pluralCats)} ${pluralOk ? 'matches CLDR (other only)' : 'WRONG'}`)
  if (msg.includes(', select,')) out(`    select: branches ${selOk ? 'all 4 present' : 'MISSING BRANCH'}; all 4 named ${selBranchesOk ? 'yes' : 'NO'}`)
  if (k.endsWith('queue_ahead')) out(`    ::group-off en=${groupOff[0]} zh=${groupOff[1]} ${groupOk ? 'OK (one arm collapsed)' : 'CHECK'}`)
  out(`    parse: ${parsed}${err ? ' -> ' + err : ''}`)
}

// §4 formatted output, grammar read
out('\n## §4 formatted output (intl-messageformat, read for grammar)')
const sample = { size: '12.4 KB' }
for (const k of Object.keys(draft)) {
  const mf = fmt[k]
  if (!mf) continue
  if (k.endsWith('queue_ahead')) {
    out(`  ${k}`)
    out('    ' + counts.map((c) => `${c}->${mf.format({ count: c })}`).join('  '))
  } else if (/\{material, select,/.test(draft[k])) {
    out(`  ${k}`)
    for (const mat of materials) {
      if (draft[k].includes('plural')) out('    ' + mat + ' total: ' + [0, 1, 3, 100, 1000000].map((t) => `${t}->${mf.format({ material: mat, total: t })}`).join('  '))
      else out(`    ${mat}->${mf.format({ material: mat })}`)
    }
  } else {
    out(`  ${k} -> ${mf.format(sample)}`)
  }
}
out('  leftover braces in any output: ' + (Object.keys(draft).some((k) => {
  try {
    const o = fmt[k].format(k.endsWith('queue_ahead') ? { count: 3 } : /\{material, select,/.test(draft[k]) ? { material: 'image', total: 3 } : sample)
    return /[{}]/.test(o)
  } catch { return true }
}) ? 'YES' : 'none'))

// §5 width (cells: CJK/fullwidth 2, ASCII 1)
const wc = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u20000-\u2FFFD]/.test(ch) ? 2 : 1), 0)
out('\n## §5 width vs English (cells; sidecar carries no maxCells for this group)')
for (const k of Object.keys(draft)) {
  if (!fmt[k]) continue
  const args = k.endsWith('queue_ahead') ? { count: 3 } : /\{material, select,/.test(draft[k]) ? { material: 'sound_effect', total: 3 } : sample
  const zhOut = fmt[k].format(args)
  let enOut
  try { enOut = new IntlMessageFormat(en[k], 'en').format(args) } catch { continue }
  out(`  ${k}: zh=${wc(zhOut)}C  en=${wc(enOut)}C  ${wc(zhOut) > wc(enOut) ? 'WIDER' : 'ok'}`)
}

// §6 ellipsis census (target: shipped zh-CN convention)
out('\n## §6 ellipsis census in shipped zh-CN catalogues')
let dbl = 0, sgl = []
const dir = `${REPO}/src/i18n/catalogues/${LOCALE}`
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== 'string') continue
    if (v.includes('……')) dbl++
    else if (v.includes('…')) sgl.push(`${f}:${k}=${v}`)
  }
}
out(`  values with …… : ${dbl}`)
out(`  values with single … : ${sgl.length}`)
sgl.forEach((s) => out('    ' + s))
out('  style guide i18n/style-guides/zh-CN.md: "Ellipsis is …… (two marks), not \"...\""')
out(`  draft values using …… : ${Object.values(draft).filter((v) => v.includes('……')).length}`)
out(`  draft values using single … : ${Object.values(draft).filter((v) => v.includes('…') && !v.includes('……')).length}`)

// §7 translator claims, verified file:key
out('\n## §7 translator notes claims re-verified against shipped zh-CN catalogue')
const claims = [
  ['ui.chat.canonical.json', 'ui.chat.canonical.tool.never_sent_composed', '未发送 · 已编写{size}'],
  ['ui.chat.canonical.json', 'ui.chat.canonical.supplement.frame.loading', '正在加载图像……'],
  ['ui.chat.canonical.json', 'ui.chat.canonical.image_gen.progress', '图像生成进度'],
  ['ui.chat.canonical.json', 'ui.chat.canonical.image_gen.control.restart', '重新生成'],
  ['ui.chat.canonical.json', 'ui.chat.canonical.tool_row.verb.wrote.running', '正在写入'],
  ['ui.canvas.json', 'ui.canvas.files.videos', '视频'],
  ['ui.library.json', 'ui.library.category.sounds', '音频'],
  ['ui.chat.pickers.json', 'ui.chat.pickers.info_model.queued', '{formatcount}个排队中'],
  ['ui.settings.imports.json', 'ui.settings.imports.state_queued', '排队中'],
]
for (const [f, k, expect] of claims) {
  const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))
  out(`  ${d[k] === expect ? 'OK  ' : 'FAIL'} ${f}:${k} = ${JSON.stringify(d[k])}`)
}
for (const pat of ['旁白', '音效', '批次']) {
  let n = 0
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))
    n += Object.values(d).filter((v) => typeof v === 'string' && v.includes(pat)).length
  }
  out(`  shipped zh-CN values containing ${pat}: ${n}`)
}

console.log(sections.join('\n'))
