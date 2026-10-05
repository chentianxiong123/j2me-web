import type { JThread, Jvm } from '../jvm/jvm';
import { commandForSoftKey } from '../jvm/natives/lcdui';
import { WAITING } from '../jvm/thread';
import { BLOCK, INVOKED, JObject, type JValue, type NativeResult } from '../jvm/types';
import { GraphicsPeer } from './graphics';
import { KEY_SOFT_LEFT, KEY_SOFT_RIGHT, gameActionOf } from './keys';
import type { Platform } from './platform';
import { type Surface, createSurface } from './surface';

export type KeyEventKind = 'pressed' | 'released' | 'repeated';
export type PointerEventKind = 'pressed' | 'released' | 'dragged';

export class DisplayService {
  current: JObject | null = null;
  readonly back: Surface;
  private displayObject: JObject | null = null;
  private graphics: JObject | null = null;
  private repaintPending = false;
  private paintQueued = false;
  private painting = false;
  /** Bitmask of game actions currently held / pressed since the last getKeyStates() (GameCanvas). */
  heldActions = 0;
  latchedActions = 0;

  constructor(private readonly platform: Platform) {
    this.back = createSurface(platform.config.width, platform.config.height, '#ffffff');
  }

  private get jvm(): Jvm {
    return this.platform.jvm;
  }

  get width(): number {
    return this.platform.config.width;
  }

  get height(): number {
    return this.platform.config.height;
  }

  isCanvas(obj: JObject | null): boolean {
    return obj !== null && this.jvm.isInstance(obj, 'javax/microedition/lcdui/Canvas');
  }

  displayFor(): JObject {
    if (!this.displayObject) {
      this.displayObject = new JObject(this.jvm.loadClass('javax/microedition/lcdui/Display'));
      this.displayObject.n = this;
    }
    return this.displayObject;
  }

  /** Graphics bound to the screen back buffer (reset before every paint). */
  screenGraphics(): JObject {
    if (!this.graphics) this.graphics = this.platform.newGraphics(this.back);
    (this.graphics.n as GraphicsPeer).reset();
    return this.graphics;
  }

  setCurrent(next: JObject | null): void {
    if (next === this.current) {
      if (next) this.requestRepaint();
      return;
    }
    const prev = this.current;
    this.current = next;
    if (prev && this.isCanvas(prev)) this.callLater(prev, 'hideNotify()V', []);
    if (next && this.isCanvas(next)) {
      this.callLater(next, 'showNotify()V', []);
      this.requestRepaint();
    } else if (next) {
      this.platform.config.log('warn', `Screen-based UI (${next.cls.name}) is not supported yet`);
    }
  }

  callLater(obj: JObject, key: string, args: JValue[]): void {
    const jvm = this.jvm;
    jvm.postEvent((t) => {
      const m = jvm.findVirtual(obj.cls, key);
      if (!m) return false;
      if (m.impl) {
        m.impl(t, [obj, ...args]);
        return false;
      }
      jvm.pushCall(t, m, [obj, ...args]);
      return true;
    });
  }

  requestRepaint(): void {
    this.repaintPending = true;
    if (this.paintQueued) return;
    this.paintQueued = true;
    this.jvm.postEvent((t) => {
      this.paintQueued = false;
      return this.startPaint(t);
    });
  }

  /** Pushes paint(Graphics) on `t`. Returns true when a Java frame was pushed. */
  private startPaint(t: JThread): boolean {
    if (!this.repaintPending || this.painting) return false;
    const canvas = this.current;
    this.repaintPending = false;
    if (!canvas || !this.isCanvas(canvas)) return false;
    const jvm = this.jvm;
    const paint = jvm.findVirtual(canvas.cls, 'paint(Ljavax/microedition/lcdui/Graphics;)V');
    if (!paint) return false;
    this.painting = true;
    jvm.pushCall(t, paint, [canvas, this.screenGraphics()], () => {
      this.painting = false;
      this.present();
      jvm.wake();
    });
    return paint.impl === null;
  }

  serviceRepaints(t: JThread): NativeResult {
    if (!this.repaintPending && !this.painting) return;
    if (t.isEventThread) {
      if (this.painting) return;
      return this.startPaint(t) ? INVOKED : undefined;
    }
    t.state = WAITING;
    t.condition = () => !this.repaintPending && !this.painting;
    this.jvm.wake();
    return BLOCK;
  }

  present(): void {
    this.platform.config.present(this.back);
  }

  postKey(kind: KeyEventKind, code: number): void {
    const action = gameActionOf(code);
    if (action) {
      const bit = 1 << action;
      if (kind === 'pressed') {
        this.heldActions |= bit;
        this.latchedActions |= bit;
      } else if (kind === 'released') {
        this.heldActions &= ~bit;
      }
    }
    const jvm = this.jvm;
    const current = this.current;
    if ((code === KEY_SOFT_LEFT || code === KEY_SOFT_RIGHT) && current) {
      const command = commandForSoftKey(current, code);
      if (command) {
        if (kind === 'pressed') {
          const listener = (current.n as { listener: JObject }).listener;
          jvm.postEvent((t) => {
            const m = jvm.findVirtual(listener.cls, 'commandAction(Ljavax/microedition/lcdui/Command;Ljavax/microedition/lcdui/Displayable;)V');
            if (!m || m.impl) return false;
            jvm.pushCall(t, m, [listener, command, current]);
            return true;
          });
        }
        return;
      }
    }
    const key = kind === 'pressed' ? 'keyPressed(I)V' : kind === 'released' ? 'keyReleased(I)V' : 'keyRepeated(I)V';
    jvm.postEvent((t) => {
      const canvas = this.current;
      if (!canvas || !this.isCanvas(canvas)) return false;
      const m = jvm.findVirtual(canvas.cls, key);
      if (!m || m.impl) return false;
      jvm.pushCall(t, m, [canvas, code]);
      return true;
    });
  }

  postPointer(kind: PointerEventKind, x: number, y: number): void {
    const jvm = this.jvm;
    const key = kind === 'pressed' ? 'pointerPressed(II)V' : kind === 'released' ? 'pointerReleased(II)V' : 'pointerDragged(II)V';
    jvm.postEvent((t) => {
      const canvas = this.current;
      if (!canvas || !this.isCanvas(canvas)) return false;
      const m = jvm.findVirtual(canvas.cls, key);
      if (!m || m.impl) return false;
      jvm.pushCall(t, m, [canvas, x, y]);
      return true;
    });
  }

  consumeKeyStates(): number {
    const states = this.heldActions | this.latchedActions;
    this.latchedActions = 0;
    return states;
  }
}
