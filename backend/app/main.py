import time
import logging
import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError
from app.database import Base, engine
from app.routers import auth, wallet, portfolio, ai, notifications

# Import ALL models so SQLAlchemy registers them for table creation
import app.models.user       # noqa: F401
import app.models.wallet     # noqa: F401
import app.models.portfolio  # noqa: F401

logger = logging.getLogger(__name__)

app = FastAPI(
    title="SmartChange API",
    description="AI-Driven Virtual Micro-Investment Platform for Students",
    version="4.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)            # Phase 1 – Authentication
app.include_router(wallet.router)          # Phase 2 – Virtual Wallet
app.include_router(portfolio.router)       # Phase 3 – Portfolio
app.include_router(ai.router)              # Phase 4 – AI Recommendations
app.include_router(notifications.router)   # Phase 5 – Notifications


@app.on_event("startup")
def startup_db():
    """Wait for Postgres to be ready, then create all tables."""
    retries = 10
    for attempt in range(retries):
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("✅ Database tables created successfully.")
            break
        except OperationalError:
            wait = 2 ** attempt
            logger.warning(f"⏳ DB not ready (attempt {attempt + 1}/{retries}), retrying in {wait}s…")
            time.sleep(wait)
    else:
        raise RuntimeError("❌ Could not connect to database after multiple retries.")

    # Pre-warm the PPO model in a background thread so the first API request
    # doesn't block. The model load + yfinance fetch takes ~5-15 s on cold start.
    def _prewarm():
        try:
            logger.info("🔥 Pre-warming PPO model in background…")
            from app.ai.rl_inference import _try_load_model
            _try_load_model()
            logger.info("✅ PPO model pre-warm complete.")
        except Exception as exc:
            logger.warning(f"⚠️  PPO pre-warm failed (non-fatal): {exc}")

    t = threading.Thread(target=_prewarm, daemon=True, name="ppo-prewarm")
    t.start()


@app.get("/", tags=["Health"])
def health_check():
    return {"status": "ok", "message": "SmartChange Backend Running 🚀"}