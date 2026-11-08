import {
  DarkTheme,
  DefaultTheme,
  Slot,
  ThemeProvider,
  useRouter,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
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

  // CANDADO SÍNCRONO: Inmune a retrasos de estado o limpiezas de URL de Supabase
  const isRecoveryFlow = useRef<boolean>(false);

  const router = useRouter();
  const segments = useSegments();

  // Detectar de inmediato (antes del primer render) si venimos del correo de recuperación
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const fullUrl = window.location.href;
    if (
      fullUrl.includes("type=recovery") ||
      window.location.pathname.includes("update-password")
    ) {
      isRecoveryFlow.current = true;
    }
  }

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
      console.log("🔔 AUTH EVENT:", event);

      if (event === "PASSWORD_RECOVERY") {
        isRecoveryFlow.current = true;
        setSession(session);
        setIsLoading(false);
        router.replace("/update-password" as any);
        return;
      }

      if (event === "SIGNED_OUT") {
        isRecoveryFlow.current = false;
        setSession(null);
        setRole(null);
        setIsAdmin(false);
        setIsLoading(false);
        return;
      }

      setSession(session);
      if (session) {
        // CRÍTICO: NO activar setIsLoading(true) si estamos en recuperación,
        // porque desmonta <Slot /> y destruye la pantalla update-password.
        if (!isRecoveryFlow.current) {
          await fetchUserRole(session.user);
        } else {
          setIsLoading(false);
        }
      } else {
        setRole(null);
        setIsAdmin(false);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  // Protección de rutas y redirecciones automáticas por rol
  useEffect(() => {
    if (isLoading) return;

    const currentSegment = segments[0] as string | undefined;
    const isWebOnUpdatePassword =
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      window.location.pathname.includes("update-password");

    // FRENO ABSOLUTO: Si el candado está activo o estamos en /update-password, NO MOVER AL USUARIO
    if (
      isRecoveryFlow.current ||
      currentSegment === "update-password" ||
      isWebOnUpdatePassword
    ) {
      if (currentSegment !== "update-password") {
        router.replace("/update-password" as any);
      }
      return;
    }

    // Permitir pantalla de forgot-password y register libremente
    if (currentSegment === "forgot-password" || currentSegment === "register") {
      return;
    }

    const inProtectedGroup =
      currentSegment === "parent" ||
      currentSegment === "babysitter" ||
      currentSegment === "admin";

    if (session) {
      if (isAdmin) {
        return;
      }

      if (!role && inProtectedGroup) {
        router.replace("/");
        return;
      }

      if (role === "parent" && currentSegment !== "parent") {
        router.replace("/parent");
      } else if (role === "babysitter" && currentSegment !== "babysitter") {
        router.replace("/babysitter");
      }
    } else if (!session && inProtectedGroup) {
      router.replace("/");
    }
  }, [session, role, isAdmin, isLoading, segments]);

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
