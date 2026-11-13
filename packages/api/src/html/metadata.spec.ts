import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Request, Response } from 'express';
import {
  APP_MANIFEST_FILE,
  readAppManifest,
  injectAppMetadata,
  createAppManifestHandler,
} from './metadata';

const SHELL =
  '<!doctype html><html lang="en-US"><head>' +
  '<meta\n      name="description"\n      content="LibreChat - An open source chat application"\n    />' +
  '<title>LibreChat</title></head><body><div id="root"></div></body></html>';

describe('injectAppMetadata', () => {
  it('writes the title and description into the shell', () => {
    const html = injectAppMetadata(SHELL, { title: 'Acme Chat', description: 'Ask Acme' });

    expect(html).toContain('<title>Acme Chat</title>');
    expect(html).toContain('content="Ask Acme"');
    expect(html).not.toContain('LibreChat');
  });

  it('keeps the build values when unset or blank', () => {
    expect(injectAppMetadata(SHELL, {})).toBe(SHELL);
    expect(injectAppMetadata(SHELL, { title: '  ', description: null })).toBe(SHELL);
  });

  it('changes only what is configured', () => {
    const html = injectAppMetadata(SHELL, { title: 'Acme Chat' });

    expect(html).toContain('<title>Acme Chat</title>');
    expect(html).toContain('content="LibreChat - An open source chat application"');
  });

  it('escapes markup and keeps replacement patterns literal', () => {
    const html = injectAppMetadata(SHELL, {
      title: '</title><script>alert(1)</script> $& $1',
      description: '"><script>alert(2)</script> $1',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain(
      '<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; $1</title>',
    );
    expect(html).toContain('content="&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt; $1"');
  });
});

describe('readAppManifest', () => {
  let dist: string;

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  });

  afterEach(() => {
    fs.rmSync(dist, { recursive: true, force: true });
  });

  const write = (content: string) => fs.writeFileSync(path.join(dist, APP_MANIFEST_FILE), content);

  it('renames the build manifest and keeps its other fields', () => {
    write(JSON.stringify({ name: 'LibreChat', short_name: 'LibreChat', display: 'standalone' }));

    const manifest = readAppManifest(dist, { title: 'Acme Chat', description: 'Ask Acme' });

    expect(JSON.parse(manifest ?? '')).toEqual({
      name: 'Acme Chat',
      short_name: 'Acme Chat',
      display: 'standalone',
      description: 'Ask Acme',
    });
  });

  it('returns null when nothing is configured', () => {
    write(JSON.stringify({ name: 'LibreChat' }));

    expect(readAppManifest(dist, {})).toBeNull();
    expect(readAppManifest(dist, { title: ' ' })).toBeNull();
  });

  it('returns null when the manifest is missing or not an object', () => {
    expect(readAppManifest(dist, { title: 'Acme Chat' })).toBeNull();

    write('[]');
    expect(readAppManifest(dist, { title: 'Acme Chat' })).toBeNull();

    write('{not json');
    expect(readAppManifest(dist, { title: 'Acme Chat' })).toBeNull();
  });

  it('serves the renamed manifest, and falls through when there is none', () => {
    write(JSON.stringify({ name: 'LibreChat' }));
    const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() };
    const next = jest.fn();

    createAppManifestHandler(dist, { title: 'Acme Chat' })(
      {} as Request,
      res as unknown as Response,
      next,
    );
    expect(res.type).toHaveBeenCalledWith('application/manifest+json');
    expect(JSON.parse(res.send.mock.calls[0][0])).toMatchObject({ name: 'Acme Chat' });
    expect(next).not.toHaveBeenCalled();

    createAppManifestHandler(dist, {})({} as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});
