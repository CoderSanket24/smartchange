import math
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.wallet import Wallet, Transaction
from app.models.user import User
from app.schemas.wallet import AddTransactionRequest, WalletOut, TransactionOut, WalletSummaryOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/wallet", tags=["Wallet"])


def _get_or_create_wallet(user_id: int, db: Session) -> Wallet:
    """Return existing wallet or create one with zero balance."""
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if not wallet:
        wallet = Wallet(user_id=user_id, balance=0.0)
        db.add(wallet)
        db.commit()
        db.refresh(wallet)
    return wallet


def _calculate_round_up(amount: float) -> tuple[float, float]:
    """
    Round up amount to the next whole rupee.
    Returns (rounded_amount, round_up_amount).
    e.g. 47.30 → (48.0, 0.70)
    """
    rounded = math.ceil(amount)
    round_up = round(rounded - amount, 2)
    # If amount is already whole (e.g. 48.00), round up by ₹1
    if round_up == 0:
        rounded += 1
        round_up = 1.0
    return float(rounded), round_up


@router.post("/transaction", response_model=WalletOut, status_code=status.HTTP_201_CREATED)
def add_transaction(
    payload: AddTransactionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Log a purchase transaction, apply round-up to the next ₹,
    and credit the spare change to the investment wallet.
    """
    rounded_amount, round_up = _calculate_round_up(payload.amount)

    # Record the transaction
    txn = Transaction(
        user_id=current_user.id,
        original_amount=payload.amount,
        rounded_amount=rounded_amount,
        round_up_amount=round_up,
        transaction_type=payload.transaction_type,
        description=payload.description
    )
    db.add(txn)

    # Credit round-up to wallet
    wallet = _get_or_create_wallet(current_user.id, db)
    wallet.balance = round(wallet.balance + round_up, 2)
    db.commit()
    db.refresh(wallet)

    return wallet


@router.get("/balance", response_model=WalletOut)
def get_balance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return current investment wallet balance."""
    wallet = _get_or_create_wallet(current_user.id, db)
    return wallet


@router.get("/transactions", response_model=List[TransactionOut])
def get_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return full transaction history for the current user."""
    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id)
        .order_by(Transaction.created_at.desc())
        .all()
    )
    return txns


@router.get("/summary", response_model=WalletSummaryOut)
def get_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return wallet balance + total invested + transaction list."""
    wallet = _get_or_create_wallet(current_user.id, db)
    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id)
        .order_by(Transaction.created_at.desc())
        .all()
    )
    total_invested = sum(t.round_up_amount for t in txns)
    return WalletSummaryOut(
        balance=wallet.balance,
        total_invested=round(total_invested, 2),
        transaction_count=len(txns),
        transactions=txns
    )
