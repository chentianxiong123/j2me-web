import { base64FromBytes } from '../jvm/natives/helpers';
import type { RmsService } from '../platform/rms';

/**
 * 存档导入导出。
 *
 * 导出产物是一个自包含的 `.jsav` 文件（JSON）：
 * 游戏 jar + RMS 全部 record store + 少量偏好设置。
 * 这样既能备份存档，也���把游戏连同进度一起发给朋友。
 */

const FORMAT = 'j2me-web-save';
const FORMAT_VERSION = 1;
const RMS_PREFIX = 'j2me-web:rms:';
const TOUCH_PREF_KEY = 'j2me-web:touch-controls';

export interface SaveFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  game: {
    name: string;
    vendor: string;
    fileName: string;
    jarBase64: string;
  };
  /** store 名 -> RmsService 里存的原始 JSON 字符串 */
  rms: Record<string, string>;
  prefs: Record<string, string>;
}

export interface ImportResult {
  game: SaveFile['game'];
  rms: Record<string, string>;
  prefs: Record<string, string>;
  /** 是否是同一个游戏；false 时调用方应提醒用户存档可能不兼容 */
  sameGame: boolean;
}

function storageIdOf(name: string, vendor: string): string {
  return `${vendor}|${name}`;
}

/** 从 localStorage 里收集这个游戏的所有 RMS store 原始字符串。 */
function collectRms(storageId: string): Record<string, string> {
  const prefix = RMS_PREFIX + storageId + ':';
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (raw !== null) out[key.slice(prefix.length)] = raw;
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

/**
 * 导出成一个可下载的 `.jsav` 文件。
 *
 * 走 rms 服务（而不是直接扫 localStorage）是有意的：
 * 它同时覆盖 localStorage 和 RmsService 的内存回退层，
 * 而内存回退层可能还没落盘。
 */
export function buildSaveFile(rms: RmsService, game: SaveFile['game'], storageId: string): SaveFile {
  const rmsData = { ...collectRms(storageId) };
  // 内存里还没落盘的 store 也要算进去
  for (const [name, raw] of Object.entries(rms.exportAll())) rmsData[name] ??= raw;
  const rmsDataFinal = rmsData;
  // prefs 用真实的 localStorage 键名，导入时才能原样写回去
  const prefs: Record<string, string> = {};
  try {
    const touch = localStorage.getItem(TOUCH_PREF_KEY);
    if (touch !== null) prefs[TOUCH_PREF_KEY] = touch;
  } catch {
    /* storage unavailable */
  }
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: Date.now(),
    game,
    rms: rmsDataFinal,
    prefs,
  };
}

export function saveFileToBlob(file: SaveFile): Blob {
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** 触发浏览器下载。文件名带时间戳，方便区分多次导出。 */
export function downloadSaveFile(file: SaveFile, fileName: string): void {
  const stamp = new Date(file.exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tag = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  const url = URL.createObjectURL(saveFileToBlob(file));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName.replace(/\.jar$/i, '')}-存档-${tag}.jsav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 解析上传的文本，校验格式与版本。 */
export function parseSaveFile(text: string): SaveFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const f = parsed as Partial<SaveFile>;
  if (f?.format !== FORMAT) throw new Error('不是 j2me-web 存档文件');
  if (typeof f.version !== 'number' || f.version > FORMAT_VERSION) {
    throw new Error(`存档版本 ${f.version} 比当前程序（${FORMAT_VERSION}）新，可能来自更新的版本`);
  }
  if (!f.game?.jarBase64 || typeof f.game.jarBase64 !== 'string') throw new Error('存档里没有游戏本体');
  if (f.rms != null && typeof f.rms !== 'object') throw new Error('存档的 rms 字段损坏');
  return {
    format: FORMAT,
    version: f.version,
    exportedAt: f.exportedAt ?? 0,
    game: f.game,
    rms: f.rms ?? {},
    prefs: f.prefs ?? {},
  };
}

/**
 * 把存档写回 localStorage。
 *
 * overwrite=false 时不动已有 store，只补缺失的——避免误覆盖用户正在玩的进度。
 * 偏好设置总是覆盖，因为它们与进度无关且用户刚主动导入了。
 */
export function applySaveFile(file: SaveFile, storageId: string, overwrite: boolean): { written: number; skipped: number } {
  const prefix = RMS_PREFIX + storageId + ':';
  let written = 0;
  let skipped = 0;
  for (const [name, raw] of Object.entries(file.rms)) {
    const key = prefix + name;
    if (!overwrite) {
      try {
        if (localStorage.getItem(key) !== null) {
          skipped += 1;
          continue;
        }
      } catch {
        /* storage unavailable */
      }
    }
    try {
      localStorage.setItem(key, raw);
      written += 1;
    } catch {
      /* quota exceeded or storage unavailable */
    }
  }
  for (const [k, v] of Object.entries(file.prefs)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  }
  return { written, skipped };
}

/** 导入前的兼容性判断，供 UI 提示用。 */
export function checkSameGame(file: SaveFile, name: string, vendor: string): boolean {
  return file.game.name === name && file.game.vendor === vendor;
}

/** jar 字节，供导入后直接开玩。 */
export function jarBytesOf(file: SaveFile): Uint8Array {
  const bin = atob(file.game.jarBase64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function makeGameRef(name: string, vendor: string, fileName: string, bytes: Uint8Array): SaveFile['game'] {
  return { name, vendor, fileName, jarBase64: base64FromBytes(bytes) };
}

export { storageIdOf };