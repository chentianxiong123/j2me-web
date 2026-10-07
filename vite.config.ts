import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // Relative base so the built app works from a subdirectory
    // (github.io/<repo>, a /games/j2me/ path, or a plain file server).
    base: './',
    build: { target: 'es2022' },
    plugins: [
      {
        // Dev only: serves a local .jar (path from J2ME_DEV_JAR in .env.local) so the player
        // can autoload it with ?dev. Nothing from here ends up in the production build.
        name: 'j2me-dev-jar',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/__dev/jar', (_req, res) => {
            const jarPath = env.J2ME_DEV_JAR;
            if (!jarPath || !fs.existsSync(jarPath)) {
              res.statusCode = 404;
              res.end('Set J2ME_DEV_JAR in .env.local');
              return;
            }
            res.setHeader('Content-Type', 'application/java-archive');
            fs.createReadStream(jarPath).pipe(res);
          });
        },
      },
    ],
  };
});
