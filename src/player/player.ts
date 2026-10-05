import { type JarFile, listMidlets, readJar } from '../jar/jar';
import { Jvm } from '../jvm/jvm';
import { allNatives } from '../jvm/natives';
import { decodePng, isPng } from '../gfx/png';
import type { KeyEventKind } from '../platform/display';
import { type LogLevel, Platform } from '../platform/platform';
import { type ScreenSize, detectScreenSize } from './detect';
import { type GamePreset, findPreset } from './presets';

export interface PlayerCallbacks {
  onLog?(level: LogLevel, message: string): void;
  onHalt?(reason: 'exit' | 'error', message?: string): void;
}

export interface MidletInfo {
  name: string;
  vendor: string;
  version: string;
  size: ScreenSize;
  iconDataUrl: string | null;
}

export function inspectJar(jar: JarFile, fileName: string): MidletInfo {
  const midlets = listMidlets(jar.manifest);
  const name = jar.manifest.get('MIDlet-Name') ?? midlets[0]?.name ?? fileName.replace(/\.jar$/i, '');
  const vendor = jar.manifest.get('MIDlet-Vendor') ?? '';
  return {
    name,
    vendor,
    version: jar.manifest.get('MIDlet-Version') ?? '',
    size: findPreset(name, vendor).screen ?? detectScreenSize(jar, fileName),
    iconDataUrl: extractIcon(jar, jar.manifest.get('MIDlet-Icon') ?? midlets[0]?.icon ?? ''),
  };
}

function extractIcon(jar: JarFile, path: string): string | null {
  const clean = path.trim().replace(/^\/+/, '');
  if (!clean) return null;
  const entry = [...jar.entries.entries()].find(([p]) => p.toLowerCase() === clean.toLowerCase());
  if (!entry || !isPng(entry[1])) return null;
  try {
    const img = decodePng(entry[1]);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** One running MIDlet: JAR + JVM + platform services + the canvas it draws to. */
export class GamePlayer {
  readonly jar: JarFile;
  readonly info: MidletInfo;
  readonly preset: GamePreset;
  readonly screen: HTMLCanvasElement;
  readonly jvm: Jvm;
  readonly platform: Platform;
  private readonly midletClass: string;
  private readonly screenCtx: CanvasRenderingContext2D;

  constructor(bytes: Uint8Array, fileName: string, callbacks: PlayerCallbacks = {}) {
    this.jar = readJar(bytes);
    const midlets = listMidlets(this.jar.manifest);
    if (!midlets.length) throw new Error('В манифесте JAR нет записи MIDlet-1 — это не J2ME-игра?');
    this.midletClass = midlets[0].className;
    this.info = inspectJar(this.jar, fileName);
    this.preset = findPreset(this.info.name, this.info.vendor);

    const { width, height } = this.info.size;
    this.screen = document.createElement('canvas');
    this.screen.width = width;
    this.screen.height = height;
    this.screen.className = 'screen';
    this.screenCtx = this.screen.getContext('2d', { alpha: false })!;
    this.screenCtx.imageSmoothingEnabled = false;
    this.screenCtx.fillStyle = '#000';
    this.screenCtx.fillRect(0, 0, width, height);

    const log = (level: LogLevel, message: string) => {
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(`[j2me] ${message}`);
      callbacks.onLog?.(level, message);
    };

    this.platform = new Platform({
      width,
      height,
      manifest: this.jar.manifest,
      resources: this.jar.entries,
      storageId: `${this.info.vendor}|${this.info.name}`,
      present: (surface) => this.screenCtx.drawImage(surface.canvas, 0, 0),
      vibrate: (ms) => {
        try {
          navigator.vibrate?.(ms);
        } catch {
          /* not supported */
        }
      },
      log,
      onExit: () => log('info', 'MIDlet exited'),
      locale: navigator.language,
    });
    this.jvm = new Jvm({ log, onHalt: (reason, message) => callbacks.onHalt?.(reason, message) }, this.jar.entries, allNatives);
    this.platform.attach(this.jvm);
  }

  start(): void {
    this.jvm.startMidlet(this.midletClass);
  }

  stop(): void {
    this.jvm.halt('exit');
  }

  key(kind: KeyEventKind, code: number): void {
    if (!this.jvm.halted) this.platform.display.postKey(kind, code);
  }
}
