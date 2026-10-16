import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp(config);
app.listen({ host: '0.0.0.0', port: config.port }).catch(error => {
  app.log.error({ err: error }, 'Server failed to start'); process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => { await app.close(); process.exit(0); });
}
