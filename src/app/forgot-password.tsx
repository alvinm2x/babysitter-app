import { supabase } from "@/utils/supabase";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === "web") alert(`${title}: ${message}`);
    else Alert.alert(title, message);
  };

  const handleResetPassword = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      showAlert("Error", "Por favor ingresa tu correo electrónico.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo:
        Platform.OS === "web"
          ? window.location.origin + "/update-password"
          : undefined,
    });
    setLoading(false);

    if (error) {
      showAlert("Error", error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recuperar Contraseña 🔐</Text>

      {sent ? (
        <View style={styles.successBox}>
          <Text style={styles.successText}>
            ¡Correo enviado! Revisa tu bandeja de entrada o spam para
            restablecer tu contraseña.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace("/")}
          >
            <Text style={styles.buttonText}>Volver al Login</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.subtitle}>
            Ingresa tu correo y te enviaremos un enlace para crear una nueva
            contraseña.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="ejemplo@correo.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TouchableOpacity
            style={styles.button}
            onPress={handleResetPassword}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Enviar Enlace</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Cancelar</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a202c",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: "#718096",
    marginBottom: 24,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 24,
    backgroundColor: "#f7fafc",
  },
  button: {
    backgroundColor: "#3182ce",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  backButton: { marginTop: 16, alignItems: "center", padding: 10 },
  backButtonText: { color: "#718096", fontSize: 15, fontWeight: "600" },
  successBox: {
    backgroundColor: "#f0fff4",
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c6f6d5",
  },
  successText: {
    color: "#2f855a",
    fontSize: 16,
    marginBottom: 20,
    textAlign: "center",
    lineHeight: 24,
  },
});
