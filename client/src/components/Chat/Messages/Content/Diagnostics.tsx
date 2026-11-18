import React from 'react';
import { visit } from 'unist-util-visit';
import type { Pluggable } from 'unified';
import { useLocalize } from '~/hooks';

const DIAGNOSTICS_DIRECTIVE = 'diagnostics';

/** Turns the `:::diagnostics` container directive into an element; every other directive is left alone. */
export const diagnosticsPlugin: Pluggable = () => {
  return (tree) => {
    visit(tree, 'containerDirective', (node) => {
      if (node.name !== DIAGNOSTICS_DIRECTIVE) {
        return;
      }
      node.data = { ...node.data, hName: DIAGNOSTICS_DIRECTIVE };
    });
  };
};

/**
 * A closed-by-default disclosure. `open` is left to the browser, so the reader's
 * choice survives the re-renders of a streaming message.
 */
export function Diagnostics({ children }: { children?: React.ReactNode; node?: unknown }) {
  const localize = useLocalize();
  return (
    <details className="my-2">
      <summary className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-subtle cursor-pointer rounded text-xs focus-visible:ring-2 focus-visible:outline-none">
        {localize('com_ui_diagnostics')}
      </summary>
      <div className="mt-1 text-sm">{children}</div>
    </details>
  );
}
