import math
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.wallet import Wallet, Transaction
from app.models.user import User
from app.schemas.wallet import AddTransactionRequest, AddMoneyRequest, WalletOut, TransactionOut, WalletSummaryOut
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
    Round up amount to the next whole rupee, then add ₹1 more.
    Returns (rounded_amount, round_up_amount).
    e.g. 47.30 → round to 48.00 (₹0.70) + ₹1 = ₹1.70 total
    e.g. 48.00 → already whole, so just add ₹1 = ₹1.00 total
    """
    rounded = math.ceil(amount)
    round_up = round(rounded - amount, 2)
    # Add ₹1 to the round-up amount
    round_up += 1.0
    rounded = amount + round_up
    return float(rounded), round_up


@router.post("/transaction", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def add_transaction(
    payload: AddTransactionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Log a purchase transaction and calculate round-up to the next ₹.
    The round-up is NOT automatically credited - user must confirm via /transaction/{id}/credit.
    """
    rounded_amount, round_up = _calculate_round_up(payload.amount)

    # Record the transaction with credited=0 (pending)
    txn = Transaction(
        user_id=current_user.id,
        original_amount=payload.amount,
        rounded_amount=rounded_amount,
        round_up_amount=round_up,
        transaction_type=payload.transaction_type,
        credited=0,  # Pending - not yet added to wallet
        description=payload.description
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)

    return txn


@router.get("/balance", response_model=WalletOut)
def get_balance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return current investment wallet balance."""
    wallet = _get_or_create_wallet(current_user.id, db)
    return wallet


@router.post("/transaction/{transaction_id}/credit", response_model=WalletOut, status_code=status.HTTP_200_OK)
def credit_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Credit a pending transaction's round-up amount to the wallet.
    Can only credit transactions that belong to the current user and are not already credited.
    """
    # Find the transaction
    txn = (
        db.query(Transaction)
        .filter(
            Transaction.id == transaction_id,
            Transaction.user_id == current_user.id
        )
        .first()
    )
    
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {transaction_id} not found."
        )
    
    if txn.credited == 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This transaction has already been credited to your wallet."
        )
    
    # Credit the round-up amount to wallet
    wallet = _get_or_create_wallet(current_user.id, db)
    wallet.balance = round(wallet.balance + txn.round_up_amount, 2)
    
    # Mark transaction as credited
    txn.credited = 1
    
    db.commit()
    db.refresh(wallet)
    
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
    # Only count credited transactions in total_invested
    total_invested = sum(t.round_up_amount for t in txns if t.credited == 1)
    return WalletSummaryOut(
        balance=wallet.balance,
        total_invested=round(total_invested, 2),
        transaction_count=len(txns),
        transactions=txns
    )


@router.post("/add-money", response_model=WalletOut, status_code=status.HTTP_200_OK)
def add_money(
    payload: AddMoneyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Directly credit money into the investment wallet (manual top-up).
    Records a transaction with type='topup' and automatically marks it as credited.
    """
    amt = round(payload.amount, 2)

    # Record a topup transaction (automatically credited)
    txn = Transaction(
        user_id=current_user.id,
        original_amount=amt,
        rounded_amount=amt,
        round_up_amount=amt,
        transaction_type="topup",
        credited=1,  # Topups are automatically credited
        description=payload.description or "Manual Top-Up",
    )
    db.add(txn)

    wallet = _get_or_create_wallet(current_user.id, db)
    wallet.balance = round(wallet.balance + amt, 2)
    db.commit()
    db.refresh(wallet)
    return wallet

