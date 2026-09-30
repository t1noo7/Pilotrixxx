import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { socket } from "../api/socket.js";

const NotificationContext = createContext(null);

const EVENT_LABELS = {
  hard_brake: "Phanh gấp",
  rapid_accel: "Tăng tốc đột ngột",
  sharp_turn: "Đánh lái gấp",
  overspeed: "Vượt tốc độ",
  lane_drift: "Lấn làn",
  gps_invalid: "Mất tín hiệu GPS",
};

const MAX_TOASTS = 3;
const TOAST_TTL_MS = 6000;

export function NotificationProvider({ children }) {
  const [notifPermission, setNotifPermission] = useState(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
  }, []);

  const markAllRead = useCallback(() => setUnreadCount(0), []);
  const requestNotifPermission = useCallback(() => {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(setNotifPermission);
  }, []);

  useEffect(() => {
    function handleAlert(payload) {
      setUnreadCount((c) => c + 1);
      if (payload.severity !== "high") return; // medium chỉ tăng badge, không làm phiền bằng toast

      const id = `${payload.vehicleId}-${payload.tripId}-${payload.eventType}`;
      const toast = {
        id,
        tripId: payload.tripId,
        vehicleId: payload.vehicleId,
        label: EVENT_LABELS[payload.eventType] || payload.eventType,
        message: payload.message,
      };

      // gop theo vehicleId+trip+loai: event moi cung khoa thi thay
      // the toast cu (reset timer) thay vi chong them
      setToasts((prev) => {
        const withoutDup = prev.filter((t) => t.id !== id);
        const next = [toast, ...withoutDup].slice(0, MAX_TOASTS);
        return next;
      });

      clearTimeout(timersRef.current[id]);
      timersRef.current[id] = setTimeout(() => dismissToast(id), TOAST_TTL_MS);

      if (
        document.visibilityState !== "visible" &&
        Notification.permission === "granted"
      ) {
        new Notification(
          `Cảnh báo: ${EVENT_LABELS[payload.eventType] || payload.eventType}`,
          {
            body: payload.message,
            tag: id,
          },
        );
      }
    }

    socket.on("alert", handleAlert);
    return () => socket.off("alert", handleAlert);
  }, [dismissToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        unreadCount,
        markAllRead,
        toasts,
        dismissToast,
        notifPermission,
        requestNotifPermission,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx)
    throw new Error(
      "useNotifications phải dùng bên trong NotificationProvider",
    );
  return ctx;
}
