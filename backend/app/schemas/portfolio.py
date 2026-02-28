from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional


class InvestRequest(BaseModel):
    stock_symbol: str = Field(..., description="e.g. RELIANCE, TCS, INFY")
    amount: float = Field(..., gt=0, description="Amount in ₹ to invest from wallet")


class HoldingOut(BaseModel):
    id: int
    stock_symbol: str
    stock_name: str
    shares: float
    avg_buy_price: float
    invested_amount: float
    invested_at: datetime

    class Config:
        from_attributes = True


class HoldingPerformanceOut(BaseModel):
    stock_symbol: str
    stock_name: str
    shares: float
    avg_buy_price: float
    current_price: float
    invested_amount: float
    current_value: float
    profit_loss: float
    profit_loss_pct: float

    class Config:
        from_attributes = True


class PortfolioSummaryOut(BaseModel):
    total_invested: float
    current_value: float
    total_profit_loss: float
    total_profit_loss_pct: float
    holdings: List[HoldingPerformanceOut]
