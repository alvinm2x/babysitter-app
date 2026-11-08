import {
  DarkTheme,
  DefaultTheme,
  Slot,
  ThemeProvider,
  useRouter,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  useColorScheme,
} from "react-native";

import { supabase } from "@/utils/supabase";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState<boolean>(false);
  const router = useRouter();
  const segments = useSegments();

  const fetchUserRole = async (user: any) => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("role, is_admin")
        .eq("id", user.id)
        .single();

      const userRole = data?.role || user?.user_metadata?.role || null;
      const adminFlag = Boolean(data?.is_admin);
      console.log("🔍 ROL OBTENIDO:", userRole, "| ADMIN:", adminFlag);
      setRole(userRole);
      setIsAdmin(adminFlag);
    } catch (err) {
      console.error("Error al obtener el rol:", err);
      setRole(user?.user_metadata?.role || null);
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // 1. Detectar en Web si entramos desde un link de recuperación antes que nada
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const urlInfo =
        window.location.hash ||
        window.location.search ||
        window.location.pathname;
      if (
        urlInfo.includes("type=recovery") ||
        urlInfo.includes("update-password")
      ) {
        setIsRecoveryMode(true);
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchUserRole(session.user);
      } else {
        setIsLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true);
        setSession(session);
        setIsLoading(false);
        router.replace("/update-password" as any);
        return;
      }

      if (event === "USER_UPDATED") {
        // Cuando termina de actualizar su contraseña, apagamos el modo recuperación
        setIsRecoveryMode(false);
      }

      setSession(session);
      if (session) {
        setIsLoading(true);
        await fetchUserRole(session.user);
      } else {
        setRole(null);
        setIsAdmin(false);
        setIsRecoveryMode(false);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Ocultar SplashScreen una vez finalizado el estado de carga
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  // Protección de rutas y redirecciones automáticas por rol
  useEffect(() => {
    if (isLoading) return;

    const currentSegment = segments[0] as string | undefined;

    // FRENO 1: Si estamos en flujo de recuperación de contraseña, forzar /update-password y NO redirigir por rol
    if (isRecoveryMode || currentSegment === "update-password") {
      if (currentSegment !== "update-password") {
        router.replace("/update-password" as any);
      }
      return;
    }

    // Permitir pantalla de forgot-password libremente
    if (currentSegment === "forgot-password") {
      return;
    }

    const inProtectedGroup =
      currentSegment === "parent" ||
      currentSegment === "babysitter" ||
      currentSegment === "admin";

    if (session) {
      // Si es Super Admin (Tester), permitirle estar en el login ('/') para elegir vista o en '/admin'
      if (isAdmin) {
        return;
      }

      // Si está autenticado pero no se ha determinado un rol válido, expulsar de rutas protegidas
      if (!role && inProtectedGroup) {
        router.replace("/");
        return;
      }

      // Redirección forzada según el rol asignado para usuarios normales
      if (role === "parent" && currentSegment !== "parent") {
        router.replace("/parent");
      } else if (role === "babysitter" && currentSegment !== "babysitter") {
        router.replace("/babysitter");
      }
    } else if (!session && inProtectedGroup) {
      // Si no hay sesión activa e intenta ingresar a una ruta protegida
      router.replace("/");
    }
  }, [session, role, isAdmin, isRecoveryMode, isLoading, segments]);

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3182CE" />
        </View>
      ) : (
        <Slot />
      )}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
