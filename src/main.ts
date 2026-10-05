import { App } from './ui/app';
import './ui/styles.css';

const app = new App(document.getElementById('app')!);

async function boot() {
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('dev')) {
    const res = await fetch('/__dev/jar');
    if (res.ok) {
      app.play(new Uint8Array(await res.arrayBuffer()), 'dev.jar');
      return;
    }
    console.warn('Dev JAR not available:', await res.text());
  }
  await app.showLibrary();
}

void boot();
