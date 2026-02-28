from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, func
from app.database import Base


class Wallet(Base):
    __tablename__ = "wallets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    balance = Column(Float, default=0.0, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    original_amount = Column(Float, nullable=False)           # e.g. ₹47.50
    rounded_amount = Column(Float, nullable=False)            # e.g. ₹48.00
    round_up_amount = Column(Float, nullable=False)           # e.g. ₹0.50 → invested
    transaction_type = Column(String, default="purchase")     # purchase | manual
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
