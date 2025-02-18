import { createChart, CrosshairMode } from 'lightweight-charts';
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

let chart = null;
let candlestickSeries = null;
let currentData = [];
let currentResolution = '1m'; // Résolution par défaut
let replayInterval = null;
let replayIndex = 0;
let isMeasuring = false;
let measurementStartPrice = null;
let measurementStartTime = null;
let longPositionLine = null;
let shortPositionLine = null;

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

function parseCSVData(csv) {
  const lines = csv.trim().split('\n');
  return lines.map(line => {
    const [date, time, open, high, low, close, tickvol, vol, spread] = line.split('\t');
    const timestamp = moment(`${date} ${time}`, 'YYYY.MM.DD HH:mm:ss').valueOf() / 1000;
    return {
      time: timestamp,
      open: open,
      high: high,
      low: low,
      close: close,
    };
  });
}

function aggregateData(data, resolution) {
  if (resolution === '1m') {
    return data;
  }
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
    case '1M': interval = 30 * 24 * 60 * 60; break; // Approximation
    default: return data;
  }
  for (let i = 0; i < data.length; i++) {
    const candleIndex = Math.floor(data[i].time / interval);
    if (!aggregatedData[candleIndex]) {
      aggregatedData[candleIndex] = {
        time: candleIndex * interval,
        open: data[i].open,
        high: data[i].high,
        low: data[i].low,
        close: data[i].close,
      };
    } else {
      aggregatedData[candleIndex].high = Math.max(aggregatedData[candleIndex].high, data[i].high);
      aggregatedData[candleIndex].low = Math.min(aggregatedData[candleIndex].low, data[i].low);
      aggregatedData[candleIndex].close = data[i].close;
    }
  }
  return aggregatedData.filter(Boolean);
}

function getMaxDecimalPlaces(data) {
  let maxDecimalPlaces = 0;
  for (const candle of data) {
    const values = [candle.open, candle.high, candle.low, candle.close];
    for (const value of values) {
      const valueStr = String(value);
      const decimalIndex = valueStr.indexOf('.');
      const decimalPlaces = decimalIndex === -1 ? 0 : valueStr.length - decimalIndex - 1;
      maxDecimalPlaces = Math.max(maxDecimalPlaces, decimalPlaces);
    }
  }
  return maxDecimalPlaces;
}

/**
 * @param {Array} data - Les données à afficher
 * @param {boolean} [shouldFitTimeScale=true] - Si true, ajuste automatiquement l'échelle du temps.
 */
function createOrUpdateChart(data, shouldFitTimeScale = true) {
  const maxDecimalPlaces = getMaxDecimalPlaces(data);
  const priceFormat = {
    type: 'price',
    precision: maxDecimalPlaces,
    minMove: Math.pow(10, -maxDecimalPlaces),
  };

  if (!chart) {
    chart = createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: 600,
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      layout: {
        background: { color: '#131722' },
        textColor: '#b0b8c5',
      },
      grid: {
        vertLines: { color: '#292e39' },
        horzLines: { color: '#292e39' },
      },
      priceScale: {
        borderColor: '#485c7b',
        scaleMargins: {
          top: 0.3,
          bottom: 0.3,
        },
      },
      timeScale: {
        borderColor: '#485c7b',
        timeVisible: true,
        secondsVisible: true,
      },
    });
    candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#737375',
      wickDownColor: '#737375',
      priceFormat: priceFormat,
    });
    window.addEventListener('resize', () => {
      chart.applyOptions({ width: chartContainer.clientWidth });
    });
  } else {
    candlestickSeries.applyOptions({
      priceFormat: priceFormat,
    });
  }

  candlestickSeries.setData(
    data.map(item => ({
      time: item.time,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
    }))
  );

  // Formatter du prix sur l'échelle de droite
  chart.applyOptions({
    localization: {
      priceFormatter: price => price.toFixed(maxDecimalPlaces),
    },
  });

  if (shouldFitTimeScale) {
    chart.timeScale().fitContent();
  }
}

function handleTimeframeChange(resolution) {
  currentResolution = resolution;
  const aggregatedData = aggregateData(currentData, resolution);
  createOrUpdateChart(aggregatedData, true);
}

// Écouteurs pour les boutons de timeframe
Object.keys(timeframeButtons).forEach(resolution => {
  timeframeButtons[resolution].addEventListener('click', () => {
    handleTimeframeChange(resolution);
  });
});

// Outils graphiques
priceMeasureButton.addEventListener('click', () => {
  isMeasuring = true;
  alert('Price Measure Tool Selected. Click on the chart to start measuring.');
});

longPositionButton.addEventListener('click', () => {
  alert('Long Position Tool Selected. Click on the chart to set entry point.');
  chartContainer.addEventListener('click', handleLongPosition);
});

shortPositionButton.addEventListener('click', () => {
  alert('Short Position Tool Selected. Click on the chart to set entry point.');
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
  const priceScale = chart.priceScale();
  const chartRect = chartContainer.getBoundingClientRect();
  const y = event.clientY - chartRect.top;
  return priceScale.coordinateToPrice(y);
}

function drawLongPosition(price) {
  if (longPositionLine) {
    candlestickSeries.removePriceLine(longPositionLine);
  }
  longPositionLine = {
    price: price,
    color: 'green',
    lineWidth: 2,
    lineStyle: 0,
    axisLabelVisible: true,
    title: 'Long',
  };
  candlestickSeries.createPriceLine(longPositionLine);
}

function drawShortPosition(price) {
  if (shortPositionLine) {
    candlestickSeries.removePriceLine(shortPositionLine);
  }
  shortPositionLine = {
    price: price,
    color: 'red',
    lineWidth: 2,
    lineStyle: 0,
    axisLabelVisible: true,
    title: 'Short',
  };
  candlestickSeries.createPriceLine(shortPositionLine);
}

chartContainer.addEventListener('click', (event) => {
  if (isMeasuring) {
    const params = chart.mouseEventParams(event);
    if (measurementStartTime === null) {
      measurementStartTime = params.time;
      measurementStartPrice = params.price;
    } else {
      const endTime = params.time;
      const endPrice = params.price;
      if (measurementStartTime !== null && endTime !== null && measurementStartPrice !== null && endPrice !== null) {
        const priceChange = endPrice - measurementStartPrice;
        const timeDiff = moment.duration(moment(endTime * 1000).diff(moment(measurementStartTime * 1000)));
        const duration = timeDiff.humanize();
        alert(`Price Change: ${priceChange.toFixed(5)}, Duration: ${duration}`);
      }
      measurementStartTime = null;
      measurementStartPrice = null;
      isMeasuring = false;
    }
  }
});

// --- Fonctionnalité de replay ---
// Le replay démarre à la date sélectionnée et affiche progressivement les bougies
// en mettant à jour le graphique avec un sous-ensemble des données.
replayPlayButton.addEventListener('click', () => {
  // Détermine l'index de départ à partir de la date saisie
  const startDate = moment(replayDateInput.value).valueOf() / 1000;
  replayIndex = currentData.findIndex(item => item.time >= startDate);
  if (replayIndex === -1) {
    replayIndex = 0;
  }
  let speed = parseInt(replaySpeedInput.value);
  if (isNaN(speed) || speed <= 0) {
    speed = 1;
  }
  const interval = 1000 / speed;
  
  replayInterval = setInterval(() => {
    if (replayIndex < currentData.length) {
      // On affiche les bougies depuis le début de la période de replay jusqu'à l'index courant
      const replayData = currentData.slice(0, replayIndex + 1);
      const aggregatedData = aggregateData(replayData, currentResolution);
      createOrUpdateChart(aggregatedData, false);
      replayIndex++;
    } else {
      clearInterval(replayInterval);
      alert('Replay Finished');
    }
  }, interval);
});

replayStopButton.addEventListener('click', () => {
  clearInterval(replayInterval);
});

// Chargement du fichier CSV
csvFileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const csv = e.target.result;
      currentData = parseCSVData(csv);
      const aggregatedData = aggregateData(currentData, currentResolution);
      createOrUpdateChart(aggregatedData, true);
    };
    reader.readAsText(file);
  }
});

// Chargement initial des données et création du graphique
currentData = parseCSVData(csvData);
createOrUpdateChart(currentData, true);
