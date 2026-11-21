import GoogleSignInButton from "@/components/GoogleSignInButton";
import { supabase } from "@/utils/supabase";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"parent" | "babysitter">("parent");
  const [loading, setLoading] = useState(false);

  // Estados para el toggle de visibilidad del ojito
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === "web") {
      alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const ensureRoleSubProfile = async (
    userId: string,
    selectedRole: "parent" | "babysitter",
    userFullName: string,
  ) => {
    if (selectedRole === "parent") {
      await supabase
        .from("parent_profiles")
        .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
    } else {
      const nameParts = String(userFullName).trim().split(/\s+/);
      const firstName = nameParts[0] || "Niñera";
      const lastName = nameParts.slice(1).join(" ") || "";

      await supabase.from("babysitter_profiles").upsert(
        {
          id: userId,
          first_name: firstName,
          last_name: lastName,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
    }
  };

  const handleGoogleRegisterSuccess = async (user: any) => {
    setLoading(true);
    try {
      // Si el usuario ya tenía cuenta previa, respetamos su perfil existente (sin pisar is_admin ni su rol)
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("is_admin, role")
        .eq("id", user.id)
        .maybeSingle();

      if (existingProfile?.is_admin) {
        router.replace("/");
        return;
      }

      if (existingProfile?.role === "babysitter") {
        router.replace("/babysitter");
        return;
      }

      if (existingProfile?.role === "parent") {
        router.replace("/parent");
        return;
      }

      // Usuario nuevo: creamos su perfil directo con el rol seleccionado arriba
      const googleName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "Usuario";

      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          full_name: googleName,
          role: role,
          is_admin: false,
        },
        { onConflict: "id" },
      );

      if (profileError) throw profileError;

      await ensureRoleSubProfile(user.id, role, googleName);

      router.replace(role === "babysitter" ? "/babysitter" : "/parent");
    } catch (err: any) {
      showAlert(
        "Error al registrar con Google",
        err.message || "Ocurrió un error inesperado.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword || !fullName) {
      showAlert("Campos requeridos", "Por favor completa todos los campos.");
      return;
    }

    if (password.length < 6) {
      showAlert(
        "Contraseña corta",
        "La contraseña debe tener al menos 6 caracteres.",
      );
      return;
    }

    if (password !== confirmPassword) {
      showAlert(
        "Error",
        "Las contraseñas no coinciden. Por favor verifícalas.",
      );
      return;
    }

    setLoading(true);

    try {
      const cleanName = fullName.trim();

      // 1. Crear usuario en Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: cleanName, role: role },
        },
      });

      if (error) throw error;

      // 2. Guardar explícitamente en la tabla de perfiles y subperfil antes de redirigir
      if (data.user) {
        const { error: profileError } = await supabase.from("profiles").upsert({
          id: data.user.id,
          full_name: cleanName,
          role: role,
          is_admin: false,
        });

        if (profileError) throw profileError;

        await ensureRoleSubProfile(data.user.id, role, cleanName);
      }

      showAlert(
        "¡Cuenta creada!",
        `Registrado como ${role === "babysitter" ? "Babysitter" : "Familia"}`,
      );

      // Redirigir según el rol seleccionado
      if (role === "babysitter") {
        router.replace("/babysitter");
      } else {
        router.replace("/parent");
      }
    } catch (err: any) {
      showAlert(
        "Error al registrar",
        err.message || "Ocurrió un error inesperado",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={{ flex: 1, backgroundColor: "#F7F9FC" }}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Crear Cuenta 👶</Text>
        <Text style={styles.subtitle}>
          Selecciona tu perfil e ingresa tus datos
        </Text>

        {/* Seleccionar Rol */}
        <View style={styles.roleContainer}>
          <TouchableOpacity
            style={[
              styles.roleButton,
              role === "parent" && styles.roleButtonActive,
            ]}
            onPress={() => setRole("parent")}
          >
            <Text
              style={[
                styles.roleText,
                role === "parent" && styles.roleTextActive,
              ]}
            >
              🏡 Familia
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.roleButton,
              role === "babysitter" && styles.roleButtonActive,
            ]}
            onPress={() => setRole("babysitter")}
          >
            <Text
              style={[
                styles.roleText,
                role === "babysitter" && styles.roleTextActive,
              ]}
            >
              🍼 Babysitter
            </Text>
          </TouchableOpacity>
        </View>

        <GoogleSignInButton
          mode="signup"
          disabled={loading}
          onSuccess={handleGoogleRegisterSuccess}
          onError={(msg) => showAlert("Error con Google", msg)}
        />

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>o regístrate con tu correo</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Nombre completo"
          value={fullName}
          onChangeText={setFullName}
        />

        <TextInput
          style={styles.input}
          placeholder="Correo electrónico"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <View style={styles.passwordWrapper}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Contraseña"
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

        <View style={styles.passwordWrapper}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Confirmar Contraseña"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
          >
            <Text style={styles.eyeIcon}>
              {showConfirmPassword ? "🙈" : "👁️"}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>Registrarse</Text>
          )}
        </TouchableOpacity>

        <Link href="/" style={styles.link}>
          ¿Ya tienes cuenta? Inicia sesión aquí
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#F7F9FC",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1A202C",
    marginBottom: 8,
  },
  subtitle: { fontSize: 16, color: "#718096", marginBottom: 24 },
  roleContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
    width: "100%",
    maxWidth: 400,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#CBD5E0",
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#FFF",
  },
  roleButtonActive: { backgroundColor: "#3182CE", borderColor: "#3182CE" },
  roleText: { color: "#4A5568", fontWeight: "600" },
  roleTextActive: { color: "#FFF" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 400,
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#CBD5E0",
  },
  dividerText: {
    fontSize: 13,
    color: "#718096",
    fontWeight: "500",
  },
  input: {
    width: "100%",
    maxWidth: 400,
    height: 48,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
  },
  passwordWrapper: {
    width: "100%",
    maxWidth: 400,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    marginBottom: 12,
  },
  passwordInput: { flex: 1, height: 48, paddingHorizontal: 16, fontSize: 16 },
  eyeButton: { padding: 12 },
  eyeIcon: { fontSize: 18 },
  button: {
    width: "100%",
    maxWidth: 400,
    height: 48,
    backgroundColor: "#3182CE",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    marginTop: 8,
  },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "bold" },
  link: {
    marginTop: 20,
    color: "#3182CE",
    fontSize: 14,
    textDecorationLine: "underline",
  },
});
