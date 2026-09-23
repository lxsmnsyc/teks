import type { JSX } from '@solidjs/web';
import { HydrationScript } from '@solidjs/web';

/**
 * The document the app is served inside.
 *
 * This replaces the hand-written `index.html`. The client entry is generated
 * by the Solid plugin's start mode and injected here, so there is no entry
 * file to keep in step with it either.
 *
 * The hydration script does nothing in client mode and is stripped from what
 * is served; it is kept so that turning SSR on later is a one-line change
 * rather than a rewrite of this file.
 */
export default function Document(props: { children: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Teks</title>
        <meta
          name="description"
          content="A multiplayer game of teks. Stack the pamatos, pick a trajectory, and win the round with the odd face out."
        />
        {/*
          A rounded display face for numbers and headings, which is most of
          what makes the table read as a game. Every use falls back to a
          system face, so the page still works if these never arrive.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossorigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@600;800&display=swap"
        />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
