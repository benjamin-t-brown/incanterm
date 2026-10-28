import type { Server as NetServer } from 'node:net';

export function listen(server: NetServer, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError);
      reject(error);
    };
    server.on('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Expected a TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
}

export function closeServer(server: NetServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
