// Lists everything a JAR references outside of itself (platform classes, methods, fields).
// Usage: npm run refs -- path/to/game.jar
import fs from 'node:fs';
import { readJar } from '../src/jar/jar';
import {
  CP_CLASS,
  CP_FIELDREF,
  CP_INTERFACE_METHODREF,
  CP_METHODREF,
  cpClassName,
  cpMemberRef,
  parseClassFile,
} from '../src/jvm/classfile';

const jarPath = process.argv[2];
if (!jarPath) {
  console.error('Usage: npm run refs -- path/to/game.jar');
  process.exit(1);
}

const jar = readJar(new Uint8Array(fs.readFileSync(jarPath)));
const classes = [...jar.entries.entries()].filter(([p]) => p.endsWith('.class'));
const own = new Set(classes.map(([p]) => p.slice(0, -'.class'.length)));
const refs = new Map<string, Set<string>>();

const add = (cls: string, member?: string) => {
  const base = cls.replace(/^\[+L?/, '').replace(/;$/, '');
  if (own.has(base) || base.length <= 1) return;
  if (!refs.has(base)) refs.set(base, new Set());
  if (member) refs.get(base)!.add(member);
};

for (const [path, bytes] of classes) {
  const cf = parseClassFile(bytes);
  if (cf.superName) add(cf.superName, '(extends)');
  cf.interfaces.forEach((i) => add(i, '(implements)'));
  for (let i = 1; i < cf.cp.tags.length; i++) {
    const tag = cf.cp.tags[i];
    if (tag === CP_CLASS) add(cpClassName(cf.cp, i));
    if (tag === CP_FIELDREF || tag === CP_METHODREF || tag === CP_INTERFACE_METHODREF) {
      const ref = cpMemberRef(cf.cp, i);
      add(ref.className, `${tag === CP_FIELDREF ? 'field ' : ''}${ref.name}${ref.desc}`);
    }
  }
  console.error(`parsed ${path} (v${cf.major}.${cf.minor})`);
}

console.log('Manifest:', Object.fromEntries(jar.manifest));
for (const cls of [...refs.keys()].sort()) {
  console.log(cls);
  for (const m of [...refs.get(cls)!].sort()) console.log(`    ${m}`);
}
