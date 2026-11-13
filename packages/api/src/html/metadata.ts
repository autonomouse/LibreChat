import fs from 'fs';
import path from 'path';
import { logger } from '@librechat/data-schemas';
import type { RequestHandler } from 'express';
import { escapeHtmlAttribute } from '~/security/html';

/** The web-app manifest vite-plugin-pwa emits beside `index.html`. */
export const APP_MANIFEST_FILE = 'manifest.webmanifest';

/** What a deployment calls itself: `APP_TITLE` and `APP_DESCRIPTION`. */
export interface AppMetadata {
  title?: string | null;
  description?: string | null;
}

const TITLE = /<title>[^<]*<\/title>/i;
const DESCRIPTION = /(<meta\s+name="description"\s+content=")[^"]*(")/i;

function configured(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Writes the deployment's title and description into the HTML shell.
 *
 * The client renames the tab from `/api/config` only after its scripts run, so
 * anything that reads the raw HTML (link previews, crawlers, the tab before
 * boot) saw the build's "LibreChat". An unset or blank value keeps the build's.
 */
export const injectAppMetadata = (html: string, metadata: AppMetadata): string => {
  const title = configured(metadata.title);
  const description = configured(metadata.description);
  let shell = html;
  if (title != null) {
    shell = shell.replace(TITLE, () => `<title>${escapeHtmlAttribute(title)}</title>`);
  }
  if (description != null) {
    shell = shell.replace(
      DESCRIPTION,
      (_match, open: string, close: string) => `${open}${escapeHtmlAttribute(description)}${close}`,
    );
  }
  return shell;
};

/**
 * The build's web-app manifest renamed for the deployment, or `null` when there
 * is nothing to rename or no manifest to serve, in which case the static file
 * (if any) is served as built. An installed web app takes its name from here.
 */
export function readAppManifest(distPath: string, metadata: AppMetadata): string | null {
  const title = configured(metadata.title);
  const description = configured(metadata.description);
  if (title == null && description == null) {
    return null;
  }

  const file = path.join(distPath, APP_MANIFEST_FILE);
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      logger.warn(`[AppMetadata] Ignoring ${file}: it does not hold an object`);
      return null;
    }
    return JSON.stringify({
      ...manifest,
      ...(title != null && { name: title, short_name: title }),
      ...(description != null && { description }),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`[AppMetadata] Ignoring unreadable ${file}`, error);
    }
    return null;
  }
}

/**
 * Serves the renamed manifest ahead of the static file. Falls through when
 * there is nothing to rename, so the build's manifest is served as before.
 */
export function createAppManifestHandler(distPath: string, metadata: AppMetadata): RequestHandler {
  const manifest = readAppManifest(distPath, metadata);
  return (_req, res, next) => {
    if (manifest == null) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('application/manifest+json');
    res.send(manifest);
  };
}
