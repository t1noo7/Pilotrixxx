import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import LoadingOverlay from "../../src/components/LoadingOverlay";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleRegister = async () => {
    if (!email || !password || !fullName) {
      return Alert.alert("Thiếu thông tin", "Nhập đủ email, mật khẩu, họ tên");
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      return Alert.alert("Email không hợp lệ", "Nhập đúng định dạng email");
    }
    if (password.length < 8) {
      return Alert.alert("Mật khẩu quá ngắn", "Mật khẩu cần ít nhất 8 ký tự");
    }
    if (password !== confirmPassword) {
      return Alert.alert("Mật khẩu không khớp", "Nhập lại mật khẩu cho đúng");
    }

    setSubmitting(true);
    try {
      const { email: registeredEmail } = await register(
        email.trim(),
        password,
        fullName,
        phoneNumber || undefined,
      );
      router.push({
        pathname: "/(auth)/verify-otp",
        params: { email: registeredEmail },
      });
    } catch (err: any) {
      Alert.alert(
        "Đăng ký thất bại",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <LoadingOverlay visible={submitting} />

      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>‹ Quay lại</Text>
      </Pressable>

      <View style={styles.logoCircle}>
        <Text style={styles.logoEmoji}>🚦</Text>
      </View>
      <Text style={styles.title}>Đăng ký tài xế</Text>

      <TextInput
        style={styles.input}
        placeholder="Họ tên"
        placeholderTextColor="#64748b"
        value={fullName}
        onChangeText={setFullName}
      />
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
        placeholder="Số điện thoại (tuỳ chọn)"
        placeholderTextColor="#64748b"
        keyboardType="phone-pad"
        value={phoneNumber}
        onChangeText={setPhoneNumber}
      />
      <TextInput
        style={styles.input}
        placeholder="Mật khẩu (tối thiểu 8 ký tự)"
        placeholderTextColor="#64748b"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="Nhập lại mật khẩu"
        placeholderTextColor="#64748b"
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />

      <Pressable
        style={styles.button}
        onPress={handleRegister}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>Đăng ký</Text>
      </Pressable>
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
  backButton: { position: "absolute", top: 60, left: 24, zIndex: 1 },
  backButtonText: { color: "#94a3b8", fontSize: 16 },
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
  logoEmoji: { fontSize: 40 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 24,
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
});
