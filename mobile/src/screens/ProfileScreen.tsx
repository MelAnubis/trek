import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{user?.username?.[0]?.toUpperCase() ?? '?'}</Text>
      </View>
      <Text style={styles.name}>{user?.username ?? 'Usuario'}</Text>
      <Text style={styles.email}>{user?.email ?? ''}</Text>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', alignItems: 'center', paddingHorizontal: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  name: { ...TYPE.h2, color: COLORS.text },
  email: { ...TYPE.body, color: COLORS.textMuted, marginTop: 4, marginBottom: 40 },
  logoutBtn: {
    width: '100%', paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: COLORS.danger, alignItems: 'center',
  },
  logoutText: { ...TYPE.label, color: COLORS.danger, fontSize: 15 },
});
