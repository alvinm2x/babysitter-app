import { supabase } from '@/utils/supabase';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'parent' | 'babysitter'>('parent');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!email || !password || !fullName) {
      Alert.alert('Campos requeridos', 'Por favor completa todos los campos.');
      return;
    }

    setLoading(true);

    try {
      // 1. Crear usuario en Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, role: role },
        },
      });

      if (error) throw error;

      // 2. Guardar explícitamente en la tabla de perfiles antes de redirigir
      if (data.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: data.user.id,
            full_name: fullName,
            role: role,
          });

        if (profileError) throw profileError;
      }

      Alert.alert('¡Cuenta creada!', `Registrado como ${role === 'babysitter' ? 'Babysitter' : 'Familia'}`);
      
      // Redirigir según el rol seleccionado
      if (role === 'babysitter') {
        router.replace('/(babysitter)');
      } else {
        router.replace('/(parent)');
      }
    } catch (err: any) {
      Alert.alert('Error al registrar', err.message || 'Ocurrió un error inesperado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crear Cuenta 👶</Text>
      <Text style={styles.subtitle}>Selecciona tu perfil e ingresa tus datos</Text>

      {/* Seleccionar Rol */}
      <View style={styles.roleContainer}>
        <TouchableOpacity
          style={[styles.roleButton, role === 'parent' && styles.roleButtonActive]}
          onPress={() => setRole('parent')}
        >
          <Text style={[styles.roleText, role === 'parent' && styles.roleTextActive]}>🏡 Familia</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.roleButton, role === 'babysitter' && styles.roleButtonActive]}
          onPress={() => setRole('babysitter')}
        >
          <Text style={[styles.roleText, role === 'babysitter' && styles.roleTextActive]}>🍼 Babysitter</Text>
        </TouchableOpacity>
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

      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Registrarse</Text>}
      </TouchableOpacity>

      <Link href="/" style={styles.link}>
        ¿Ya tienes cuenta? Inicia sesión aquí
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#F7F9FC' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1A202C', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#718096', marginBottom: 24 },
  roleContainer: { flexDirection: 'row', gap: 12, marginBottom: 20, width: '100%', maxWidth: 400 },
  roleButton: { flex: 1, paddingVertical: 12, borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, alignItems: 'center', backgroundColor: '#FFF' },
  roleButtonActive: { backgroundColor: '#3182CE', borderColor: '#3182CE' },
  roleText: { color: '#4A5568', fontWeight: '600' },
  roleTextActive: { color: '#FFF' },
  input: { width: '100%', maxWidth: 400, height: 48, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 16, marginBottom: 12, fontSize: 16 },
  button: { width: '100%', maxWidth: 400, height: 48, backgroundColor: '#3182CE', justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginTop: 8 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  link: { marginTop: 20, color: '#3182CE', fontSize: 14, textDecorationLine: 'underline' },
});