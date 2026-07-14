import { View, ActivityIndicator, StyleSheet, Text } from "react-native";

export default function LoadingOverlay({
  visible,
  message,
}: {
  visible: boolean;
  message?: string;
}) {
  if (!visible) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#22c55e" />
        {message && <Text style={styles.message}>{message}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    backgroundColor: "#00000099",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#1e293b",
    padding: 28,
    borderRadius: 16,
    alignItems: "center",
    gap: 12,
  },
  message: {
    color: "#fff",
    fontSize: 14,
  },
});
