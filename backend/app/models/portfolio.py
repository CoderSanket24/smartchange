from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, func
from app.database import Base


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    stock_symbol = Column(String, nullable=False)       # e.g. "RELIANCE"
    stock_name = Column(String, nullable=False)         # e.g. "Reliance Industries"
    shares = Column(Float, default=0.0, nullable=False) # e.g. 0.05 fractional shares
    avg_buy_price = Column(Float, nullable=False)       # price at time of investment
    invested_amount = Column(Float, nullable=False)     # actual ₹ put in
    invested_at = Column(DateTime(timezone=True), server_default=func.now())
