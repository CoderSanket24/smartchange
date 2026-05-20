import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.portfolio import Holding
from app.models.wallet import Wallet
from app.models.user import User
from app.schemas.portfolio import InvestRequest, HoldingOut, HoldingPerformanceOut, PortfolioSummaryOut
from app.dependencies import get_current_user

log = logging.getLogger(__name__)

# ── In-memory price cache: symbol → (price, timestamp) ────────────────────────
_PRICE_CACHE: dict = {}
_CACHE_TTL   = 60   # seconds

router = APIRouter(prefix="/portfolio", tags=["Portfolio"])

# ---------------------------------------------------------------------------
# Mock stock universe – simulates NSE price feed
# In production, replace with a real market data API (e.g. yfinance, Alpha Vantage)
# ---------------------------------------------------------------------------
STOCK_UNIVERSE = {
    # ── Original 8 ────────────────────────────────────────────────────────────
    "RELIANCE":   {"name": "Reliance Industries",        "sector": "Energy",            "price": 2950.0},
    "TCS":        {"name": "Tata Consultancy Svcs",      "sector": "IT",                "price": 3820.0},
    "INFY":       {"name": "Infosys",                    "sector": "IT",                "price": 1780.0},
    "HDFC":       {"name": "HDFC Bank",                  "sector": "Banking",           "price": 1620.0},
    "WIPRO":      {"name": "Wipro",                      "sector": "IT",                "price": 480.0},
    "ITC":        {"name": "ITC Limited",                "sector": "FMCG",              "price": 440.0},
    "TATASTEEL":  {"name": "Tata Steel",                 "sector": "Metals",            "price": 145.0},
    "AXISBANK":   {"name": "Axis Bank",                  "sector": "Banking",           "price": 1100.0},
    # ── 12 new additions ──────────────────────────────────────────────────────
    "SBIN":       {"name": "State Bank of India",        "sector": "Banking",           "price": 760.0},
    "ICICIBANK":  {"name": "ICICI Bank",                 "sector": "Banking",           "price": 1250.0},
    "LT":         {"name": "Larsen & Toubro",            "sector": "Infrastructure",    "price": 3600.0},
    "BAJFINANCE": {"name": "Bajaj Finance",              "sector": "NBFC",              "price": 7200.0},
    "MARUTI":     {"name": "Maruti Suzuki",              "sector": "Auto",              "price": 12500.0},
    "HINDUNILVR": {"name": "Hindustan Unilever",         "sector": "FMCG",              "price": 2400.0},
    "ASIANPAINT": {"name": "Asian Paints",               "sector": "Consumer",          "price": 2800.0},
    "TITAN":      {"name": "Titan Company",              "sector": "Consumer Durables", "price": 3500.0},
    "ULTRACEMCO": {"name": "UltraTech Cement",           "sector": "Cement",            "price": 10800.0},
    "KOTAKBANK":  {"name": "Kotak Mahindra Bank",        "sector": "Banking",           "price": 1950.0},
    "BHARTIARTL": {"name": "Bharti Airtel",              "sector": "Telecom",           "price": 1700.0},
    "ADANIENT":   {"name": "Adani Enterprises",          "sector": "Conglomerate",      "price": 2450.0},
}

def _get_live_price(symbol: str) -> float:
    """
    Fetch live NSE price via yfinance with a 60-second in-memory TTL cache.
    Handles the HDFC -> HDFCBANK.NS alias transparently.
    Falls back to the static base price on any yfinance error.
    """
    global _PRICE_CACHE
    now = time.time()
    cached = _PRICE_CACHE.get(symbol)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    # Resolve known alias: HDFC (portfolio key) -> HDFCBANK (NSE ticker)
    _ALIAS: dict[str, str] = {"HDFC": "HDFCBANK"}
    nse_base = _ALIAS.get(symbol, symbol)
    ticker = f"{nse_base}.NS"

    base_price = STOCK_UNIVERSE.get(symbol, {}).get("price", 0.0)
    try:
        import yfinance as yf
        data = yf.download(ticker, period="2d", auto_adjust=True, progress=False)
        if not data.empty and "Close" in data.columns:
            close_val = data["Close"].iloc[-1]
            # yfinance may return a Series when multi-level columns are present
            if hasattr(close_val, "iloc"):
                close_val = close_val.iloc[0]
            price = round(float(close_val), 2)
            _PRICE_CACHE[symbol] = (price, now)
            return price
    except Exception as exc:
        log.warning(f"yfinance price fetch failed for {ticker}: {exc}")

    # Fallback: use cached value (even stale) or static base
    if cached:
        return cached[0]
    return base_price


@router.get("/stocks", tags=["Portfolio"])
def list_available_stocks():
    """Return all investable stocks in the virtual universe."""
    return [
        {"symbol": sym, "name": info["name"], "price": info["price"]}
        for sym, info in STOCK_UNIVERSE.items()
    ]


@router.get("/stocks/{symbol}/history", tags=["Portfolio"])
def get_stock_history(symbol: str, period: str = "6mo", interval: str = "1d"):
    """
    Return OHLCV candlestick data for a given NSE symbol using yfinance.
    No authentication required (used by the mobile chart WebView).
    Returns list of {time, open, high, low, close} dicts.
    """
    _ALIAS: dict = {"HDFC": "HDFCBANK"}
    clean = _ALIAS.get(symbol.upper(), symbol.upper())
    ticker_sym = f"{clean}.NS"
    try:
        import yfinance as yf
        df = yf.download(ticker_sym, period=period, interval=interval,
                         auto_adjust=True, progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {ticker_sym}")
        # Flatten multi-level columns if present
        if hasattr(df.columns, "levels"):
            df.columns = df.columns.get_level_values(0)
        candles = []
        for ts, row in df.iterrows():
            try:
                candles.append({
                    "time": int(ts.timestamp()),
                    "open":  round(float(row["Open"]),  2),
                    "high":  round(float(row["High"]),  2),
                    "low":   round(float(row["Low"]),   2),
                    "close": round(float(row["Close"]), 2),
                })
            except Exception:
                continue
        return {"symbol": symbol.upper(), "candles": candles}
    except HTTPException:
        raise
    except Exception as exc:
        log.error(f"History fetch failed for {ticker_sym}: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch history: {exc}")



@router.post("/invest", response_model=HoldingOut, status_code=status.HTTP_201_CREATED)
def invest(
    payload: InvestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Invest ₹amount from the wallet into a stock.
    Buys fractional shares at the current mock price.
    """
    symbol = payload.stock_symbol.upper()
    if symbol not in STOCK_UNIVERSE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stock '{symbol}' not in virtual universe. Available: {list(STOCK_UNIVERSE.keys())}"
        )

    # Check wallet balance
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    if not wallet or wallet.balance < payload.amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient wallet balance. Available: ₹{wallet.balance if wallet else 0:.2f}"
        )

    current_price = STOCK_UNIVERSE[symbol]["price"]
    shares_bought = round(payload.amount / current_price, 6)

    # Update or create holding (weighted average buy price)
    holding = (
        db.query(Holding)
        .filter(Holding.user_id == current_user.id, Holding.stock_symbol == symbol)
        .first()
    )
    if holding:
        total_invested = holding.invested_amount + payload.amount
        total_shares = holding.shares + shares_bought
        holding.avg_buy_price = round(total_invested / total_shares, 4)
        holding.shares = round(total_shares, 6)
        holding.invested_amount = round(total_invested, 2)
    else:
        holding = Holding(
            user_id=current_user.id,
            stock_symbol=symbol,
            stock_name=STOCK_UNIVERSE[symbol]["name"],
            shares=shares_bought,
            avg_buy_price=current_price,
            invested_amount=payload.amount
        )
        db.add(holding)

    # Deduct from wallet
    wallet.balance = round(wallet.balance - payload.amount, 2)
    db.commit()
    db.refresh(holding)
    return holding


@router.get("/holdings", response_model=List[HoldingOut])
def get_holdings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all stock holdings for the current user."""
    return (
        db.query(Holding)
        .filter(Holding.user_id == current_user.id)
        .all()
    )


@router.get("/performance", response_model=PortfolioSummaryOut)
def get_performance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Return full portfolio performance with live yfinance prices.
    Falls back to static base prices if yfinance is unreachable.
    """
    holdings = db.query(Holding).filter(Holding.user_id == current_user.id).all()

    if not holdings:
        return PortfolioSummaryOut(
            total_invested=0, current_value=0,
            total_profit_loss=0, total_profit_loss_pct=0, holdings=[]
        )

    perf_list = []
    total_invested = 0.0
    total_current = 0.0

    for h in holdings:
        live_price = _get_live_price(h.stock_symbol)
        curr_value  = round(h.shares * live_price, 2)
        pl          = round(curr_value - h.invested_amount, 2)
        pl_pct      = round((pl / h.invested_amount) * 100, 2) if h.invested_amount else 0

        perf_list.append(HoldingPerformanceOut(
            stock_symbol=h.stock_symbol,
            stock_name=h.stock_name,
            shares=h.shares,
            avg_buy_price=h.avg_buy_price,
            current_price=live_price,
            invested_amount=h.invested_amount,
            current_value=curr_value,
            profit_loss=pl,
            profit_loss_pct=pl_pct,
            invested_at=h.invested_at,
        ))
        total_invested += h.invested_amount
        total_current  += curr_value

    total_pl = round(total_current - total_invested, 2)
    total_pl_pct = round((total_pl / total_invested) * 100, 2) if total_invested else 0

    return PortfolioSummaryOut(
        total_invested=round(total_invested, 2),
        current_value=round(total_current, 2),
        total_profit_loss=total_pl,
        total_profit_loss_pct=total_pl_pct,
        holdings=perf_list
    )
