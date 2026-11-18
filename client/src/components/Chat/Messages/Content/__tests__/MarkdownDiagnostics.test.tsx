import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { markdownToHtml } from '~/utils/richtext';
import { MessageContext } from '~/Providers';
import Markdown from '../Markdown';

jest.mock('~/components/Artifacts/ArtifactButton', () => ({
  __esModule: true,
  default: ({ artifact }: { artifact?: { identifier?: string } }) => (
    <div data-testid="art" data-id={String(artifact?.identifier)} />
  ),
}));

const diagnostics = [
  ':::diagnostics',
  '- **Rules version:** 32.',
  '- **Tools:** `resolve_concepts`; [docs](https://example.com/docs).',
  ':::',
].join('\n');

const queryClient = new QueryClient();

/** The latest message of a conversation, generating while `submitting` holds. */
const liveView = (content: string, submitting: boolean) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <RecoilRoot>
        <MessageContext.Provider
          value={{
            messageId: 'm1',
            isExpanded: true,
            isSubmitting: submitting,
            isLatestMessage: true,
          }}
        >
          <Markdown content={content} isLatestMessage={true} />
        </MessageContext.Provider>
      </RecoilRoot>
    </MemoryRouter>
  </QueryClientProvider>
);

/** A finished message renders through one pipeline; a streamed one renders per block. */
const renderMessage = (content: string, streamed: boolean) => {
  const rendered = render(liveView(content, streamed));
  rendered.rerender(liveView(content, false));
  return rendered;
};

describe.each([
  ['a finished', false],
  ['a streamed', true],
])('diagnostics directive in %s message', (_label, streamed) => {
  it('renders one closed disclosure holding its content', () => {
    const { container } = renderMessage(`Answer.\n\n${diagnostics}`, streamed);

    const blocks = container.querySelectorAll('details');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].open).toBe(false);
    expect(blocks[0].querySelector('summary')?.textContent).toBe('Diagnostics');
    expect(blocks[0].textContent).toContain('Rules version:');
    expect(container.textContent).not.toContain(':::');
  });

  it('renders the markdown inside it', () => {
    const { container } = renderMessage(diagnostics, streamed);

    const block = container.querySelector('details');
    expect(block?.querySelectorAll('li')).toHaveLength(2);
    expect(block?.querySelector('strong')?.textContent).toBe('Rules version:');
    expect(block?.querySelector('code')?.textContent).toBe('resolve_concepts');
    expect(block?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/docs');
  });

  it('leaves an unrelated directive and an artifact as they were', async () => {
    const content = [
      ':::note',
      'Plain note.',
      ':::',
      '',
      ':::artifact{identifier="doc" type="text/markdown" title="Doc"}',
      'hello',
      ':::',
      '',
      '::diagnostics',
      '',
      'Inline :diagnostics here.',
    ].join('\n');
    const { container } = renderMessage(content, streamed);

    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByText('Plain note.')).toBeInTheDocument();
    expect(screen.getByText('Inline :diagnostics here.')).toBeInTheDocument();
    const [artifactNode] = await screen.findAllByTestId('art');
    expect(artifactNode.getAttribute('data-id')).toBe('doc');
  });
});

describe('diagnostics directive while its message streams', () => {
  it('keeps the content inside the closed disclosure before the closing line arrives', () => {
    const { container } = render(liveView('Answer.\n\n:::diagnostics\n- **Rules', true));

    const block = container.querySelector('details');
    expect(block?.open).toBe(false);
    expect(block?.textContent).toContain('Rules');
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(block?.querySelectorAll('li')).toHaveLength(1);
  });

  it.each([
    ['a bare colon run', ':::', 'Answer.:::'],
    ['a partial name', ':::diag', 'Answer.'],
    ['a partial closing line', diagnostics.slice(0, -1), 'Answer.'],
  ])('shows the expected text outside the disclosure after %s', (_label, tail, expected) => {
    const { container } = render(liveView(`Answer.\n\n${tail}`, true));

    const loose = Array.from(container.querySelectorAll('p, li'))
      .filter((el) => el.closest('details') == null)
      .map((el) => el.textContent)
      .join('');
    expect(loose).toBe(expected);
  });

  it('keeps the disclosure the reader opened when the message finishes', () => {
    const { container, rerender } = render(liveView(diagnostics.slice(0, -4), true));
    const block = container.querySelector('details') as HTMLDetailsElement;
    block.open = true;

    rerender(liveView(diagnostics, true));
    rerender(liveView(diagnostics, false));

    expect(container.querySelector('details')).toBe(block);
    expect(block.open).toBe(true);
  });
});

describe('diagnostics directive on the clipboard', () => {
  it('keeps the content in the rich-text copy', () => {
    const html = markdownToHtml(diagnostics, { variant: 'full', latex: false });

    expect(html).toContain('<ul><li><strong>Rules version:</strong> 32.</li>');
    expect(html).toContain('resolve_concepts');
    expect(html).not.toContain(':::');
  });
});
