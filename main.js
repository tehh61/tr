import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import moment from 'moment';

const chartContainer = document.getElementById('chart-container');
const timeframeButtons = {
  '1m': document.getElementById('timeframe-1m'),
  '2m': document.getElementById('timeframe-2m'),
  '5m': document.getElementById('timeframe-5m'),
  '15m': document.getElementById('timeframe-15m'),
  '1h': document.getElementById('timeframe-1h'),
  '4h': document.getElementById('timeframe-4h'),
  '1d': document.getElementById('timeframe-1d'),
  '1w': document.getElementById('timeframe-1w'),
  '1M': document.getElementById('timeframe-1M'),
};
const priceMeasureButton = document.getElementById('price-measure');
const longPositionButton = document.getElementById('long-position');
const shortPositionButton = document.getElementById('short-position');
const replayDateInput = document.getElementById('replay-date');
const replaySpeedInput = document.getElementById('replay-speed');
const replayPlayButton = document.getElementById('replay-play');
const replayStopButton = document.getElementById('replay-stop');
const chartTypeSelect = document.getElementById('chart-type');

// New elements for symbol input
const symbolInputEl = document.getElementById('symbol-input');
const loadDataButtonEl = document.getElementById('load-data-button');

chartTypeSelect.innerHTML = `
  <option value="Candlestick">Candlestick</option>
  <option value="Bar">Bar</option>
  <option value="Area">Area</option>
  <option value="Line">Line</option>
  <option value="Baseline">Baseline</option>
  <option value="VolumeCandlestick">VolumeCandlestick</option>
  <option value="Range">Range</option>
  <option value="HeikinAshi">HeikinAshi</option>
  <option value="Renko">Renko</option>
  <option value="Kagi">Kagi</option>
  <option value="AreaHLC">AreaHLC</option>
`;

let chart = null;
let series = null;
let currentData = []; // Holds data for the current symbol and base timeframe for replay
let currentSymbol = '';
let currentResolution = '1d'; // Default resolution (map to D1 for MT5)
let replayInterval = null;
let replayIndex = 0;
let isMeasuring = false;
let measurementStartPrice = null;
let measurementStartTime = null;
let longPositionLine = null;
let shortPositionLine = null;
let currentChartType = 'Candlestick';

// =======================
// DATA FETCHING FROM API
// =======================
async function fetchDataFromServer(symbol, timeframe, numCandles = 500) {
  console.log(`Fetching data for ${symbol}, Timeframe: ${timeframe}, Candles: ${numCandles}`);
  const url = `/api/data?symbol=${symbol}&timeframe=${timeframe.toUpperCase()}&candles=${numCandles}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      let errorMsg = `HTTP error! status: ${response.status}`;
      try {
          const errorData = await response.json();
          errorMsg = errorData.error || JSON.stringify(errorData); 
      } catch (e) {
          // If parsing JSON fails, use the original status text or a generic message
          errorMsg = response.statusText || errorMsg;
      }
      throw new Error(errorMsg);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
        console.error("Data received is not an array:", data);
        return [];
    }
    // Convert time format and ensure all fields are present
    return data.map(item => ({
      time: moment(item.time, 'YYYY-MM-DD HH:mm:ss').valueOf() / 1000,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.volume) // Assuming 'volume' is the correct field from API
    }));
  } catch (error) {
    console.error("Error fetching data from server:", error);
    alert(`Error fetching data: ${error.message}`); // Notify user
    return []; // Return empty array on error
  }
}

// =======================
// AGGREGATION (kept for potential client-side adjustments if needed, but primarily rely on backend for timeframe data)
// =======================
function aggregateData(data, resolution) {
  // Mapping frontend resolution to backend/MT5 timeframes if direct fetch is not used for aggregation
  // For now, this function might be less critical if each resolution change fetches new data.
  // If data is fetched for '1m' and then aggregated client-side:
  if (resolution === '1m' || !data || data.length === 0) return data;

  const resolutionMap = {
    '1m': 'M1', '2m': 'M2', '5m': 'M5', '15m': 'M15',
    '1h': 'H1', '4h': 'H4', '1d': 'D1', '1w': 'W1', '1M': 'MN1'
  };
  // If the backend provides data for the exact resolution, no client-side aggregation is needed.
  // This function is more for if we fetch fine-grained data and want to aggregate it in the browser.
  // For simplicity with the new API, we might mostly rely on fetching data for the chosen resolution directly.
  // However, keeping a simplified version for now.

  const aggregatedData = [];
  let intervalSeconds;
  switch (resolution) {
    case '2m': intervalSeconds = 2 * 60; break;
    case '5m': intervalSeconds = 5 * 60; break;
    case '15m': intervalSeconds = 15 * 60; break;
    case '1h': intervalSeconds = 60 * 60; break;
    case '4h': intervalSeconds = 4 * 60 * 60; break;
    case '1d': intervalSeconds = 24 * 60 * 60; break;
    case '1w': intervalSeconds = 7 * 24 * 60 * 60; break;
    case '1M': intervalSeconds = 30 * 24 * 60 * 60; break; // Approximate
    default: return data; // No aggregation for '1m' or unknown
  }

  if (!data.length) return [];

  let currentAggregatedCandle = null;
  let nextIntervalStart = 0;

  for (const candle of data) {
    if (!currentAggregatedCandle || candle.time >= nextIntervalStart) {
      if (currentAggregatedCandle) {
        aggregatedData.push(currentAggregatedCandle);
      }
      nextIntervalStart = Math.floor(candle.time / intervalSeconds) * intervalSeconds + intervalSeconds;
      currentAggregatedCandle = {
        time: Math.floor(candle.time / intervalSeconds) * intervalSeconds,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      };
    } else {
      currentAggregatedCandle.high = Math.max(currentAggregatedCandle.high, candle.high);
      currentAggregatedCandle.low = Math.min(currentAggregatedCandle.low, candle.low);
      currentAggregatedCandle.close = candle.close;
      currentAggregatedCandle.volume += (candle.volume || 0);
    }
  }
  if (currentAggregatedCandle) {
    aggregatedData.push(currentAggregatedCandle);
  }
  return aggregatedData;
}


function getMaxDecimalPlaces(data) {
  if (!data || data.length === 0) return 2; // Default precision
  let maxDec = 0;
  for (const candle of data) {
    const vals = [candle.open, candle.high, candle.low, candle.close];
    for (const v of vals) {
      if (typeof v !== 'number' || isNaN(v)) continue;
      const s = v.toString();
      const idx = s.indexOf('.');
      const dec = idx === -1 ? 0 : s.length - idx - 1;
      if (dec > maxDec) maxDec = dec;
    }
  }
  return Math.max(2, maxDec); // Ensure at least 2 decimal places, common for currencies
}

// =======================
// TRANSFORMATIONS SPÉCIFIQUES (HeikinAshi, Renko, Kagi, etc.)
// These functions assume OHLC data is passed to them.
// =======================

function computeHeikinAshi(data) {
  if (!data || !data.length) return [];
  const ha = [];
  let prevOpen = data[0].open;
  let prevClose = (data[0].open + data[0].high + data[0].low + data[0].close) / 4;
  ha.push({
    time: data[0].time,
    open: prevOpen,
    high: Math.max(data[0].high, prevOpen, prevClose),
    low: Math.min(data[0].low, prevOpen, prevClose),
    close: prevClose
  });
  for (let i = 1; i < data.length; i++) {
    const d = data[i];
    const currentOpen = (prevOpen + prevClose) / 2;
    const currentClose = (d.open + d.high + d.low + d.close) / 4;
    ha.push({
      time: d.time,
      open: currentOpen,
      high: Math.max(d.high, currentOpen, currentClose),
      low: Math.min(d.low, currentOpen, currentClose),
      close: currentClose
    });
    prevOpen = currentOpen;
    prevClose = currentClose;
  }
  return ha;
}

function computeRenko(data) {
    if (!data || !data.length) return [];
    const closes = data.map(d => d.close);
    const range = Math.max(...closes) - Math.min(...closes);
    const brickSize = Math.max(range / 20, Math.pow(10, -getMaxDecimalPlaces(data)) * 5 ); // adaptive brick size
    const bricks = [];
    if (data.length === 0) return bricks;

    let lastClose = data[0].close;
    let timeCounter = 0; // To ensure unique timestamps for bricks from the same original candle

    bricks.push({
        time: data[0].time,
        open: lastClose,
        high: lastClose,
        low: lastClose,
        close: lastClose
    });

    for (let i = 1; i < data.length; i++) {
        const currentClose = data[i].close;
        let diff = currentClose - lastClose;
        
        // Use a small epsilon for floating point comparisons
        const epsilon = brickSize / 1000; 

        while (Math.abs(diff) >= brickSize - epsilon) {
            timeCounter++;
            // Ensure unique time for each brick, can be tricky if source data has identical timestamps
            const brickTime = data[i].time + timeCounter * 0.001; // Add milliseconds to ensure uniqueness

            if (diff > 0) { // Upward brick
                const brickOpen = lastClose;
                const brickClose = lastClose + brickSize;
                bricks.push({
                    time: brickTime,
                    open: brickOpen,
                    high: brickClose,
                    low: brickOpen,
                    close: brickClose
                });
                lastClose = brickClose;
            } else { // Downward brick
                const brickOpen = lastClose;
                const brickClose = lastClose - brickSize;
                bricks.push({
                    time: brickTime,
                    open: brickOpen,
                    high: brickOpen,
                    low: brickClose,
                    close: brickClose
                });
                lastClose = brickClose;
            }
            diff = currentClose - lastClose;
        }
    }
    return bricks;
}


function computeKagi(data, reversalAmount = null) {
  if (!data || !data.length) return [];
  const kagi = [];
  let last = data[0].close;
  kagi.push({ time: data[0].time, value: last });
  if (reversalAmount === null) reversalAmount = (Math.max(...data.map(d=>d.close)) - Math.min(...data.map(d=>d.close))) * 0.01 ; // 1% of range
  if (reversalAmount === 0) reversalAmount = 0.001; // Default if range is 0

  let direction = 0; // 0: undecided, 1: up, -1: down
  for (let i = 1; i < data.length; i++) {
    const current = data[i].close;
    if (direction === 0) {
      if (current > last) direction = 1;
      else if (current < last) direction = -1;
      
      if (direction !== 0) { // Line changed from initial point
         kagi[kagi.length-1].value = last; // Update last point of previous segment
         kagi.push({ time: data[i].time, value: current });
         last = current;
      } else { // Still flat, update time of last point
         kagi[kagi.length-1].time = data[i].time;
      }

    } else if (direction === 1) { // Currently going up
      if (current > last) {
        last = current;
        kagi[kagi.length-1].time = data[i].time; // Extend current line
        kagi[kagi.length-1].value = current;
      } else if (last - current >= reversalAmount) { // Reverse down
        kagi.push({ time: data[i].time, value: current });
        direction = -1;
        last = current;
      }
    } else if (direction === -1) { // Currently going down
      if (current < last) {
        last = current;
        kagi[kagi.length-1].time = data[i].time; // Extend current line
        kagi[kagi.length-1].value = current;
      } else if (current - last >= reversalAmount) { // Reverse up
        kagi.push({ time: data[i].time, value: current });
        direction = 1;
        last = current;
      }
    }
  }
  return kagi;
}

function computeAreaHLC(data) {
  if (!data || !data.length) return [];
  return data.map(d => ({
    time: d.time,
    value: (d.high + d.low + d.close) / 3
  }));
}


// =======================
// CRÉATION / MISE À JOUR DU GRAPHIQUE
// =======================

function createOrUpdateChart(dataToDisplay, chartType, shouldFitTimeScale = true) {
  if (!dataToDisplay) {
    console.warn("createOrUpdateChart called with null or undefined dataToDisplay.");
    dataToDisplay = []; // Ensure it's an array
  }
  const maxDec = getMaxDecimalPlaces(dataToDisplay);
  const priceFormat = {
    type: 'price',
    precision: maxDec,
    minMove: Math.pow(10, -maxDec)
  };

  if (!chart) {
    chart = createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: 600, // Adjust as needed
      crosshair: { mode: CrosshairMode.Normal },
      layout: { background: { color: '#131722' }, textColor: '#b0b8c5' },
      grid: { vertLines: { color: '#292e39' }, horzLines: { color: '#292e39' } },
      priceScale: { borderColor: '#485c7b', scaleMargins: { top: 0.3, bottom: 0.25 } }, // Adjusted bottom margin
      timeScale: { borderColor: '#485c7b', timeVisible: true, secondsVisible: true }
    });
    window.addEventListener('resize', () => {
      if (chart) chart.applyOptions({ width: chartContainer.clientWidth });
    });
  }

  if (series) {
    chart.removeSeries(series);
    series = null;
  }
  
  if (dataToDisplay.length === 0) {
    console.log("No data to display on the chart.");
    // Optionally display a message on the chart itself
    return;
  }

  let seriesData = dataToDisplay; // Default for Candlestick, Bar, Volume

  switch (chartType) {
    case 'Candlestick':
      series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#737375', wickDownColor: '#737375', priceFormat });
      break;
    case 'Bar':
      series = chart.addBarSeries({ upColor: '#26a69a', downColor: '#ef5350', priceFormat });
      break;
    case 'Area':
      series = chart.addAreaSeries({ topColor: 'rgba(38,166,154,0.56)', bottomColor: 'rgba(38,166,154,0.04)', lineColor: 'rgba(38,166,154,1)', lineWidth: 2, priceFormat });
      seriesData = dataToDisplay.map(d => ({ time: d.time, value: d.close }));
      break;
    case 'Line':
      series = chart.addLineSeries({ color: 'rgba(38,166,154,1)', lineWidth: 2, priceFormat });
      seriesData = dataToDisplay.map(d => ({ time: d.time, value: d.close }));
      break;
    case 'Baseline':
      const basePrice = dataToDisplay.length > 0 ? dataToDisplay[Math.floor(dataToDisplay.length / 2)].close : 0;
      series = chart.addBaselineSeries({ baseValue: { type: 'price', price: basePrice }, topFillColor1: 'rgba(38,166,154,0.56)', topLineColor: 'rgba(38,166,154,1)', bottomFillColor1: 'rgba(239,83,80,0.56)', bottomLineColor: 'rgba(239,83,80,1)', lineWidth: 2, priceFormat });
      seriesData = dataToDisplay.map(d => ({ time: d.time, value: d.close }));
      break;
    case 'VolumeCandlestick': // This should be Histogram for volume
      series = chart.addHistogramSeries({ color: '#26a69a', priceFormat: { type: 'volume' } });
      seriesData = dataToDisplay.map(d => ({ time: d.time, value: d.volume, color: d.close >= d.open ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)' }));
      // This series should typically be on a separate price scale or pane.
      // For simplicity, it's overlaid. Consider adding to a new price scale if main series is also price-based.
      // Example: series.priceScale().applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });
      break;
    case 'Range': // Range bars (Open = Low, Close = High or vice-versa)
      series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#737375', wickDownColor: '#737375', priceFormat });
      seriesData = dataToDisplay.map(d => ({ time: d.time, open: d.low, high: d.high, low: d.low, close: d.high }));
      break;
    case 'HeikinAshi':
      series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#737375', wickDownColor: '#737375', priceFormat });
      seriesData = computeHeikinAshi(dataToDisplay);
      break;
    case 'Renko':
      series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#737375', wickDownColor: '#737375', priceFormat });
      seriesData = computeRenko(dataToDisplay);
      break;
    case 'Kagi':
      series = chart.addLineSeries({ color: 'rgba(38,166,154,1)', lineWidth: 2, priceFormat });
      seriesData = computeKagi(dataToDisplay);
      break;
    case 'AreaHLC':
      series = chart.addAreaSeries({ topColor: 'rgba(38,166,154,0.56)', bottomColor: 'rgba(38,166,154,0.04)', lineColor: 'rgba(38,166,154,1)', lineWidth: 2, priceFormat });
      seriesData = computeAreaHLC(dataToDisplay);
      break;
    default:
      series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#737375', wickDownColor: '#737375', priceFormat });
      break;
  }
  
  if (series && seriesData && seriesData.length > 0) {
    series.setData(seriesData);
  } else {
    console.log("Series could not be created or no data for series type:", chartType);
    if(series) series.setData([]); // Clear if series exists but no data
  }

  chart.applyOptions({
    localization: { priceFormatter: price => price.toFixed(maxDec) }
  });

  if (shouldFitTimeScale && dataToDisplay.length > 0) {
    chart.timeScale().fitContent();
  }
}

// =======================
// ÉVÉNEMENTS & REPLAY
// =======================

async function loadChartData(symbol, resolution) {
  if (!symbol) {
    alert("Please enter a symbol.");
    return;
  }
  currentSymbol = symbol; // Store the current symbol
  currentResolution = resolution; // Store current resolution

  // Map frontend resolution to MT5 timeframes for the API call
  const resolutionMap = {
    '1m': 'M1', '2m': 'M2', '5m': 'M5', '15m': 'M15',
    '1h': 'H1', '4h': 'H4', '1d': 'D1', '1w': 'W1', '1M': 'MN1'
  };
  const apiTimeframe = resolutionMap[resolution] || 'D1';

  const data = await fetchDataFromServer(symbol, apiTimeframe, 500); // Fetch 500 candles
  
  if (data && data.length > 0) {
    currentData = data; // Store the raw data for the current symbol/timeframe (for replay)
    // For HeikinAshi, Renko, Kagi, AreaHLC, the transformations are applied in createOrUpdateChart
    // For other types, data is used directly or mapped (e.g. for Line/Area)
    createOrUpdateChart(currentData, currentChartType, true);
  } else {
    currentData = []; // Clear current data if fetch failed or returned empty
    createOrUpdateChart([], currentChartType, true); // Clear the chart
    console.log("No data to display for", symbol, resolution); // Changed apiTimeframe to resolution
  }
}

loadDataButtonEl.addEventListener('click', () => {
  const symbol = symbolInputEl.value.trim().toUpperCase();
  loadChartData(symbol, currentResolution);
});

symbolInputEl.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        const symbol = symbolInputEl.value.trim().toUpperCase();
        loadChartData(symbol, currentResolution);
    }
});


Object.keys(timeframeButtons).forEach(resolutionKey => {
  timeframeButtons[resolutionKey].addEventListener('click', () => {
    // `currentSymbol` should be set from the input field
    const symbolToLoad = symbolInputEl.value.trim().toUpperCase() || currentSymbol;
    if (!symbolToLoad) {
        alert("Please enter a symbol first.");
        return;
    }
    currentResolution = resolutionKey; // Update current resolution
    loadChartData(symbolToLoad, currentResolution);
  });
});


priceMeasureButton.addEventListener('click', () => {
  isMeasuring = true;
  // console.log("Price measure tool activated.");
});

longPositionButton.addEventListener('click', () => {
  chartContainer.style.cursor = 'crosshair';
  chartContainer.addEventListener('click', handleLongPosition, { once: true });
});

shortPositionButton.addEventListener('click', () => {
  chartContainer.style.cursor = 'crosshair';
  chartContainer.addEventListener('click', handleShortPosition, { once: true });
});

// Corrected getPriceFromMouseEvent and its callers
function getPriceFromMouseEvent(event, chartInstance, seriesInstance) {
    if (!chartInstance || !seriesInstance) return null;
    const chartRect = chartContainer.getBoundingClientRect();
    // First, convert the y-coordinate on the viewport to the y-coordinate on the chart pane
    const yOnPane = event.clientY - chartRect.top;
    // Then, convert the y-coordinate on the chart pane to a price value for the series
    return seriesInstance.coordinateToPrice(yOnPane);
}

function handleLongPosition(event) {
  chartContainer.style.cursor = 'default';
  const price = getPriceFromMouseEvent(event, chart, series);
  if (price === null) return;
  drawLongPosition(price);
}

function handleShortPosition(event) {
  chartContainer.style.cursor = 'default';
  const price = getPriceFromMouseEvent(event, chart, series);
  if (price === null) return;
  drawShortPosition(price);
}


function drawLongPosition(price) {
  if (!series) return;
  if (longPositionLine) series.removePriceLine(longPositionLine);
  longPositionLine = series.createPriceLine({
    price: price,
    color: 'green',
    lineWidth: 2,
    lineStyle: LineStyle.Solid, // Use LineStyle from lightweight-charts
    axisLabelVisible: true,
    title: 'Long'
  });
}

function drawShortPosition(price) {
  if (!series) return;
  if (shortPositionLine) series.removePriceLine(shortPositionLine);
  shortPositionLine = series.createPriceLine({
    price: price,
    color: 'red',
    lineWidth: 2,
    lineStyle: LineStyle.Solid, // Use LineStyle from lightweight-charts
    axisLabelVisible: true,
    title: 'Short'
  });
}

chartContainer.addEventListener('mousemove', (event) => {
    if (!isMeasuring || !measurementStartTime || !chart || !series) return;

    const rect = chartContainer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const price = series.coordinateToPrice(y); // Price from Y coordinate
    const logicalCoordinate = chart.timeScale().coordinateToLogical(x); // Logical index from X
    if (logicalCoordinate === null) return; // Not on the time scale
    const time = chart.timeScale().logicalToTime(logicalCoordinate); // Time from logical index


    if (price !== null && time !== null) {
        // Optional: Draw a temporary line or update some UI elements
        // For now, just log to console
        // console.log(`Current measurement: Price=${price.toFixed(5)}, Time=${moment(time * 1000).format('YYYY-MM-DD HH:mm')}`);
    }
});


chartContainer.addEventListener('click', (event) => {
  if (isMeasuring) {
    if (!chart || !series) {
        isMeasuring = false; // Reset if chart/series not ready
        return;
    }
    const rect = chartContainer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const price = series.coordinateToPrice(y);
    const logicalCoordinate = chart.timeScale().coordinateToLogical(x); // Get logical index from x-coordinate
    if (logicalCoordinate === null) { // Click was outside of time scale range
        isMeasuring = false; // Reset
        return;
    }
    const time = chart.timeScale().logicalToTime(logicalCoordinate); // Convert logical index to time


    if (price === null || time === null) return;

    if (!measurementStartTime) {
      measurementStartTime = time;
      measurementStartPrice = price;
      // console.log(`Measurement started: Price=${price.toFixed(5)}, Time=${moment(time * 1000).format('YYYY-MM-DD HH:mm')}`);
    } else {
      const priceChange = price - measurementStartPrice;
      // Ensure currentData is not empty and has valid numbers for getMaxDecimalPlaces
      const precision = (currentData && currentData.length > 0) ? getMaxDecimalPlaces(currentData) : 2;
      const pipsChange = priceChange * Math.pow(10, precision -1); 
      const timeDiffMs = (time * 1000) - (measurementStartTime * 1000);
      const duration = moment.duration(timeDiffMs).humanize();
      
      console.log(`Measurement End: Price=${price.toFixed(precision)}, Time=${moment(time * 1000).format('YYYY-MM-DD HH:mm')}`);
      console.log(`Result: Change=${priceChange.toFixed(precision)} (${pipsChange.toFixed(1)} pips), Duration=${duration}`);
      
      alert(`Price Change: ${priceChange.toFixed(precision)} (${pipsChange.toFixed(1)} pips)
Duration: ${duration}`);
      
      measurementStartTime = null;
      measurementStartPrice = null;
      isMeasuring = false;
    }
  }
});

replayPlayButton.addEventListener('click', () => {
  if (!currentData || currentData.length === 0) {
    alert("No data loaded for replay.");
    return;
  }
  const startDateStr = replayDateInput.value;
  if (!startDateStr) {
    alert("Please select a replay start date.");
    return;
  }
  const startDate = moment(startDateStr).valueOf() / 1000;
  
  replayIndex = currentData.findIndex(item => item.time >= startDate);
  if (replayIndex === -1) { // If start date is after all data points
    replayIndex = currentData.length; // Effectively, replay won't show anything new.
  }
  
  let speed = parseInt(replaySpeedInput.value);
  if (isNaN(speed) || speed <= 0) speed = 1;
  const interval = 1000 / speed;
  
  if (replayInterval) clearInterval(replayInterval);

  // Display data up to the start of replay first
  const initialReplayData = currentData.slice(0, replayIndex);
  createOrUpdateChart(initialReplayData, currentChartType, false); // Don't fit content initially for replay

  replayInterval = setInterval(() => {
    if (replayIndex < currentData.length) {
      const replayDataSegment = currentData.slice(0, replayIndex + 1);
      // The data for replay is already at the correct resolution from `currentData`
      createOrUpdateChart(replayDataSegment, currentChartType, false); // Don't fit content during replay
      replayIndex++;
    } else {
      clearInterval(replayInterval);
      replayInterval = null;
      console.log('Replay Finished');
      if (chart) chart.timeScale().fitContent(); // Fit content at the end
    }
  }, interval);
});

replayStopButton.addEventListener('click', () => {
  if (replayInterval) {
    clearInterval(replayInterval);
    replayInterval = null;
    console.log("Replay stopped.");
    // Optionally, restore full chart view
    // createOrUpdateChart(currentData, currentChartType, true);
  }
});


chartTypeSelect.addEventListener('change', (event) => {
  currentChartType = event.target.value;
  if (currentData && currentData.length > 0) {
    // Re-render with the current data (which is already at the correct resolution)
    createOrUpdateChart(currentData, currentChartType, true);
  } else if (currentSymbol) { // If a symbol is loaded but currentData is empty (e.g. after an error)
    loadChartData(currentSymbol, currentResolution); // Try reloading
  }
});

// Initial Chart Setup
createOrUpdateChart([], currentChartType, true); // Initialize with an empty chart

// Log for debugging
console.log("TradingView Clone Initialized with API integration.");
//symbolInputEl.value = 'EURUSD'; // Default symbol example
//loadChartData('EURUSD', currentResolution); // Optionally load a default symbol
