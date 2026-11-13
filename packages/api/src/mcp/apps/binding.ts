import { createHmac, timingSafeEqual } from 'crypto';
import type { MCPConnectionTarget, MCPOptions } from '../types';
import { getMCPAppToolsPublicationGeneration } from '../toolsChanged';

const BINDING_VERSION = 'v1';
const BINDING_KEY_DOMAIN = 'librechat:mcp-app:server-binding:v1';

export type MCPAppRuntimeTarget =
  | { type: 'stdio'; command: string; args: string[]; cwd: string | null; env: [string, string][] }
  | { type: string; url: string };

export interface MCPAppBindingSubject {
  userId: string;
  tenantId?: string | null;
  serverName: string;
  connectionTarget: MCPConnectionTarget;
  runtimeTarget: MCPAppRuntimeTarget;
}

export interface MCPAppBindingCodec {
  create(subject: MCPAppBindingSubject): string;
  verify(binding: string, subject: MCPAppBindingSubject): boolean;
}

/** Keeps routing identity while excluding live request headers and refreshable credentials. */
export function projectMCPAppRuntimeTarget(config: MCPOptions): MCPAppRuntimeTarget {
  if (config.type === 'stdio') {
    return {
      type: 'stdio',
      command: config.command,
      args: [...config.args],
      cwd: config.cwd ?? null,
      env: Object.entries(config.env ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    };
  }
  return { type: config.type, url: config.url };
}

/**
 * Fields an App binding never reads, dropped before placeholder resolution so
 * validating a persisted App cannot depend on a credential it does not inspect.
 *
 * `projectMCPAppRuntimeTarget` keeps only routing identity, but `processMCPEnv`
 * resolves every field it is handed, and `{{LIBRECHAT_OPENID_ACCESS_TOKEN}}` (or
 * its `{{LIBRECHAT_OPENID_TOKEN}}` alias) in a header raises
 * `OpenIDReauthRequiredError` when the request-time user snapshot carries a stale
 * access token. `validateAppBinding` never refreshes that snapshot, so once the
 * token expired every persisted App of a direct-bearer server failed to load,
 * although the App operations that follow refresh the bearer through
 * `resolveDirectOpenIDBearerConfig`. `buildMCPDomainValidationConfig` narrows the
 * domain check the same way.
 *
 * `url`, `args` and `env` are deliberately absent from this list: a runtime target
 * reads them, so an unresolvable placeholder there must keep failing closed.
 */
const UNREAD_BY_APP_BINDING = ['apiKey', 'headers', 'oauth', 'oauth_headers'] as const;

/**
 * Narrows a server config to what an App binding reads. Every other field is
 * preserved, including the `source` and `dbId` that decide which placeholders
 * `processMCPEnv` resolves at all. The argument is never mutated.
 */
export function buildMCPAppBindingConfig<T extends MCPOptions>(config: T): T {
  const bindingConfig: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  for (const field of UNREAD_BY_APP_BINDING) {
    delete bindingConfig[field];
  }
  return bindingConfig as unknown as T;
}

export function createMCPAppBindingCodec(secret: string): MCPAppBindingCodec {
  if (!secret) {
    throw new Error('JWT_SECRET is required to bind persisted MCP Apps');
  }
  const key = createHmac('sha256', secret).update(BINDING_KEY_DOMAIN).digest();
  const digest = (subject: MCPAppBindingSubject): string => {
    const payload = JSON.stringify({
      userId: subject.userId,
      tenantId: subject.tenantId ?? null,
      serverName: subject.serverName,
      connectionOwner: subject.connectionTarget.connectionOwner,
      configGeneration: getMCPAppToolsPublicationGeneration(subject.connectionTarget.serverConfig),
      runtimeTarget: subject.runtimeTarget,
    });
    return createHmac('sha256', key).update(payload).digest('base64url');
  };
  const create = (subject: MCPAppBindingSubject): string => `${BINDING_VERSION}.${digest(subject)}`;

  return {
    create,
    verify(binding, subject) {
      if (!binding.startsWith(`${BINDING_VERSION}.`)) {
        return false;
      }
      const actual = Buffer.from(binding);
      const expected = Buffer.from(create(subject));
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    },
  };
}
