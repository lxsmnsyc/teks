import { readTeksMessage } from '~/games/teks/protocol';
import type { GameEvent, GameServer, GameTable, Refusal } from '../types';
import { isRefusal } from '../types';
import { decide } from './bot';
import { Table } from './table';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** A thrown stack, as the room passes it on to everyone watching. */
function throwEvent(result: unknown): GameEvent {
  return { type: 'result', result } as GameEvent;
}

/** Teks, as the platform sees it: a table per room, and bots to fill seats. */
class TeksTable implements GameTable {
  private table = new Table();

  join(name: string) {
    return this.table.join(name);
  }

  disconnect(playerId: string): void {
    this.table.disconnect(playerId);
  }

  depart(playerId: string): void {
    this.table.depart(playerId);
  }

  async handle(
    playerId: string,
    raw: unknown,
  ): Promise<GameEvent | Refusal | undefined> {
    const read = readTeksMessage(raw);
    if (!read.ok) return { refused: read.reason };
    const outcome = await this.table.handle(playerId, read.message);
    if (isRefusal(outcome)) return outcome;
    return outcome ? throwEvent(outcome) : undefined;
  }

  view(playerId: string): unknown {
    return this.table.view(playerId);
  }

  hasPresentHuman(): boolean {
    return this.table.hasPresentHuman();
  }

  lobby() {
    return this.table.lobby();
  }

  async botTurn(announce: (event?: GameEvent) => void): Promise<boolean> {
    for (const playerId of this.table.botSeats()) {
      const steps = decide(this.table.view(playerId), playerId, Math.random);
      if (steps.length === 0) continue;

      for (const step of steps) {
        await wait(step.delay);
        const outcome = await this.table.handle(playerId, step.message);
        if (isRefusal(outcome)) break;
        announce(outcome ? throwEvent(outcome) : undefined);
      }
      return true;
    }

    // A decided round moves on by itself once it has been watched.
    const waiting = this.table.roundToMoveOn();
    if (waiting) {
      await wait(waiting.waitMs);
      if (this.table.moveOn(waiting.round)) {
        announce();
        return true;
      }
    }

    // Nobody left to press on with the round but the machine.
    if (!this.table.hasLiveHuman()) {
      const [first] = this.table.botSeats();
      if (first) {
        await wait(1400);
        const moved = await this.table.handle(first, { type: 'next' });
        if (!isRefusal(moved)) {
          announce();
          return true;
        }
      }
    }
    return false;
  }
}

export const teks: GameServer = {
  createTable: () => new TeksTable(),
};
