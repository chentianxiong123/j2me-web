import { readJar } from '../jar/jar';
import { GamepadInput } from '../player/gamepad';
import { InputManager } from '../player/input';
import { DEFAULT_KEYMAP, KEY_HELP, physicalCode } from '../player/keymap';
import { type GameSummary, deleteGame, gameId, listGames, loadGame, saveGame, touchGame } from '../player/library';
import { GamePlayer, inspectJar } from '../player/player';
import { h, toast } from './dom';
import { TouchControls } from './touch';

const TOUCH_PREF_KEY = 'j2me-web-player:touch-controls';

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
      h('button', { class: 'btn primary', text: 'Открыть .jar', on: { click: () => fileInput.click() } }),
      h('div', { text: 'или перетащи файл игры сюда' }),
      h('small', { text: 'Файл не загружается на сервер — игра и сохранения остаются только в этом браузере.' }),
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
          h('div', {}, h('h1', { text: 'J2ME Web Player' }), h('p', { text: 'Java-игры с кнопочных телефонов — в браузере на ПК и телефоне' })),
        ),
        dropzone,
        h('h2', { class: 'section-title', text: 'Мои игры' }),
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
      list.replaceChildren(h('p', { class: 'empty', text: 'Пока пусто. Открой .jar-файл, и игра появится здесь.' }));
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
              attrs: { title: 'Удалить из списка', 'aria-label': 'Удалить' },
              on: {
                click: async () => {
                  await deleteGame(game.id);
                  await this.renderGames(list);
                },
              },
            }),
            h('button', { class: 'btn primary', text: 'Играть', on: { click: () => void this.playStored(game.id) } }),
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
      toast(`Не получилось открыть файл: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async playStored(id: string): Promise<void> {
    const record = await loadGame(id);
    if (!record) {
      toast('Игра не найдена');
      return;
    }
    void touchGame(id);
    this.play(new Uint8Array(record.bytes), record.fileName);
  }

  // ---------------------------------------------------------------------------------------------
  // Player

  play(bytes: Uint8Array, fileName: string): void {
    this.stopPlayer();
    let player: GamePlayer;
    try {
      player = new GamePlayer(bytes, fileName, { onHalt: (reason, message) => this.showHalt(reason, message, bytes, fileName) });
    } catch (e) {
      toast(`Не получилось запустить игру: ${e instanceof Error ? e.message : e}`);
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
      attrs: { title: 'Экранные кнопки', 'aria-label': 'Экранные кнопки' },
      on: { click: () => setTouch(!view.classList.contains('touch'), true) },
    });
    const fullscreenBtn = h('button', {
      class: 'btn icon',
      text: '⛶',
      attrs: { title: 'Полный экран', 'aria-label': 'Полный экран' },
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
        h('button', { class: 'btn icon', text: '←', attrs: { title: 'К списку игр', 'aria-label': 'Назад' }, on: { click: () => void this.showLibrary() } }),
        h('div', { class: 'player-title', text: player.info.name }),
        h('button', { class: 'btn icon', text: '⌨', attrs: { title: 'Управление', 'aria-label': 'Управление' }, on: { click: () => this.showKeys(stage, player) } }),
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
    player.start();
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
        h('h2', { text: 'Управление' }),
        h('div', { class: 'keys' }, ...rows.flatMap(([key, action]) => [h('kbd', { text: key }), h('span', { text: action })])),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Понятно', on: { click: () => overlay.remove() } })),
      ),
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
          h('h2', { text: reason === 'exit' ? 'Игра закрылась' : 'Игра упала' }),
          reason === 'error' && message ? h('pre', { text: message }) : null,
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn', text: 'К списку', on: { click: () => void this.showLibrary() } }),
            h('button', { class: 'btn primary', text: 'Запустить снова', on: { click: () => this.play(bytes, fileName) } }),
          ),
        ),
      ),
    );
  }
}
