# 💸 SmartChange

> **AI-powered micro-investment platform** — Turn your everyday spending spare change into smart investments, guided by a PPO Reinforcement Learning agent trained on live NSE market data.

---

## 📋 Table of Contents

- [About the Project](#about-the-project)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend Setup (Docker)](#backend-setup-docker)
  - [Mobile App Setup](#mobile-app-setup)
- [Environment Variables](#environment-variables)
- [AI / PPO Model](#ai--ppo-model)
- [API Endpoints](#api-endpoints)
- [App Screens](#app-screens)
- [Contributing](#contributing)
- [License](#license)

---

## 🌟 About the Project

**SmartChange** is a full-stack mobile application that automates micro-investing by rounding up everyday transactions and directing the spare change into a personalized stock portfolio. The investment decisions are powered by a **PPO (Proximal Policy Optimization) Reinforcement Learning agent** trained on 2 years of NSE (National Stock Exchange of India) market data.

The app is designed to make investing effortless, data-driven, and accessible — even with just a few rupees at a time.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **JWT Authentication** | Secure register/login with JWT stored in AsyncStorage |
| 💰 **Round-Up Wallet** | Automatically saves spare change from every transaction |
| 📈 **Fractional Investing** | Invest any amount in NSE-listed stocks (e.g. ₹5 buys 0.00134 shares of TCS) |
| 🤖 **PPO AI Advisor** | PPO RL agent recommends optimal stock allocation based on live market data |
| 🔍 **AI Explainability** | Human-readable explanation of each stock's allocation decision |
| 📊 **Backtesting** | 3-way performance comparison: PPO vs. Equal-Weight vs. NIFTY-50 |
| 🌙 **Dark / Light Mode** | Persistent theme toggle across all screens |
| 🐳 **Dockerized Backend** | One-command startup with Docker Compose |

---

## 🛠 Tech Stack

### Backend
| Layer | Technology |
|---|---|
| API Framework | FastAPI (Python) |
| AI / RL Agent | Stable-Baselines3 (PPO), Gymnasium |
| Market Data | yfinance (NSE live data) |
| Primary DB | PostgreSQL 16 (users, wallets, portfolio) |
| Activity DB | MongoDB 7 (transaction & activity logs) |
| Auth | JWT (PyJWT) + Argon2 password hashing |
| Containerization | Docker + Docker Compose |

### Mobile App
| Layer | Technology |
|---|---|
| Framework | React Native 0.81 + Expo SDK 54 |
| Navigation | Expo Router (file-based routing) |
| HTTP Client | Axios |
| State / Auth | React Context API + AsyncStorage |
| Language | TypeScript |

---

## 🏗 Architecture

```
Mobile App (Expo / React Native)
        │
        │  HTTP  (Axios)
        ▼
FastAPI Backend  ──── PostgreSQL  (users, wallets, portfolio)
        │        ──── MongoDB     (activity logs)
        │
        ├── PPO RL Agent  (Stable-Baselines3)
        └── yfinance       (live NSE market data)
```

The backend is a single **FastAPI** service that:
1. Handles user authentication and wallet management (PostgreSQL)
2. Logs all activity (MongoDB)
3. Serves live AI recommendations via a pre-trained **PPO MlpPolicy** model
4. Fetches real-time NSE stock data using **yfinance**

---

## 📁 Project Structure

```
smartchange/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI entry point & CORS
│       ├── database.py             # PostgreSQL + MongoDB connections
│       ├── dependencies.py         # JWT auth dependency injection
│       ├── models/                 # SQLAlchemy ORM models
│       ├── schemas/                # Pydantic request/response schemas
│       ├── routers/
│       │   ├── ai.py               # /ai/* endpoints
│       │   ├── portfolio.py        # /portfolio/* + STOCK_UNIVERSE
│       │   └── wallet.py           # /wallet/*
│       ├── services/               # Business logic layer
│       └── ai/
│           ├── rl_env.py           # Custom Gymnasium environment
│           ├── rl_train.py         # PPO training script
│           ├── rl_inference.py     # Live PPO inference + explain
│           ├── rl_backtest.py      # PPO vs EW vs NIFTY-50 backtest
│           └── models/             # Saved model artefacts (gitignored)
│               ├── ppo_smartchange.zip
│               ├── vecnormalize.pkl
│               ├── model_meta.json
│               └── split_meta.json
│
├── mobile-app/
│   ├── app.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── context/
│   │   ├── AuthContext.tsx         # JWT auth state management
│   │   └── ThemeContext.tsx        # Light/dark theme tokens (29 tokens)
│   ├── app/
│   │   ├── _layout.tsx             # Root layout (ThemeProvider + AuthProvider)
│   │   ├── auth/
│   │   │   ├── login.tsx
│   │   │   └── register.tsx
│   │   └── (tabs)/
│   │       ├── _layout.tsx         # Tab bar (theme-aware)
│   │       ├── index.tsx           # Home + theme toggle
│   │       ├── wallet.tsx          # Round-up wallet
│   │       ├── portfolio.tsx       # Holdings + invest
│   │       └── ai.tsx              # PPO recommendations
│   └── services/
│       └── api.ts                  # Axios API client (base URL config)
│
├── docker-compose.yml
├── .env                            # Environment variables (not committed)
├── .gitignore
└── APP_WORKFLOW.md                 # Detailed workflow documentation
```

---

## 🚀 Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for backend)
- [Node.js](https://nodejs.org/) v18+ and npm
- [Expo CLI](https://docs.expo.dev/get-started/installation/) — `npm install -g expo-cli`
- [Expo Go](https://expo.dev/client) app on your Android/iOS device (for testing)

---

### Backend Setup (Docker)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/smartchange.git
   cd smartchange
   ```

2. **Create your `.env` file** (see [Environment Variables](#environment-variables) below).

3. **Start all services:**
   ```bash
   docker-compose up --build
   ```
   This starts:
   - `smartchange_backend` — FastAPI at `http://localhost:8000`
   - `smartchange_postgres` — PostgreSQL at `localhost:5432`
   - `smartchange_mongo` — MongoDB at `localhost:27017`

4. **Verify the API is running:**
   ```
   http://localhost:8000/docs   ← Interactive Swagger UI
   ```

---

### Train the PPO Model (One-Time)

The AI model must be trained before recommendations work. Run the training script inside the container:

```bash
# Train the PPO agent (takes a few minutes)
docker exec -it smartchange_backend python app/ai/rl_train.py

# Generate backtest results
docker exec -it smartchange_backend python app/ai/rl_backtest.py
```

> **Note:** If the model is not trained, the AI advisor automatically falls back to an **Equal-Weight** allocation strategy.

---

### Mobile App Setup

1. **Navigate to the mobile app directory:**
   ```bash
   cd mobile-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure the API base URL** in `services/api.ts`:
   ```typescript
   // Replace with your machine's local IP address
   const BASE_URL = "http://192.168.x.x:8000";
   ```
   > Use your **local network IP** (not `localhost`) so your physical device can reach the backend.

4. **Start the Expo development server:**
   ```bash
   npm start
   ```

5. **Scan the QR code** with the Expo Go app on your device.

---

## 🔑 Environment Variables

Create a `.env` file in the project root with the following:

```env
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=smartchange
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/smartchange

# MongoDB
MONGO_URL=mongodb://mongo:27017

# JWT
SECRET_KEY=your-super-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

---

## 🤖 AI / PPO Model

### Stock Universe (NSE)

The PPO agent is trained on **8 large-cap NSE stocks**:

`RELIANCE` · `TCS` · `INFY` · `HDFCBANK` · `WIPRO` · `ITC` · `TATASTEEL` · `AXISBANK`

### Input Features (per stock, per step)

| Feature | Description |
|---|---|
| `log_return` | `log(close_t / close_{t-1})` |
| `sma14_norm` | 14-day SMA, normalized to [0, 1] |
| `volatility14_norm` | 14-day rolling std / episode max |
| `rsi14_norm` | RSI(14) / 100 |
| `momentum_5d` | 5-day price % change |

### Training Details

| Parameter | Value |
|---|---|
| Algorithm | PPO (MlpPolicy) |
| Training Data | 2 years daily OHLCV |
| Train/Test Split | 75% / 25% (temporal, no leakage) |
| Timesteps | 100,000 |
| Reward Function | Portfolio log-return − λ × rolling_volatility (Sharpe-like) |
| Data Source | Yahoo Finance via yfinance |

### Inference Pipeline

```
User Input: ₹ amount + top-N stocks
         ↓
Live 90-day OHLCV fetched from yfinance
         ↓
5 features computed per stock
         ↓
Observation normalized via frozen VecNormalize stats
         ↓
PPO.predict(obs, deterministic=True)
         ↓
Raw weights → clip negatives → L1-normalize → portfolio allocation
         ↓
Suggested ₹ amount per stock returned to UI
```

---

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Register a new user |
| `POST` | `/auth/login` | Login and receive JWT |

### Wallet
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/wallet/summary` | Get wallet balance & investment total |
| `POST` | `/wallet/transaction` | Log a transaction (triggers round-up) |

### Portfolio
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/portfolio/performance` | Get portfolio value & P&L |
| `GET` | `/portfolio/stocks` | List current holdings |
| `POST` | `/portfolio/invest` | Invest from wallet into a stock |

### AI Advisor
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/ai/recommend` | Get PPO stock allocation recommendations |
| `GET` | `/ai/explain/{symbol}` | Get feature breakdown & decision reason |
| `GET` | `/ai/model-info` | View model card & performance metrics |
| `GET` | `/ai/backtest` | PPO vs Equal-Weight vs NIFTY-50 comparison |

> 📖 Full interactive API documentation available at `http://localhost:8000/docs`

---

## 📱 App Screens

| Screen | Description |
|---|---|
| **Login / Register** | JWT-based auth; token persisted in AsyncStorage |
| **Home** | Wallet balance, portfolio value, total P&L, theme toggle |
| **Wallet** | Log purchases, view round-up history, investment balance |
| **Portfolio** | Holdings list, fractional shares, invest button |
| **AI Advisor** | Run PPO analysis, view allocations, read AI explanations |

### Theme System
- 🌙 **Dark:** `#0A0E1A` background · `#00D4FF` accent
- ☀️ **Light:** `#F0F4FF` background · `#0284C7` accent
- Persisted across sessions via `AsyncStorage`
- 29 design tokens per theme

---

## 🐳 Docker Services

| Container | Image | Port |
|---|---|---|
| `smartchange_backend` | Custom (FastAPI) | `8000` |
| `smartchange_postgres` | `postgres:16-alpine` | `5432` |
| `smartchange_mongo` | `mongo:7` | `27017` |

**Useful commands:**
```bash
# Start services in background
docker-compose up -d

# View backend logs
docker-compose logs -f backend

# Stop all services
docker-compose down

# Stop and remove volumes (fresh start)
docker-compose down -v
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Open a Pull Request

---

## 📄 License

This project is developed as part of an **Entrepreneurship Development Initiative (EDI)** academic project.

---

<div align="center">
  <p>Made with ❤️ using FastAPI, React Native, and Reinforcement Learning</p>
</div>
