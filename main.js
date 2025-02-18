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
const csvFileInput = document.getElementById('csv-file');
// Mise à jour du menu déroulant pour n'afficher que les types souhaités
const chartTypeSelect = document.getElementById('chart-type');
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
let currentData = [];
let currentResolution = '1m'; // Résolution par défaut
let replayInterval = null;
let replayIndex = 0;
let isMeasuring = false;
let measurementStartPrice = null;
let measurementStartTime = null;
let longPositionLine = null;
let shortPositionLine = null;
let currentChartType = 'Candlestick';

const csvData = `
2025.01.02 00:05:00	1.25103	1.25120	1.25103	1.25104	5	0	85
2025.01.02 00:06:00	1.25104	1.25115	1.25100	1.25108	7	0	90
2025.01.02 00:07:00	1.25108	1.25122	1.25105	1.25118	3	0	75
2025.01.02 00:08:00	1.25118	1.25130	1.25115	1.25125	9	0	80
2025.01.02 00:09:00	1.25125	1.25140	1.25120	1.25135	6	0	88
2025.01.02 00:10:00	1.25135	1.25150	1.25130	1.25145	8	0	92
2025.01.02 00:11:00	1.25145	1.25160	1.25140	1.25155	4	0	78
2025.01.02 00:12:00	1.25155	1.25170	1.25150	1.25165	10	0	85
2025.01.02 00:13:00	1.25165	1.25180	1.25160	1.25175	2	0	90
2025.01.02 00:14:00	1.25175	1.25190	1.25170	1.25185	7	0	75
`;

// =======================
// PARSING & AGRÉGATION
// =======================

function parseCSVData(csv) {
  const lines = csv.trim().split('\n');
  return lines.map(line => {
    const [date, time, open, high, low, close, tickvol, vol, spread] = line.split('\t');
    const timestamp = moment(`${date} ${time}`, 'YYYY.MM.DD HH:mm:ss').valueOf() / 1000;
    return {
      time: timestamp,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      tickvol: parseFloat(tickvol),
      vol: parseFloat(vol),
      spread: parseFloat(spread)
    };
  });
}

function aggregateData(data, resolution) {
  if (resolution === '1m') return data;
  const aggregatedData = [];
  let interval = null;
  switch (resolution) {
    case '2m': interval = 2 * 60; break;
    case '5m': interval = 5 * 60; break;
    case '15m': interval = 15 * 60; break;
    case '1h': interval = 60 * 60; break;
    case '4h': interval = 4 * 60 * 60; break;
    case '1d': interval = 24 * 60 * 60; break;
    case '1w': interval = 7 * 24 * 60 * 60; break;
    case '1M': interval = 30 * 24 * 60 * 60; break;
    default: return data;
  }
  for (let i = 0; i < data.length; i++) {
    const idx = Math.floor(data[i].time / interval);
    if (!aggregatedData[idx]) {
      aggregatedData[idx] = {
        time: idx * interval,
        open: data[i].open,
        high: data[i].high,
        low: data[i].low,
        close: data[i].close,
        vol: data[i].vol
      };
    } else {
      aggregatedData[idx].high = Math.max(aggregatedData[idx].high, data[i].high);
      aggregatedData[idx].low = Math.min(aggregatedData[idx].low, data[i].low);
      aggregatedData[idx].close = data[i].close;
      aggregatedData[idx].vol += data[i].vol;
    }
  }
  return aggregatedData.filter(Boolean);
}

function getMaxDecimalPlaces(data) {
  let maxDec = 0;
  for (const candle of data) {
    const vals = [candle.open, candle.high, candle.low, candle.close];
    for (const v of vals) {
      const s = v.toString();
      const idx = s.indexOf('.');
      const dec = idx === -1 ? 0 : s.length - idx - 1;
      if (dec > maxDec) maxDec = dec;
    }
  }
  return maxDec;
}

// =======================
// TRANSFORMATIONS SPÉCIFIQUES
// =======================

function computeHeikinAshi(data) {
  if (!data.length) return [];
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
  if (!data.length) return [];
  // Calculer la plage sur les cours de clôture et définir brickSize = max(range/20, 0.00005)
  const closes = data.map(d => d.close);
  const range = Math.max(...closes) - Math.min(...closes);
  const brickSize = Math.max(range / 20, 0.00005);
  const bricks = [];
  let lastClose = data[0].close;
  // On s'assure que chaque brique ait un timestamp unique
  let timeCounter = 0;
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
    while (Math.abs(diff) >= brickSize) {
      timeCounter++;
      const brickTime = data[i].time + timeCounter; // pour avoir un timestamp unique
      if (diff > 0) {
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
      } else {
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
  if (!data.length) return [];
  const kagi = [];
  let last = data[0].close;
  kagi.push({ time: data[0].time, value: last });
  if (reversalAmount === null) reversalAmount = 0.001;
  let direction = 0;
  for (let i = 1; i < data.length; i++) {
    const current = data[i].close;
    if (direction === 0) {
      direction = current > last ? 1 : current < last ? -1 : 0;
      last = current;
      kagi.push({ time: data[i].time, value: last });
    } else if (direction === 1) {
      if (current > last) {
        last = current;
        kagi.push({ time: data[i].time, value: last });
      } else if (last - current >= reversalAmount) {
        direction = -1;
        last = current;
        kagi.push({ time: data[i].time, value: last });
      }
    } else if (direction === -1) {
      if (current < last) {
        last = current;
        kagi.push({ time: data[i].time, value: last });
      } else if (current - last >= reversalAmount) {
        direction = 1;
        last = current;
        kagi.push({ time: data[i].time, value: last });
      }
    }
  }
  return kagi;
}

function computeAreaHLC(data) {
  return data.map(d => ({
    time: d.time,
    value: (d.high + d.low + d.close) / 3
  }));
}

// =======================
// CRÉATION / MISE À JOUR DU GRAPHIQUE
// =======================

function createOrUpdateChart(data, chartType, shouldFitTimeScale = true) {
  const maxDec = getMaxDecimalPlaces(data);
  const priceFormat = {
    type: 'price',
    precision: maxDec,
    minMove: Math.pow(10, -maxDec)
  };

  if (!chart) {
    chart = createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: 600,
      crosshair: { mode: CrosshairMode.Normal },
      layout: { background: { color: '#131722' }, textColor: '#b0b8c5' },
      grid: { vertLines: { color: '#292e39' }, horzLines: { color: '#292e39' } },
      priceScale: { borderColor: '#485c7b', scaleMargins: { top: 0.3, bottom: 0.3 } },
      timeScale: { borderColor: '#485c7b', timeVisible: true, secondsVisible: true }
    });
    window.addEventListener('resize', () => {
      chart.applyOptions({ width: chartContainer.clientWidth });
    });
  }

  if (series) {
    chart.removeSeries(series);
    series = null;
  }

  // Par défaut, utiliser les données OHLC
  let seriesData = data.map(d => ({
    time: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close
  }));

  // On gère uniquement les types suivants :
  // Candlestick, Bar, Area, Line, Baseline, VolumeCandlestick, Range, HeikinAshi, Renko, Kagi, AreaHLC
  switch (chartType) {
    case 'Candlestick':
      series = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#737375',
        wickDownColor: '#737375',
        priceFormat: priceFormat
      });
      break;
    case 'Bar':
      series = chart.addBarSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        priceFormat: priceFormat
      });
      break;
    case 'Area':
      series = chart.addAreaSeries({
        topColor: 'rgba(38,166,154,0.56)',
        bottomColor: 'rgba(38,166,154,0.04)',
        lineColor: 'rgba(38,166,154,1)',
        lineWidth: 2,
        priceFormat: priceFormat
      });
      seriesData = data.map(d => ({ time: d.time, value: d.close }));
      break;
    case 'Line':
      series = chart.addLineSeries({
        color: 'rgba(38,166,154,1)',
        lineWidth: 2,
        priceFormat: priceFormat
      });
      seriesData = data.map(d => ({ time: d.time, value: d.close }));
      break;
    case 'Baseline':
      series = chart.addBaselineSeries({
        baseValue: { type: 'price', price: 1.251 },
        topFillColor1: 'rgba(38,166,154,0.56)',
        topFillColor2: 'rgba(38,166,154,0.04)',
        topLineColor: 'rgba(38,166,154,1)',
        bottomFillColor1: 'rgba(239,83,80,0.56)',
        bottomFillColor2: 'rgba(239,83,80,0.04)',
        bottomLineColor: 'rgba(239,83,80,1)',
        lineWidth: 2,
        priceFormat: priceFormat
      });
      seriesData = data.map(d => ({ time: d.time, value: d.close }));
      break;
    case 'VolumeCandlestick': {
      series = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume', precision: 0 }
      });
      seriesData = data.map(d => ({
        time: d.time,
        value: d.vol,
        color: d.close >= d.open ? '#26a69a' : '#ef5350'
      }));
      break;
    }
    case 'Range': {
      series = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#737375',
        wickDownColor: '#737375',
        priceFormat: priceFormat
      });
      // Force open = low et close = high
      seriesData = data.map(d => ({
        time: d.time,
        open: d.low,
        high: d.high,
        low: d.low,
        close: d.high
      }));
      break;
    }
    case 'HeikinAshi': {
      series = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#737375',
        wickDownColor: '#737375',
        priceFormat: priceFormat
      });
      seriesData = computeHeikinAshi(data);
      break;
    }
    case 'Renko': {
      series = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#737375',
        wickDownColor: '#737375',
        priceFormat: priceFormat
      });
      seriesData = computeRenko(data);
      break;
    }
    case 'Kagi': {
      series = chart.addLineSeries({
        color: 'rgba(38,166,154,1)',
        lineWidth: 2,
        priceFormat: priceFormat
      });
      seriesData = computeKagi(data, null);
      break;
    }
    case 'AreaHLC': {
      series = chart.addAreaSeries({
        topColor: 'rgba(38,166,154,0.56)',
        bottomColor: 'rgba(38,166,154,0.04)',
        lineColor: 'rgba(38,166,154,1)',
        lineWidth: 2,
        priceFormat: priceFormat
      });
      seriesData = computeAreaHLC(data);
      break;
    }
    default: {
      series = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#737375',
        wickDownColor: '#737375',
        priceFormat: priceFormat
      });
      break;
    }
  }

  series.setData(seriesData);

  chart.applyOptions({
    localization: { priceFormatter: price => price.toFixed(maxDec) }
  });

  if (shouldFitTimeScale) chart.timeScale().fitContent();
}

// =======================
// ÉVÉNEMENTS & REPLAY
// =======================

function handleTimeframeChange(resolution) {
  currentResolution = resolution;
  const aggregatedData = aggregateData(currentData, resolution);
  createOrUpdateChart(aggregatedData, currentChartType, true);
}

Object.keys(timeframeButtons).forEach(resolution => {
  timeframeButtons[resolution].addEventListener('click', () => {
    handleTimeframeChange(resolution);
  });
});

priceMeasureButton.addEventListener('click', () => {
  isMeasuring = true;
  // Suppression de l'alerte pour le Price Measure Tool
});

longPositionButton.addEventListener('click', () => {
  // Suppression de l'alerte pour le Long Position Tool
  chartContainer.addEventListener('click', handleLongPosition);
});

shortPositionButton.addEventListener('click', () => {
  // Suppression de l'alerte pour le Short Position Tool
  chartContainer.addEventListener('click', handleShortPosition);
});

function handleLongPosition(event) {
  const price = getPriceFromMouseEvent(event);
  if (price === null) return;
  chartContainer.removeEventListener('click', handleLongPosition);
  drawLongPosition(price);
}

function handleShortPosition(event) {
  const price = getPriceFromMouseEvent(event);
  if (price === null) return;
  chartContainer.removeEventListener('click', handleShortPosition);
  drawShortPosition(price);
}

function getPriceFromMouseEvent(event) {
  const rect = chartContainer.getBoundingClientRect();
  const y = event.clientY - rect.top;
  return chart.priceScale().coordinateToPrice(y);
}

function drawLongPosition(price) {
  if (longPositionLine) series.removePriceLine(longPositionLine);
  longPositionLine = {
    price: price,
    color: 'green',
    lineWidth: 2,
    lineStyle: 0,
    axisLabelVisible: true,
    title: 'Long'
  };
  series.createPriceLine(longPositionLine);
}

function drawShortPosition(price) {
  if (shortPositionLine) series.removePriceLine(shortPositionLine);
  shortPositionLine = {
    price: price,
    color: 'red',
    lineWidth: 2,
    lineStyle: 0,
    axisLabelVisible: true,
    title: 'Short'
  };
  series.createPriceLine(shortPositionLine);
}

chartContainer.addEventListener('click', (event) => {
  if (isMeasuring) {
    const params = chart.mouseEventParams(event);
    if (!measurementStartTime) {
      measurementStartTime = params.time;
      measurementStartPrice = params.price;
    } else {
      const priceChange = params.price - measurementStartPrice;
      const duration = moment
        .duration(moment(params.time * 1000).diff(moment(measurementStartTime * 1000)))
        .humanize();
      // Vous pouvez afficher ces informations dans votre interface utilisateur plutôt que via alert
      console.log(`Price Change: ${priceChange.toFixed(5)}, Duration: ${duration}`);
      measurementStartTime = null;
      measurementStartPrice = null;
      isMeasuring = false;
    }
  }
});

// Replay : reconstruction progressive de l'historique à partir d'une date donnée
replayPlayButton.addEventListener('click', () => {
  const startDate = moment(replayDateInput.value).valueOf() / 1000;
  replayIndex = currentData.findIndex(item => item.time >= startDate);
  if (replayIndex === -1) replayIndex = 0;
  let speed = parseInt(replaySpeedInput.value);
  if (isNaN(speed) || speed <= 0) speed = 1;
  const interval = 1000 / speed;
  
  replayInterval = setInterval(() => {
    if (replayIndex < currentData.length) {
      const replayData = currentData.slice(0, replayIndex + 1);
      const aggregatedData = aggregateData(replayData, currentResolution);
      createOrUpdateChart(aggregatedData, currentChartType, false);
      replayIndex++;
    } else {
      clearInterval(replayInterval);
      // Suppression de l'alerte de fin de replay
      console.log('Replay Finished');
    }
  }, interval);
});

replayStopButton.addEventListener('click', () => {
  clearInterval(replayInterval);
});

csvFileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    currentData = parseCSVData(e.target.result);
    const aggregatedData = aggregateData(currentData, currentResolution);
    createOrUpdateChart(aggregatedData, currentChartType, true);
  };
  reader.readAsText(file);
});

chartTypeSelect.addEventListener('change', (event) => {
  currentChartType = event.target.value;
  const aggregatedData = aggregateData(currentData, currentResolution);
  createOrUpdateChart(aggregatedData, currentChartType, true);
});

// Chargement initial
currentData = parseCSVData(csvData);
createOrUpdateChart(currentData, currentChartType, true);
