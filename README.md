# J2ME Web Player

Run classic Java ME (MIDP) phone games in the browser, on desktop and mobile, from your own `.jar` file.

- **Your files stay yours.** The player ships no games. You open a `.jar` you own; it is stored only in your browser (IndexedDB), together with the game's saves (localStorage).
- **The original game runs as-is.** A small JVM written in TypeScript interprets the MIDlet's bytecode and implements the CLDC / MIDP APIs on top of HTML canvas, so levels and mechanics behave like on the phone.
- **Made for today's devices.** Keyboard, gamepad and on-screen touch controls, pixel-perfect integer scaling and fullscreen.

## Features

- CLDC 1.1 / MIDP 2.0 subset: `lcdui` (Canvas, GameCanvas, Graphics, Image, Font, Command), RMS, threads, monitors, `java.io`, `java.util`
- Vendor APIs: Samsung (`AudioClip`, `Vibration`, `LCDLight`)
- Screen size detection from JAD/manifest hints, file name or the game's graphics
- Input fixes for old games that only track one key at a time: held directions are re-sent after another key is released, and optional key chords (e.g. direction + jump → diagonal jump)
- Per-game compatibility presets (screen size, key bindings, touch buttons)

Not yet supported: sound playback (MMF/MIDI/MP3), form-based UIs (`Form`, `List`, `Alert`), 3D APIs (M3G, Mascot Capsule), Nokia UI API.

## Controls

| Keyboard | Phone |
| --- | --- |
| Arrows | Joystick |
| Enter / Space | Center key |
| F1 or Q / F2 or E | Left / right soft key |
| 0–9, − / = | Digits, `*` / `#` |
| Backspace | Clear |

Gamepads use the standard mapping (d-pad / left stick, A = center key, shoulders = soft keys). On touch screens a d-pad, action buttons and a numeric keypad appear under the game.

## Development

```bash
npm install
npm run dev
```

To autoload a local game while developing, put its path into `.env.local` (git-ignored) and open `http://localhost:5173/?dev`:

```
J2ME_DEV_JAR=C:\path\to\game.jar
```

Tools:

- `npm run refs -- game.jar` lists the platform classes and methods a game uses
- `npm run javap -- game.jar ClassName [method]` disassembles bytecode

## License

MIT
