// ICU integrity + formatting check for zh-CN s16a draft. Read-only.
import { IntlMessageFormat } from '/Users/damian/local-operator-ui/.worktrees/i18n-s16a/node_modules/intl-messageformat/index.js'
import fs from 'node:fs'

const draftPath = '/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/zh-CN-s16a.json'
const enPath = '/Users/damian/local-operator-ui/.worktrees/i18n-s16a/src/i18n/catalogues/en/ui.chat.canonical.json'
const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'))
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))
const locale = 'zh-CN'

console.log('# Intl.PluralRules categories:', JSON.stringify(new Intl.PluralRules(locale).resolvedOptions().pluralCategories), 'type=', new Intl.PluralRules(locale).resolvedOptions().pluralRule)

// CLDR categories present in each message's plural branches
function pluralBranches(msg) {
  const out = []
  const re = /\{[^,{}]+,\s*plural,((?:\s*(?:zero|one|two|few|many|other)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)\s*\}/g
  let m
  while ((m = re.exec(msg))) {
    const cats = [...m[1].matchAll(/(zero|one|two|few|many|other)\s*\{/g)].map((x) => x[1])
    out.push(cats)
  }
  return out
}

const selectBranches = (msg) => [...msg.matchAll(/(zero|one|two|few|many|other)\s*\{/g)].map((m) => m[1])
const selKeys = (msg) => [...msg.matchAll(/\{(video|voiceover|sound_effect)\s*\{/g)].map((m) => m[1])

const counts = [0, 1, 2, 3, 5, 11, 21, 22, 100, 1000000]
const materials = ['video', 'voiceover', 'sound_effect', 'image']
const passArgs = { size: '12.4 KB', dir: '/tmp/x' }

console.log('\n# Key presence / parity')
const enNew = Object.keys(en).filter((k) => /tool\.(composing|queued)_|image_gen\.state\./.test(k))
console.log('en new keys:', enNew.length, 'draft keys:', Object.keys(draft).length)
console.log('missing in draft:', enNew.filter((k) => !(k in draft)))
console.log('extra in draft:', Object.keys(draft).filter((k) => !enNew.includes(k)))

for (const k of Object.keys(draft)) {
  const msg = draft[k]
  const enMsg = en[k]
  console.log(`\n=== ${k}`)
  console.log('  ZH: ' + msg)
  // placeholder names
  const ph = (m) => [...new Set([...m.matchAll(/\{\s*([a-zA-Z_][\w]*)\s*[,}]/g)].map((x) => x[1]).filter((n) => !['plural', 'select', 'number', 'other', 'video', 'voiceover', 'sound_effect', 'zero', 'one', 'two', 'few', 'many'].includes(n)))]
  const enPh = ph(enMsg).sort(), zhPh = ph(msg).sort()
  const same = JSON.stringify(enPh) === JSON.stringify(zhPh)
  console.log(`  placeholders en=${JSON.stringify(enPh)} zh=${JSON.stringify(zhPh)} ${same ? 'OK' : 'MISMATCH'}`)
  // group-off
  console.log(`  ::group-off en=${(enMsg.match(/::group-off/g) || []).length} zh=${(msg.match(/::group-off/g) || []).length}`)
  // plural categories
  const pb = pluralBranches(msg)
  if (pb.length) console.log('  plural branch sets:', JSON.stringify(pb), pb.every((c) => c.length === 1 && c[0] === 'other') ? 'other-only OK' : 'CHECK')
  // select branches
  const sk = selKeys(msg)
  if (sk.length) console.log('  select branches:', JSON.stringify(sk))
  // parse
  let mf
  try {
    mf = new IntlMessageFormat(msg, locale)
    console.log('  PARSE: ok')
  } catch (e) {
    console.log('  PARSE: FAIL ' + e.message)
    continue
  }
  // formatted output
  if (k.endsWith('queue_ahead')) {
    for (const c of counts) console.log(`   count=${c} -> ${mf.format({ count: c })}`)
  } else if (/running|done|failed/.test(k)) {
    for (const mat of materials) {
      if (k.includes('batch') || k === 'ui.chat.canonical.image_gen.state.running_batch') {
        for (const t of counts) console.log(`   ${mat} total=${t} -> ${mf.format({ material: mat, total: t })}`)
      } else {
        console.log(`   ${mat} -> ${mf.format({ material: mat })}`)
      }
    }
  } else if (msg.includes('{size}')) {
    console.log('   -> ' + mf.format({ size: '12.4 KB' }))
  } else {
    console.log('   -> ' + mf.format({}))
  }
  // leftover braces
  try {
    const args = k.endsWith('queue_ahead') ? { count: 3 } : /running|done|failed/.test(k) ? { material: 'image', total: 3 } : { size: '12.4 KB' }
    const out = mf.format(args)
    if (/[{}]/.test(out)) console.log('  LEFTOVER BRACES in output: ' + out)
  } catch (e) {
    console.log('  FORMAT ERROR: ' + e.message)
  }
}

// cell widths (CJK/fullwidth = 2, ASCII = 1)
const wc = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u20000-\u2FFFD]/.test(ch) ? 2 : 1), 0)
console.log('\n# Widths (cells) ZH vs EN(formatted with sample args)')
for (const k of Object.keys(draft)) {
  const enMsg = en[k]
  if (/running|done|failed|queued_ahead|queue_ahead/.test(k) && !k.includes('composing') && !k.includes('tool.queued')) {
    for (const mat of materials) {
      const a = { material: mat, total: 3, count: 3 }
      let zo, eo
      try { zo = new IntlMessageFormat(draft[k], locale).format(a) } catch { continue }
      try { eo = new IntlMessageFormat(enMsg, 'en').format(a) } catch { continue }
      console.log(`  ${k} [${mat}] zh=${wc(zo)}C "${zo}"  en=${wc(eo)}C "${eo}"  ${wc(zo) > wc(eo) ? 'WIDER' : 'ok'}`)
    }
  } else {
    const a = { size: '12.4 KB' }
    const zo = new IntlMessageFormat(draft[k], locale).format(a)
    const eo = new IntlMessageFormat(enMsg, 'en').format(a)
    console.log(`  ${k} zh=${wc(zo)}C "${zo}"  en=${wc(eo)}C "${eo}"  ${wc(zo) > wc(eo) ? 'WIDER' : 'ok'}`)
  }
}
