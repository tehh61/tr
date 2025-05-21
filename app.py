import MetaTrader5 as mt5
from flask import Flask, request, jsonify
from datetime import datetime
import json

app = Flask(__name__)

def get_market_data(symbol: str, timeframe_str: str, num_candles: int):
    """
    Fetches historical market data from MetaTrader 5.

    Args:
        symbol (str): The financial instrument symbol (e.g., "EURUSD").
        timeframe_str (str): The timeframe string (e.g., "M1", "H1", "D1").
        num_candles (int): The number of candles to fetch.

    Returns:
        list: A list of dictionaries, where each dictionary represents a candle.
              Returns an error string if something goes wrong.
    """
    # Initialize MetaTrader 5 connection
    if not mt5.initialize():
        # Log the specific MT5 error if possible
        # print(f"MT5 initialization failed: {mt5.last_error()}") # For server-side logging
        return {"error": "Could not connect to MetaTrader 5 terminal."}

    # Check if the symbol exists
    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        mt5.shutdown()
        return {"error": f"Symbol {symbol} not found."}

    # Parse timeframe string to MetaTrader 5 timeframe constant
    timeframe_mapping = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
        "W1": mt5.TIMEFRAME_W1,
        "MN1": mt5.TIMEFRAME_MN1,
    }
    timeframe = timeframe_mapping.get(timeframe_str.upper())
    if timeframe is None:
        mt5.shutdown()
        return {"error": f"Invalid timeframe: {timeframe_str}."}

    # Fetch historical data
    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, num_candles)

    # Shutdown MetaTrader 5 connection (early shutdown if rates are None or empty)
    if rates is None or not rates.size:
        # Log the specific MT5 error if rates is None
        # if rates is None:
            # print(f"Failed to fetch data for {symbol} on {timeframe_str}. Error code: {mt5.last_error()}") # Server-side logging
        mt5.shutdown()
        # Distinguish between a fetch failure and simply no data available for a valid request.
        # If rates is None, it's a failure. If rates.size is 0, it means no candles matched, which is not an error.
        if rates is None:
            return {"error": f"Could not fetch data for {symbol} on {timeframe_str}."}
        return [] # Return empty list if no data is found (rates.size == 0)


    # Convert data to list of dictionaries
    candle_data = []
    for rate in rates:
        candle_data.append({
            "time": datetime.fromtimestamp(rate['time']).strftime('%Y-%m-%d %H:%M:%S'), # Corrected format
            "open": rate['open'],
            "high": rate['high'],
            "low": rate['low'],
            "close": rate['close'],
            "volume": rate['tick_volume']
        })
    
    # Shutdown MetaTrader 5 connection
    mt5.shutdown()

    return candle_data

if __name__ == '__main__':
    # Example usage (optional, for testing purposes)
    # Ensure your MetaTrader 5 terminal is running and logged in
    # And that you have the symbol available.
    # Note: This part will not run when deployed as a Flask app,
    # No changes to the body of get_market_data itself in this step.
    # The example usage block below will be replaced by the Flask app runner.
    pass

@app.route('/api/data', methods=['GET'])
def api_data():
    symbol = request.args.get('symbol')
    timeframe_str = request.args.get('timeframe', default='D1', type=str) # Renamed for clarity
    num_candles = request.args.get('candles', default=100, type=int)

    if not symbol:
        app.logger.warning("API call missing symbol parameter.")
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    # Basic validation for num_candles
    if not isinstance(num_candles, int) or num_candles <= 0 or num_candles > 2000: # Max limit example
        app.logger.warning(f"API call with invalid num_candles: {num_candles}")
        return jsonify({"error": "Candles parameter must be a positive integer, max 2000."}), 400


    result = get_market_data(symbol, timeframe_str, num_candles)

    if isinstance(result, dict) and "error" in result:
        error_message = result["error"]
        app.logger.error(f"Error processing request for {symbol}/{timeframe_str}: {error_message}")
        if "Could not connect" in error_message:
            return jsonify(result), 503 # Service Unavailable
        elif "not found" in error_message:
            return jsonify(result), 404 # Not Found
        elif "Invalid timeframe" in error_message:
            return jsonify(result), 400 # Bad Request
        elif "Could not fetch data" in error_message: # MT5 API call failed for data
            return jsonify(result), 500 # Internal Server Error (as it's a backend failure to get data)
        else:
            return jsonify(result), 500 # Generic server error

    # If result is an empty list (no data found, not an error) or a list with data
    return jsonify(result)

if __name__ == '__main__':
    # Setup basic logging for when running directly (e.g. python app.py)
    # For production, a more robust logging setup (e.g., Gunicorn's logger) would be used.
    import logging
    logging.basicConfig(level=logging.INFO)
    # Make Flask development server logger a bit more verbose for debugging
    #werkzeug_logger = logging.getLogger('werkzeug')
    #werkzeug_logger.setLevel(logging.INFO)
    app.logger.info("Flask app starting in debug mode...")

    app.run(debug=True)
