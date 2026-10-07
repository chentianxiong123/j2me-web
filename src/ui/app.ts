import { readJar } from '../jar/jar';
import { GamepadInput } from '../player/gamepad';
import { InputManager } from '../player/input';
import { DEFAULT_KEYMAP, KEY_HELP, physicalCode } from '../player/keymap';
import { type GameSummary, deleteGame, gameId, listGames, loadGame, saveGame, touchGame } from '../player/library';
import { isPacked } from '../player/pack';
import { GamePlayer, inspectJar } from '../player/player';
import {
  applySaveFile,
  buildSaveFile,
  checkSameGame,
  downloadSaveFile,
  makeGameRef,
  parseSaveFile,
} from '../player/saveio';
import { h, toast } from './dom';
import { TouchControls } from './touch';

const TOUCH_PREF_KEY = 'j2me-web:touch-controls';

function prefersTouch(): boolean {
  try {
    const saved = localStorage.getItem(TOUCH_PREF_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    /* storage unavailable */
  }
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
}

export class App {
  private player: GamePlayer | null = null;
  /** 当前游戏的原始 jar 字节，导出存档时要用（JarFile 本身不保留原字节）。 */
  private currentJarBytes: Uint8Array = new Uint8Array();
  private teardown: Array<() => void> = [];

  constructor(private readonly root: HTMLElement) {}

  // ---------------------------------------------------------------------------------------------
  // Library

  async showLibrary(): Promise<void> {
    this.stopPlayer();
    const fileInput = h('input', {
      attrs: { type: 'file', accept: '.jar,application/java-archive', hidden: '' },
      on: {
        change: () => {
          const file = fileInput.files?.[0];
          if (file) void this.openFile(file);
          fileInput.value = '';
        },
      },
    });
    const dropzone = h(
      'div',
      { class: 'dropzone' },
      h('button', { class: 'btn primary', text: '打开 .jar', on: { click: () => fileInput.click() } }),
      h('div', { text: '或把游戏文件拖到这里' }),
      h('small', { text: '文件不会上传到服务器 —— 游戏和存档只保存在这个浏览器里。' }),
      fileInput,
    );
    for (const type of ['dragenter', 'dragover'] as const) {
      dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        dropzone.classList.add('over');
      });
    }
    for (const type of ['dragleave', 'drop'] as const) {
      dropzone.addEventListener(type, () => dropzone.classList.remove('over'));
    }
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.openFile(file);
    });

    const list = h('div', { class: 'games' });
    this.root.replaceChildren(
      h(
        'main',
        { class: 'library' },
        h(
          'header',
          { class: 'brand' },
          h('img', { attrs: { src: '/icon.svg', alt: '' } }),
          h('div', {}, h('h1', { text: 'J2ME Web Player' }), h('p', { text: '手机上的 Java 游戏（J2ME）—— 在电脑和手机浏览器里直接玩' })),
        ),
        dropzone,
        h('h2', { class: 'section-title', text: '我的游戏' }),
        list,
      ),
    );
    await this.renderGames(list);
  }

  private async renderGames(list: HTMLElement): Promise<void> {
    let games: GameSummary[] = [];
    try {
      games = await listGames();
    } catch {
      /* IndexedDB unavailable (private mode) */
    }
    if (!games.length) {
      list.replaceChildren(h('p', { class: 'empty', text: '这里还是空的。打开一个 .jar 文件，游戏就会出现在这里。' }));
      return;
    }
    list.replaceChildren(
      ...games.map((game) =>
        h(
          'article',
          { class: 'game' },
          h('div', { class: 'game-icon' }, game.iconDataUrl ? h('img', { attrs: { src: game.iconDataUrl, alt: '' } }) : '📱'),
          h('div', { class: 'game-meta' }, h('b', { text: game.name }), h('span', { text: game.vendor || game.fileName })),
          h(
            'div',
            { class: 'game-actions' },
            h('button', {
              class: 'btn icon danger',
              text: '✕',
              attrs: { title: '从列表中删除', 'aria-label': '删除' },
              on: {
                click: async () => {
                  await deleteGame(game.id);
                  await this.renderGames(list);
                },
              },
            }),
            h('button', { class: 'btn primary', text: '开始游戏', on: { click: () => void this.playStored(game.id) } }),
          ),
        ),
      ),
    );
  }

  private async openFile(file: File): Promise<void> {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const info = inspectJar(readJar(bytes), file.name);
      const id = await gameId(buffer);
      const existing = await loadGame(id).catch(() => undefined);
      await saveGame({
        id,
        fileName: file.name,
        name: info.name,
        vendor: info.vendor,
        size: bytes.length,
        addedAt: existing?.addedAt ?? Date.now(),
        lastPlayedAt: Date.now(),
        iconDataUrl: info.iconDataUrl,
        bytes: buffer,
      }).catch(() => undefined);
      this.play(bytes, file.name);
    } catch (e) {
      toast(`无法打开文件：${e instanceof Error ? e.message : e}`);
    }
  }

  private async playStored(id: string): Promise<void> {
    const record = await loadGame(id);
    if (!record) {
      toast('找不到游戏');
      return;
    }
    void touchGame(id);
    this.play(new Uint8Array(record.bytes), record.fileName);
  }

  // ---------------------------------------------------------------------------------------------
  // Player

  play(bytes: Uint8Array, fileName: string): void {
    this.stopPlayer();
    this.currentJarBytes = bytes;
    let player: GamePlayer;
    try {
      player = new GamePlayer(bytes, fileName, { onHalt: (reason, message) => this.showHalt(reason, message, bytes, fileName) });
    } catch (e) {
      toast(`无法启动游戏：${e instanceof Error ? e.message : e}`);
      return;
    }
    this.player = player;
    if (import.meta.env.DEV) (window as any).__player = player;

    const preset = player.preset;
    const input = new InputManager((kind, code) => player.key(kind, code), {
      repressHeldDirections: preset.repressHeldDirections ?? false,
      chords: preset.chords ?? [],
    });

    const stage = h('div', { class: 'player-stage' }, player.screen);
    const touch = new TouchControls(input, preset);
    stage.append(touch.keypad);

    const view = h('div', { class: 'player' });
    const setTouch = (on: boolean, remember: boolean) => {
      view.classList.toggle('touch', on);
      touchBtn.classList.toggle('active', on);
      if (!remember) return;
      try {
        localStorage.setItem(TOUCH_PREF_KEY, on ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    };
    const touchBtn = h('button', {
      class: 'btn icon',
      text: '🎮',
      attrs: { title: '屏幕按键', 'aria-label': '屏幕按键' },
      on: { click: () => setTouch(!view.classList.contains('touch'), true) },
    });
    const fullscreenBtn = h('button', {
      class: 'btn icon',
      text: '⛶',
      attrs: { title: '全屏', 'aria-label': '全屏' },
      on: {
        click: () => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => undefined);
        },
      },
    });

    view.append(
      h(
        'div',
        { class: 'player-bar' },
        // 打包模式下没有「游戏列表」可回退，渲染这个按钮只会跳到
        // 一个只能上传 jar 的空页面，纯属多余
        isPacked() ? null : h('button', { class: 'btn icon', text: '←', attrs: { title: '返回游戏列表', 'aria-label': '返回' }, on: { click: () => void this.showLibrary() } }),
        h('div', { class: 'player-title', text: player.info.name }),
        h('button', { class: 'btn icon', text: '⇅', attrs: { title: '存档导入导出', 'aria-label': '存档' }, on: { click: () => this.showSaveMenu(stage, player) } }),
        h('button', { class: 'btn icon', text: '⌨', attrs: { title: '操作说明', 'aria-label': '操作说明' }, on: { click: () => this.showKeys(stage, player) } }),
        touchBtn,
        fullscreenBtn,
      ),
      touch.left,
      stage,
      touch.right,
    );
    this.root.replaceChildren(view);
    touch.mount();
    setTouch(prefersTouch(), false);

    const gamepad = new GamepadInput(input, preset);
    this.teardown.push(() => touch.destroy(), () => gamepad.destroy());
    this.attachKeyboard(player, input);
    this.attachScaling(player, stage);
    // JPEG 像素必须在 MIDlet 启动前解码完（浏览器异步 vs MIDP 同步 API）。
    // 解码失败也不阻断启动：createImage 会退化成同尺寸白图。
    player
      .prepareImages()
      .catch((e) => console.warn('[j2me] JPEG 预解码失败：', e))
      .finally(() => player.start());
  }

  private stopPlayer(): void {
    for (const fn of this.teardown) fn();
    this.teardown = [];
    this.player?.stop();
    this.player = null;
  }

  private attachKeyboard(player: GamePlayer, input: InputManager): void {
    const keymap = { ...DEFAULT_KEYMAP, ...(player.preset.keys ?? {}) };
    const down = (e: KeyboardEvent) => {
      const physical = physicalCode(e);
      const code = keymap[physical];
      if (code === undefined || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      input.press(`kb:${physical}`, code);
    };
    const up = (e: KeyboardEvent) => {
      const physical = physicalCode(e);
      if (!input.isHeld(`kb:${physical}`)) return;
      e.preventDefault();
      input.release(`kb:${physical}`);
    };
    const releaseAll = () => input.releaseAll('kb:');
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    this.teardown.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
    });
  }

  private attachScaling(player: GamePlayer, stage: HTMLElement): void {
    const { width, height } = player.info.size;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const availW = Math.max(1, stage.clientWidth - 12);
      const availH = Math.max(1, stage.clientHeight - 12);
      const k = Math.floor(Math.min((availW * dpr) / width, (availH * dpr) / height));
      const scale = k >= 1 ? k / dpr : Math.min(availW / width, availH / height);
      player.screen.style.width = `${width * scale}px`;
      player.screen.style.height = `${height * scale}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    fit();
    this.teardown.push(() => observer.disconnect());
  }

  private showKeys(stage: HTMLElement, player: GamePlayer): void {
    const rows = [...(player.preset.keyHelp ?? []), ...KEY_HELP];
    const overlay = h(
      'div',
      { class: 'overlay', on: { click: (e: MouseEvent) => e.target === overlay && overlay.remove() } },
      h(
        'div',
        { class: 'overlay-card' },
        h('h2', { text: '操作说明' }),
        h('div', { class: 'keys' }, ...rows.flatMap(([key, action]) => [h('kbd', { text: key }), h('span', { text: action })])),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', text: '知道了', on: { click: () => overlay.remove() } })),
      ),
    );
    stage.append(overlay);
  }

  /**
   * 存档导入导出对话框。
   *
   * 导出是自包含的 `.jsav`：jar 本体 + RMS 全部 store + 触摸偏好，
   * 所以既能备份，也能把游戏连同进度一起发给别人。
   */
  private showSaveMenu(stage: HTMLElement, player: GamePlayer): void {
    let setStatus = (_text: string) => {};

    const doExport = () => {
      try {
        const game = makeGameRef(player.info.name, player.info.vendor, `${player.info.name}.jar`, this.currentJarBytes);
        const file = buildSaveFile(player.platform.rms, game, player.storageId);
        downloadSaveFile(file, game.fileName);
        const stores = Object.keys(file.rms).length;
        setStatus(`已导出 ${stores} 个记录库，导入这个文件即可恢复进度。`);
      } catch (e) {
        setStatus(`导出失败：${(e as Error).message}`);
      }
    };

    const doImport = async (file: File, overwrite: boolean) => {
      try {
        const parsed = parseSaveFile(await file.text());
        if (!checkSameGame(parsed, player.info.name, player.info.vendor)) {
          setStatus(`这个存档属于《${parsed.game.name}》（${parsed.game.vendor || '未知厂商'}），与当前游戏不同。已按你选择的方式处理。`);
        } else {
          setStatus('');
        }
        const { written, skipped } = applySaveFile(parsed, player.storageId, overwrite);
        setStatus(
          `导入完成：写入 ${written} 个记录库` + (skipped ? `，跳过 ${skipped} 个已存在的（没覆盖）` : '') +
          '。需要重启游戏才会生效。',
        );
      } catch (e) {
        setStatus(`导入失败：${(e as Error).message}`);
      }
    };

    const statusEl = h('div', { class: 'hint' });
    setStatus = (text: string) => {
      statusEl.textContent = text;
    };
    const fileInput = h('input', { attrs: { type: 'file', accept: '.jsav,application/json' } }) as HTMLInputElement;
    const overwriteInput = h('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void doImport(f, overwriteInput.checked);
    });

    const card = h(
      'div',
      { class: 'overlay-card' },
      h('h2', { text: '存档' }),
      h('p', { class: 'hint', text: '导出得到一个 .jsav 文件，含游戏本体和全部进度，可以自己留底，也可以发给同一个人直接玩。' }),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', text: '导出存档', on: { click: doExport } }),
        h('button', { class: 'btn', text: '导入存档…', on: { click: () => fileInput.click() } }),
      ),
      h(
        'label',
        { class: 'hint row' },
        overwriteInput,
        h('span', { text: '覆盖同名记录（默认只补空缺，保护当前进度）' }),
      ),
      fileInput,
      statusEl,
      h('div', { class: 'row' }, h('button', { class: 'btn', text: '关闭', on: { click: () => overlay.remove() } })),
    );

    const overlay = h(
      'div',
      { class: 'overlay', on: { click: (e: MouseEvent) => e.target === overlay && overlay.remove() } },
      card,
    );
    stage.append(overlay);
  }

  private showHalt(reason: 'exit' | 'error', message: string | undefined, bytes: Uint8Array, fileName: string): void {
    const stage = this.root.querySelector('.player-stage');
    if (!stage) return;
    stage.append(
      h(
        'div',
        { class: 'overlay' },
        h(
          'div',
          { class: 'overlay-card' },
          h('h2', { text: reason === 'exit' ? '游戏已关闭' : '游戏崩溃了' }),
          reason === 'error' && message ? h('pre', { text: message }) : null,
          h(
            'div',
            { class: 'row' },
            isPacked() ? null : h('button', { class: 'btn', text: '返回列表', on: { click: () => void this.showLibrary() } }),
            h('button', { class: 'btn primary', text: '重新启动', on: { click: () => this.play(bytes, fileName) } }),
          ),
        ),
      ),
    );
  }
}
