import { supabase } from "@/utils/supabase";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
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

const PENDING_REQUEST_STORAGE_KEY = "mibabysitter_pending_request_id";

const savePendingRequestId = (reqId?: string) => {
  if (!reqId || Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_REQUEST_STORAGE_KEY, reqId);
  } catch {}
};

const consumePendingRequestId = (): string | null => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(PENDING_REQUEST_STORAGE_KEY);
    if (stored) {
      window.sessionStorage.removeItem(PENDING_REQUEST_STORAGE_KEY);
      return stored;
    }
  } catch {}
  return null;
};

export default function LoginScreen() {
  const router = useRouter();
  const { requestId: paramRequestId } = useLocalSearchParams<{
    requestId?: string;
  }>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const [showPassword, setShowPassword] = useState(false);
  const [isAdminTester, setIsAdminTester] = useState(false);

  // Estado para usuarios nuevos que entran con Google y aún no eligen rol
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);
  const [pendingGoogleUser, setPendingGoogleUser] = useState<any | null>(null);
  const [savingRole, setSavingRole] = useState(false);

  const isRoutingRef = useRef(false);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === "web") {
      alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const navigateWithPendingRequest = (
    basePath: "/parent" | "/babysitter" | "/admin",
  ) => {
    const pendingReqId =
      (paramRequestId ? String(paramRequestId) : null) ||
      consumePendingRequestId();

    if (pendingReqId && basePath !== "/admin") {
      router.replace(
        `${basePath}?requestId=${encodeURIComponent(pendingReqId)}` as any,
      );
    } else {
      router.replace(basePath as any);
    }
  };

  const routeAuthenticatedUser = async (user: any) => {
    if (!user || isRoutingRef.current) return;
    isRoutingRef.current = true;

    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("is_admin, role, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error leyendo perfil:", error.message);
      }

      if (profile?.is_admin) {
        setIsAdminTester(true);
        setNeedsRoleSelection(false);
        return;
      }

      if (profile?.role === "babysitter") {
        navigateWithPendingRequest("/babysitter");
        return;
      }

      if (profile?.role === "parent") {
        navigateWithPendingRequest("/parent");
        return;
      }

      // Usuario nuevo (ej. primer ingreso con Google sin rol asignado aún)
      setPendingGoogleUser(user);
      setNeedsRoleSelection(true);
    } finally {
      setCheckingSession(false);
      isRoutingRef.current = false;
    }
  };

  useEffect(() => {
    if (paramRequestId) {
      savePendingRequestId(String(paramRequestId));
    }

    // 1. Lectura directa de URL para Web/Vercel (recuperación de clave)
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const urlInfo = window.location.hash || window.location.search;
      if (urlInfo.includes("type=recovery")) {
        setCheckingSession(false);
        router.replace("/update-password");
        return;
      }
    }

    // 2. Verificar si ya existe sesión activa (ej. regreso desde Google OAuth)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        routeAuthenticatedUser(session.user);
      } else {
        setCheckingSession(false);
      }
    });

    // 3. Listener de Supabase
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          router.replace("/update-password");
          return;
        }
        if (event === "SIGNED_IN" && session?.user) {
          routeAuthenticatedUser(session.user);
        }
        if (event === "SIGNED_OUT") {
          setIsAdminTester(false);
          setNeedsRoleSelection(false);
          setPendingGoogleUser(null);
          setCheckingSession(false);
        }
      },
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router, paramRequestId]);

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
    } else if (data.user) {
      await routeAuthenticatedUser(data.user);
    }
  };

  const handleGoogleLogin = async () => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      showAlert(
        "Próximamente en móvil",
        "El inicio con Google está habilitado en la versión web (mibabysitter.cl).",
      );
      return;
    }

    if (paramRequestId) {
      savePendingRequestId(String(paramRequestId));
    }

    setLoadingGoogle(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
        },
      });

      if (error) {
        showAlert("Error con Google", error.message);
        setLoadingGoogle(false);
      }
    } catch (err: any) {
      showAlert(
        "Error con Google",
        err.message || "No se pudo iniciar con Google.",
      );
      setLoadingGoogle(false);
    }
  };

  const handleSelectRole = async (chosenRole: "parent" | "babysitter") => {
    if (!pendingGoogleUser || savingRole) return;
    setSavingRole(true);

    try {
      const fullName =
        pendingGoogleUser.user_metadata?.full_name ||
        pendingGoogleUser.user_metadata?.name ||
        pendingGoogleUser.email?.split("@")[0] ||
        "Usuario";

      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: pendingGoogleUser.id,
          full_name: fullName,
          role: chosenRole,
          is_admin: false,
        },
        { onConflict: "id" },
      );

      if (profileError) throw profileError;

      if (chosenRole === "parent") {
        await supabase
          .from("parent_profiles")
          .upsert(
            { id: pendingGoogleUser.id },
            { onConflict: "id", ignoreDuplicates: true },
          );
        navigateWithPendingRequest("/parent");
      } else {
        const nameParts = String(fullName).trim().split(/\s+/);
        const firstName = nameParts[0] || "Niñera";
        const lastName = nameParts.slice(1).join(" ") || "";

        await supabase.from("babysitter_profiles").upsert(
          {
            id: pendingGoogleUser.id,
            first_name: firstName,
            last_name: lastName,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        navigateWithPendingRequest("/babysitter");
      }
    } catch (err: any) {
      showAlert("Error al configurar perfil", err.message);
    } finally {
      setSavingRole(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setIsAdminTester(false);
    setNeedsRoleSelection(false);
    setPendingGoogleUser(null);
  };

  if (checkingSession) {
    return (
      <View style={[styles.container, { alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#3182ce" />
        <Text style={{ marginTop: 12, color: "#718096", fontSize: 15 }}>
          Verificando tu sesión...
        </Text>
      </View>
    );
  }

  const googleUserDisplayName =
    pendingGoogleUser?.user_metadata?.full_name ||
    pendingGoogleUser?.user_metadata?.name ||
    "";

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={{ flex: 1, backgroundColor: "#fff" }}
    >
      <View style={styles.container}>
        {needsRoleSelection ? (
          <View style={styles.roleSelectionBox}>
            <Text style={styles.title}>
              ¡Hola
              {googleUserDisplayName
                ? `, ${googleUserDisplayName.split(" ")[0]}`
                : ""}
              ! 👋
            </Text>
            <Text style={styles.subtitle}>
              Para terminar de crear tu cuenta, dinos cómo quieres usar
              MiBabysitter.cl:
            </Text>

            <TouchableOpacity
              style={[styles.roleCard, styles.roleCardParent]}
              onPress={() => handleSelectRole("parent")}
              disabled={savingRole}
            >
              <Text style={styles.roleCardEmoji}>👨‍👩‍👧</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.roleCardTitle}>Busco una Niñera</Text>
                <Text style={styles.roleCardDesc}>
                  Quiero encontrar y reservar niñeras de confianza para mi
                  familia.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleCard, styles.roleCardSitter]}
              onPress={() => handleSelectRole("babysitter")}
              disabled={savingRole}
            >
              <Text style={styles.roleCardEmoji}>👩‍🍼</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.roleCardTitle}>
                  Quiero trabajar como Niñera
                </Text>
                <Text style={styles.roleCardDesc}>
                  Quiero publicar mi disponibilidad, tarifa por hora y recibir
                  turnos.
                </Text>
              </View>
            </TouchableOpacity>

            {savingRole && (
              <ActivityIndicator
                size="small"
                color="#3182ce"
                style={{ marginTop: 12 }}
              />
            )}

            <TouchableOpacity
              style={styles.switchAccountBtn}
              onPress={handleSignOut}
              disabled={savingRole}
            >
              <Text style={styles.switchAccountText}>
                Usar otra cuenta de correo
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.title}>¡Bienvenido! 👋</Text>
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>

            {isAdminTester ? (
              <View style={styles.adminFastSwitchContainer}>
                <Text style={styles.adminFastSwitchTitle}>
                  Modo Pruebas Activado
                </Text>
                <Text style={styles.adminFastSwitchSub}>
                  Elige la vista a la que quieres entrar:
                </Text>

                <TouchableOpacity
                  style={[
                    styles.button,
                    { backgroundColor: "#38a169", marginBottom: 12 },
                  ]}
                  onPress={() => navigateWithPendingRequest("/parent")}
                >
                  <Text style={styles.buttonText}>👨‍👩‍👧 Entrar como PADRE</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.button,
                    { backgroundColor: "#805ad5", marginBottom: 12 },
                  ]}
                  onPress={() => navigateWithPendingRequest("/babysitter")}
                >
                  <Text style={styles.buttonText}>👩‍🍼 Entrar como NIÑERA</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.button,
                    { backgroundColor: "#dd6b20", marginBottom: 16 },
                  ]}
                  onPress={() => navigateWithPendingRequest("/admin")}
                >
                  <Text style={styles.buttonText}>
                    🗼 Entrar a TORRE DE CONTROL
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.switchAccountBtn}
                  onPress={handleSignOut}
                >
                  <Text style={styles.switchAccountText}>Cerrar Sesión</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.googleButton}
                  onPress={handleGoogleLogin}
                  disabled={loadingGoogle || loading}
                >
                  {loadingGoogle ? (
                    <ActivityIndicator color="#2d3748" />
                  ) : (
                    <View style={styles.googleButtonInner}>
                      <View style={styles.googleBadge}>
                        <Text style={styles.googleBadgeText}>G</Text>
                      </View>
                      <Text style={styles.googleButtonText}>
                        Continuar con Google
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>
                    o ingresa con tu correo
                  </Text>
                  <View style={styles.dividerLine} />
                </View>

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
                      <Text style={styles.eyeIcon}>
                        {showPassword ? "🙈" : "👁️"}
                      </Text>
                    </TouchableOpacity>
                  </View>

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
                  disabled={loading || loadingGoogle}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Iniciar Sesión</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.registerContainer}>
                  <Text style={styles.registerText}>
                    ¿No tienes una cuenta?{" "}
                  </Text>
                  <TouchableOpacity onPress={() => router.push("/register")}>
                    <Text style={styles.registerLink}>Regístrate</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
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
    padding: 24,
    backgroundColor: "#fff",
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#1a202c",
    marginBottom: 8,
  },
  subtitle: { fontSize: 16, color: "#718096", marginBottom: 28 },

  googleButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#cbd5e0",
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  googleButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ebf8ff",
    borderWidth: 1,
    borderColor: "#90cdf4",
    alignItems: "center",
    justifyContent: "center",
  },
  googleBadgeText: {
    color: "#2b6cb0",
    fontWeight: "bold",
    fontSize: 14,
  },
  googleButtonText: {
    color: "#1a202c",
    fontSize: 16,
    fontWeight: "600",
  },

  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e2e8f0",
  },
  dividerText: {
    fontSize: 13,
    color: "#a0aec0",
    fontWeight: "500",
  },

  inputContainer: { marginBottom: 24 },
  label: { fontSize: 14, fontWeight: "600", color: "#4a5568", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: "#f7fafc",
  },
  passwordWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    backgroundColor: "#f7fafc",
    marginBottom: 8,
  },
  passwordInput: { flex: 1, padding: 12, fontSize: 16 },
  eyeButton: { padding: 12 },
  eyeIcon: { fontSize: 20 },
  forgotPasswordButton: { alignSelf: "flex-end", marginBottom: 8 },
  forgotPasswordText: { color: "#3182ce", fontSize: 14, fontWeight: "600" },
  button: {
    backgroundColor: "#3182ce",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  registerContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 24,
  },
  registerText: { color: "#4a5568", fontSize: 15 },
  registerLink: { color: "#3182ce", fontSize: 15, fontWeight: "bold" },
  adminFastSwitchContainer: {
    backgroundColor: "#f8fafc",
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  adminFastSwitchTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2d3748",
    marginBottom: 8,
    textAlign: "center",
  },
  adminFastSwitchSub: {
    fontSize: 14,
    color: "#718096",
    marginBottom: 24,
    textAlign: "center",
  },

  roleSelectionBox: {
    width: "100%",
  },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 14,
    gap: 14,
  },
  roleCardParent: {
    backgroundColor: "#f0fff4",
    borderColor: "#9ae6b4",
  },
  roleCardSitter: {
    backgroundColor: "#faf5ff",
    borderColor: "#d6bcfa",
  },
  roleCardEmoji: {
    fontSize: 32,
  },
  roleCardTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#1a202c",
    marginBottom: 4,
  },
  roleCardDesc: {
    fontSize: 13,
    color: "#4a5568",
    lineHeight: 18,
  },
  switchAccountBtn: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 8,
  },
  switchAccountText: {
    color: "#718096",
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
