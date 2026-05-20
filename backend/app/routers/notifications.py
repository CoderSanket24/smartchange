"""
routers/notifications.py
========================
GET /notifications — dynamic, context-aware notification messages.

Messages are generated server-side so the mobile app only needs
a single call on load / wallet update / portfolio change.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.portfolio import Holding
from app.models.wallet import Wallet, Transaction
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("")
def get_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return a list of contextual notification messages for the current user.
    Each item has: { type, title, body, icon }
    """
    messages: list[dict] = []

    # ── Wallet info ──────────────────────────────────────────────────────────
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    balance = wallet.balance if wallet else 0.0

    # Today's round-ups (transactions created today)
    today = date.today()
    today_txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id)
        .all()
    )
    today_roundup = sum(
        t.round_up_amount
        for t in today_txns
        if t.created_at and t.created_at.date() == today
    )

    if today_roundup > 0:
        messages.append({
            "type":  "wallet",
            "title": "Savings Update 💰",
            "body":  f"You saved ₹{today_roundup:.2f} today through round-ups!",
            "icon":  "wallet-outline",
        })

    if balance > 0:
        messages.append({
            "type":  "wallet",
            "title": "Wallet Balance",
            "body":  f"Your wallet has ₹{balance:.2f} available to invest.",
            "icon":  "cash-outline",
        })

    # ── Portfolio P&L ────────────────────────────────────────────────────────
    holdings = db.query(Holding).filter(Holding.user_id == current_user.id).all()

    if holdings:
        total_invested = sum(h.invested_amount for h in holdings)
        # Use static prices for notification (avoids slow yfinance call)
        from app.routers.portfolio import STOCK_UNIVERSE, _get_live_price
        total_current = 0.0
        for h in holdings:
            try:
                live_p = _get_live_price(h.stock_symbol)
            except Exception:
                live_p = STOCK_UNIVERSE.get(h.stock_symbol, {}).get("price", h.avg_buy_price)
            total_current += h.shares * live_p

        pl_pct = round(((total_current - total_invested) / total_invested) * 100, 2) if total_invested else 0

        if pl_pct > 0:
            messages.append({
                "type":  "portfolio",
                "title": "Portfolio Update 📈",
                "body":  f"Your portfolio is up {pl_pct:.2f}% — great progress!",
                "icon":  "trending-up-outline",
            })
        elif pl_pct < -1:
            messages.append({
                "type":  "portfolio",
                "title": "Portfolio Update 📉",
                "body":  f"Your portfolio is down {abs(pl_pct):.2f}% — markets fluctuate, stay invested.",
                "icon":  "trending-down-outline",
            })
    else:
        messages.append({
            "type":  "portfolio",
            "title": "Start Investing! 🚀",
            "body":  "You have no holdings yet. Head to the Portfolio tab to invest.",
            "icon":  "bar-chart-outline",
        })

    # ── AI suggestion ─────────────────────────────────────────────────────────
    if balance >= 10:
        messages.append({
            "type":  "ai",
            "title": "AI Suggestion 🤖",
            "body":  f"AI suggests investing your ₹{balance:.2f} balance for better returns.",
            "icon":  "sparkles-outline",
        })

    return {"notifications": messages, "count": len(messages)}
