import time
import logging
import math
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.portfolio import Holding
from app.models.wallet import Wallet
from app.models.user import User
from app.schemas.portfolio import InvestRequest, HoldingOut, HoldingPerformanceOut, PortfolioSummaryOut, SellRequest, SellResponse
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
            
            # Convert to float and validate
            price = float(close_val)
            
            # Safety check: ensure price is valid (not NaN, not inf, positive)
            if math.isnan(price) or math.isinf(price) or price <= 0:
                fallback = base_price if base_price > 0 else 100.0
                log.warning(f"Invalid price {price} for {ticker}, using base price: {fallback}")
                return fallback
            
            price = round(price, 2)
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
    """Return all investable stocks with live prices from yfinance."""
    stocks = []
    for sym, info in STOCK_UNIVERSE.items():
        price = _get_live_price(sym)  # Already returns valid price (base price if live fails)
        
        stocks.append({
            "symbol": sym,
            "name":   info["name"],
            "sector": info.get("sector", "N/A"),
            "price":  round(price, 2),
        })
    return stocks


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
                # Extract values and check for NaN/inf
                open_val = float(row["Open"])
                high_val = float(row["High"])
                low_val = float(row["Low"])
                close_val = float(row["Close"])
                
                # Skip candles with invalid data
                if (math.isnan(open_val) or math.isinf(open_val) or
                    math.isnan(high_val) or math.isinf(high_val) or
                    math.isnan(low_val) or math.isinf(low_val) or
                    math.isnan(close_val) or math.isinf(close_val)):
                    log.warning(f"Skipping candle with NaN/inf values for {ticker_sym} at {ts}")
                    continue
                
                candles.append({
                    "time": int(ts.timestamp()),
                    "open":  round(open_val, 2),
                    "high":  round(high_val, 2),
                    "low":   round(low_val, 2),
                    "close": round(close_val, 2),
                })
            except Exception as e:
                log.warning(f"Error processing candle for {ticker_sym} at {ts}: {e}")
                continue
        
        if not candles:
            raise HTTPException(status_code=404, detail=f"No valid data for {ticker_sym}")
        
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

    # ── Use LIVE price (same source as performance endpoint) ─────────────────
    # Using the static STOCK_UNIVERSE price would create a mismatch: shares
    # would be bought at stale price but P&L calculated against live price,
    # making the investment appear immediately profitable or in loss with no
    # relation to actual price movement after the user's purchase.
    current_price = _get_live_price(symbol)
    
    # Validate price is valid (not NaN, not inf, positive)
    if math.isnan(current_price) or math.isinf(current_price) or current_price <= 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not fetch valid price for {symbol}. Please try again shortly."
        )

    shares_bought = round(payload.amount / current_price, 6)
    
    # Validate shares_bought is valid
    if math.isnan(shares_bought) or math.isinf(shares_bought) or shares_bought <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid calculation for shares. Please try again."
        )

    # Update or create holding — weighted average buy price across top-ups
    holding = (
        db.query(Holding)
        .filter(Holding.user_id == current_user.id, Holding.stock_symbol == symbol)
        .first()
    )
    if holding:
        # Weighted average: (old_invested + new_invested) / (old_shares + new_shares)
        total_invested = holding.invested_amount + payload.amount
        total_shares   = holding.shares + shares_bought
        avg_price = round(total_invested / total_shares, 4)
        
        # Validate all values before updating
        if math.isnan(avg_price) or math.isinf(avg_price):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Invalid price calculation. Please contact support."
            )
        
        holding.avg_buy_price  = avg_price
        holding.shares         = round(total_shares, 6)
        holding.invested_amount = round(total_invested, 2)
    else:
        holding = Holding(
            user_id=current_user.id,
            stock_symbol=symbol,
            stock_name=STOCK_UNIVERSE[symbol]["name"],
            shares=shares_bought,
            avg_buy_price=current_price,   # live price at time of purchase
            invested_amount=payload.amount
        )
        db.add(holding)

    # Deduct from wallet
    wallet.balance = round(wallet.balance - payload.amount, 2)
    db.commit()
    db.refresh(holding)
    return holding


@router.post("/sell", response_model=SellResponse, status_code=status.HTTP_200_OK)
def sell_stock(
    payload: SellRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Sell shares of a stock and add proceeds to wallet.
    Uses current live price for the sale.
    """
    symbol = payload.stock_symbol.upper()
    
    # Validate stock exists in universe
    if symbol not in STOCK_UNIVERSE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stock '{symbol}' not in virtual universe. Available: {list(STOCK_UNIVERSE.keys())}"
        )
    
    # Check if user has this holding
    holding = (
        db.query(Holding)
        .filter(Holding.user_id == current_user.id, Holding.stock_symbol == symbol)
        .first()
    )
    
    if not holding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"You don't own any shares of {symbol}"
        )
    
    # Check if user has enough shares
    if holding.shares < payload.shares:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient shares. You own {holding.shares} shares but trying to sell {payload.shares}"
        )
    
    # Get current live price
    current_price = _get_live_price(symbol)
    if current_price <= 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not fetch live price for {symbol}. Please try again shortly."
        )
    
    # Calculate sale proceeds
    total_amount = round(payload.shares * current_price, 2)
    
    # Calculate profit/loss for the shares being sold
    cost_basis = round(payload.shares * holding.avg_buy_price, 2)
    profit_loss = round(total_amount - cost_basis, 2)
    
    # Get wallet
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wallet not found"
        )
    
    # Update holding
    remaining_shares = round(holding.shares - payload.shares, 6)
    
    if remaining_shares <= 0.000001:  # Essentially zero (accounting for floating point)
        # Sold all shares, delete the holding
        db.delete(holding)
        remaining_shares = 0.0
    else:
        # Partial sale - update shares and invested amount proportionally
        holding.shares = remaining_shares
        holding.invested_amount = round(remaining_shares * holding.avg_buy_price, 2)
    
    # Add proceeds to wallet
    wallet.balance = round(wallet.balance + total_amount, 2)
    
    db.commit()
    
    return SellResponse(
        message=f"Successfully sold {payload.shares} shares of {symbol}",
        stock_symbol=symbol,
        shares_sold=payload.shares,
        sale_price=current_price,
        total_amount=total_amount,
        profit_loss=profit_loss,
        remaining_shares=remaining_shares,
        wallet_balance=wallet.balance
    )



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
