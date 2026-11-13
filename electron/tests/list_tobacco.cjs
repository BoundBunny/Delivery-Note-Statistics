const fs=require('fs');
const src=fs.readFileSync('webapp/js/seed-products.js','utf8');
const obj=JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']')+1));
const tob=obj.filter(p=>p.category==='tobacco');
const names=[...new Set(tob.map(p=>p.name))];
console.log('tobacco entries',tob.length,'unique names',names.length);
console.log(names.join('\n'));
