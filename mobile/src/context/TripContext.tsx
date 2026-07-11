import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { getCurrentTrip } from "../api/driverTrips";
import type { CurrentTrip } from "../types";

type TripContextValue = {
  ongoingTrip: CurrentTrip | null;
  /** Gọi lại API /trips/current, cập nhật state - dùng sau khi start/end trip
   *  để tab bar phản ánh đúng ngay, không phải chờ AppState đổi. */
  refreshOngoingTrip: () => Promise<CurrentTrip | null>;
  clearOngoingTrip: () => void;
};

const TripContext = createContext<TripContextValue | undefined>(undefined);

export function TripProvider({ children }: { children: ReactNode }) {
  const [ongoingTrip, setOngoingTrip] = useState<CurrentTrip | null>(null);

  const refreshOngoingTrip = useCallback(async () => {
    try {
      const current = await getCurrentTrip();
      setOngoingTrip(current);
      return current;
    } catch (err) {
      // Không có mạng / lỗi tạm thời - giữ nguyên state cũ, không xoá vội
      // (tránh tab nhảy về "Chọn xe" oan trong lúc mất mạng thoáng qua)
      console.log("[TripContext] refreshOngoingTrip error:", err);
      return ongoingTrip;
    }
  }, [ongoingTrip]);

  const clearOngoingTrip = useCallback(() => setOngoingTrip(null), []);

  // Check lúc mount + mỗi lần app quay lại foreground (vd bị chuyển qua app
  // khác/Simulator mất focus rồi quay lại) - đúng tình huống gây ra bug
  // thời gian trip bị reset trước đó, giờ cũng dùng để đồng bộ tab bar.
  useEffect(() => {
    refreshOngoingTrip();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshOngoingTrip();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TripContext.Provider
      value={{ ongoingTrip, refreshOngoingTrip, clearOngoingTrip }}
    >
      {children}
    </TripContext.Provider>
  );
}

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTrip() phải được gọi bên trong <TripProvider>");
  return ctx;
}
