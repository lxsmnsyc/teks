# Teks — design notes

Teks is a multiplayer game for three or more players, built around one physical
act: a player stacks everyone's playing pieces, throws the stack, and the odd
face out wins the round.

This document records what has been decided, what is still open, and why the
code is shaped the way it is. It is the place to look before changing the
rules or the simulation.

## Vocabulary

- **Teks** are the chips players wager. Every player starts with 100.
- **A pamato** is a player's playing piece. Each player picks one in the lobby
  and keeps it for the whole game.
- **A piece** is a thin rectangular card with exactly two readable faces.
- **The launcher** is the player who throws the stack in a given round.

## The round

1. Every player wagers some of the teks they hold.
2. The launcher collects every pamato into a stack and orders it however they
   like.
3. The launcher sets up the throw in two stages. First they rotate the stack,
   between a quarter turn and three quarters of a turn from flat. Then they
   pick the spot on the floor they want it to come down on.
4. The stack is thrown and the physics decides where everything lands.
5. The piece whose face differs from every other piece wins the round for its
   owner.
6. Every other player pays the winner exactly what the winner wagered.

The launcher for the first round is random. After that it is whoever won the
previous round.

### No unique face

If no single piece is the odd one out, the smaller of the two face groups still
wins and splits the payout. Only an exact even split, or every piece landing
the same way up, sends the round back to the same launcher for another throw.

The odd face out is still the throw players aim for, and the payout is better
for winning alone. The minority rule exists because a strict uniqueness rule
makes decisive throws rare as players join.

### Paying up

A player who cannot cover what they owe pays every teks they hold, hands over
every pamato they own, and is eliminated. The game ends when one player is left
holding everything.

A forfeited pamato is not thrown. Everyone throws exactly one piece, always:
what a collected pamato gives its new owner is a choice, made once a round,
about which of their pamatos to throw. Winning pamatos widens the options
rather than multiplying the chances.

### The panabla

Two pieces can never produce an odd one out, so once the table is down to its
last two players a third pamato joins the throw. The panabla belongs to
nobody. It is there only so that the two players have something to differ
from.

It is judged alongside the rest but cannot win anything, so a throw where the
panabla is itself the odd one out settles nothing and is thrown again.

## What a pamato may do

A pamato changes how it flies and how it behaves once it is down. That is the
whole of it. No pamato touches teks, wagers, turn order, elimination or how a
face is read.

Every stat in `src/data/pamatos.ts` is a physical property handed to Rapier or
to the launch velocity. The subtlest is `comOffset`, which shifts the centre of
mass along the piece's own axis so it favours one resting face. The trials show
`tabingi` landing face up about 41% of the time against 50% for a neutral
piece: a real bias, produced by real physics, that never overrides what
actually happened on the table.

## Architecture

### The simulation is the source of truth

`src/sim` is pure. It imports no DOM, no three.js and no Solid, so the exact
same module runs in the browser for previews and on a server as the
authoritative judge of a round. `runThrow` takes the launcher's inputs and a
seed and returns the resting faces plus a recorded replay.

Clients replay the recorded frames. They never decide the faces themselves.
A throw takes about 5ms for cards and about 13ms for pogs, so judging rounds
server-side is cheap.

The seed is issued by the server rather than the client, so a launcher cannot
re-roll a throw they do not like.

### Layers

- `src/sim` — Rapier, pure, isomorphic, no rendering.
- `src/rules` — teks, wagers, payouts, elimination. Pure.
- `src/render` — three.js scene, piece meshes, replay, aim guide.
- `src/ui` — Solid components.
- `src/data` — the pamato roster.
- `scripts/sim-trials.ts` — headless fairness and stability trials.

### The ground has no edge

There is no wall around the playing area. A piece that came back off one would
have been turned around by something the launcher never aimed at, and a throw
that ends against a barrier reads as cheated even when the physics is honest.
A piece thrown too hard simply travels further than its owner meant it to,
which is the launcher's problem and a fair one.

What is marked out on the ground is the area worth aiming at, not a boundary.
Pieces land about a metre from where they were aimed on average, but without
walls they keep going: they come to rest a median 4.2m from the mark, 8.5m at
the ninety-ninth percentile, and occasionally much further with a bouncy
pamato. The camera therefore widens during the replay to hold every piece in
frame, easing rather than cutting, and returns to the close view when the next
throw is being set up. A round that finishes off the edge of the screen cannot
be read, which would matter more than the tidiness of a fixed camera.

### The shape of a piece

A piece is a bipyramid: a rectangular rim with no thickness at all, and a
shallow pyramid rising from it to an apex on each side, so its cross-section
is a triangle rather than a flat band.

The shape is there to take away a resting position. A piece with a flat edge
can land on that edge and stay there, leaving a round with no readable face.
A rim is a knife edge, so a thrown piece nearly always falls onto one face or
the other by itself: thrown on its own, with nothing to lean against, a piece
comes to rest unreadable 0.6% of the time.

Two things are worth knowing before anyone reshapes this.

Making the faces steeper does not help, and makes it slightly worse: at a 13.5
degree slope the unreadable rate doubles to 1.2%. Thin is better.

Most unreadable landings in a real round are not rim rests at all. Across
three-piece throws roughly 4% of rounds need a nudge, and the bulk of those are
pieces propped up against each other rather than balanced on an edge. That is
a different situation and the nudge is the right answer to it. When measuring
this, throw a single piece: with other pieces on the table the two causes are
mixed together and the numbers mislead.

### The throw

A throw is two choices, made in order.

**Stage one, the stack.** The launcher orders the pieces, turns any of them
over, and rotates the whole stack.

Rotation is read off a dial standing behind the throw, the way angles are read
on a protractor: zero lies flat to the right, a quarter turn points straight
up, a half turn lies flat to the left. The launcher works in the upper half of
that dial, between an eighth and three eighths of a full turn.

The angle describes the stack's **edge**, not the face of its pieces. At a
quarter turn the edge stands vertical, so the pieces are on edge and the stack
grows sideways rather than upward. The stack is centred on the throwing mark so
that rotating it leans it evenly either way instead of burying it in the
floor.

**Stage two, the target.** The launcher picks where on the floor they want the
stack to land. The speed and the elevation are solved from that, so the
launcher names an outcome rather than dialling in a number.

The throw is made from standing height, half the arena's width up, and is
always lofted to rise at least back to that height however near the target is.
A throw that leaves the hand already falling skims the ground, barely turns the
pieces over on the way, and reads as a slide rather than a throw.

The two stages are connected, which is the point of splitting them. The stack
is thrown along a plane rolled over by the same rotation it was given, so the
arc leans with the stack, and the stack spins about its own face like a thrown
disc, so that rotation is also the spin axis. A spinning disc is pushed
sideways by the air, which bends the flight further the same way.

The result is that the rotation shapes the arc without moving where it lands.
At a quarter turn the throw is a tall upright arc peaking around 0.95m. Rotated
to either end of the dial it flattens to about 0.65m and bows roughly 0.35m out
to the side, leaning the same way the stack leans, before coming back to the
target. Rotating the stack and shaping the throw are one decision.

### Spin, and what it costs

The pieces spin like thrown discs, about the axis running through their faces.
That is the look the game wants and it is what the simulation does.

It has a consequence worth writing down, because it is easy to rediscover the
hard way. A flat plate's face normal is its maximum-inertia axis, so spinning
about it is gyroscopically stable and the piece tends to keep the face it
launched with. Measured at the time the model was chosen, a disc-dominant throw
held its launch face between 78% and 99% of the time across every stack
rotation, bounce and ground roughness tried, and adding end-over-end tumble up
to 45 rad/s barely moved it.

In practice this means the way a launcher orients a piece in stage one carries
through to how it lands. The trials show it plainly: flipping only the bottom
piece of a three-piece stack takes that piece from winning about 13% of rounds
to winning about 60%. How much of that to leave in is a gameplay decision that
has not been taken yet, and it is tracked under the open questions.

### Physics notes worth keeping

These were all found by running trials rather than by reading the code, which
is why `pnpm sim:trials` exists.

- **Measure a throw through `runThrow`, not by stepping the world.** The
  sideways push from the spin is applied by the step loop inside `runThrow`, so
  a test harness that builds a world and calls `step` itself is simulating a
  different, liftless throw. Doing that suggested throws were overshooting
  their aim by a factor of two; through the real entry point the same throws
  land about a metre from where they were aimed.
- **The engine reports inertia as sorted eigenvalues.** `principalInertia` does
  not return components along the body's own axes; it returns sorted values
  paired with the frame they are measured in, from
  `principalInertiaLocalFrame`. Feeding the numbers back as x, y and z without
  that frame hands a card its smallest inertia about its longest axis, and it
  tumbles quite wrongly while still looking plausible.
- **Mass properties come from the shape, then get rescaled.** Setting a mass on
  a collider directly replaces the shape's mass properties outright and leaves
  the piece with no rotational inertia at all. The collider is built at a
  reference density so the engine derives the real tensor, which is then scaled
  to the mass the pamato is supposed to have.
- **The collider is given its triangles rather than a point cloud.** A rim of
  more than about sixteen coplanar points on a body millimetres thick is close
  enough to degenerate that convex hull building quietly returns a shape with
  no volume, no mass and no inertia, without reporting a failure. This is what
  ruled out round pieces; it is worth remembering if the shape is ever rounded
  off.
- **Launch is set as velocity, not impulse.** These pieces are thin plates with
  a very small moment of inertia. A torque impulse large enough to feel
  meaningful spun them at thousands of radians per second and they tunnelled
  through the floor. Spin rates are set directly instead, where 55 rad/s is a
  little under nine turns a second and is a number a person can reason about.
- **The arc preview shares the simulation's own integrator.** Because the
  flight is banked and bent by the spin it is not a parabola, so the preview
  cannot be drawn from a closed-form curve. `predictArc` steps the same forces
  at the same timestep, which keeps the drawn arc honest.
- **Lift is an acceleration and has to be scaled by the step.** Adding a fixed
  slice of the cross product every step instead gives the flight a little more
  speed each time, because the added part is square to the velocity. It
  compounds: at a strong setting the throw climbed to five metres and never
  came down.
- **The bank does not bend the flight; the spin does.** Rolling the plane the
  stack is thrown along produces no sideways bow at all, because a rolled
  parabola is still a parabola and the aim solver simply re-aims through it.
  All of the visible lean comes from the spin pushing against the air. What the
  bank does change is how much of the throw goes upward, so a rotated stack
  travels flatter. Its sign turns out not to matter either, for the same
  reason: only its magnitude survives the aim solve.
- **The spin axis is the face normal negated.** With the other sign the arc
  bows away from the way the stack is leaning, which reads as the throw
  disagreeing with the stack. This is the kind of thing that is invisible in
  the maths and obvious on screen, so it is worth measuring in the view's own
  frame: the camera looks down +Z, which puts world -X on the right of the
  screen and makes it easy to convince yourself of the wrong sign.
- **The aim is solved by Newton's method, not by nudging.** Moving the aim
  point by however far the throw missed converges at about two thirds a pass
  and falls apart once the flight curves hard. Solving instead for the heading
  and speed, from how the landing responds to each, lands within a millimetre
  in a handful of passes at any curve strength. Overshooting the simple version
  to speed it up was tried and diverges.
- **The settle assist.** Past a few hundred steps, damping ramps up until
  everything stops. A bouncy pamato on a slick floor, and a pog on its edge in
  particular, can otherwise keep moving for longer than any step ceiling.
- **Damping is written in steps, not every frame.** Writing damping on every
  step resets Rapier's sleep timer, so the pieces never sleep and every round
  ends on a timeout.
- **Escaped pieces are recovered.** If a piece ends up below the floor it is
  put back rather than allowed to fall forever. It should never fire now, and
  the trials report it if it does.

## Decisions worth re-reading

### Even player counts re-throw more, and that is accepted

The minority rule fixed odd player counts and does nothing for even ones, which
is obvious in hindsight: with an even number of pieces the common failure is an
exact even split, and an even split has no minority to award. Measured over 200
throws per count, cards, neutral pamatos:

| Players | Odd one out | Split win | Re-throw |
| ------- | ----------- | --------- | -------- |
| 3       | 65%         | n/a       | 35%      |
| 4       | 43%         | 0%        | 57%      |
| 5       | 38%         | 41%       | 22%      |
| 6       | 25%         | 36%       | 40%      |

Four players is the worst table at 57%, and four is a likely table size. A
positional tiebreak was considered and rejected: the physics records where every
piece came to rest, so the furthest or nearest piece could break a dead even
split for free. The rule stays pure instead. Only a genuinely odd face wins, and
an even split is thrown again.

What this costs is bounded and worth watching. A throw takes about 5ms to
simulate, so the re-throw itself is free; the cost is the replay. The replay
needs a skip control and should stay short, because at four players more than
half of all throws will end in another throw.

### The faces are not independent

Re-throw rates run consistently above what fair independent coins predict: 35%
against 25% at three players, 40% against 34% at six. The pieces are thrown as
one stack and land as a clump, so their faces are positively correlated. This
is realistic and probably desirable, and it is also why the odds should be read
off `pnpm sim:trials` rather than off a binomial.

## Open questions

### Games take far too long

`pnpm game:trials` plays whole games headlessly, and they do not finish.
Twelve games at each table size, with wagers picked at random between 1 and 25
against a bankroll of 100:

| Players | Reached a winner | Mean rounds |
| ------- | ---------------- | ----------- |
| 3       | 10 of 12         | 187         |
| 4       | 5 of 12          | 343         |
| 5       | 6 of 12          | 335         |
| 6       | 3 of 12          | 374         |

Nothing is broken: teks and pamatos are conserved exactly across every game,
and eliminations do happen. The problem is arithmetic. Two players with 100
teks each, trading wagers averaging 13 on a near even chance, are a random walk
that takes hundreds of rounds to reach zero, and close to half of all throws
settle nothing and have to be thrown again.

The endgame is also most of the game: at three players, 88% of rounds are
played with the panabla out, meaning two players grinding at each other.

The knobs are a smaller starting bankroll, a wager floor that climbs as the
game goes on the way blinds do, or wagers pegged to the shortest stack rather
than chosen freely. Which of those to turn is a gameplay decision and has not
been taken.

### How much the launcher should be able to decide

Because disc spin holds a piece's launch face, stage one is close to choosing
the result: flipping the bottom piece of a three-piece stack moves it from
winning about 13% of rounds to about 60%. The launcher rotates the stack and
turns pieces over, so the launcher has most of that leverage.

Whether that is a flaw or the skill of the game is not settled. It could be
left alone, damped by having the spin bleed off in flight, or removed by
deciding rounds on something other than the resting face.

### A player holding more than one pamato

The forfeit rule lets a winner collect a loser's pamato, so a player can throw
two pieces. `judgeRound` currently judges pieces, not players, which means such
a player gets two chances at being the odd one out and can also be their own
majority. Options are to count only one of their pieces, to treat their extra
pieces as obstacles that are thrown but not judged, or to leave the advantage
in as a reward. Not yet decided.

### Edge landings

A piece that comes to rest on its edge is nudged and allowed to settle again,
up to six times, and only then read as whichever side is closer to up. Pogs
roll and hit this far more often than cards do. It works, but it has not been
weighed against making an edge landing mean something in the rules.

## Networking

### One game, one tunnel, one code

There are no rooms and no lobby. A host runs the server, exposes it with
`cloudflared`, and hands out the link. Anyone who opens the link still has to
type the join code, which is printed in the host's terminal and nowhere else.

That is the whole of the access control, and it is meant to be. The game is
played among people who already know each other, and the alternative is an
account system nobody wants for a game of teks. Having the URL is not enough;
hearing the code is.

A seat is claimed by name. If someone's connection drops they keep their seat
and reclaim it by joining again with the same name, which matters because a
round in progress cannot simply carry on without them.

### The lobby

Nothing starts on its own. People arrive, choose a colour, and the host decides
when there are enough of them and what everyone is playing for.

The host is whoever sat down first, and the job passes on if they leave before
the game begins, so a table is never left with nobody able to start it. The
host sets the starting bankroll, seats and dismisses bots, and starts the game.
Colours are each player's own choice from a palette of six, and two players
cannot take the same one.

This screen exists because of a real failure. An earlier version started the
moment a third player sat down, which made a game of four or more impossible to
arrange: the third arrival closed the door on everyone still on their way, and
the reply they got was "the game has already started". It also left barely a
moment to seat a bot. The door now stays open until somebody says otherwise.

Joining still closes once the game is under way. Letting people in mid-game
means deciding what they start with and where their teks came from, which is a
rules question rather than a plumbing one.

### The client is built in start mode

The Solid plugin's start mode owns the client: it generates the entries and
serves the document shell, so there is no `index.html` and no mount file to
keep in step with them. `src/App.tsx` is the root component and
`src/Document.tsx` is the shell. SSR is left off, because there is nothing
worth rendering ahead of time in a canvas behind a join screen, and the build
is a static client as a result.

Worth being clear about, because it caused a wrong turn early on: start mode is
an option on `@solidjs/vite-plugin` and works with Solid 2.0. It is not the
`@solidjs/start` package, whose published version still depends on Solid 1.9.
Checking the package and concluding start was unavailable cost this project its
entry pipeline for several milestones.

Two consequences worth knowing. The plugin takes over the build once start mode
is on, so the game server and the trial scripts are built through their own
config that leaves the plugin out; none of that code contains JSX. And Vite is
put in `appType: 'custom'` when embedded, so it does not reach for the
`index.html` that no longer exists.

### One process

There is one server and one port, in development as well as when hosting. In
development Vite runs as middleware inside it and compiles the client on
demand, so hot reloading works without a second process and a proxy stitching
the two together. In production the same server hands out the built files.

Vite is loaded through a dynamic import that only runs in development, so it is
never pulled into the production bundle. The game socket is attached to the
HTTP server by hand rather than handed the server outright, because Vite is
also listening for upgrades on it for hot reloading: each side takes the
upgrades meant for it, matched on path, and leaves the rest alone.

### The server decides everything

The client holds no game state. It draws whatever table the server last
described and sends back what the person did: the wager they typed, the stack
they arranged, where they aimed. It never sends a result.

The throw is simulated on the server and the outcome is told to everyone. The
seed is issued there too, so a launcher cannot throw repeatedly until they like
what they get. A throw costs about 6ms to simulate, so there was never a reason
to do this anywhere else.

Everything arriving from a client is parsed against a valibot schema before it
is looked at, and then checked again against the game: a wager has to be a
whole number the player can actually cover, a tilt has to be inside the range
the dial allows, a stack has to contain exactly this round's pieces and no
others, and a message from someone who is not the launcher is refused whatever
it says. A client is a stranger on the far end of a public URL.

### Bots

A table can be filled with bots, which is how the game is played alone and how
it is tested. A bot is an ordinary seat with nobody on a socket, so nothing
would ever prompt it to act; the server looks for a bot whose move it is after
every change to the table and plays it out.

Three things are worth knowing about how they behave.

They pause between steps. A bot would otherwise wager, stack, aim and throw
inside a single frame, and the round would be over before anyone had read it.
The pause is for the people watching.

They play honestly. A bot stakes a slice of what it holds, builds a stack
without reading the physics, and throws somewhere reasonable. In particular it
does not exploit the fact that a piece tends to keep the face it was stacked
with, which a bot could do relentlessly and a person would find unbearable.

A table of nothing but bots does not start. Joining closes once a game is under
way, so a table that started by itself could never be joined, and seating three
bots from the command line would lock everyone out of their own game.

### The replay is held back

The server settles a round the moment the throw is simulated, but the people
watching have not seen it land yet. The client therefore keeps the result to
itself until the replay has finished running, and only then shows the faces and
the payout. The alternative is being told who won while the pieces are still in
the air.

### What was not built

An earlier plan had Supabase for realtime and a CRDT for shared player state.
Neither is here. A CRDT converges, it does not adjudicate, so it could never
have held the teks balances; and once a server exists to hold those, a plain
socket carries the rest. The CRDT would only have earned its place for state
where convergence is the right model and nobody can cheat by winning the race,
such as several people dragging the same stack at once, which is not how a
round works: only the launcher touches it.

## Roadmap

- **M1 — throw sandbox.** Done. Local, no network, no wagering. Build a stack,
  aim it, throw it, read the faces.
- **M2 — the round.** Done. Teks, wagers, payouts, elimination, game end, all
  local and hot-seat. A round runs wagers, then the stack, then the throw, then
  the payout.
- **M3 — over the tunnel.** Done. One hosted game, joined by link plus code.
  The server owns the game, runs the throw, and validates everything a client
  sends. Presence and turn ownership included.
- **M4 — hardening and hosting.** What M3 left: the host has no way to start,
  pause or reset a game except by restarting the process; a player who leaves
  mid-round stalls it, since nothing times them out; and the game lives only in
  memory, so a restart loses it. Deployment beyond a laptop and a tunnel also
  belongs here.
