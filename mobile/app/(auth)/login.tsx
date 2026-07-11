import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import { Link, router } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    if (!email || !password)
      return Alert.alert("Thiếu thông tin", "Nhập đủ email và mật khẩu");
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/(app)/vehicles");
    } catch (err: any) {
      const data = err.response?.data;
      // Backend trả 403 { error, emailVerified: false, email } khi tài
      // khoản chưa xác thực OTP -> điều hướng thẳng sang verify-otp
      // thay vì chỉ hiện lỗi chung chung.
      if (err.response?.status === 403 && data?.emailVerified === false) {
        router.push({
          pathname: "/(auth)/verify-otp",
          params: { email: data.email ?? email },
        });
        return;
      }
      Alert.alert("Đăng nhập thất bại", data?.error || "Có lỗi xảy ra");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoCircle}>
        <Text style={styles.logoEmoji}>🚗</Text>
      </View>
      <Text style={styles.title}>Pilotrix Driver</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#64748b"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Mật khẩu"
        placeholderTextColor="#64748b"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable
        style={styles.button}
        onPress={handleLogin}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>
          {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </Text>
      </Pressable>
      <Link href="/(auth)/register" style={styles.link}>
        <Text style={styles.linkText}>Chưa có tài khoản? Đăng ký</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#0f172a",
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#22c55e22",
    borderWidth: 2,
    borderColor: "#22c55e",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  logoEmoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 32,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#1e293b",
    color: "#fff",
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#22c55e",
    padding: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  buttonText: { color: "#0f172a", fontWeight: "700", textAlign: "center" },
  link: { marginTop: 16, alignSelf: "center" },
  linkText: { color: "#94a3b8" },
});
