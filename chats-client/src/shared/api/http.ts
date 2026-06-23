import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../../store/auth.store';

// const API_URL = 'http://localhost:9999'; // Android emulator
const API_URL = 'http://13.63.159.111/'; // Android emulator

export const http = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Accept':'application/json',
    'Content-Type':'application/json'
  },
});
http.interceptors.request.use(
  async (config) => {
    const storeToken = useAuthStore.getState().token;
    const storageToken = await AsyncStorage.getItem('accessToken');
    const token = storeToken || storageToken;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      console.warn('[http] request without access token', {
        method: config.method,
        url: config.url,
      });
    }

    return config;
  },
  (error) => Promise.reject(error),
);

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn('[http] 401 Unauthorized', {
        method: error.config?.method,
        url: error.config?.url,
      });
    }

    return Promise.reject(error);
  },
);
