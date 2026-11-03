import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,TYPE} from "file:///Users/damian/local-operator-ui/node_modules/.pnpm/%40formatjs%2Bicu-messageformat-parser%403.5.21/node_modules/%40formatjs/icu-messageformat-parser/index.js";
import {IntlMessageFormat} from "file:///Users/damian/local-operator-ui/node_modules/.pnpm/intl-messageformat%4012.1.3/node_modules/intl-messageformat/index.js";
const root="/Users/damian/.local-operator/sessions/35aac0a677bc/scratchpad/fr-census-second";
const keys=["ui.chat.session_status.effort_level.low", "ui.chat.session_status.effort_level.medium", "ui.chat.session_status.effort_level.high", "ui.chat.run_details.wake.armed_count", "ui.chat.run_details.wake.cadence_once"];
const result={keys:[],plural_categories:new Intl.PluralRules('fr').resolvedOptions().pluralCategories};
for(const key of keys){
 const ns=key.includes('session_status')?'ui.chat':'ui.chat.run_details';
 const en=JSON.parse(readFileSync(`${root}/src/i18n/catalogues/en/${ns}.json`))[key];
 const fr=JSON.parse(readFileSync(`${root}/src/i18n/catalogues/fr/${ns}.json`))[key];
 const a=parse(en),b=parse(fr);
 assert(!/\p{Cf}/u.test(fr)); assert.notEqual(en,fr);
 const row={key,en,fr,no_Cf:true,chars:Array.from(fr).length};
 if(key.endsWith('armed_count')){
  assert.equal(a.length,1);assert.equal(b.length,1);
  assert.equal(a[0].type,TYPE.plural);assert.equal(b[0].type,TYPE.plural);
  assert.equal(a[0].value,'count');assert.equal(b[0].value,'count');
  assert.equal(b[0].pluralType,'cardinal');
  assert.deepEqual(Object.keys(b[0].options).sort(),result.plural_categories.slice().sort());
  for(const opt of Object.values(b[0].options)){
   assert.equal(opt.value[0].type,TYPE.argument);assert.equal(opt.value[0].value,'count_display');
   assert(!opt.value.some(n=>n.type===TYPE.pound));
  }
  row.outputs=[0,1,2,1000000,1500000].map(count=>({count,text:new IntlMessageFormat(fr,'fr').format({count,count_display:String(count)})}));
  row.selector_display_separation=new IntlMessageFormat(fr,'fr').format({count:2,count_display:'RAW_COUNT'});
  assert.equal(row.selector_display_separation,'RAW_COUNT réveils activés');
 }
 result.keys.push(row);
}
console.log(JSON.stringify(result,null,2));
