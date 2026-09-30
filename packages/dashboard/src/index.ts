import http from 'node:http';
import { DASHBOARD_HTML } from './html.js';

export * from './html.js';

export interface DashboardServerOptions {
  port?: number;
  collectorUrl?: string;
}

/**
 * Starts a standalone web dashboard server.
 */
export function startDashboardServer(options: DashboardServerOptions = {}): Promise<http.Server> {
  const port = options.port || 5000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DASHBOARD_HTML);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[Doomwatch Dashboard] Web visualizer running on http://localhost:${port}`);
      resolve(server);
    });
  });
}

// Auto-run if executed as standalone script
if (process.argv[1]?.endsWith('dashboard/dist/index.js')) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  startDashboardServer({ port }).catch(console.error);
}
