import { ACC_ABSTRACT, ACC_INTERFACE } from '../classfile';
import type { JThread, NativeClassDef } from '../jvm';
import { JArray, JObject, type JRef, type NativeImpl } from '../types';
import { INT_MAX, javaEquals, javaHashCode, newNativeObject } from './helpers';

// ---------------------------------------------------------------------------------------------------
// Random: same LCG as java.util.Random so seeded sequences match the original platform.

const MULTIPLIER = 0x5deece66dn;
const MASK = (1n << 48n) - 1n;
let seedUniquifier = 8682522807148012n;

interface RandomPeer {
  seed: bigint;
}

function setSeed(peer: RandomPeer, seed: bigint) {
  peer.seed = (seed ^ MULTIPLIER) & MASK;
}

function nextBits(peer: RandomPeer, bits: number): number {
  peer.seed = (peer.seed * MULTIPLIER + 0xbn) & MASK;
  return Number(BigInt.asIntN(32, peer.seed >> BigInt(48 - bits)));
}

const rnd = (self: JObject) => self.n as RandomPeer;

const randomClass: NativeClassDef = {
  name: 'java/util/Random',
  methods: {
    '<init>()V': (_t, [self]) => {
      seedUniquifier = BigInt.asIntN(64, seedUniquifier * 181783497276652981n);
      self.n = { seed: 0n };
      setSeed(self.n, BigInt.asIntN(64, seedUniquifier ^ BigInt(Date.now()) ^ BigInt(Math.floor(performance.now() * 1000))));
    },
    '<init>(J)V': (_t, [self, seed]) => {
      self.n = { seed: 0n };
      setSeed(self.n, seed);
    },
    'setSeed(J)V': (_t, [self, seed]) => setSeed(rnd(self), seed),
    'nextInt()I': (_t, [self]) => nextBits(rnd(self), 32),
    'nextInt(I)I': (t, [self, bound]) => {
      if (bound <= 0) throw t.jvm.throwable('java/lang/IllegalArgumentException', 'n must be positive');
      const peer = rnd(self);
      if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(nextBits(peer, 31))) >> 31n);
      let bits: number;
      let val: number;
      do {
        bits = nextBits(peer, 31);
        val = bits % bound;
      } while (bits - val + (bound - 1) > INT_MAX);
      return val;
    },
    'nextLong()J': (_t, [self]) => {
      const peer = rnd(self);
      const hi = BigInt(nextBits(peer, 32));
      const lo = BigInt(nextBits(peer, 32));
      return BigInt.asIntN(64, (hi << 32n) + lo);
    },
    'nextFloat()F': (_t, [self]) => nextBits(rnd(self), 24) / (1 << 24),
    'nextDouble()D': (_t, [self]) => {
      const peer = rnd(self);
      return (nextBits(peer, 26) * 2 ** 27 + nextBits(peer, 27)) / 2 ** 53;
    },
    'nextBoolean()Z': (_t, [self]) => nextBits(rnd(self), 1) !== 0,
  },
};

// ---------------------------------------------------------------------------------------------------
// Vector / Stack / Enumeration

const vec = (self: JObject) => (self.n as { a: JRef[] }).a;
const vectorInit: NativeImpl = (_t, [self]) => {
  self.n = { a: [] };
};

function aioobe(t: JThread, index: number) {
  return t.jvm.throwable('java/lang/ArrayIndexOutOfBoundsException', String(index));
}

function indexOf(t: JThread, items: JRef[], value: JRef, from: number): number {
  for (let i = Math.max(0, from); i < items.length; i++) {
    if (value === null ? items[i] === null : javaEquals(t, value, items[i])) return i;
  }
  return -1;
}

export function newEnumeration(t: JThread, items: JRef[]): JObject {
  return newNativeObject(t.jvm, 'j2me/NativeEnumeration', { items, i: 0 });
}

const vectorClass: NativeClassDef = {
  name: 'java/util/Vector',
  methods: {
    '<init>()V': vectorInit,
    '<init>(I)V': vectorInit,
    '<init>(II)V': vectorInit,
    'size()I': (_t, [self]) => vec(self).length,
    'capacity()I': (_t, [self]) => Math.max(10, vec(self).length),
    'isEmpty()Z': (_t, [self]) => vec(self).length === 0,
    'addElement(Ljava/lang/Object;)V': (_t, [self, v]) => {
      vec(self).push(v);
    },
    'insertElementAt(Ljava/lang/Object;I)V': (t, [self, v, i]) => {
      const a = vec(self);
      if (i < 0 || i > a.length) throw aioobe(t, i);
      a.splice(i, 0, v);
    },
    'elementAt(I)Ljava/lang/Object;': (t, [self, i]) => {
      const a = vec(self);
      if (i < 0 || i >= a.length) throw aioobe(t, i);
      return a[i];
    },
    'setElementAt(Ljava/lang/Object;I)V': (t, [self, v, i]) => {
      const a = vec(self);
      if (i < 0 || i >= a.length) throw aioobe(t, i);
      a[i] = v;
    },
    'removeElementAt(I)V': (t, [self, i]) => {
      const a = vec(self);
      if (i < 0 || i >= a.length) throw aioobe(t, i);
      a.splice(i, 1);
    },
    'removeElement(Ljava/lang/Object;)Z': (t, [self, v]) => {
      const a = vec(self);
      const i = indexOf(t, a, v, 0);
      if (i < 0) return false;
      a.splice(i, 1);
      return true;
    },
    'removeAllElements()V': (_t, [self]) => {
      vec(self).length = 0;
    },
    'contains(Ljava/lang/Object;)Z': (t, [self, v]) => indexOf(t, vec(self), v, 0) >= 0,
    'indexOf(Ljava/lang/Object;)I': (t, [self, v]) => indexOf(t, vec(self), v, 0),
    'indexOf(Ljava/lang/Object;I)I': (t, [self, v, from]) => indexOf(t, vec(self), v, from),
    'lastIndexOf(Ljava/lang/Object;)I': (t, [self, v]) => {
      const a = vec(self);
      for (let i = a.length - 1; i >= 0; i--) if (v === null ? a[i] === null : javaEquals(t, v, a[i])) return i;
      return -1;
    },
    'firstElement()Ljava/lang/Object;': (t, [self]) => {
      const a = vec(self);
      if (!a.length) throw t.jvm.throwable('java/util/NoSuchElementException');
      return a[0];
    },
    'lastElement()Ljava/lang/Object;': (t, [self]) => {
      const a = vec(self);
      if (!a.length) throw t.jvm.throwable('java/util/NoSuchElementException');
      return a[a.length - 1];
    },
    'elements()Ljava/util/Enumeration;': (t, [self]) => newEnumeration(t, vec(self)),
    'copyInto([Ljava/lang/Object;)V': (t, [self, arr]) => {
      const a = vec(self);
      if (arr === null) throw t.jvm.npe();
      if (arr.d.length < a.length) throw aioobe(t, a.length);
      for (let i = 0; i < a.length; i++) (arr.d as JRef[])[i] = a[i];
    },
    'setSize(I)V': (t, [self, size]) => {
      if (size < 0) throw aioobe(t, size);
      const a = vec(self);
      const old = a.length;
      a.length = size;
      if (size > old) a.fill(null, old);
    },
    'ensureCapacity(I)V': () => {},
    'trimToSize()V': () => {},
    'toString()Ljava/lang/String;': (t, [self]) => `[${vec(self).map((v) => t.jvm.stringValueOf(t, v)).join(', ')}]`,
  },
};

const stackClass: NativeClassDef = {
  name: 'java/util/Stack',
  super: 'java/util/Vector',
  methods: {
    '<init>()V': vectorInit,
    'push(Ljava/lang/Object;)Ljava/lang/Object;': (_t, [self, v]) => {
      vec(self).push(v);
      return v;
    },
    'pop()Ljava/lang/Object;': (t, [self]) => {
      const a = vec(self);
      if (!a.length) throw t.jvm.throwable('java/util/EmptyStackException');
      return a.pop()!;
    },
    'peek()Ljava/lang/Object;': (t, [self]) => {
      const a = vec(self);
      if (!a.length) throw t.jvm.throwable('java/util/EmptyStackException');
      return a[a.length - 1];
    },
    'empty()Z': (_t, [self]) => vec(self).length === 0,
    'search(Ljava/lang/Object;)I': (t, [self, v]) => {
      const a = vec(self);
      for (let i = a.length - 1; i >= 0; i--) if (javaEquals(t, v, a[i])) return a.length - i;
      return -1;
    },
  },
};

const nativeEnumeration: NativeClassDef = {
  name: 'j2me/NativeEnumeration',
  interfaces: ['java/util/Enumeration'],
  methods: {
    'hasMoreElements()Z': (_t, [self]) => self.n.i < self.n.items.length,
    'nextElement()Ljava/lang/Object;': (t, [self]) => {
      if (self.n.i >= self.n.items.length) throw t.jvm.throwable('java/util/NoSuchElementException');
      return self.n.items[self.n.i++];
    },
  },
};

// ---------------------------------------------------------------------------------------------------
// Hashtable

interface Entry {
  key: JRef;
  value: JRef;
}

type Buckets = Map<number, Entry[]>;
const table = (self: JObject) => (self.n as { buckets: Buckets }).buckets;

function findEntry(t: JThread, buckets: Buckets, key: JRef): { bucket: Entry[] | undefined; index: number; hash: number } {
  if (key === null) throw t.jvm.npe();
  const hash = javaHashCode(t, key);
  const bucket = buckets.get(hash);
  const index = bucket ? bucket.findIndex((e) => e.key === key || javaEquals(t, key, e.key)) : -1;
  return { bucket, index, hash };
}

function allEntries(buckets: Buckets): Entry[] {
  return [...buckets.values()].flat();
}

const hashtableInit: NativeImpl = (_t, [self]) => {
  self.n = { buckets: new Map() };
};

const hashtableClass: NativeClassDef = {
  name: 'java/util/Hashtable',
  methods: {
    '<init>()V': hashtableInit,
    '<init>(I)V': hashtableInit,
    'put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;': (t, [self, key, value]) => {
      if (value === null) throw t.jvm.npe();
      const buckets = table(self);
      const { bucket, index, hash } = findEntry(t, buckets, key);
      if (bucket && index >= 0) {
        const old = bucket[index].value;
        bucket[index].value = value;
        return old;
      }
      if (bucket) bucket.push({ key, value });
      else buckets.set(hash, [{ key, value }]);
      return null;
    },
    'get(Ljava/lang/Object;)Ljava/lang/Object;': (t, [self, key]) => {
      const { bucket, index } = findEntry(t, table(self), key);
      return bucket && index >= 0 ? bucket[index].value : null;
    },
    'remove(Ljava/lang/Object;)Ljava/lang/Object;': (t, [self, key]) => {
      const buckets = table(self);
      const { bucket, index, hash } = findEntry(t, buckets, key);
      if (!bucket || index < 0) return null;
      const [removed] = bucket.splice(index, 1);
      if (!bucket.length) buckets.delete(hash);
      return removed.value;
    },
    'containsKey(Ljava/lang/Object;)Z': (t, [self, key]) => findEntry(t, table(self), key).index >= 0,
    'contains(Ljava/lang/Object;)Z': (t, [self, value]) => {
      if (value === null) throw t.jvm.npe();
      return allEntries(table(self)).some((e) => javaEquals(t, value, e.value));
    },
    'size()I': (_t, [self]) => allEntries(table(self)).length,
    'isEmpty()Z': (_t, [self]) => table(self).size === 0,
    'clear()V': (_t, [self]) => table(self).clear(),
    'keys()Ljava/util/Enumeration;': (t, [self]) => newEnumeration(t, allEntries(table(self)).map((e) => e.key)),
    'elements()Ljava/util/Enumeration;': (t, [self]) => newEnumeration(t, allEntries(table(self)).map((e) => e.value)),
    'rehash()V': () => {},
    'toString()Ljava/lang/String;': (t, [self]) =>
      `{${allEntries(table(self)).map((e) => `${t.jvm.stringValueOf(t, e.key)}=${t.jvm.stringValueOf(t, e.value)}`).join(', ')}}`,
  },
};

// ---------------------------------------------------------------------------------------------------
// Date, Timer

const dateClass: NativeClassDef = {
  name: 'java/util/Date',
  methods: {
    '<init>()V': (_t, [self]) => {
      self.n = BigInt(Date.now());
    },
    '<init>(J)V': (_t, [self, ms]) => {
      self.n = ms;
    },
    'getTime()J': (_t, [self]) => self.n,
    'setTime(J)V': (_t, [self, ms]) => {
      self.n = ms;
    },
    'equals(Ljava/lang/Object;)Z': (_t, [self, o]) => o instanceof JObject && o.cls === self.cls && o.n === self.n,
    'hashCode()I': (_t, [self]) => Number(BigInt.asIntN(32, self.n ^ (self.n >> 32n))),
    'toString()Ljava/lang/String;': (_t, [self]) => new Date(Number(self.n)).toString(),
  },
};

interface TimerTaskPeer {
  cancelled: boolean;
  handle: ReturnType<typeof setTimeout> | null;
  running: boolean;
  lastRun: bigint;
}

function scheduleTask(t: JThread, timer: JObject, task: JObject, delay: number, period: number, fixedRate: boolean) {
  const jvm = t.jvm;
  if (task === null) throw jvm.npe();
  if (delay < 0 || period < 0) throw jvm.throwable('java/lang/IllegalArgumentException');
  if (timer.n.cancelled) throw jvm.throwable('java/lang/IllegalStateException', 'Timer already cancelled.');
  const peer = task.n as TimerTaskPeer;
  if (peer.handle !== null || peer.cancelled) throw jvm.throwable('java/lang/IllegalStateException', 'Task already scheduled or cancelled');
  timer.n.tasks.add(task);
  let next = performance.now() + delay;

  const fire = () => {
    if (peer.cancelled || timer.n.cancelled || jvm.halted) return;
    jvm.postEvent((et) => {
      if (peer.cancelled || peer.running) return false;
      const run = jvm.findVirtual(task.cls, 'run()V');
      if (!run) return false;
      peer.running = true;
      peer.lastRun = BigInt(Date.now());
      jvm.pushCall(et, run, [task], () => {
        peer.running = false;
      });
      return true;
    });
    if (period > 0) {
      next = fixedRate ? next + period : performance.now() + period;
      peer.handle = setTimeout(fire, Math.max(0, next - performance.now()));
    } else {
      peer.handle = null;
      timer.n.tasks.delete(task);
    }
  };
  peer.handle = setTimeout(fire, delay);
}

const timerClass: NativeClassDef = {
  name: 'java/util/Timer',
  methods: {
    '<init>()V': (_t, [self]) => {
      self.n = { cancelled: false, tasks: new Set<JObject>() };
    },
    'schedule(Ljava/util/TimerTask;J)V': (t, [self, task, delay]) => scheduleTask(t, self, task, Number(delay), 0, false),
    'schedule(Ljava/util/TimerTask;JJ)V': (t, [self, task, delay, period]) => {
      if (period <= 0n) throw t.jvm.throwable('java/lang/IllegalArgumentException');
      scheduleTask(t, self, task, Number(delay), Number(period), false);
    },
    'scheduleAtFixedRate(Ljava/util/TimerTask;JJ)V': (t, [self, task, delay, period]) => {
      if (period <= 0n) throw t.jvm.throwable('java/lang/IllegalArgumentException');
      scheduleTask(t, self, task, Number(delay), Number(period), true);
    },
    'schedule(Ljava/util/TimerTask;Ljava/util/Date;)V': (t, [self, task, date]) =>
      scheduleTask(t, self, task, Math.max(0, Number(date.n) - Date.now()), 0, false),
    'cancel()V': (_t, [self]) => {
      self.n.cancelled = true;
      for (const task of self.n.tasks as Set<JObject>) {
        const peer = task.n as TimerTaskPeer;
        if (peer.handle !== null) clearTimeout(peer.handle);
        peer.handle = null;
      }
      self.n.tasks.clear();
    },
  },
};

const timerTaskClass: NativeClassDef = {
  name: 'java/util/TimerTask',
  interfaces: ['java/lang/Runnable'],
  flags: ACC_ABSTRACT,
  methods: {
    '<init>()V': (_t, [self]) => {
      self.n = { cancelled: false, handle: null, running: false, lastRun: 0n } satisfies TimerTaskPeer;
    },
    'cancel()Z': (_t, [self]) => {
      const peer = self.n as TimerTaskPeer;
      const wasScheduled = peer.handle !== null && !peer.cancelled;
      peer.cancelled = true;
      if (peer.handle !== null) clearTimeout(peer.handle);
      peer.handle = null;
      return wasScheduled;
    },
    'scheduledExecutionTime()J': (_t, [self]) => (self.n as TimerTaskPeer).lastRun,
  },
};

export const utilNatives: NativeClassDef[] = [
  randomClass,
  vectorClass,
  stackClass,
  { name: 'java/util/Enumeration', flags: ACC_INTERFACE | ACC_ABSTRACT },
  nativeEnumeration,
  hashtableClass,
  dateClass,
  timerClass,
  timerTaskClass,
];

export { JArray };
