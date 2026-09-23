# Teks

A multiplayer game of teks. Players stack their pamatos, one of them throws the
stack, and the odd face out wins the round.

See [DESIGN.md](./DESIGN.md) for the rules, the architecture and the open
questions.

## Status

Milestone 3: a whole game played over a tunnel. The host runs the server and
shares the link; anyone who opens it needs the join code to sit down. The
server owns the game and simulates the throws, so no client decides anything.

## Hosting a game

```sh
pnpm install
pnpm host      # builds the client, then serves game and app on :8787
pnpm tunnel    # in another terminal: exposes it with cloudflared
```

Starting the server prints the code and two links:

```
  Join code   KSXCDP
  Open        http://localhost:8787/?code=KSXCDP
  Or share    http://localhost:8787  and read the code out
```

The first link fills the code in for you, which is what you want when testing
on your own machine. The second is the careful one: sharing it on its own means
the code still has to be passed on separately. The code is also shown in the
lobby once you are seated, so you can read it out from there.

Set your own with `JOIN_CODE=TEKS01 pnpm host`, which saves looking it up every
restart while working on the game.

The first person to sit down is the host. Everyone picks a colour, the host
sets the starting teks and seats any bots, and the game begins when the host
starts it. Three players are needed and six can play; joining closes once the
game is under way.

To play alone, seat some bots from the lobby. `BOTS=2 pnpm server` seats them
up front instead.

## Working on it

```sh
JOIN_CODE=TEKS01 pnpm dev
```

One process on one port, the same as when hosting. In development the client
is compiled on demand by Vite running inside the server, so hot reloading works
without a second process or a proxy between them. Changes to anything under
`server/` need a restart; changes to the client do not.

Open http://localhost:8787/?code=TEKS01 in a couple of browser windows, or one
window and some bots, to play both sides of a game.

## Scripts

| Script            | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Vite dev server on port 3000                       |
| `pnpm build`      | Production build                                   |
| `pnpm host`       | Build the client, then serve game and app on :8787 |
| `pnpm tunnel`     | Expose :8787 through a cloudflared quick tunnel    |
| `pnpm type-check` | `tsgo --noEmit`                                    |
| `pnpm lint`       | oxlint, type-aware                                 |
| `pnpm format`     | oxfmt                                              |
| `pnpm sim:trials` | Headless throw trials: fairness, stability, timing |

`pnpm sim:trials` is the one worth knowing about. It runs hundreds of throws
without a browser and reports how often a throw produced a winner, how often a
piece landed on its edge, whether anything failed to settle, and how close each
stack position is to an even split. Every physics bug so far was found there
rather than by watching a single throw.

Set `RUNS` to change the sample size:

```sh
RUNS=1000 pnpm sim:trials
```

## Stack

Solid 2.0 with Vite 8 and TypeScript 7, three.js for rendering and Rapier for
physics, linted with oxlint and formatted with oxfmt.

The client runs in the Solid plugin's start mode, so the entries and the
document shell are generated: there is no `index.html` and no `main.tsx`, and
`src/App.tsx` is the root component with `src/Document.tsx` as the shell.

Note that start mode is an option on `@solidjs/vite-plugin`, which is Solid 2.0
native. It is not the `@solidjs/start` package, whose published version still
depends on Solid 1.9.
