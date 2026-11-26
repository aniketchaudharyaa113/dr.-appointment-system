import type { Socket } from 'socket.io-client';

const activeSockets = new Set<Socket>();

export function registerSocket(socket: Socket): () => void {
  activeSockets.add(socket);
  return () => {
    activeSockets.delete(socket);
  };
}

export function disconnectAllSockets(): void {
  for (const socket of activeSockets) {
    try {
      socket.disconnect();
    } catch {
      // ignore errors during teardown
    }
  }
  activeSockets.clear();
}
