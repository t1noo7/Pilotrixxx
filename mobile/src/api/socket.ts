import { io, Socket } from "socket.io-client";
import * as SecureStore from "expo-secure-store";

const BASE_URL = "https://pilotrixxx.onrender.com"; // trùng client.ts

export const driverSocket: Socket = io(`${BASE_URL}/driver`, {
  autoConnect: false,
  transports: ["websocket"],
});

export async function connectDriverSocket() {
  const token = await SecureStore.getItemAsync("driverToken");
  if (!token) return;
  driverSocket.auth = { token };
  if (!driverSocket.connected) driverSocket.connect();
}

export function disconnectDriverSocket() {
  if (driverSocket.connected) driverSocket.disconnect();
}
