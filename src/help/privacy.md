---
title: Privacy and offline use
description: What TikZFlow keeps on your computer, what it never sends anywhere, and how it works without a connection.
order: 12
---
# Privacy and offline use

## Nothing leaves your computer

- **No server, no account, no tracking.** TikZFlow is a set of static files. There is no analytics and no advertising, and the site loads nothing from other websites.
- **Your diagrams stay in your browser.** The code is kept in this browser's storage, and the TeX engine runs on your computer. Import, layout and export all happen in the page.
- **Share links** carry the code after the `#` in the address, which browsers never send to a server.
- **Report a problem** opens GitHub's issue form in a new tab. Nothing is sent from TikZFlow itself; you choose what to paste there.

Because nothing is stored on a server, nothing can be recovered from one either: see [Your work lives in this browser](saving.md#your-work-lives-in-this-browser).

## Working offline

After your first visit to the editor, TikZFlow works without a connection: the pages, the editor and the TeX engine are kept by your browser. The app bar says "Works offline" once everything is kept.

On a metered connection, or with data saving turned on, the engine's packages and fonts are kept only as your pictures use them, not all at once; the app bar then says "Offline: kept as used".

When a new version of TikZFlow is published, your browser picks it up on a later visit.

## Bookmarking

Bookmark [tikzflow.pages.dev/editor/](/editor/) to go straight to the editor. The home page offers **Continue your diagram** when this browser has work in progress.
