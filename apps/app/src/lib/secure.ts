import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Stockage des jetons : trousseau chiffré sur iOS / Android, stockage du navigateur sur le web. */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') { try { return localStorage.getItem(key); } catch { return null; } }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') { try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ } return; }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') { try { localStorage.removeItem(key); } catch { /* ignoré */ } return; }
    await SecureStore.deleteItemAsync(key);
  }
};
