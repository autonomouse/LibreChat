import { hasToolCallErrorPrefix, isToolValidationFeedback } from 'librechat-data-provider';

/** The feedback a call gets when its input fails schema validation: the SDK
 *  returns it to the model as a plain `Error:` block closed by its retry hint,
 *  with the run step still `completed`. Mirrors the server's own verdict in
 *  `completedToolExecutionStatus`, so a card, a group header and a phase
 *  agree with the label the server wrote for the same call. */
export function isError(text: string): boolean {
  return (
    hasToolCallErrorPrefix(text) ||
    text.startsWith('Error processing tool') ||
    isToolValidationFeedback(text)
  );
}
