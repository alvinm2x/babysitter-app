import { supabase } from "@/utils/supabase";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
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

export default function UpdatePasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Intercepta la sesión inmediatamente al cargar la pantalla
  useEffect(() => {
    const setupManualSession = async () => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const url = window.location.href;

        if (url.includes("access_token=")) {
          // Extrae los parámetros de la URL independientemente de si usa # o ?
          const paramsString = url.includes("#")
            ? url.split("#")[1]
            : url.split("?")[1];
          const params = new URLSearchParams(paramsString);

          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");

          if (accessToken && refreshToken) {
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
          }
        }
      }
    };

    setupManualSession();
  }, []);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === "web") alert(`${title}: ${message}`);
    else Alert.alert(title, message);
  };

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) {
      showAlert("Error", "Por favor completa ambos campos.");
      return;
    }

    if (password.length < 6) {
      showAlert("Error", "La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      showAlert("Error", "Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    // Barrera de seguridad: Verificar que Supabase capturó la sesión
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setLoading(false);
      showAlert(
        "Enlace expirado",
        "Por seguridad, este enlace ya caducó o fue utilizado. Por favor, vuelve al inicio y solicita un correo nuevo.",
      );
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      showAlert("Error", error.message);
    } else {
      showAlert(
        "¡Contraseña actualizada!",
        "Tu contraseña ha sido cambiada con éxito. Ya puedes iniciar sesión.",
      );
      router.replace("/");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nueva Contraseña 🔑</Text>
      <Text style={styles.subtitle}>
        Ingresa tu nueva contraseña para tu cuenta de Babysitter.
      </Text>

      <Text style={styles.label}>Nueva contraseña</Text>
      <View style={styles.passwordWrapper}>
        <TextInput
          style={styles.passwordInput}
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShowPassword(!showPassword)}
        >
          <Text style={styles.eyeIcon}>{showPassword ? "🙈" : "👁️"}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Confirma la contraseña</Text>
      <TextInput
        style={styles.input}
        placeholder="••••••••"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry={!showPassword}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleUpdatePassword}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Actualizar Contraseña</Text>
        )}
      </TouchableOpacity>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#718096",
    marginBottom: 24,
    lineHeight: 22,
  },
  label: { fontSize: 14, fontWeight: "600", color: "#4a5568", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: "#f7fafc",
  },
  passwordWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    backgroundColor: "#f7fafc",
    marginBottom: 16,
  },
  passwordInput: { flex: 1, padding: 12, fontSize: 16 },
  eyeButton: { padding: 12 },
  eyeIcon: { fontSize: 20 },
  button: {
    backgroundColor: "#3182ce",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
