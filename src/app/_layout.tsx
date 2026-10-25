import { DarkTheme, DefaultTheme, Slot, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useColorScheme } from 'react-native';

import { supabase } from '@/utils/supabase';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<string | null>(null);
  const router = useRouter();
  const segments = useSegments();

  const fetchUserRole = async (user: any) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      const userRole = data?.role || user?.user_metadata?.role || null;
      console.log('🔍 ROL OBTENIDO:', userRole);
      setRole(userRole);
    } catch (err) {
      console.error('Error al obtener el rol:', err);
      setRole(user?.user_metadata?.role || null);
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        setIsLoading(true);
        await fetchUserRole(session.user);
      } else {
        setRole(null);
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

    const currentSegment = segments[0];
    const inProtectedGroup = currentSegment === 'parent' || currentSegment === 'babysitter';

    if (session) {
      // Si está autenticado pero no se ha determinado un rol válido, expulsar de rutas protegidas
      if (!role && inProtectedGroup) {
        router.replace('/');
        return;
      }

      // Redirección forzada según el rol asignado
      if (role === 'parent' && currentSegment !== 'parent') {
        router.replace('/parent');
      } else if (role === 'babysitter' && currentSegment !== 'babysitter') {
        router.replace('/babysitter');
      }
    } else if (!session && inProtectedGroup) {
      // Si no hay sesión activa e intenta ingresar a una ruta protegida
      router.replace('/');
    }
  }, [session, role, isLoading, segments]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
    justifyContent: 'center',
    alignItems: 'center',
  },
});