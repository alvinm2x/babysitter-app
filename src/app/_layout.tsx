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
  const [session, setSession] = useState<any>(null);

  // ESTADO ATÓMICO: Garantiza que el rol y el admin se evalúen exactamente al mismo tiempo
  const [authData, setAuthData] = useState({
    isLoaded: false,
    role: null as string | null,
    isAdmin: false,
  });

  const isRecoveryFlow = useRef<boolean>(false);
  const router = useRouter();
  const segments = useSegments();

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

      // Actualización atómica en un solo golpe
      setAuthData({ isLoaded: true, role: userRole, isAdmin: adminFlag });
    } catch (err) {
      console.error("Error al obtener el rol:", err);
      setAuthData({
        isLoaded: true,
        role: user?.user_metadata?.role || null,
        isAdmin: false,
      });
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      if (initialSession) {
        fetchUserRole(initialSession.user);
      } else {
        setAuthData((prev) => ({ ...prev, isLoaded: true }));
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (event === "PASSWORD_RECOVERY") {
        isRecoveryFlow.current = true;
        setSession(currentSession);
        setAuthData((prev) => ({ ...prev, isLoaded: true }));
        router.replace("/update-password" as any);
        return;
      }

      if (event === "SIGNED_OUT") {
        isRecoveryFlow.current = false;
        setSession(null);
        setAuthData({ isLoaded: true, role: null, isAdmin: false });
        return;
      }

      setSession(currentSession);
      if (currentSession) {
        if (!isRecoveryFlow.current) {
          await fetchUserRole(currentSession.user);
        } else {
          setAuthData((prev) => ({ ...prev, isLoaded: true }));
        }
      } else {
        setAuthData({ isLoaded: true, role: null, isAdmin: false });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authData.isLoaded) {
      SplashScreen.hideAsync();
    }
  }, [authData.isLoaded]);

  // Protección de rutas y redirecciones automáticas por rol
  useEffect(() => {
    if (!authData.isLoaded) return;

    const currentSegment = segments[0] as string | undefined;
    const isWebOnUpdatePassword =
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      window.location.pathname.includes("update-password");

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

    if (currentSegment === "forgot-password" || currentSegment === "register") {
      return;
    }

    const inProtectedGroup =
      currentSegment === "parent" ||
      currentSegment === "babysitter" ||
      currentSegment === "admin";

    if (session) {
      // Si es Admin, tiene pase libre a cualquier pantalla, nunca se redirige
      if (authData.isAdmin) {
        return;
      }

      if (!authData.role && inProtectedGroup) {
        router.replace("/");
        return;
      }

      if (authData.role === "parent" && currentSegment !== "parent") {
        router.replace("/parent");
      } else if (
        authData.role === "babysitter" &&
        currentSegment !== "babysitter"
      ) {
        router.replace("/babysitter");
      }
    } else if (!session && inProtectedGroup) {
      router.replace("/");
    }
  }, [session, authData, segments]);

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      {!authData.isLoaded ? (
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
