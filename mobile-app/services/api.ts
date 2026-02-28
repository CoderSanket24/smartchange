import axios from "axios";
import * as SecureStore from "expo-secure-store";

// Physical device (Expo Go): use your machine's LAN IP
// Android emulator: use 10.0.2.2 instead
export const BASE_URL = "http://172.168.0.207:8000";

export const API = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// Attach JWT token to every request
API.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth helpers
export const authApi = {
  register: (email: string, username: string, password: string) =>
    API.post("/auth/register", { email, username, password }),
  login: (email: string, password: string) =>
    API.post("/auth/login", { email, password }),
  me: () => API.get("/auth/me"),
};

// Wallet helpers
export const walletApi = {
  balance: () => API.get("/wallet/balance"),
  summary: () => API.get("/wallet/summary"),
  addTransaction: (amount: number, description?: string) =>
    API.post("/wallet/transaction", { amount, description, transaction_type: "purchase" }),
};

// Portfolio helpers
export const portfolioApi = {
  stocks: () => API.get("/portfolio/stocks"),
  invest: (stock_symbol: string, amount: number) =>
    API.post("/portfolio/invest", { stock_symbol, amount }),
  holdings: () => API.get("/portfolio/holdings"),
  performance: () => API.get("/portfolio/performance"),
};

// AI helpers
export const aiApi = {
  recommend: (amount: number, top_n: number = 4) =>
    API.get(`/ai/recommend?amount=${amount}&top_n=${top_n}`),
  explain: (symbol: string) => API.get(`/ai/explain/${symbol}`),
};