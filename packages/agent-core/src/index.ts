export * from './AgentAdapter';
// `translate` is exported for the privacy suite rather than for callers: the
// events it produces are what reach the phone and the activity log, so it is
// where redaction has to be proved rather than assumed.
export { ClaudeCodeAdapter, translate } from './ClaudeCodeAdapter';
export { GeminiAdapter } from './GeminiAdapter';
export { isReadOnlyShellCommand } from './readOnlyShell';
// `checkTool` is exported so it can be attacked from a suite. It was not, which
// is the reason nothing ever tested the decision of which tools an agent may
// use - the policy was unreachable from outside this package.
export {
  checkCommand,
  checkPath,
  checkTool,
  MAX_TURNS,
  redactSecrets,
  SHELL_TOOL,
} from './safety';
