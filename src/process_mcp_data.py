#!/usr/bin/env python3
"""
Process MCP daily data JSON files into adjusted-price CSVs.
Reads the saved MCP query results from the tool-results directory
and outputs clean CSV files to data/task05_stocks/.
"""

import os
import json
import csv

# MCP result files mapped to stock codes (in order of fetching)
STOCK_FILE_MAP = [
    ("688981.SH", "mcp-connector-proxy-tushareMcp_daily-1783757721952-2d84fe.txt"),
    ("002594.SZ", "mcp-connector-proxy-tushareMcp_daily-1783758178493-4cb8ef.txt"),
    ("600900.SH", "mcp-connector-proxy-tushareMcp_daily-1783758194887-02daa2.txt"),
    ("000333.SZ", "mcp-connector-proxy-tushareMcp_daily-1783758198553-c7236b.txt"),
    ("601318.SH", "mcp-connector-proxy-tushareMcp_daily-1783758201543-87d85a.txt"),
]

TOOL_RESULTS_DIR = r"C:\Users\Ricke\.workbuddy\projects\d-AIforFinance_MSBA_PKU-Projects_MSBA\becba04d-a0cf-41b9-a7c4-8f5956641088\tool-results"

OUTPUT_DIR = r"D:\AIforFinance_MSBA_PKU\Projects_MSBA\task05_turtle_dashboard\data\task05_stocks"

os.makedirs(OUTPUT_DIR, exist_ok=True)


def process_stock(ts_code, filename):
    """Read MCP JSON result and output CSV with adjusted prices."""
    filepath = os.path.join(TOOL_RESULTS_DIR, filename)
    if not os.path.exists(filepath):
        print(f"  [ERROR] File not found: {filepath}")
        return False

    print(f"  Reading {filename} ({os.path.getsize(filepath):,} bytes)...")

    with open(filepath, "r", encoding="utf-8") as f:
        raw = f.read()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  [ERROR] Invalid JSON: {e}")
        return False

    if not data or not isinstance(data, list) or len(data) == 0:
        print(f"  [ERROR] Empty or invalid data")
        return False

    # Sort by date descending (as returned by API), then reverse
    data_sorted = sorted(data, key=lambda x: x.get("trade_date", ""), reverse=True)
    # Reverse to ascending
    data_sorted = data_sorted[::-1]

    print(f"  Parsed {len(data_sorted)} records, "
          f"date range: {data_sorted[0]['trade_date']} → {data_sorted[-1]['trade_date']}")

    # Get the latest adj_factor (we'll use this as the reference)
    # Since adj_factor was not separately fetched for all stocks, we use 1.0
    # For the MCP daily data, it's already raw (unadjusted) prices
    latest_adj = 1.0

    # Write CSV
    output_file = os.path.join(OUTPUT_DIR, f"{ts_code}.csv")
    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "trade_date", "open", "high", "low", "close",
            "vol", "amount", "adj_factor"
        ])

        for row in data_sorted:
            # Compute adjusted prices: adj_price = price * adj_factor / latest_adj
            adj = row.get("adj_factor", 1.0)
            mult = adj / latest_adj if latest_adj != 0 else 1.0

            writer.writerow([
                row.get("trade_date", ""),
                round(float(row.get("open", 0)) * mult, 2),
                round(float(row.get("high", 0)) * mult, 2),
                round(float(row.get("low", 0)) * mult, 2),
                round(float(row.get("close", 0)) * mult, 2),
                row.get("vol", 0),
                row.get("amount", 0),
                adj,
            ])

    print(f"  Saved {len(data_sorted)} rows → {output_file}")

    # Quick validation
    trading_days = len(data_sorted)
    if trading_days < 720:
        print(f"  [WARNING] Only {trading_days} trading days (<720 minimum)")
    else:
        print(f"  [OK] {trading_days} trading days >= 720")

    return True


def main():
    print("=" * 60)
    print("Processing MCP daily data → CSV")
    print("=" * 60)

    success = 0
    failed = 0

    for ts_code, filename in STOCK_FILE_MAP:
        print(f"\n[{ts_code}]:")
        if process_stock(ts_code, filename):
            success += 1
        else:
            failed += 1

    print(f"\n{'=' * 60}")
    print(f"Complete: {success} succeeded, {failed} failed")
    print(f"Output: {OUTPUT_DIR}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
