// 校验打包产物：__PACK__ 是否注入成功、内嵌的 jar 是否完整。
// 只做静态解析，不执行产物里的任何代码。
//
// 注意：注入的字面量里含反引号（base64 不含反引号，但 JSON.stringify
// 在部分字段上可能产生模板字符串形式），所以不能直接 JSON.parse，
// 要按 JS 字面量的规则来扫。
const fs = require('node:fs');

const file = process.argv[2] || 'dist/assets/app.js';
const src = fs.readFileSync(file, 'utf8');

const marker = src.match(/__PACK__\s*=\s*/);
if (!marker) {
  console.log('FAIL 产物里找不到 __PACK__');
  process.exit(1);
}

const start = marker.index + marker[0].length;

// 从字面量的第一个字符开始扫，找配对的结束引号或大括号。
// 兼容字符串 / 模板字符串 / 嵌套对象。
let i = start;
while (i < src.length && src[i] !== '{' && src[i] !== '`') i++;
const OPEN = src[i];
const CLOSE = OPEN === '`' ? '`' : '}';

let depth = 0;
let inStr = null;
let esc = false;
let end = -1;
let strDepth = 0; // 模板字符串里的 ${...} 嵌套层级

for (; i < src.length; i++) {
  const c = src[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (inStr === '"' && c === inStr) inStr = null;
    else if (inStr === '`' && c === '`') inStr = null;
    else if (inStr === '`' && c === '$' && src[i + 1] === '{') { strDepth++; i++; }
    else if (strDepth > 0 && c === '}') strDepth--;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}

const literal = src.slice(start, end);
// 把反引号字面量安全转成 JSON 字符串形式（base64 里不会有特殊字符）
const jsonText = literal
  .replace(/`/g, '"')
  .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
  .replace(/([{,]\s*)'([^']*)'\s*:/g, '$1"$2":');

const packed = JSON.parse(jsonText);

const bytes = Buffer.from(packed.game.jarBase64, 'base64');

const report = [
  ['OK   __PACK__ 注入', true],
  ['  game.name     =', packed.game.name],
  ['  game.fileName =', packed.game.fileName],
  ['  identity      =', JSON.stringify(packed.identity)],
  ['  jarBase64     =', packed.game.jarBase64.length.toLocaleString() + ' 字符'],
  ['  解码后        =', bytes.length.toLocaleString() + ' 字节 (' + (bytes.length / 1048576).toFixed(2) + ' MB)'],
  ['  ZIP 魔数      =', bytes.slice(0, 2).toString('hex') + (bytes.slice(0, 2).toString('hex') === '504b' ? '  合法 jar' : '  不是 zip')],
];

// 和磁盘上的原 jar 逐字节比对，确保内嵌过程没损坏
const cfg = JSON.parse(fs.readFileSync('pack.config.json', 'utf8'));
const orig = fs.readFileSync(cfg.game.jar);
report.push(['  与原 jar 一致 =', orig.equals(bytes) ? '逐字节相同' : '不一致 ' + orig.length + ' vs ' + bytes.length]);

for (const [k, v] of report) {
  if (v === true) console.log(k);
  else console.log(k + ' ' + v);
}