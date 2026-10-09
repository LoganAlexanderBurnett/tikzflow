// SPDX-License-Identifier: GPL-3.0-or-later
// Where the engine's files are served (D67): /engine/<tag>/ next to the app,
// for the release pinned in engine/release.json. `npm run fetch-engines`
// puts them in vendor/engine/<tag>/; the dev server and the build serve them.

import release from "../../engine/release.json";

/** The pinned engine release. */
export const ENGINE_RELEASE: string = release.tag;

/**
 * The URL of the engine's folder. `override` names another folder under
 * /engine/ (a CI run staged with scripts/stage-engine-ci.ts: `ci-<run id>`),
 * for development only.
 */
export function engineBase(override?: string | null): string {
  const folder = override && /^[\w.-]+$/.test(override) ? override : ENGINE_RELEASE;
  return new URL(`${import.meta.env.BASE_URL}engine/${folder}/`, location.href).href;
}
