export function routeLoopbackInput(
  data: string,
  screen: 'client' | 'server',
): { screen: 'client' | 'server'; forward?: string; quit?: boolean } {
  if (data.includes('\x03')) return { screen, quit: true };
  if (data === '~') return { screen: screen === 'client' ? 'server' : 'client' };
  return screen === 'client' ? { screen, forward: data } : { screen };
}
