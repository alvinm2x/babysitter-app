import { supabase } from '@/utils/supabase';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Fase 1: Estado para la visibilidad de la contraseña
  const [showPassword, setShowPassword] = useState(false);
  
  // Atajo rápido para pruebas de cuentas Admin
  const [isAdminTester, setIsAdminTester] = useState(false);

  // Soporte de alertas nativas en Web y Móvil
  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      showAlert('Error', 'Por favor ingresa correo y contraseña.');
      return;
    }

    setLoading(true);
    console.log('Intentando autenticación con:', cleanEmail);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: password,
    });

    setLoading(false);

    if (error) {
      console.error('❌ Error de autenticación:', error.message);
      showAlert('Error de Inicio de Sesión', error.message);
    } else {
      console.log('✅ Autenticación exitosa para:', data.user?.email);
      
      // Chequear si es Admin para activar el panel de atajos de pruebas cruzadas
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', data.user?.id)
        .single();
        
      if (profile?.is_admin) {
        setIsAdminTester(true);
      } else {
        router.replace('/parent');
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>¡Bienvenido! 👋</Text>
      <Text style={styles.subtitle}>Inicia sesión para continuar</Text>

      {isAdminTester ? (
        <View style={styles.adminFastSwitchContainer}>
          <Text style={styles.adminFastSwitchTitle}>Modo Pruebas (Admin) Activado</Text>
          <Text style={styles.adminFastSwitchSub}>Elige la vista a la que quieres entrar con esta cuenta:</Text>
          
          <TouchableOpacity style={[styles.button, { backgroundColor: '#38a169', marginBottom: 12 }]} onPress={() => router.replace('/parent')}>
            <Text style={styles.buttonText}>👨‍👩‍👧 Entrar como PADRE</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.button, { backgroundColor: '#805ad5', marginBottom: 12 }]} onPress={() => router.replace('/babysitter')}>
            <Text style={styles.buttonText}>👩‍🍼 Entrar como NIÑERA</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.button, { backgroundColor: '#dd6b20' }]} onPress={() => router.replace('/admin')}>
            <Text style={styles.buttonText}>🗼 Entrar a TORRE DE CONTROL (Admin)</Text>
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
              {/* TOGGLE DEL OJITO */}
              <TouchableOpacity 
                style={styles.eyeButton} 
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>
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
            <TouchableOpacity onPress={() => router.push('/register')}>
              <Text style={styles.registerLink}>Regístrate</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a202c',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#718096',
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4a5568',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: '#f7fafc',
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#f7fafc',
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
  },
  eyeButton: {
    padding: 12,
  },
  eyeIcon: {
    fontSize: 20,
  },
  button: {
    backgroundColor: '#3182ce',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  registerText: {
    color: '#4a5568',
    fontSize: 15,
  },
  registerLink: {
    color: '#3182ce',
    fontSize: 15,
    fontWeight: 'bold',
  },
  adminFastSwitchContainer: {
    backgroundColor: '#f8fafc',
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  adminFastSwitchTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 8,
    textAlign: 'center',
  },
  adminFastSwitchSub: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 24,
    textAlign: 'center',
  },
});