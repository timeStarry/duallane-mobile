export function assertAllowedCardAction(actionId: string, allowed: string[]) {
  if (!allowed.includes(actionId)) throw new Error('Unknown action');
}
