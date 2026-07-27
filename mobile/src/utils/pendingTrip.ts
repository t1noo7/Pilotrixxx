import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "pilotrix:pendingTripId";

// Luu tripId dang cho xe toi (status='pending') xuong bo nho ben vung,
// song qua ca luc app bi kill hoan toan - khac TripContext (chi song
// trong RAM, mat sach khi kill app). Dung de phat hien case: app bi kill
// dung luc backend auto-abort trip mo coi (qua 10 phut khong tin hieu),
// mo lai app khong con cach nao biet "vua bi huy" tru phi hoi lai day.
export async function savePendingTripId(tripId: string | number) {
  try {
    await AsyncStorage.setItem(KEY, String(tripId));
  } catch (err) {
    console.log("[pendingTrip] save error:", err);
  }
}

export async function getPendingTripId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch (err) {
    console.log("[pendingTrip] get error:", err);
    return null;
  }
}

export async function clearPendingTripId() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (err) {
    console.log("[pendingTrip] clear error:", err);
  }
}
