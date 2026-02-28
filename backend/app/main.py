import time
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError
from app.database import Base, engine
from app.routers import auth

# Import models so SQLAlchemy registers them for table creation
import app.models.user  # noqa: F401

logger = logging.getLogger(__name__)

app = FastAPI(
    title="SmartChange API",
    description="AI-Driven Virtual Micro-Investment Platform for Students",
    version="1.0.0"
)

# CORS – allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phase 1 – Authentication
app.include_router(auth.router)


@app.on_event("startup")
def startup_db():
    """Wait for Postgres to be ready, then create all tables."""
    retries = 10
    for attempt in range(retries):
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("✅ Database tables created successfully.")
            return
        except OperationalError as e:
            wait = 2 ** attempt  # exponential back-off: 1s, 2s, 4s, 8s…
            logger.warning(f"⏳ DB not ready (attempt {attempt + 1}/{retries}), retrying in {wait}s… {e}")
            time.sleep(wait)

    raise RuntimeError("❌ Could not connect to the database after multiple retries.")


@app.get("/", tags=["Health"])
def health_check():
    return {"status": "ok", "message": "SmartChange Backend Running 🚀"}