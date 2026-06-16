import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/store/authStore';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';
import { BASE_URL_KEY } from '@/api/client';

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login, init, isLoading } = useAuthStore();

  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    init();
    AsyncStorage.getItem(BASE_URL_KEY).then((url) => {
      if (url) setServerUrl(url);
    });
  }, []);

  const handleLogin = async () => {
    if (!serverUrl.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Campos requeridos', 'Rellena todos los campos');
      return;
    }
    setLoading(true);
    try {
      await login(serverUrl.trim(), email.trim(), password);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Error de conexión';
      Alert.alert('Error al iniciar sesión', msg);
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashLogo}>Trek</Text>
        <ActivityIndicator color={COLORS.primary} size="large" style={{ marginTop: 32 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>T</Text>
          </View>
          <Text style={styles.appName}>Trek Wanderer</Text>
          <Text style={styles.tagline}>Tu diario de viaje, en el bolsillo</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.sectionLabel}>SERVIDOR</Text>
          <TextInput
            style={styles.input}
            placeholder="https://tu-trek.com"
            placeholderTextColor="#9CA3AF"
            value={serverUrl}
            onChangeText={setServerUrl}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>CUENTA</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#9CA3AF"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            placeholder="Contraseña"
            placeholderTextColor="#9CA3AF"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Iniciar sesión</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  splashLogo: { fontSize: 52, fontWeight: '800', color: COLORS.primary, letterSpacing: -2 },

  container: { flexGrow: 1, backgroundColor: '#F9FAFB', paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 48 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center',
    marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  logoText: { fontSize: 36, fontWeight: '800', color: COLORS.primary },
  appName: { fontSize: 28, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 },
  tagline: { ...TYPE.body, color: COLORS.textMuted, marginTop: 6 },

  form: { gap: 0 },
  sectionLabel: { ...TYPE.caption, color: COLORS.textMuted, marginBottom: 8, marginLeft: 2 },
  input: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: COLORS.text,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  loginBtn: {
    backgroundColor: COLORS.primaryDark, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 28,
    shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },
});
