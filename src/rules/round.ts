import type { Face } from '~/sim/types';

/** The default bankroll every player starts a game with. */
export const STARTING_TEKS = 100;

/** The piece id used for the tiebreaker pamato. */
export const PANABLA_ID = 'panabla';
/** Which pamato the panabla is. Neutral, so it favours neither player. */
export const PANABLA_PAMATO = 'baraha';

export interface Player {
  id: string;
  name: string;
  teks: number;
  /**
   * Pamatos this player owns. A player starts with one and collects more by
   * winning them from players who could not pay.
   */
  pamatoIds: string[];
  /** Which of their pamatos they are throwing this round. */
  activePamatoId: string;
  eliminated: boolean;
}

/** One landed piece, ready to be judged. */
export interface LandedPiece {
  pieceId: string;
  /** Null for the panabla, which belongs to nobody. */
  ownerId: string | null;
  face: Face;
}

export interface Winner {
  playerId: string;
  pieceId: string;
}

export type RoundOutcome =
  | {
      kind: 'winner';
      /**
       * `unique` when a single piece was the odd one out, which is the throw
       * players are actually aiming for. `minority` when no piece was unique
       * but one side was still smaller than the other.
       */
      by: 'unique' | 'minority';
      face: Face;
      winners: Winner[];
    }
  | { kind: 'rethrow'; reason: string };

/**
 * Judges a throw.
 *
 * The rule players aim for is the odd face out: one piece different from every
 * other. When nobody manages that, the smaller of the two groups still wins
 * and splits the payout, which keeps rounds moving. With two faces and a
 * strict uniqueness rule the odds of a decisive throw collapse as players join
 * (about 68% at three players but only 24% at six), and a table of six would
 * spend most of its time watching throws that decided nothing.
 *
 * Only an exact even split, or every piece landing the same way up, sends the
 * round back for another throw.
 *
 * The panabla is judged alongside the rest but cannot win anything. When it is
 * itself the odd one out there is nobody to pay, so the round is thrown again.
 */
export function judgeRound(landed: LandedPiece[]): RoundOutcome {
  if (landed.length < 3) {
    return { kind: 'rethrow', reason: 'a round needs at least three pieces' };
  }

  const up = landed.filter(piece => piece.face === 'up');
  const down = landed.filter(piece => piece.face === 'down');

  if (up.length === 0 || down.length === 0) {
    return { kind: 'rethrow', reason: 'every piece landed the same way up' };
  }
  if (up.length === down.length) {
    return {
      kind: 'rethrow',
      reason: `dead even: ${up.length} up against ${down.length} down`,
    };
  }

  const smaller = up.length < down.length ? up : down;
  const owned = smaller.filter(piece => piece.ownerId !== null);
  if (owned.length === 0) {
    return {
      kind: 'rethrow',
      reason: 'the panabla was the odd one out, and it belongs to nobody',
    };
  }

  return {
    kind: 'winner',
    by: smaller.length === 1 ? 'unique' : 'minority',
    face: smaller[0].face,
    winners: owned.map(piece => ({
      playerId: piece.ownerId as string,
      pieceId: piece.pieceId,
    })),
  };
}

/** What one losing player ended up paying. */
export interface Payment {
  playerId: string;
  /** Teks actually handed over, which may be less than what was owed. */
  paid: number;
  owed: number;
  /** Pamatos surrendered because the player could not cover the debt. */
  surrenderedPamatoIds: string[];
  eliminated: boolean;
}

/** What one winning player collected. */
export interface Award {
  playerId: string;
  teks: number;
  pamatoIds: string[];
}

export interface Settlement {
  /** What each loser owed: the average wager across the winning side. */
  price: number;
  /** Teks collected from the losers in total. */
  collected: number;
  payments: Payment[];
  awards: Award[];
  /** Player states after the settlement, in the order they were given. */
  players: Player[];
}

/**
 * Splits a pot between winners in proportion to what they staked, using
 * largest-remainder so the parts add back up to the whole. Teks are whole
 * chips and none of them may quietly vanish in a division.
 */
function splitProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((run, weight) => run + weight, 0);
  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    const shares = weights.map(() => base);
    let left = total - base * weights.length;
    for (let i = 0; left > 0; i++, left--) shares[i % shares.length]++;
    return shares;
  }

  const exact = weights.map(weight => (total * weight) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((run, share) => run + share, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; left > 0; i++, left--)
    shares[order[i % order.length].index]++;
  return shares;
}

/**
 * Pays out a round.
 *
 * Every player outside the winning side owes the winners' average wager. When
 * one piece was the odd one out that is just the winner's own wager, which is
 * the rule in its plainest form; a split win only averages what the winning
 * side staked so a loser never pays more for facing two winners than one.
 *
 * A player who cannot cover it hands over every teks they hold and every
 * pamato they own, and is eliminated. So does a player it would leave with
 * nothing: a wager is at least one teks, so someone holding none could never
 * stake again, and a player still in the game with nothing staked would break
 * the next round they happened to win. Surrendered pamatos go to the winner who
 * collected the largest share, who may throw any one of them in later rounds.
 */
export function settleRound(
  players: Player[],
  winnerIds: string[],
  wagers: Record<string, number>,
): Settlement {
  if (winnerIds.length === 0) throw new Error('a round needs a winner');

  const next = players.map(player => ({
    ...player,
    pamatoIds: [...player.pamatoIds],
  }));

  const winners = winnerIds.map(id => {
    const found = next.find(player => player.id === id);
    if (!found) throw new Error(`unknown winner "${id}"`);
    return found;
  });

  const stakes = winnerIds.map(id => wagers[id] ?? 0);
  if (stakes.some(stake => stake <= 0)) {
    throw new Error('every winner must have staked a positive wager');
  }

  const price = Math.round(
    stakes.reduce((run, stake) => run + stake, 0) / stakes.length,
  );

  const payments: Payment[] = [];
  const forfeited: string[] = [];
  let collected = 0;

  for (const player of next) {
    if (winnerIds.includes(player.id) || player.eliminated) continue;

    // Covering it and having something left over, not just covering it.
    const canPay = player.teks > price;
    const paid = canPay ? price : player.teks;
    const surrenderedPamatoIds = canPay ? [] : player.pamatoIds;

    player.teks -= paid;
    collected += paid;

    if (!canPay) {
      player.pamatoIds = [];
      player.eliminated = true;
      forfeited.push(...surrenderedPamatoIds);
    }

    payments.push({
      playerId: player.id,
      paid,
      owed: price,
      surrenderedPamatoIds,
      eliminated: !canPay,
    });
  }

  const shares = splitProportionally(collected, stakes);
  const awards: Award[] = winners.map((winner, index) => {
    winner.teks += shares[index];
    return { playerId: winner.id, teks: shares[index], pamatoIds: [] };
  });

  if (forfeited.length > 0) {
    let best = 0;
    for (let i = 1; i < shares.length; i++) {
      if (shares[i] > shares[best]) best = i;
    }
    // Duplicates are dropped: owning the same pamato twice would mean nothing.
    const fresh = forfeited.filter(id => !winners[best].pamatoIds.includes(id));
    winners[best].pamatoIds.push(...fresh);
    awards[best].pamatoIds = fresh;
  }

  return { price, collected, payments, awards, players: next };
}

/**
 * The game is over once only one player is left holding teks. That player has
 * everyone else's stake, which is the same thing as having won them all.
 */
export function findGameWinner(players: Player[]): Player | undefined {
  const alive = players.filter(player => !player.eliminated);
  return alive.length === 1 ? alive[0] : undefined;
}

/** The most a player may stake this round. */
export function maxWager(player: Player): number {
  return Math.max(0, player.teks);
}

/**
 * Whether this round needs the panabla.
 *
 * Two pieces can never produce an odd one out, so a table down to its last two
 * players would never settle anything. The panabla is a third pamato belonging
 * to nobody, thrown with the others purely so there is something for the two
 * of them to differ from.
 */
export function needsPanabla(players: Player[]): boolean {
  return players.filter(player => !player.eliminated).length === 2;
}
