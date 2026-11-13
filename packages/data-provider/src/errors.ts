const TOOL_CALL_ERROR_PREFIX = /^Error:\s*(?:\[[^\]]*\]\s*)*tool call failed:\s*/i;

export function hasToolCallErrorPrefix(text: string): boolean {
  return TOOL_CALL_ERROR_PREFIX.test(text);
}

/** Whether a tool output string is one the tool output renderers present as a failure. */
export function isToolErrorOutput(text: string): boolean {
  return hasToolCallErrorPrefix(text) || text.startsWith('Error processing tool');
}

/**
 * The sentence the agents SDK is to close a failed call's result with, for the model.
 * Users read that result under the call's details, and the sentence the SDK has used
 * since LangChain's `ToolNode`, "Please fix your mistakes.", reads there as a rebuke
 * of them rather than as a hint to the model.
 */
export const TOOL_ERROR_RETRY_HINT = 'Please check the error and correct the tool call if needed.';

/** Stored conversations, and SDK releases before the change, keep the old sentence. */
const LEGACY_TOOL_ERROR_RETRY_HINT = 'Please fix your mistakes.';

const RETRY_HINT = `(?:${[TOOL_ERROR_RETRY_HINT, LEGACY_TOOL_ERROR_RETRY_HINT]
  .map((hint) => hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')})`;
const VALIDATION_FEEDBACK = new RegExp(`^Error:[\\s\\S]*\\n ${RETRY_HINT}$`, 'i');
const TRAILING_RETRY_HINT = new RegExp(`\\s*${RETRY_HINT}$`, 'i');

/** Whether a tool output is the SDK's feedback to the model, closed by either retry hint. */
export function isToolValidationFeedback(text: string): boolean {
  return VALIDATION_FEEDBACK.test(text);
}

/** Removes the retry hint that closes a failed call's result, in either wording. */
export function stripToolErrorRetryHint(text: string): string {
  return text.replace(TRAILING_RETRY_HINT, '');
}

/**
 * Whether a completed tool call failed. Agents SDK releases serialize tool failures
 * into these host-authored prefixes, and schema-validation feedback into a plain
 * `Error:` block, without carrying `ToolMessage.status` on the wire.
 */
export function isFailedToolOutput(text: string): boolean {
  return (
    hasToolCallErrorPrefix(text) ||
    /^Error processing tool(?::|$)/i.test(text) ||
    isToolValidationFeedback(text)
  );
}

export function stripToolCallErrorPrefix(text: string): string {
  return text.replace(TOOL_CALL_ERROR_PREFIX, '');
}
