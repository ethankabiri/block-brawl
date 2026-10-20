# Block Brawl

A 3D arena fighter for the browser (Three.js + TypeScript + Vite).

## Run
```
npm ci
npm run dev      # dev server
npm run build    # type-check + production build into dist/
```

## Controls
| | Player 1 | Player 2 |
|---|---|---|
| Move / jump / block | A D / W / S | ← → / ↑ / ↓ |
| Punch / kick / special | J / K / L | , / . / / |

Esc pauses. Touch buttons appear on touch devices. Chain punch → punch → kick; specials cost 50 meter.

Modes: Arcade ladder (5 fights, coins reward, unlock fighters), 2 players, Training. Progress saves in localStorage.

## Credits
See `public/models/CREDITS.md`.
