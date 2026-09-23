# Laro

Filipino games to play together in the browser. The first is Teks: players
stack their pamatos, one of them throws the stack, and the odd face out wins
the round.

See [DESIGN.md](./DESIGN.md) for the rules, the architecture and the open
questions.

## Status

A menu of games, rooms that anyone can host, and a whole game of Teks played
across them. There are no accounts: a player is a name typed on their device.
The server owns every game and simulates the throws, so no client decides
anything.

## Hosting

```sh
pnpm install
pnpm host      # builds the client, then serves everything on :8787
pnpm tunnel    # in another terminal: exposes it with cloudflared
```

Open the address, pick a game, put in a name and host a room. The room has a
six-character code and a link of its own, both shown in the lobby. Send the
link, or read the code out; anyone with either can sit down. A room can also
be made public when it is opened, which lists it under open lobbies on the
game's page for anyone to join.

Whoever opens the room is its host. Everyone picks a colour, the host sets the
starting teks and seats any bots, and the game begins when the host starts it.
Teks needs three players and seats six; joining closes once the game is under
way. To play alone, seat some bots from the lobby.

A reload or a dropped connection puts the player back in their seat. Leaving
on purpose gives the seat up in the lobby, or hands it to a bot mid-game, and
opening the room link again takes it back.

## Working on it

```sh
pnpm dev
```

One process on one port, the same as when hosting. In development the client
is compiled on demand by Vite running inside the server, so hot reloading works
without a second process or a proxy between them. Changes to anything under
`server/` need a restart; changes to the client do not.

Open http://localhost:8787 in a couple of browser windows, or one window and
some bots, to play both sides of a game.

The code is split into a platform, under `src/platform` and `server/rooms.ts`,
and one folder per game under `src/games` and `server/games`. DESIGN.md has the
steps for adding a game.

## Scripts

| Script             | What it does                                        |
| ------------------ | --------------------------------------------------- |
| `pnpm dev`         | Server with the client compiled on demand, on :8787 |
| `pnpm build`       | Production build                                    |
| `pnpm host`        | Build the client, then serve game and app on :8787  |
| `pnpm tunnel`      | Expose :8787 through a cloudflared quick tunnel     |
| `pnpm type-check`  | `tsgo --noEmit`                                     |
| `pnpm lint`        | oxlint, type-aware                                  |
| `pnpm format`      | oxfmt                                               |
| `pnpm sim:trials`  | Headless throw trials: fairness, stability, timing  |
| `pnpm game:trials` | Whole games between simulated players               |

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
