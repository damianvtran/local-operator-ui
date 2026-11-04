import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/damian/local-operator-ui/package.json');
const { parse, TYPE } = await import(require.resolve('@formatjs/icu-messageformat-parser'));
const { IntlMessageFormat } = await import(require.resolve('intl-messageformat'));
const input = JSON.parse(readFileSync(new URL('./inputs.json', import.meta.url)));
const categories = new Intl.PluralRules('vi').resolvedOptions().pluralCategories;
assert.deepEqual(categories,['other']);
function signature(ast, map={}) {
 for(const node of ast){
  if([TYPE.argument,TYPE.number,TYPE.date,TYPE.time,TYPE.select,TYPE.plural].includes(node.type)) {
   const kind = node.type===TYPE.plural ? 'number' : node.type===TYPE.argument ? 'string' : String(node.type);
   assert.ok(!map[node.value] || map[node.value]===kind); map[node.value]=kind;
  }
  if(node.options) for(const option of Object.values(node.options)) signature(option.value,map);
  if(node.children) signature(node.children,map);
 } return map;
}
const report={locale:'vi',cldr_categories:categories,namespaces:{},samples:[],limits:'Source/ICU formatting only; no native app, pseudo-localization or rendered pixel/fit proof. No full-repository scanner/build/tsc.'};
for(const ns of ['ui.chat','ui.chat.run_details']){
 const b=input[ns];
 assert.deepEqual(Object.keys(b.en.messages).sort(),Object.keys(b.vi.messages).sort());
 for(const key of b.keys){
  const source=b.en.messages[key], target=b.vi.messages[key];
  const sa=parse(source), ta=parse(target);
  assert.deepEqual(signature(sa),signature(ta));
  assert.equal(target.normalize('NFC'),target);
  assert.ok(!/\p{Cf}/u.test(target));
  assert.ok(!/\p{M}/u.test(target),'No decomposed combining marks');
  assert.notEqual(source,target);
  assert.deepEqual(source.match(/`[^`]*`|<\/?[A-Za-z][^>]*>/g)||[],target.match(/`[^`]*`|<\/?[A-Za-z][^>]*>/g)||[]);
  const plural=ta.find(n=>n.type===TYPE.plural);
  if(plural){
   assert.equal(plural.value,'count'); assert.deepEqual(Object.keys(plural.options),categories);
   assert.deepEqual(plural.options.other.value.filter(n=>n.type===TYPE.argument).map(n=>n.value),['count_display']);
   assert.ok(!plural.options.other.value.some(n=>n.type===TYPE.pound));
   for(const count of [0,1,2,5,21,1000,1.5]){
    const actual=new IntlMessageFormat(target,'vi').format({count,count_display:String(count)});
    assert.equal(actual,`${String(count)} lịch thức dậy đã đặt`);
    report.samples.push({key,count,actual});
   }
   const probe=new IntlMessageFormat(target,'vi').format({count:2,count_display:'TOKEN_1000.5'});
   assert.equal(probe,'TOKEN_1000.5 lịch thức dậy đã đặt');
   report.samples.push({key,selector_print_separation:probe});
  }else report.samples.push({key,actual:new IntlMessageFormat(target,'vi').format(),characters:[...target].length});
 }
 report.namespaces[ns]={audited_delta_keys:b.keys.length,catalogue_key_count:Object.keys(b.en.messages).length,key_parity:true,placeholder_types:true,valid_icu:true,NFC:true,no_Cf:true,no_combining_marks:true,explicit_numeric_maxCells_or_maxChars:b.keys.some(k=>'maxCells' in b.context.messages[k]||'maxChars' in b.context.messages[k])};
}
const once=input['ui.chat.run_details'].vi.messages['ui.chat.run_details.wake.cadence_once'];
for(const k of ['ui.schedules.scheduled_task_model.cadence_starts_value2','ui.schedules.scheduled_task_model.cadence_until_value2']){
 const actual=new IntlMessageFormat(input.schedule.vi[k],'vi').format({cadence:once,value2:'10:00'});
  report.samples.push({key: k, actual, scope: 'Unchanged direct embedding consumer only'});
}
writeFileSync(new URL('./mechanical.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
