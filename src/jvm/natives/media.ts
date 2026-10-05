import type { Jvm, JThread, NativeClassDef } from '../jvm';
import { ACC_ABSTRACT, ACC_INTERFACE } from '../classfile';
import { JArray, JObject } from '../types';
import { newNativeObject } from './helpers';

/**
 * javax.microedition.media 桩实现。
 *
 * 上游 0.0.x 完全没有这个包：整个 src 里 media 只在 lang.ts 的异常类映射里出现过
 * 一次。任何调用 Manager/Player 的游戏都会拿到 NoClassDefFoundError（jvm.ts:162），
 * 如果游戏在 repaint 里重试就会变成异常风暴——这就是「勾选声音就卡死」的根因。
 *
 * 这里按 CLDC/MIDP 2.0 的类结构补齐类与方法的**签名**，让游戏能正常往下走：
 * 所有播放相关方法都是 no-op，getState() 永远返回 STARTED，也就是
 * 「假装正在播放，实际静音」。
 *
 * 状态常���（javax.microedition.media.Player）：
 *   REALIZED 4 / PREFETCHED 8 / STARTED 16 / CLOSED 32 / ERROR 0
 */

/** javax.microedition.media.Player 的状态常量（真实 MIDP 取值）。 */
const UNREALIZED = 100;
const REALIZED = 4;
const PREFETCHED = 8;
const STARTED = 16;
const CLOSED = 32;

const LOOP_INDEFINITE = -1;

/** 每个实例的播放状态；不落到 self.n 上的整数状态用 peer 对象存。 */
interface PlayerPeer {
  state: number;
  loopMode: number;
  loopCount: number;
}

/** 造一个「已在播放」的假 Player。 */
function newStartedPlayer(jvm: Jvm): JObject {
  return newNativeObject(jvm, 'javax/microedition/media/Player', {
    state: STARTED,
    loopMode: LOOP_INDEFINITE,
    loopCount: -1,
  } satisfies PlayerPeer);
}

function peerOf(self: JObject): PlayerPeer {
  if (self.n === undefined || self.n === null) self.n = { state: UNREALIZED, loopMode: LOOP_INDEFINITE, loopCount: -1 } satisfies PlayerPeer;
  return self.n as PlayerPeer;
}

/** 统一的状态迁移：CLOSED 之后任何播放调用都要抛 MediaException（符合 MIDP 语义）。 */
function enter(t: JThread, self: JObject, next: number): void {
  const p = peerOf(self);
  if (p.state === CLOSED) throw t.jvm.throwable('javax/microedition/media/MediaException', 'player is closed');
  p.state = next;
}

const mediaException: NativeClassDef = {
  name: 'javax/microedition/media/MediaException',
  super: 'java/lang/Exception',
};

const playerListener: NativeClassDef = {
  name: 'javax/microedition/media/PlayerListener',
  flags: ACC_ABSTRACT | ACC_INTERFACE,
};

/** javax.microedition.media.Control：所有控制器的基类（MIDP 2.0 里在 media 包下）。 */
const controlClass: NativeClassDef = {
  name: 'javax/microedition/media/Control',
  super: 'java/lang/Object',
};

/** Controllable：Player 实现的接口，暴露 getControl/getControls。 */
const controllableClass: NativeClassDef = {
  name: 'javax/microedition/media/Controllable',
  flags: ACC_ABSTRACT | ACC_INTERFACE,
  methods: {
    'getControl(Ljava/lang/String;)Ljavax/microedition/media/Control;': () => null,
    'getControls()[Ljavax/microedition/media/Control;': () => new JArray('[Ljavax/microedition/media/Control;', []),
  },
};

const volumeControlInterface: NativeClassDef = {
  name: 'javax/microedition/media/control/VolumeControl',
  interfaces: ['javax/microedition/media/Control'],
  flags: ACC_ABSTRACT | ACC_INTERFACE,
};

/**
 * 音量控制器的具体实现。游戏拿到 Player 后通常做
 *   player.getControl("VolumeControl") -> checkcast VolumeControl -> setLevel(x)
 * 三步，所以 getControl 必须返回一个真的 instanceof VolumeControl 的对象。
 */
const volumeControlImpl: NativeClassDef = {
  name: 'j2me/VolumeControlImpl',
  interfaces: ['javax/microedition/media/control/VolumeControl'],
  methods: {
    '<init>()V': () => {},
    'getLevel()I': (_t, [self]) => (self.n as number | undefined) ?? 100,
    'setLevel(I)I': (t, [self, level]) => {
      if (level < 0 || level > 100) throw t.jvm.throwable('java/lang/IllegalArgumentException', `level ${level}`);
      self.n = level;
      return level;
    },
    'isMute()Z': () => false,
    'setMute(Z)V': () => {},
  },
};

/** getControl("VolumeControl") 用的共享实例。 */
function newVolumeControl(t: JThread): JObject {
  return newNativeObject(t.jvm, 'j2me/VolumeControlImpl', 100);
}

const playerClass: NativeClassDef = {
  name: 'javax/microedition/media/Player',
  interfaces: ['javax/microedition/media/Controllable'],
  fields: {
    UNREALIZED: UNREALIZED,
    REALIZED,
    PREFETCHED,
    STARTED,
    CLOSED,
    ERROR: 0,
  },
  methods: {
    '<init>()V': () => {},
    // ---- 生命周期：全部一步到位视为成功 ----
    'realize()V': (t, [self]) => enter(t, self, REALIZED),
    'prefetch()V': (t, [self]) => enter(t, self, PREFETCHED),
    'prepare()V': (t, [self]) => enter(t, self, PREFETCHED),
    'start()V': (t, [self]) => enter(t, self, STARTED),
    'stop()V': (t, [self]) => enter(t, self, PREFETCHED),
    'close()V': (t, [self]) => {
      const p = peerOf(self);
      if (p.state === CLOSED) throw t.jvm.throwable('javax/microedition/media/MediaException', 'player already closed');
      p.state = CLOSED;
    },
    'release()V': (t, [self]) => {
      peerOf(self).state = CLOSED;
    },
    'reset()V': (t, [self]) => {
      peerOf(self).state = UNREALIZED;
    },
    'deallocate()V': () => {},

    // ---- 状态查询 ----
    'getState()I': (_t, [self]) => peerOf(self).state,
    'getLoopMode()I': (_t, [self]) => peerOf(self).loopMode,
    'getLoopCount()I': (_t, [self]) => peerOf(self).loopCount,
    'getDuration()I': () => -1,
    'getMediaType()Ljava/lang/String;': () => 'audio/midi',
    'getContentType(Ljava/lang/String;)Ljava/lang/String;': (_t, [, type]) => type,
    'getLongDuration()J': () => -1,

    // ---- 参数设置 ----
    'setLoopMode(I)V': (t, [self, mode]) => {
      peerOf(self).loopMode = mode;
    },
    'setLoopCount(I)V': (t, [self, count]) => {
      peerOf(self).loopCount = count;
    },
    'setPriority(I)V': () => {},
    'setMediaLocator(Ljavax/microedition/media/MediaLocator;)V': () => {},
    'getMediaLocator()Ljavax/microedition/media/MediaLocator;': () => null,
    // ★ 描述符必须和 jar 里的常量池逐字一致，否则 invokevirtual 找不到实现 → AbstractMethodError
    'getControl(Ljava/lang/String;)Ljavax/microedition/media/Control;': (t, [, name]) =>
      name === 'VolumeControl' ? newVolumeControl(t) : null,
    'getControls()[Ljavax/microedition/media/Control;': () => new JArray('[Ljavax/microedition/media/Control;', []),

    // ---- 监听器：只保留注册，事件不派发 ----
    'addPlayerListener(Ljavax/microedition/media/PlayerListener;)V': () => {},
    'removePlayerListener(Ljavax/microedition/media/PlayerListener;)V': () => {},

    // ---- 音量：真实 API 是控制器的，这里记下就行 ----
    'setVolume(I)V': () => {},
    'getVolume()I': () => 100,

    // ---- 常见扩展方法，部分老游戏会直接调 ----
    'setDataSource(Ljava/lang/String;)V': () => {},
    'getVideoCodecInfo()Ljava/lang/String;': () => null,
    'getVideoWidth()I': () => -1,
    'getVideoHeight()I': () => -1,
  },
};

const managerClass: NativeClassDef = {
  name: 'javax/microedition/media/Manager',
  statics: {
    // createPlayer(...) → 永远是「已就绪且在播放」的假 Player
    'createPlayer(Ljava/lang/String;)Ljavax/microedition/media/Player;': (t, [, url]) => {
      if (url === null) throw t.jvm.npe('url');
      return newStartedPlayer(t.jvm);
    },
    'createPlayer(Ljava/io/InputStream;Ljava/lang/String;)Ljavax/microedition/media/Player;': (t, [, stream]) => {
      if (stream === null) throw t.jvm.npe('stream');
      return newStartedPlayer(t.jvm);
    },
    'createPlayer(Ljava/io/InputStream;)Ljavax/microedition/media/Player;': (t, [, stream]) => {
      if (stream === null) throw t.jvm.npe('stream');
      return newStartedPlayer(t.jvm);
    },
    // MIDI 设备：老游戏常先问有没有 MIDI
    'getMidiSystem()Ljavax/microedition/media/spi/MidiSystem;': () => null,
    'getSupportedContentTypes(Ljava/lang/String;)[Ljava/lang/String;': () => new JArray('[Ljava/lang/String;', []),
    'getAudioInfo(Ljavax/microedition/media/AudioInfo;)V': () => {},
    'getSystemSound(Ljava/lang/String;)Ljavax/microedition/media/Player;': (t) => newStartedPlayer(t.jvm),
    'playTone(IILjava/io/InputStream;)V': () => {},
    'playTone(I)V': () => {},
    'getPlyBtnOrder()I': () => 0,
    'setPlyBtnOrder(I)V': () => {},
  },
};

const toneSequence: NativeClassDef = {
  name: 'javax/microedition/media/control/ToneSequence',
  methods: {
    '<init>([B)V': () => {},
    'getSequence()[B': () => null,
  },
};

const tonePlayerClass: NativeClassDef = {
  name: 'javax/microedition/media/TonePlayer',
  methods: {
    '<init>(Ljavax/microedition/media/control/ToneSequence;)V': () => {},
    'play()V': () => {},
    'stop()V': () => {},
  },
};

const midiDevice: NativeClassDef = {
  name: 'javax/microedition/media/spi/MidiDevice',
  methods: {
    'getChannels()I': () => 0,
    'isOpen()Z': () => false,
    'open()V': () => {},
    'close()V': () => {},
  },
};

/** javax.microedition.io.Connection：只补 close()，够「连接用完就关」的老代码。 */
const connectionClass: NativeClassDef = {
  name: 'javax/microedition/io/Connection',
  interfaces: ['javax/microedition/io/InputConnection'],
  flags: ACC_ABSTRACT | ACC_INTERFACE,
  methods: {
    'close()V': () => {},
  },
};

const inputConnectionClass: NativeClassDef = {
  name: 'javax/microedition/io/InputConnection',
  super: 'javax/microedition/io/Connection',
  flags: ACC_ABSTRACT | ACC_INTERFACE,
};

export const mediaNatives: NativeClassDef[] = [
  mediaException,
  playerListener,
  controlClass,
  controllableClass,
  volumeControlInterface,
  volumeControlImpl,
  inputConnectionClass,
  connectionClass,
  playerClass,
  managerClass,
  toneSequence,
  tonePlayerClass,
  midiDevice,
];
