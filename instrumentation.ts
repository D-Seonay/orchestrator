export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { orchestrator } = await import('./lib/orchestrator');
    orchestrator.init();
  }
}
