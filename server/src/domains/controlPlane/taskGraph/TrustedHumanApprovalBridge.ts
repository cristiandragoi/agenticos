/** Production issuance remains disabled until an independent OS-protected issuer is enrolled. */
export function issueTrustedHumanApproval(..._args: unknown[]): never {
  throw new Error('TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE');
}
export function verifyAndConsumeTrustedApproval(..._args: unknown[]): never {
  throw new Error('TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE');
}
