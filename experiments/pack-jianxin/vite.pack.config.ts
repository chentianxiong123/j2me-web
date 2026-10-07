import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * 打包构建：把一个 .jar 内嵌进产物，打开页面直接进游戏。
 *
 * 用法：
 *   npx vite build --config experiments/pack-jianxin/vite.pack.config.ts
 *
 * 与正式构建（vite.config.ts）的区别只有两点：
 *   1. 注入 window.__PACK__（jar 的 base64 + 身份标识）
 *   2. index.html 的标题/描述换成游戏名
 *
 * 正式构建不注入任何东西，主程序的「上传 jar」库界面行为完全不变。
 */

interface PackConfig {
  game: { name: string; title?: string; description?: string; jar: string };
  identity?: { storageId?: string; databaseName?: string };
  embed?: { mode?: 'inline' };
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'pack.config.json'), 'utf8')) as PackConfig;

const jarPath = path.resolve(HERE, cfg.game.jar);
if (!fs.existsSync(jarPath)) throw new Error(`jar not found: ${jarPath}（检查 pack.config.json 的 game.jar）`);

const jarBase64 = fs.readFileSync(jarPath).toString('base64');
const jarMiB = (fs.statSync(jarPath).size / 1024 / 1024).toFixed(2);

export default defineConfig({
  // 相对 base：产物能丢到 /repo/、/games/xxx/ 等任意子目录
  base: './',
  root: ROOT,
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: path.join(HERE, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(ROOT, 'index.html'),
      output: {
        // 固定文件名：单游戏包不需要 hash，也方便部署后手动检查版本
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [
    {
      name: 'j2me-pack-embed',
      // 改一下 index.html 里的 title / description / favicon
      transformIndexHtml(html) {
        const iconPath = path.join(ROOT, 'public/icon.svg');
        const favicon = fs.existsSync(iconPath)
          ? `<link rel="icon" href="./icon.svg" type="image/svg+xml" />`
          : '';
        const cleaned = html
          .replace(/<link rel="icon"[^>]*>/, favicon)
          .replace(/<title>[^<]*<\/title>/, `<title>${cfg.game.title ?? cfg.game.name}</title>`)
          .replace(
            /(<meta name="description" content=")[^"]*(")/,
            `$1${cfg.game.description ?? cfg.game.name}$2`,
          );
        return { html: cleaned, tags: [] };
      },
      // 注入运行时常量
      transform(code, id) {
        if (!id.endsWith('main.ts')) return null;
        const payload = {
          game: { name: cfg.game.name, fileName: path.basename(jarPath), jarBase64 },
          identity: {
            storageId: cfg.identity?.storageId,
            databaseName: cfg.identity?.databaseName,
          },
          title: cfg.game.title ?? cfg.game.name,
          description: cfg.game.description,
        };
        // 注意两点：
// 1. 注入代码必须是纯 JS，不能带 TS 语法（比如 as any），
//    否则 transform 阶段会被当成 JS 解析而报错。
// 2. 挂在 main.ts 的模块顶部。ESM 里模块体内的代码按书写顺序执行，
//    而 boot() 是在文件末尾调用的——如果把赋值拼在代码尾部
//    （transform 返回 code 的常规做法），赋值会晚于 boot() 执行，
//    读到的还是 undefined，于是错误地回退到库界面。
//    放模块顶部才能保证「赋值先于 boot()」。
return {
          code: [
            `// ---- 打包注入（构建期生成，勿手改）----`,
            `window.__PACK__ = ${JSON.stringify(payload)};`,
            code,
          ].join('\n'),
          map: null,
        };
      },
      configResolved() {
        console.log(
          `\n  打包模式：${cfg.game.name}\n  jar: ${jarPath} (${jarMiB} MB)` +
            `\n  以 base64 内嵌，约 ${(jarBase64.length / 1024 / 1024).toFixed(2)} MB\n` +
            `  storageId: ${cfg.identity?.storageId ?? '(从 jar 清单推导)'}\n` +
            `  database:  ${cfg.identity?.databaseName ?? '(默认 j2me-web)'}\n`,
        );
      },
    },
  ],
});