from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class AddTransactionRequest(BaseModel):
    amount: float = Field(..., gt=0, description="Purchase amount in ₹ (e.g. 47.50)")
    transaction_type: str = Field(default="purchase", description="purchase | manual")
    description: Optional[str] = None


class WalletOut(BaseModel):
    id: int
    user_id: int
    balance: float

    class Config:
        from_attributes = True


class TransactionOut(BaseModel):
    id: int
    original_amount: float
    rounded_amount: float
    round_up_amount: float
    transaction_type: str
    description: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class WalletSummaryOut(BaseModel):
    balance: float
    total_invested: float
    transaction_count: int
    transactions: List[TransactionOut]
