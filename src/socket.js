import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:5000';

export const socket = io(SERVER_URL, {
  transports: ['websocket'],
  autoConnect: false,
});
