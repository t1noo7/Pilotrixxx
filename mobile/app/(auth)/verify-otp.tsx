import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import LoadingOverlay from "../../src/components/LoadingOverlay";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyOtpScreen() {
  const { verifyOtp, resendOtp } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? "";

  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  // OTP đã được gửi ngay lúc register/login 403 -> cooldown bắt đầu ngay
  // khi vào màn hình, tránh bấm gửi lại spam ngay lập tức.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      return Alert.alert("Mã OTP không hợp lệ", "Nhập đủ 6 chữ số");
    }
    setSubmitting(true);
    try {
      // verifyOtp() giờ CHỈ xác nhận OTP đúng, không tự login/lưu token.
      // Phải bắt người dùng đăng nhập lại thật sự ở màn login.
      await verifyOtp(email, otp);
      Alert.alert(
        "Xác thực thành công",
        "Tài khoản đã được kích hoạt. Mời bạn đăng nhập để tiếp tục.",
        [
          {
            text: "OK",
            onPress: () => router.replace("/(auth)/login"),
          },
        ],
      );
    } catch (err: any) {
      Alert.alert(
        "Xác thực thất bại",
        err.response?.data?.error || "Mã OTP sai hoặc đã hết hạn",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await resendOtp(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      Alert.alert("Đã gửi lại", "Mã OTP mới đã được gửi tới email của bạn");
    } catch (err: any) {
      Alert.alert(
        "Gửi lại thất bại",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.container}>
      <LoadingOverlay visible={submitting || resending} />

      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>‹ Quay lại</Text>
      </Pressable>

      <View style={styles.logoCircle}>
        <Text style={styles.logoEmoji}>📧</Text>
      </View>
      <Text style={styles.title}>Xác thực email</Text>
      <Text style={styles.subtitle}>
        Nhập mã 6 số vừa gửi tới{"\n"}
        <Text style={styles.email}>{email}</Text>
      </Text>

      <TextInput
        style={styles.otpInput}
        placeholder="000000"
        placeholderTextColor="#475569"
        keyboardType="number-pad"
        maxLength={6}
        value={otp}
        onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ""))}
      />

      <Pressable
        style={[styles.button, otp.length !== 6 && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={submitting || otp.length !== 6}
      >
        <Text style={styles.buttonText}>Xác thực</Text>
      </Pressable>

      <Pressable
        onPress={handleResend}
        disabled={cooldown > 0 || resending}
        style={styles.resendButton}
      >
        <Text
          style={[
            styles.resendText,
            (cooldown > 0 || resending) && styles.resendTextDisabled,
          ]}
        >
          {cooldown > 0
            ? `Gửi lại mã sau ${cooldown}s`
            : "Gửi lại mã OTP"}
        </Text>
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
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  email: { color: "#e2e8f0", fontWeight: "600" },
  otpInput: {
    backgroundColor: "#1e293b",
    color: "#fff",
    padding: 14,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 24,
    letterSpacing: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#22c55e",
    padding: 14,
    borderRadius: 8,
  },
  buttonDisabled: { backgroundColor: "#22c55e55" },
  buttonText: { color: "#0f172a", fontWeight: "700", textAlign: "center" },
  resendButton: { marginTop: 20, alignSelf: "center" },
  resendText: { color: "#22c55e", fontSize: 14 },
  resendTextDisabled: { color: "#475569" },
});
