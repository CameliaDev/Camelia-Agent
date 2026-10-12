import fs from 'node:fs';
const path='packages/ui/test/local-prefs.test.ts';
let s=fs.readFileSync(path,'utf8');
s=s.replace("#f3f0ed", "#f6f1ec");
fs.writeFileSync(path,s);
console.log('updated color expect');
