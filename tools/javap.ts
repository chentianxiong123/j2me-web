// Minimal bytecode disassembler for compatibility debugging.
// Usage: npm run javap -- path/to/game.jar ClassName [methodName]
import fs from 'node:fs';
import { readJar } from '../src/jar/jar';
import {
  CP_CLASS,
  CP_DOUBLE,
  CP_FLOAT,
  CP_INTEGER,
  CP_LONG,
  CP_STRING,
  type ConstantPool,
  cpClassName,
  cpMemberRef,
  cpString,
  parseClassFile,
} from '../src/jvm/classfile';

const NAMES = `nop aconst_null iconst_m1 iconst_0 iconst_1 iconst_2 iconst_3 iconst_4 iconst_5 lconst_0 lconst_1 fconst_0 fconst_1 fconst_2
dconst_0 dconst_1 bipush sipush ldc ldc_w ldc2_w iload lload fload dload aload iload_0 iload_1 iload_2 iload_3 lload_0 lload_1 lload_2 lload_3
fload_0 fload_1 fload_2 fload_3 dload_0 dload_1 dload_2 dload_3 aload_0 aload_1 aload_2 aload_3 iaload laload faload daload aaload baload caload
saload istore lstore fstore dstore astore istore_0 istore_1 istore_2 istore_3 lstore_0 lstore_1 lstore_2 lstore_3 fstore_0 fstore_1 fstore_2
fstore_3 dstore_0 dstore_1 dstore_2 dstore_3 astore_0 astore_1 astore_2 astore_3 iastore lastore fastore dastore aastore bastore castore sastore
pop pop2 dup dup_x1 dup_x2 dup2 dup2_x1 dup2_x2 swap iadd ladd fadd dadd isub lsub fsub dsub imul lmul fmul dmul idiv ldiv fdiv ddiv irem lrem
frem drem ineg lneg fneg dneg ishl lshl ishr lshr iushr lushr iand land ior lor ixor lxor iinc i2l i2f i2d l2i l2f l2d f2i f2l f2d d2i d2l d2f
i2b i2c i2s lcmp fcmpl fcmpg dcmpl dcmpg ifeq ifne iflt ifge ifgt ifle if_icmpeq if_icmpne if_icmplt if_icmpge if_icmpgt if_icmple if_acmpeq
if_acmpne goto jsr ret tableswitch lookupswitch ireturn lreturn freturn dreturn areturn return getstatic putstatic getfield putfield
invokevirtual invokespecial invokestatic invokeinterface invokedynamic new newarray anewarray arraylength athrow checkcast instanceof
monitorenter monitorexit wide multianewarray ifnull ifnonnull goto_w jsr_w`.split(/\s+/);

function constant(cp: ConstantPool, i: number): string {
  switch (cp.tags[i]) {
    case CP_STRING:
      return JSON.stringify(cpString(cp, i));
    case CP_INTEGER:
    case CP_FLOAT:
    case CP_DOUBLE:
    case CP_LONG:
      return String(cp.values[i]);
    case CP_CLASS:
      return `class ${cpClassName(cp, i)}`;
    default:
      return `#${i}`;
  }
}

function member(cp: ConstantPool, i: number): string {
  const r = cpMemberRef(cp, i);
  return `${r.className}.${r.name}${r.desc.startsWith('(') ? r.desc : `:${r.desc}`}`;
}

export function disassemble(cp: ConstantPool, code: Uint8Array): string[] {
  const out: string[] = [];
  const u2 = (p: number) => (code[p] << 8) | code[p + 1];
  const s2 = (p: number) => ((code[p] << 24) >> 16) | code[p + 1];
  const s4 = (p: number) => (code[p] << 24) | (code[p + 1] << 16) | (code[p + 2] << 8) | code[p + 3];
  for (let pc = 0; pc < code.length; ) {
    const op = code[pc];
    const name = NAMES[op] ?? `op_${op.toString(16)}`;
    let arg = '';
    let len = 1;
    if (op === 0x10) [arg, len] = [String((code[pc + 1] << 24) >> 24), 2];
    else if (op === 0x11) [arg, len] = [String(s2(pc + 1)), 3];
    else if (op === 0x12) [arg, len] = [constant(cp, code[pc + 1]), 2];
    else if (op === 0x13 || op === 0x14) [arg, len] = [constant(cp, u2(pc + 1)), 3];
    else if ((op >= 0x15 && op <= 0x19) || (op >= 0x36 && op <= 0x3a) || op === 0xa9) [arg, len] = [String(code[pc + 1]), 2];
    else if (op === 0x84) [arg, len] = [`${code[pc + 1]} ${(code[pc + 2] << 24) >> 24}`, 3];
    else if ((op >= 0x99 && op <= 0xa8) || op === 0xc6 || op === 0xc7) [arg, len] = [`-> ${pc + s2(pc + 1)}`, 3];
    else if (op === 0xc8 || op === 0xc9) [arg, len] = [`-> ${pc + s4(pc + 1)}`, 5];
    else if (op >= 0xb2 && op <= 0xb8) [arg, len] = [member(cp, u2(pc + 1)), 3];
    else if (op === 0xb9) [arg, len] = [member(cp, u2(pc + 1)), 5];
    else if (op === 0xbb || op === 0xbd || op === 0xc0 || op === 0xc1) [arg, len] = [cpClassName(cp, u2(pc + 1)), 3];
    else if (op === 0xbc) [arg, len] = [String(code[pc + 1]), 2];
    else if (op === 0xc5) [arg, len] = [`${cpClassName(cp, u2(pc + 1))} dims=${code[pc + 3]}`, 4];
    else if (op === 0xc4) [arg, len] = [`${NAMES[code[pc + 1]]} ${u2(pc + 2)}`, code[pc + 1] === 0x84 ? 6 : 4];
    else if (op === 0xaa || op === 0xab) {
      const p = (pc + 4) & ~3;
      if (op === 0xaa) {
        const low = s4(p + 4);
        const high = s4(p + 8);
        const cases = Array.from({ length: high - low + 1 }, (_, k) => `${low + k}->${pc + s4(p + 12 + k * 4)}`);
        [arg, len] = [`{${cases.join(' ')} default->${pc + s4(p)}}`, p + 12 + (high - low + 1) * 4 - pc];
      } else {
        const n = s4(p + 4);
        const cases = Array.from({ length: n }, (_, k) => `${s4(p + 8 + k * 8)}->${pc + s4(p + 12 + k * 8)}`);
        [arg, len] = [`{${cases.join(' ')} default->${pc + s4(p)}}`, p + 8 + n * 8 - pc];
      }
    }
    out.push(`${String(pc).padStart(5)}: ${name}${arg ? ` ${arg}` : ''}`);
    pc += len;
  }
  return out;
}

const [jarPath, className, methodName] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || (jarPath && className)) {
  const jar = readJar(new Uint8Array(fs.readFileSync(jarPath)));
  const bytes = jar.entries.get(`${className.replace(/\./g, '/')}.class`);
  if (!bytes) throw new Error(`Class ${className} not found`);
  const cf = parseClassFile(bytes);
  for (const m of cf.methods) {
    if (methodName && m.name !== methodName) continue;
    console.log(`\n${m.name}${m.desc}  (max_stack=${m.code?.maxStack}, max_locals=${m.code?.maxLocals})`);
    if (m.code) for (const line of disassemble(cf.cp, m.code.code)) console.log(line);
  }
}
