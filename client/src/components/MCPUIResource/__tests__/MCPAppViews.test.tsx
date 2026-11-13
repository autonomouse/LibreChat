import React from 'react';
import { Tools } from 'librechat-data-provider';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TAttachment, TStartupConfig, UIResource } from 'librechat-data-provider';
import type { MessagesViewContextValue } from '~/Providers/MessagesViewContext';
import type { MCPAppFrameState } from '~/hooks/MCP';
import { MCPAppsPolicyProvider } from '~/Providers/MCPAppsPolicyContext';
import { MCPAppSuppressionContext, MCPAppViews } from '../MCPAppViews';
import { MessagesViewContext } from '~/Providers/MessagesViewContext';
import { MessageContext } from '~/Providers/MessageContext';
import { useAppBridge } from '~/hooks/MCP/useAppBridge';
import { useMCPAppFrame } from '~/hooks/MCP';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<number, string>) => {
    if (key === 'com_ui_mcp_app_frame_title') return `MCP App: ${values?.[0] ?? ''}`;
    if (key === 'com_ui_mcp_app_open_named' || key === 'com_ui_mcp_app_close_named') {
      return `${key} ${values?.[0]} (${values?.[1]})`;
    }
    return key;
  },
}));

jest.mock('~/hooks/MCP', () => ({ useMCPAppFrame: jest.fn() }));
jest.mock('~/hooks/MCP/useAppBridge', () => ({ useAppBridge: jest.fn() }));

const mockUseAppBridge = useAppBridge as jest.MockedFunction<typeof useAppBridge>;
const mockUseMCPAppFrame = useMCPAppFrame as jest.MockedFunction<typeof useMCPAppFrame>;

const enabledConfig = {
  mcpApps: { enabled: true, legacyHtmlEnabled: true },
} as TStartupConfig;

function app(overrides: Partial<UIResource>): UIResource {
  return {
    resourceId: 'shared-resource',
    uri: 'ui://demo/view',
    mimeType: 'text/html;profile=mcp-app',
    toolName: 'show_app',
    serverName: 'demo',
    text: '<p>view</p>',
    ...overrides,
  };
}

function makeFrameState(
  resource: UIResource,
  toolArgs?: string | Record<string, unknown>,
  overrides: Partial<MCPAppFrameState> = {},
): MCPAppFrameState {
  const { buildAppToolResult } = jest.requireActual('~/utils/mcpApps');
  return {
    iframeRef: { current: null },
    status: 'ready',
    kind: 'app',
    height: 320,
    attempt: 0,
    canRetry: false,
    sandboxUrl: 'http://sandbox.localhost:3081/api/mcp/sandbox',
    inlineHtml: resource.text,
    toolArgs: typeof toolArgs === 'string' ? undefined : toolArgs,
    toolResult: buildAppToolResult(resource),
    active: true,
    onSizeChanged: jest.fn(),
    onLoaded: jest.fn(),
    onTeardown: jest.fn(),
    onFailed: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
}

function attachment(
  owner: { toolCallId: string; agentId: string; stepId: string },
  resources: UIResource[],
): TAttachment {
  return {
    type: Tools.ui_resources,
    ...owner,
    [Tools.ui_resources]: resources,
  } as unknown as TAttachment;
}

/** The bridge module loads on demand, so an opened View reaches `useAppBridge` a tick after the click. */
const waitForBridges = (count: number) =>
  waitFor(() => expect(mockUseAppBridge.mock.calls.length).toBeGreaterThanOrEqual(count));
const frames = (root: ParentNode) => root.querySelectorAll('iframe[data-sandbox-url]');

describe('MCPAppViews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMCPAppFrame.mockImplementation((resource, options) =>
      makeFrameState(resource as UIResource, options.toolArgs),
    );
  });

  it('keeps the Close control and shows the loading view while the bridge module loads', async () => {
    /** The lazy bridge keeps its module once resolved, so only the first Open in this file sees it pending. */
    const attachments = [
      attachment({ toolCallId: 'pending', agentId: 'agent', stepId: 'step' }, [app({})]),
    ];
    const view = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));

    const close = view.getByRole('button', { name: /com_ui_mcp_app_close_named/ });
    expect(close).toHaveFocus();
    const loading = view.getByText('com_ui_loading_interactive_view');
    expect(loading.parentElement).toHaveStyle({ height: '320px' });
    /** The frame's own overlay announces the loading once the bridge arrives, so this box stays silent. */
    expect(view.queryByRole('status')).not.toBeInTheDocument();
    expect(mockUseAppBridge).not.toHaveBeenCalled();

    await waitForBridges(1);
    expect(view.queryByText('com_ui_loading_interactive_view')).not.toBeInTheDocument();
    expect(frames(view.container)).toHaveLength(1);
    expect(view.getByRole('button', { name: /com_ui_mcp_app_close_named/ })).toBe(close);
    expect(close).toHaveFocus();
  });

  it('does not create frame or bridge hooks without both policy and host identity', () => {
    const attachments = [
      attachment({ toolCallId: 'call-1', agentId: 'agent-1', stepId: 'step-1' }, [
        app({ toolArgs: { owner: 'one' } }),
      ]),
    ];

    const { container } = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready>
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(mockUseMCPAppFrame).not.toHaveBeenCalled();
    expect(mockUseAppBridge).not.toHaveBeenCalled();
  });

  it('retains every wrapper occurrence and gives each App only its own input and result', async () => {
    const alpha = app({
      toolArgs: { owner: 'alpha' },
      content: [{ type: 'text', text: 'alpha result' }],
      structuredContent: { owner: 'alpha' },
    });
    const beta = app({
      toolArgs: { owner: 'beta' },
      content: [{ type: 'text', text: 'beta result' }],
      structuredContent: { owner: 'beta' },
    });
    const attachments = [
      attachment({ toolCallId: 'call-0', agentId: 'agent-alpha', stepId: 'step-alpha' }, [alpha]),
      attachment({ toolCallId: 'call-0', agentId: 'agent-beta', stepId: 'step-beta' }, [beta]),
    ];

    const { container } = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );

    expect(container.querySelectorAll('iframe[data-sandbox-url]')).toHaveLength(0);
    expect(mockUseAppBridge).not.toHaveBeenCalled();
    screen.getAllByRole('button', { name: /com_ui_mcp_app_open_named/ }).forEach(fireEvent.click);
    await waitForBridges(2);
    expect(container.querySelectorAll('iframe[data-sandbox-url]')).toHaveLength(2);
    expect(mockUseAppBridge).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        resource: alpha,
        userId: 'user-1',
        toolArgs: { owner: 'alpha' },
        toolResult: expect.objectContaining({
          content: [{ type: 'text', text: 'alpha result' }],
          structuredContent: { owner: 'alpha' },
        }),
      }),
    );
    expect(mockUseAppBridge).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resource: beta,
        userId: 'user-1',
        toolArgs: { owner: 'beta' },
        toolResult: expect.objectContaining({
          content: [{ type: 'text', text: 'beta result' }],
          structuredContent: { owner: 'beta' },
        }),
      }),
    );
  });

  it('gives duplicate App buttons distinct accessible names', () => {
    const attachments = [
      attachment({ toolCallId: 'dup', agentId: 'agent', stepId: 'step' }, [
        app({ resourceId: 'one' }),
        app({ resourceId: 'two' }),
      ]),
    ];
    const view = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );
    const buttons = view.getAllByRole('button', { name: /com_ui_mcp_app_open_named/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName('com_ui_mcp_app_open_named show_app (1)');
    expect(buttons[1]).toHaveAccessibleName('com_ui_mcp_app_open_named show_app (2)');
    fireEvent.click(buttons[0]);
    expect(view.getByRole('button', { name: /com_ui_mcp_app_close_named/ })).toBeInTheDocument();
  });

  it('applies the published limit to all Views and clears failed capacity notices on release', async () => {
    const config = {
      mcpApps: { enabled: true, legacyHtmlEnabled: true, maxActiveViews: 1 },
    } as TStartupConfig;
    const attachments = [
      attachment({ toolCallId: 'bounded', agentId: 'agent', stepId: 'step' }, [
        app({ resourceId: 'first' }),
        app({ resourceId: 'second' }),
      ]),
    ];
    const view = render(
      <MCPAppsPolicyProvider startupConfig={config} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );
    const buttons = view.getAllByRole('button', { name: /com_ui_mcp_app_open_named/ });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(view.getByRole('alert')).toHaveTextContent('com_ui_mcp_app_at_capacity');
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_close_named/ }));
    expect(view.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(view.getAllByRole('button', { name: /com_ui_mcp_app_open_named/ })[1]);
    await waitFor(() => expect(frames(view.container)).toHaveLength(1));
  });

  it('returns keyboard focus to the replacement App control without stealing focus on peer teardown', async () => {
    const attachments = [
      attachment({ toolCallId: 'focus', agentId: 'agent', stepId: 'step' }, [app({})]),
    ];
    const view = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );
    const open = view.getByRole('button', { name: /com_ui_mcp_app_open_named/ });
    open.focus();
    fireEvent.click(open);
    const close = view.getByRole('button', { name: /com_ui_mcp_app_close_named/ });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toHaveFocus();

    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));
    view.getByRole('button', { name: /com_ui_mcp_app_close_named/ }).focus();
    await waitForBridges(1);
    act(() => {
      mockUseAppBridge.mock.calls.at(-1)?.[0].onTeardown?.();
    });
    expect(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toHaveFocus();

    const bridgesBefore = mockUseAppBridge.mock.calls.length;
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));
    const unrelated = document.createElement('button');
    document.body.appendChild(unrelated);
    unrelated.focus();
    await waitForBridges(bridgesBefore + 1);
    act(() => {
      mockUseAppBridge.mock.calls.at(-1)?.[0].onTeardown?.();
    });
    expect(unrelated).toHaveFocus();
    expect(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toBeInTheDocument();
    unrelated.remove();
  });

  it('does not reserve capacity or mount a bridge for a read-only URI-only App', async () => {
    const config = {
      mcpApps: { enabled: true, legacyHtmlEnabled: true, maxActiveViews: 1 },
    } as TStartupConfig;
    const attachments = [
      attachment({ toolCallId: 'read-only', agentId: 'agent', stepId: 'step' }, [
        app({ text: undefined, resourceId: 'uri-only' }),
        app({ resourceId: 'inline' }),
      ]),
    ];
    const view = render(
      <MCPAppsPolicyProvider startupConfig={config} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );
    expect(view.getByText('com_ui_mcp_app_shared_unavailable')).toBeInTheDocument();
    expect(mockUseMCPAppFrame).not.toHaveBeenCalled();
    expect(view.getAllByRole('button', { name: /com_ui_mcp_app_open_named/ })).toHaveLength(1);
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));
    await waitFor(() => expect(frames(view.container)).toHaveLength(1));
  });

  it('limits simultaneous live bridges and releases the slot on close', async () => {
    const attachments = [
      attachment(
        { toolCallId: 'batch', agentId: 'agent', stepId: 'step' },
        Array.from({ length: 4 }, (_, i) => app({ resourceId: `r${i}`, toolName: `tool${i}` })),
      ),
    ];
    const view = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );
    expect(mockUseAppBridge).not.toHaveBeenCalled();
    view
      .getAllByRole('button', { name: /com_ui_mcp_app_open_named/ })
      .slice(0, 3)
      .forEach(fireEvent.click);
    await waitFor(() => expect(frames(view.container)).toHaveLength(3));
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));
    expect(view.getByRole('alert')).toHaveTextContent('com_ui_mcp_app_at_capacity');
    expect(frames(view.container)).toHaveLength(3);
    fireEvent.click(view.getAllByRole('button', { name: /com_ui_mcp_app_close_named/ })[0]);
    expect(frames(view.container)).toHaveLength(2);
    fireEvent.click(view.getAllByRole('button', { name: /com_ui_mcp_app_open_named/ }).at(-1)!);
    await waitFor(() => expect(frames(view.container)).toHaveLength(3));
  });

  it('keeps legitimate same-owner and same-resource occurrences distinct', async () => {
    const attachments = [
      attachment({ toolCallId: 'call-0', agentId: 'agent-alpha', stepId: 'step-alpha' }, [
        app({ toolArgs: { occurrence: 'first' }, content: [{ type: 'text', text: 'first' }] }),
        app({ toolArgs: { occurrence: 'second' }, content: [{ type: 'text', text: 'second' }] }),
      ]),
    ];

    const { container } = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );

    expect(container.querySelectorAll('iframe[data-sandbox-url]')).toHaveLength(0);
    expect(mockUseAppBridge).not.toHaveBeenCalled();
    screen.getAllByRole('button', { name: /com_ui_mcp_app_open_named/ }).forEach(fireEvent.click);
    await waitForBridges(2);
    expect(container.querySelectorAll('iframe[data-sandbox-url]')).toHaveLength(2);
    expect(mockUseAppBridge.mock.calls.map(([params]) => params.toolArgs)).toEqual([
      { occurrence: 'first' },
      { occurrence: 'second' },
    ]);
    expect(mockUseAppBridge.mock.calls.map(([params]) => params.toolResult?.content)).toEqual([
      [{ type: 'text', text: 'first' }],
      [{ type: 'text', text: 'second' }],
    ]);
  });

  it('preserves an App frame when unrelated wrappers and resources are inserted or reordered', async () => {
    const target = app({ resourceId: 'target', toolName: 'target', toolArgs: { target: true } });
    const unrelated = app({
      resourceId: 'unrelated',
      toolName: 'unrelated',
      toolArgs: { unrelated: true },
    });
    const targetAttachment = attachment(
      { toolCallId: 'call-target', agentId: 'agent-a', stepId: 'step-a' },
      [target],
    );
    const unrelatedAttachment = attachment(
      { toolCallId: 'call-other', agentId: 'agent-b', stepId: 'step-b' },
      [unrelated],
    );
    const renderViews = (attachments: TAttachment[]) => (
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>
    );
    const view = render(renderViews([targetAttachment]));
    expect(view.queryByTitle('MCP App: target')).not.toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));
    const targetFrame = await view.findByTitle('MCP App: target');

    view.rerender(renderViews([unrelatedAttachment, targetAttachment]));
    expect(view.getByTitle('MCP App: target')).toBe(targetFrame);

    const expandedTargetAttachment = attachment(
      { toolCallId: 'call-target', agentId: 'agent-a', stepId: 'step-a' },
      [unrelated, target],
    );
    view.rerender(renderViews([expandedTargetAttachment, unrelatedAttachment]));
    expect(view.getByTitle('MCP App: target')).toBe(targetFrame);

    view.rerender(renderViews([unrelatedAttachment, targetAttachment]));
    expect(view.getByTitle('MCP App: target')).toBe(targetFrame);
  });

  it('suppresses only attachments owned by an ancestor App surface', async () => {
    const owned = attachment({ toolCallId: 'call-owned', agentId: 'agent-a', stepId: 'step-a' }, [
      app({ resourceId: 'owned', toolName: 'owned' }),
    ]);
    const nested = attachment({ toolCallId: 'call-nested', agentId: 'agent-b', stepId: 'step-b' }, [
      app({ resourceId: 'nested', toolName: 'nested' }),
    ]);

    const view = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppSuppressionContext.Provider value={new Set([owned])}>
          <MCPAppViews attachments={[owned, nested]} />
        </MCPAppSuppressionContext.Provider>
      </MCPAppsPolicyProvider>,
    );

    expect(view.queryByTitle('MCP App: owned')).not.toBeInTheDocument();
    expect(view.queryByTitle('MCP App: nested')).not.toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));
    expect(await view.findByTitle('MCP App: nested')).toBeInTheDocument();
  });

  it.each([
    ['default', 320],
    ['compact', 260],
    ['lower clamp', 80],
  ])('uses the hook-owned %s height without a second surface minimum', async (_label, height) => {
    mockUseMCPAppFrame.mockImplementationOnce((resource, options) =>
      makeFrameState(resource as UIResource, options.toolArgs, { height }),
    );
    const attachments = [
      attachment({ toolCallId: 'call-1', agentId: 'agent-1', stepId: 'step-1' }, [
        app({ toolName: 'compact' }),
      ]),
    ];

    const view = render(
      <MCPAppsPolicyProvider startupConfig={enabledConfig} ready userId="user-1">
        <MCPAppViews attachments={attachments} />
      </MCPAppsPolicyProvider>,
    );
    expect(view.queryByTitle('MCP App: compact')).not.toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ }));
    const container = (await view.findByTitle('MCP App: compact')).parentElement;

    expect(container).toHaveStyle({ height: `${height}px` });
    expect(container?.style.minHeight).toBe('');
  });

  describe('auto-open (mcpSettings.appAutoOpen)', () => {
    const autoOpenConfig = {
      mcpApps: { enabled: true, legacyHtmlEnabled: true, autoOpenServers: ['demo'] },
    } as TStartupConfig;
    const live = { messageId: 'm1', isExpanded: true, isSubmitting: true, isLatestMessage: true };
    const saved = { messageId: 'm1', isExpanded: true, isSubmitting: false, isLatestMessage: true };
    const one = (overrides: Partial<UIResource> = {}) => [
      attachment({ toolCallId: 'auto', agentId: 'agent', stepId: 'step' }, [app(overrides)]),
    ];
    /** Without a messages view the host counts as read-only, where nothing opens unasked. */
    const writable = { readOnly: false } as MessagesViewContextValue;
    const readOnly = { readOnly: true } as MessagesViewContextValue;
    const tree = (
      message: typeof live,
      attachments: TAttachment[],
      config: TStartupConfig = autoOpenConfig,
      messagesView: MessagesViewContextValue = writable,
    ) => (
      <MCPAppsPolicyProvider startupConfig={config} ready userId="user-1">
        <MessagesViewContext.Provider value={messagesView}>
          <MessageContext.Provider value={message}>
            <MCPAppViews attachments={attachments} />
          </MessageContext.Provider>
        </MessagesViewContext.Provider>
      </MCPAppsPolicyProvider>
    );

    it("opens a listed server's View as its result arrives, without taking focus", async () => {
      const view = render(tree(live, one()));

      expect(await view.findByTitle('MCP App: show_app')).toBeInTheDocument();
      expect(view.getByRole('button', { name: /com_ui_mcp_app_close_named/ })).not.toHaveFocus();
    });

    it('keeps the Open control for a saved conversation and for an unlisted server', () => {
      const savedView = render(tree(saved, one()));
      expect(savedView.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toBeVisible();
      savedView.unmount();

      const unlisted = render(tree(live, one({ serverName: 'other' })));
      expect(unlisted.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toBeVisible();
      unlisted.unmount();

      const unset = render(tree(live, one(), enabledConfig));
      expect(unset.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toBeVisible();
      unset.unmount();

      const shared = render(tree(live, one(), autoOpenConfig, readOnly));
      expect(shared.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toBeVisible();
    });

    it('stays closed once the user closes it, across re-renders', async () => {
      const attachments = one();
      const view = render(tree(live, attachments));
      await view.findByTitle('MCP App: show_app');

      fireEvent.click(view.getByRole('button', { name: /com_ui_mcp_app_close_named/ }));
      view.rerender(tree(live, attachments));

      expect(view.queryByTitle('MCP App: show_app')).not.toBeInTheDocument();
      expect(view.getByRole('button', { name: /com_ui_mcp_app_open_named/ })).toBeVisible();
    });

    it('reopens after its message remounts once the response has ended', async () => {
      const attachments = one();
      const remount = (message: typeof live, rowKey: string) => (
        <MCPAppsPolicyProvider startupConfig={autoOpenConfig} ready userId="user-1">
          <MessagesViewContext.Provider value={writable}>
            <MessageContext.Provider key={rowKey} value={message}>
              <MCPAppViews attachments={attachments} />
            </MessageContext.Provider>
          </MessagesViewContext.Provider>
        </MCPAppsPolicyProvider>
      );
      const view = render(remount(live, 'streaming'));
      await view.findByTitle('MCP App: show_app');

      view.rerender(remount(saved, 'final'));

      expect(await view.findByTitle('MCP App: show_app')).toBeInTheDocument();
    });

    it('leaves a View closed, with no capacity alert, when the host is full', async () => {
      const full = {
        mcpApps: { ...autoOpenConfig.mcpApps, maxActiveViews: 1 },
      } as TStartupConfig;
      const attachments = [
        attachment({ toolCallId: 'first', agentId: 'agent', stepId: 'step' }, [
          app({ toolName: 'first' }),
        ]),
        attachment({ toolCallId: 'second', agentId: 'agent', stepId: 'step' }, [
          app({ toolName: 'second' }),
        ]),
      ];
      const view = render(tree(live, attachments, full));

      expect(await view.findByTitle('MCP App: first')).toBeInTheDocument();
      expect(view.queryByTitle('MCP App: second')).not.toBeInTheDocument();
      expect(view.getByRole('button', { name: /com_ui_mcp_app_open_named second/ })).toBeVisible();
      expect(view.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
