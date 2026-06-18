import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
  ImageBackground,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/store/authStore';
import { COLORS } from '@/theme/colors';
import { BASE_URL_KEY } from '@/api/client';

const BRAND_BG = require('../../assets/brand-bg.png');

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login, init, isLoading } = useAuthStore();

  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      const msg = e?.response?.data?.message ?? e?.message ?? 'Error de conexion';
      Alert.alert('Error al iniciar sesion', msg);
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <ImageBackground source={BRAND_BG} style={styles.splash} resizeMode="cover">
        <View style={styles.splashOverlay}>
          <View style={styles.splashLogo}>
            <Ionicons name="bicycle" size={42} color={COLORS.accent} />
          </View>
          <Text style={styles.splashName}>trekwanderer</Text>
          <ActivityIndicator color={COLORS.accent} size="large" style={{ marginTop: 40 }} />
        </View>
      </ImageBackground>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* ── Brand header with background image ── */}
        <ImageBackground
          source={BRAND_BG}
          style={styles.hero}
          resizeMode="cover"
        >
          <View style={[styles.heroOverlay, { paddingTop: insets.top + 32 }]}>
            <View style={styles.logoBadge}>
              <Ionicons name="bicycle" size={36} color={COLORS.accent} />
            </View>
            <Text style={styles.appName}>trekwanderer</Text>
            <Text style={styles.tagline}>Viaja. Explora. Descubre.</Text>
          </View>
        </ImageBackground>

        {/* ── Form ── */}
        <View style={[styles.form, { paddingBottom: insets.bottom + 32 }]}>

          <Text style={styles.formTitle}>Acceder</Text>

          <Text style={styles.fieldLabel}>SERVIDOR</Text>
          <View style={styles.inputRow}>
            <Ionicons name="server-outline" size={17} color={COLORS.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="https://tu-trek.com"
              placeholderTextColor={COLORS.textMuted}
              value={serverUrl}
              onChangeText={setServerUrl}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 20 }]}>CUENTA</Text>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={17} color={COLORS.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={COLORS.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={[styles.inputRow, { marginTop: 10 }]}>
            <Ionicons name="lock-closed-outline" size={17} color={COLORS.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Contrasena"
              placeholderTextColor={COLORS.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="log-in-outline" size={18} color="#fff" />
                <Text style={styles.loginBtnText}>Iniciar sesion</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            Introduce la URL de tu servidor Trek para conectarte.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
  },
  splashOverlay: {
    flex: 1,
    backgroundColor: 'rgba(13,43,29,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    width: 88,
    height: 88,
    borderRadius: 26,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: COLORS.accent,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  splashName: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.textInverse,
    letterSpacing: -0.5,
  },

  hero: {
    alignItems: 'center',
    paddingBottom: 44,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    overflow: 'hidden',
  },
  heroOverlay: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 44,
    backgroundColor: 'rgba(13,43,29,0.60)',
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    shadowColor: COLORS.accent,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  appName: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.textInverse,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  form: {
    flex: 1,
    backgroundColor: COLORS.cream,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 24,
    letterSpacing: -0.3,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
  },
  eyeBtn: { padding: 4 },

  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primaryDark,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 28,
    shadowColor: COLORS.primaryDark,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
});
