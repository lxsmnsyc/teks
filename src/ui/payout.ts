import { getPamato } from '~/data/pamatos';
import type { Settlement } from '~/rules/round';

/** How long one tek takes to cross the table, in milliseconds. */
const FLIGHT = 1000;
/** Gap between teks leaving, so a payment reads as a stream. */
const STAGGER = 90;
/**
 * How far below the player boxes a tek dips on its way across, in pixels.
 * The boxes sit in a row, so a tek going straight across would travel
 * behind the numbers it is changing and never be seen.
 */
const DIP = 110;
/** Most teks drawn for a single payment, however large it is. */
const MOST_DRAWN = 7;

function centreOf(element: HTMLElement, layer: HTMLElement) {
  const box = element.getBoundingClientRect();
  const origin = layer.getBoundingClientRect();
  return {
    x: box.left - origin.left + box.width / 2,
    y: box.top - origin.top + box.height / 2,
  };
}

/** Just under a player's box, where a label will not cover what is in it. */
function belowOf(element: HTMLElement, layer: HTMLElement) {
  const box = element.getBoundingClientRect();
  const origin = layer.getBoundingClientRect();
  return {
    x: box.left - origin.left + box.width / 2,
    y: box.bottom - origin.top,
  };
}

/** A few teks for a small payment, more for a large one, never a flood. */
function drawnFor(teks: number): number {
  if (teks <= 0) return 0;
  return Math.min(MOST_DRAWN, Math.max(1, Math.round(Math.sqrt(teks))));
}

/** Pops a label onto the lower edge of a player's box, then fades it. */
function callout(
  layer: HTMLElement,
  at: { x: number; y: number },
  text: string,
  kind: 'paid' | 'won',
  delay: number,
): void {
  const label = document.createElement('span');
  label.className = 'callout';
  label.dataset.kind = kind;
  label.textContent = text;
  label.style.left = `${at.x}px`;
  label.style.top = `${at.y}px`;
  layer.append(label);
  label
    .animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.6)' },
        {
          opacity: 1,
          transform: 'translate(-50%, -50%) scale(1.12)',
          offset: 0.12,
        },
        {
          opacity: 1,
          transform: 'translate(-50%, -50%) scale(1)',
          offset: 0.22,
        },
        {
          opacity: 1,
          transform: 'translate(-50%, -50%) scale(1)',
          offset: 0.85,
        },
        { opacity: 0, transform: 'translate(-50%, -80%) scale(1)' },
      ],
      { duration: 2200, delay, easing: 'ease-out', fill: 'backwards' },
    )
    .finished.then(
      () => label.remove(),
      () => label.remove(),
    );
}

/**
 * Sends the teks of a settled round across the screen: teks leave each
 * player who paid and land on the players who won, split between winners the
 * way the pot itself was split.
 *
 * Returns how long the whole thing takes, in milliseconds, so the caller can
 * run the counters for the same length of time.
 */
export function flyTeks(
  layer: HTMLElement,
  settlement: Settlement,
  anchorOf: (playerId: string) => HTMLElement | undefined,
): number {
  const winners = settlement.awards.filter(award => award.teks > 0);
  if (winners.length === 0) return 0;

  const drawnCount = settlement.payments.reduce(
    (sum, payment) => sum + drawnFor(payment.paid),
    0,
  );

  // Hand teks to winners in proportion to what each was awarded.
  const totalAwarded = winners.reduce((sum, award) => sum + award.teks, 0);
  const credit = new Map(winners.map(award => [award.playerId, 0]));
  const nextWinner = (): string => {
    let pick = winners[0].playerId;
    let owed = -Infinity;
    for (const award of winners) {
      const share = award.teks / totalAwarded;
      const due = share - (credit.get(award.playerId) ?? 0);
      if (due > owed) {
        owed = due;
        pick = award.playerId;
      }
    }
    credit.set(pick, (credit.get(pick) ?? 0) + 1 / Math.max(1, drawnCount));
    return pick;
  };

  let launched = 0;
  for (const payment of settlement.payments) {
    const from = anchorOf(payment.playerId);
    if (!from || payment.paid <= 0) continue;
    const start = centreOf(from, layer);

    callout(
      layer,
      belowOf(from, layer),
      payment.eliminated ? `−${payment.paid} · out` : `−${payment.paid}`,
      'paid',
      launched * STAGGER,
    );

    for (let i = 0; i < drawnFor(payment.paid); i++) {
      const to = anchorOf(nextWinner());
      if (!to) continue;
      const end = centreOf(to, layer);
      const low =
        Math.max(start.y, end.y) + DIP + Math.abs(end.x - start.x) * 0.12;
      // Teks from one payer fan out a little, so a stream reads as several.
      const spread = (i - (drawnFor(payment.paid) - 1) / 2) * 10;
      // Each one tumbles as it goes, the way a thrown piece does, turning the
      // way it is travelling.
      const turn = (end.x >= start.x ? 1 : -1) * (360 + i * 45);

      const tek = document.createElement('span');
      tek.className = 'tek flying';
      layer.append(tek);
      tek
        .animate(
          [
            {
              transform: `translate(${start.x}px, ${start.y}px) rotate(0deg) scale(0.4)`,
              opacity: 0,
            },
            {
              transform: `translate(${start.x + spread}px, ${start.y + 40}px) rotate(${turn * 0.2}deg) scale(1)`,
              opacity: 1,
              offset: 0.15,
            },
            {
              transform: `translate(${(start.x + end.x) / 2 + spread}px, ${low}px) rotate(${turn * 0.55}deg) scale(1.2)`,
              opacity: 1,
              offset: 0.5,
            },
            {
              transform: `translate(${end.x}px, ${end.y + 30}px) rotate(${turn * 0.9}deg) scale(1)`,
              opacity: 1,
              offset: 0.88,
            },
            {
              transform: `translate(${end.x}px, ${end.y}px) rotate(${turn}deg) scale(0.5)`,
              opacity: 0,
            },
          ],
          {
            duration: FLIGHT,
            delay: launched * STAGGER,
            easing: 'ease-in-out',
            fill: 'backwards',
          },
        )
        .finished.then(
          () => tek.remove(),
          () => tek.remove(),
        );
      launched += 1;
    }
  }

  const total = Math.max(0, launched - 1) * STAGGER + FLIGHT;

  for (const award of winners) {
    const at = anchorOf(award.playerId);
    if (!at) continue;
    const pamatos = award.pamatoIds.map(id => getPamato(id).name);
    callout(
      layer,
      belowOf(at, layer),
      pamatos.length > 0
        ? `+${award.teks} · ${pamatos.join(', ')}`
        : `+${award.teks}`,
      'won',
      total - 200,
    );
  }

  return total;
}
