# Visual directions (M5 step 1, D89)

Static mockups of three candidate looks for the home page and the editor, shown to the owner as
screenshots at the step 1 checkpoint. Nothing here is used by the app.

- `index.html?d=a|b|c&view=home|editor|board&theme=light|dark` draws one view of one direction.
- `mock.ts` builds the views; `base.css` lays them out from tokens; `a.css`, `b.css` and `c.css`
  hold each direction's tokens, fonts and the few rules that differ.
- The template thumbnails are hand-drawn placeholders. The real ones will be compiled by the engine.
- `node spike/design/shoot.ts` (with `npm run dev` running) saves the screenshots to `spike/design/shots/`.

The fonts are self-hosted OFL-1.1 packages from Fontsource, installed for the mockups only:

```
npm install --no-save @fontsource/source-serif-4@5.3.1 @fontsource/source-sans-3@5.3.1 @fontsource/source-code-pro@5.3.1 @fontsource/ibm-plex-sans@5.3.0 @fontsource/ibm-plex-mono@5.3.0 @fontsource/space-grotesk@5.3.0 @fontsource/atkinson-hyperlegible-next@5.3.0 @fontsource/jetbrains-mono@5.3.0
```
