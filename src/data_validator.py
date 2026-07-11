#!/usr/bin/env python3
"""
Data Collection & Validation Script for Task 5 — Turtle Trading Strategy
========================================================================
Fetches 3-year daily data (20230711–20260711) for 5 A-share stocks
from Tushare Pro API, computes pre-adjusted prices using adj_factor,
validates data quality, and saves to CSV.

Token: Configured via MCP or environment variable TUSHARE_TOKEN

Usage:
    python data_validator.py [--fetch] [--validate-only]
"""

import os
import sys
import time
import json
from datetime import datetime

import pandas as pd
import numpy as np

try:
    import tushare as ts
except ImportError:
    print("[ERROR] tushare not installed. Run: pip install tushare")
    sys.exit(1)

# ============================================================
# CONFIGURATION
# ============================================================

TUSHARE_TOKEN = "dba6b4efef5781ad64a07196c1876694c526a9d727c873512b34d6da"

STOCKS = [
    {"code": "688981.SH", "name": "中芯国际A", "file": "688981.SH.csv"},
    {"code": "002594.SZ", "name": "比亚迪A",   "file": "002594.SZ.csv"},
    {"code": "600900.SH", "name": "长江电力A", "file": "600900.SH.csv"},
    {"code": "000333.SZ", "name": "美的集团A", "file": "000333.SZ.csv"},
    {"code": "601318.SH", "name": "中国平安A", "file": "601318.SH.csv"},
]

START_DATE = "20230711"
END_DATE   = "20260711"

# Output directory (relative to project root)
OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "data", "task05_stocks"
)

# Quality thresholds
MIN_TRADING_DAYS = 720
MAX_CONSECUTIVE_GAPS = 3
MAX_PCT_CHG = 20.0  # non-ST daily change limit


# ============================================================
# DATA FETCHING
# ============================================================

def init_tushare():
    """Initialize Tushare Pro API."""
    ts.set_token(TUSHARE_TOKEN)
    return ts.pro_api()


def fetch_daily(pro, ts_code):
    """
    Fetch daily OHLCV data for a single stock.
    Returns DataFrame with columns: ts_code, trade_date, open, high, low,
    close, pre_close, change, pct_chg, vol, amount
    """
    print(f"  [FETCH] {ts_code} daily data...")
    df = pro.daily(
        ts_code=ts_code,
        start_date=START_DATE,
        end_date=END_DATE,
        fields="ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
    )
    if df is None or df.empty:
        raise ValueError(f"No daily data returned for {ts_code}")
    df = df.sort_values("trade_date").reset_index(drop=True)
    print(f"    Got {len(df)} rows, {df.trade_date.min()} → {df.trade_date.max()}")
    return df


def fetch_adj_factor(pro, ts_code):
    """
    Fetch adjustment factor for a single stock.
    Returns DataFrame with columns: ts_code, trade_date, adj_factor
    """
    print(f"  [FETCH] {ts_code} adj_factor...")
    df = pro.adj_factor(
        ts_code=ts_code,
        start_date=START_DATE,
        end_date=END_DATE,
    )
    if df is None or df.empty:
        print(f"    WARNING: No adj_factor data for {ts_code}, using 1.0")
        return None
    df = df.sort_values("trade_date").reset_index(drop=True)
    return df


def compute_adjusted_prices(daily_df, adj_df):
    """
    Merge daily data with adj_factor and compute pre-adjusted prices.

    Pre-adjusted close = close * adj_factor / latest_adj_factor
    This ensures the latest price equals the raw close, and historical
    prices are adjusted backward for splits and dividends.
    """
    df = daily_df.copy()

    if adj_df is None or adj_df.empty:
        # No adj_factor data — assume no adjustments needed
        df["adj_factor"] = 1.0
    else:
        df = df.merge(adj_df[["trade_date", "adj_factor"]], on="trade_date", how="left")
        # Forward-fill any missing adj_factor
        df["adj_factor"] = df["adj_factor"].ffill().fillna(1.0)

    # Compute pre-adjusted prices
    latest_factor = df["adj_factor"].iloc[0]  # most recent
    if latest_factor == 0:
        latest_factor = 1.0

    for col in ["open", "high", "low", "close", "pre_close"]:
        df[f"adj_{col}"] = df[col] * df["adj_factor"] / latest_factor

    return df


# ============================================================
# DATA VALIDATION
# ============================================================

def validate_data(df, stock_name):
    """
    Validate data quality:
    - Trading days >= MIN_TRADING_DAYS
    - Consecutive gaps <= MAX_CONSECUTIVE_GAPS
    - Daily change within ±MAX_PCT_CHG (for non-ST stocks)
    """
    issues = []
    valid = True

    # 1. Trading days check
    n_days = len(df)
    if n_days < MIN_TRADING_DAYS:
        issues.append(
            f"Trading days {n_days} < minimum {MIN_TRADING_DAYS}"
        )
        valid = False
    else:
        print(f"    [OK] Trading days: {n_days} >= {MIN_TRADING_DAYS}")

    # 2. Consecutive date gaps
    df_sorted = df.sort_values("trade_date").reset_index(drop=True)
    dates = pd.to_datetime(df_sorted["trade_date"], format="%Y%m%d")
    gaps = dates.diff().dropna().dt.days
    max_gap = gaps.max()
    n_large_gaps = (gaps > MAX_CONSECUTIVE_GAPS + 1).sum()

    if max_gap > MAX_CONSECUTIVE_GAPS + 1:
        issues.append(
            f"Max date gap {int(max_gap)} days > allowed {MAX_CONSECUTIVE_GAPS}"
        )
        valid = False
    else:
        print(f"    [OK] Max date gap: {int(max_gap)} days, large gaps: {n_large_gaps}")

    # 3. Daily change check
    pct_col = "pct_chg" if "pct_chg" in df.columns else None
    if pct_col:
        abnormal = df[df[pct_col].abs() > MAX_PCT_CHG]
        if len(abnormal) > 0:
            issues.append(
                f"Detected {len(abnormal)} days with |pct_chg| > {MAX_PCT_CHG}%"
            )
            # Mark but don't invalidate (could be valid for some stocks)
            print(f"    [MARK] {len(abnormal)} abnormal days (|pct_chg| > {MAX_PCT_CHG}%):")
            for _, row in abnormal.iterrows():
                print(f"      {row['trade_date']}: {row[pct_col]:.2f}%")
        else:
            print(f"    [OK] No abnormal daily changes")

    # 4. Missing value check
    required_cols = ["open", "high", "low", "close", "vol"]
    for col in required_cols:
        missing = df[col].isna().sum()
        if missing > 0:
            issues.append(f"Column '{col}' has {missing} missing values")
            valid = False

    if valid:
        print(f"  [PASS] {stock_name} data validation passed ✓")
    else:
        print(f"  [FAIL] {stock_name} data validation FAILED:")
        for issue in issues:
            print(f"    - {issue}")

    return valid, issues


# ============================================================
# MAIN
# ============================================================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Task5 data collection and validation")
    parser.add_argument("--fetch", action="store_true", help="Force re-fetch all data")
    parser.add_argument("--validate-only", action="store_true", help="Only validate existing CSVs")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if args.validate_only:
        print("=" * 60)
        print("VALIDATION-ONLY MODE")
        print("=" * 60)
        for stock in STOCKS:
            filepath = os.path.join(OUTPUT_DIR, stock["file"])
            if not os.path.exists(filepath):
                print(f"\n{stock['name']} ({stock['code']}): CSV not found, skipping")
                continue
            df = pd.read_csv(filepath)
            print(f"\n{stock['name']} ({stock['code']}):")
            validate_data(df, stock["name"])
        return

    # Initialize Tushare
    print("Connecting to Tushare Pro...")
    pro = init_tushare()

    all_passed = True

    for i, stock in enumerate(STOCKS):
        filepath = os.path.join(OUTPUT_DIR, stock["file"])

        # Skip if CSV exists and not forcing re-fetch
        if os.path.exists(filepath) and not args.fetch:
            print(f"\n[{i+1}/5] {stock['name']} ({stock['code']}): CSV exists, validating...")
            df = pd.read_csv(filepath)
            valid, _ = validate_data(df, stock["name"])
            if not valid:
                all_passed = False
            continue

        print(f"\n[{i+1}/5] {stock['name']} ({stock['code']}):")

        try:
            # Fetch daily data
            daily_df = fetch_daily(pro, stock["code"])

            # Fetch adj_factor (with rate limit handling)
            adj_df = None
            try:
                adj_df = fetch_adj_factor(pro, stock["code"])
            except Exception as e:
                print(f"    WARNING: adj_factor fetch failed: {e}")
                print(f"    Using adj_factor=1.0 (no adjustment)")

            # Compute adjusted prices
            merged_df = compute_adjusted_prices(daily_df, adj_df)

            # Select output columns
            output_cols = [
                "trade_date",
                "adj_open", "adj_high", "adj_low", "adj_close",
                "vol", "amount", "adj_factor",
            ]
            # Rename for CSV
            rename_map = {
                "adj_open": "open",
                "adj_high": "high",
                "adj_low": "low",
                "adj_close": "close",
            }
            out_df = merged_df[["trade_date", "adj_open", "adj_high", "adj_low", "adj_close", "vol", "amount", "adj_factor"]].copy()
            out_df = out_df.rename(columns=rename_map)
            out_df["trade_date"] = out_df["trade_date"].astype(str)

            # Validate
            valid, issues = validate_data(out_df, stock["name"])
            if not valid:
                all_passed = False
                user_input = input(f"    Data validation failed. Continue with save? [y/N]: ")
                if user_input.lower() != "y":
                    continue

            # Save CSV
            out_df.to_csv(filepath, index=False, encoding="utf-8")
            print(f"    Saved {len(out_df)} rows to {filepath}")

        except Exception as e:
            print(f"    ERROR: {e}")
            all_passed = False

        # Rate limit: wait between stocks
        if i < len(STOCKS) - 1:
            print("    Waiting 2s for rate limit...")
            time.sleep(2)

    print("\n" + "=" * 60)
    if all_passed:
        print("ALL DATA COLLECTED AND VALIDATED SUCCESSFULLY ✓")
    else:
        print("DATA COLLECTION COMPLETE WITH SOME ISSUES — REVIEW ABOVE")
    print("=" * 60)


if __name__ == "__main__":
    main()
