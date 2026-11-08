import { supabase } from "@/utils/supabase";
import { useRouter } from "expo-router";
import { useState, useEffect } from "react";
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

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [isAdminTester, setIsAdminTester] = useState(false);

  // Listener Reforzado para Recuperación de Contraseña (Sin errores de TypeScript)
  useEffect(() => {
    // 1. Lectura directa de URL (Infalible para Vercel/Web)
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const urlInfo = window.location.hash || window.location.search;
      if (urlInfo.includes("type=recovery")) {
        router.replace("/update-password" as any);
        return; // Detenemos aquí para que no siga cargando el login
      }
    }

    // 2. Listener normal de Supabase (Para cuando la app ya está abierta)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event === "PASSWORD_RECOVERY") {
          router.replace("/update-password" as any);
        }
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === "web") {
      alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      showAlert("Error", "Por favor ingresa correo y contraseña.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: password,
    });

    setLoading(false);

    if (error) {
      showAlert("Error de Inicio de Sesión", error.message);
    } else {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", data.user?.id)
        .single();

      if (profile?.is_admin) {
        setIsAdminTester(true);
      } else {
        router.replace("/parent");
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>¡Bienvenido! 👋</Text>
      <Text style={styles.subtitle}>Inicia sesión para continuar</Text>

      {isAdminTester ? (
        <View style={styles.adminFastSwitchContainer}>
          <Text style={styles.adminFastSwitchTitle}>Modo Pruebas Activado</Text>
          <Text style={styles.adminFastSwitchSub}>
            Elige la vista a la que quieres entrar:
          </Text>

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: "#38a169", marginBottom: 12 },
            ]}
            onPress={() => router.replace("/parent")}
          >
            <Text style={styles.buttonText}>👨‍👩‍👧 Entrar como PADRE</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: "#805ad5", marginBottom: 12 },
            ]}
            onPress={() => router.replace("/babysitter")}
          >
            <Text style={styles.buttonText}>👩‍🍼 Entrar como NIÑERA</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: "#dd6b20" }]}
            onPress={() => router.replace("/admin")}
          >
            <Text style={styles.buttonText}>🗼 Entrar a TORRE DE CONTROL</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              placeholder="ejemplo@correo.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.label}>Contraseña</Text>
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

            {/* BOTÓN DE RECUPERACIÓN DE CONTRASEÑA */}
            <TouchableOpacity
              onPress={() => router.push("/forgot-password" as any)}
              style={styles.forgotPasswordButton}
            >
              <Text style={styles.forgotPasswordText}>
                ¿Olvidaste tu contraseña?
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.button}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Iniciar Sesión</Text>
            )}
          </TouchableOpacity>

          <View style={styles.registerContainer}>
            <Text style={styles.registerText}>¿No tienes una cuenta? </Text>
            <TouchableOpacity onPress={() =>