import type { IUser } from '@librechat/data-schemas';
import type { ParsedServerConfig } from '../types';
import { buildMCPAppBindingConfig, projectMCPAppRuntimeTarget } from './binding';
import { OpenIDReauthRequiredError } from '~/utils/oidc';
import { processMCPEnv } from '~/utils/env';

/** What `openIdJwtStrategy` attaches from `req.session.openidTokens` without refreshing it. */
const staleOpenIDUser = (): Partial<IUser> =>
  ({
    id: 'user-1',
    provider: 'openid',
    openidId: 'oidc-sub-1',
    federatedTokens: {
      access_token: 'stale-access-token',
      expires_at: Math.floor(Date.now() / 1000) - 3600,
    },
  }) as Partial<IUser>;

/** `ParsedServerConfig` is a union by transport, so a test reads these through the union. */
const headersOf = (options: ParsedServerConfig): Record<string, string> | undefined =>
  (options as { headers?: Record<string, string> }).headers;

const yamlServer = (overrides: Record<string, unknown> = {}): ParsedServerConfig =>
  ({
    type: 'streamable-http',
    url: 'https://mcp.example.com/mcp',
    source: 'yaml',
    requiresOAuth: false,
    ...overrides,
  }) as ParsedServerConfig;

const httpTarget = { type: 'streamable-http', url: 'https://mcp.example.com/mcp' };

describe('buildMCPAppBindingConfig', () => {
  it('lets a stale OpenID snapshot resolve the target an Authorization placeholder blocked', () => {
    const config = yamlServer({
      headers: { Authorization: 'Bearer {{LIBRECHAT_OPENID_ACCESS_TOKEN}}' },
    });
    const user = staleOpenIDUser();

    /** The trap: a header no binding reads fails the whole resolution. */
    expect(() => processMCPEnv({ user, options: config })).toThrow(OpenIDReauthRequiredError);

    const resolved = processMCPEnv({ user, options: buildMCPAppBindingConfig(config) });
    expect(projectMCPAppRuntimeTarget(resolved)).toEqual(httpTarget);
  });

  it.each([
    ['headers', { headers: { 'X-Auth-Token': '{{LIBRECHAT_OPENID_ACCESS_TOKEN}}' } }],
    ['oauth_headers', { oauth_headers: { Authorization: 'Bearer {{LIBRECHAT_OPENID_TOKEN}}' } }],
    ['oauth', { oauth: { client_secret: '{{LIBRECHAT_OPENID_ACCESS_TOKEN}}' } }],
    [
      'apiKey',
      {
        apiKey: {
          source: 'admin',
          key: '{{LIBRECHAT_OPENID_ACCESS_TOKEN}}',
          authorization_type: 'bearer',
        },
      },
    ],
  ])(
    'drops a credential placeholder carried by %s, which no runtime target reads',
    (_field, overrides) => {
      const config = yamlServer(overrides);
      const user = staleOpenIDUser();

      expect(() => processMCPEnv({ user, options: config })).toThrow(OpenIDReauthRequiredError);
      const resolved = processMCPEnv({ user, options: buildMCPAppBindingConfig(config) });
      expect(projectMCPAppRuntimeTarget(resolved)).toEqual(httpTarget);
    },
  );

  it.each([
    ['url', { url: 'https://mcp.example.com/mcp/{{LIBRECHAT_OPENID_ACCESS_TOKEN}}' }],
    [
      'stdio args',
      {
        type: 'stdio',
        command: 'mcp-server',
        args: ['--token={{LIBRECHAT_OPENID_ACCESS_TOKEN}}'],
      },
    ],
    [
      'stdio env',
      {
        type: 'stdio',
        command: 'mcp-server',
        args: [],
        env: { UPSTREAM_TOKEN: '{{LIBRECHAT_OPENID_ACCESS_TOKEN}}' },
      },
    ],
  ])(
    'keeps failing closed when the %s a runtime target reads carries a placeholder',
    (_field, overrides) => {
      const config = yamlServer(overrides);

      expect(() =>
        processMCPEnv({ user: staleOpenIDUser(), options: buildMCPAppBindingConfig(config) }),
      ).toThrow(OpenIDReauthRequiredError);
    },
  );

  it('preserves every field resolution depends on, and mutates nothing', () => {
    const headers = { Authorization: 'Bearer {{LIBRECHAT_OPENID_TOKEN}}' };
    const config = yamlServer({ headers, dbId: 'server-1', source: 'user', consumeOnly: true });

    expect(buildMCPAppBindingConfig(config)).toEqual({
      type: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      source: 'user',
      requiresOAuth: false,
      dbId: 'server-1',
      consumeOnly: true,
    });
    /** The App operations still need the placeholder they know how to refresh. */
    expect(headersOf(config)).toBe(headers);
  });
});
