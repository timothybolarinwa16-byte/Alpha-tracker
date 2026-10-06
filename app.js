import {
  normalizeSymbol,
  resolveSymbol,
  get24hTicker,
  getHistoricalKlines
} from "./exchange.js";

import {
  calculateAllMetrics
} from "./metrics.js";

const state = {
  symbol: "BTCUSDT",
  candles: [],
  metrics: null,
  tickerTimer: null
};

const $ = id => document.getElementById(id);

const elements = {
  pairInput: $("pairInput"),
  loadPairBtn: $("loadPairBtn"),
  connectionStatus: $("connectionStatus"),

  currentPrice: $("currentPrice"),
  priceChange: $("priceChange"),
  volume24h: $("volume24h"),
  tradeCount: $("tradeCount"),

  tradeStart: $("tradeStart"),
  tradeEnd: $("tradeEnd"),
  inspectTradesBtn: $("inspectTradesBtn"),
  analysisStatus: $("analysisStatus"),

  buyTDA: $("buyTDA"),
  buyTDR: $("buyTDR"),
  buySC: $("buySC"),
  buySF: $("buySF"),

  sellTDA: $("sellTDA"),
  sellTDR: $("sellTDR"),
  sellSC: $("sellSC"),
  sellSF: $("sellSF"),

  buyPairedWins: $("buyPairedWins"),
  buyPairedAverage: $("buyPairedAverage"),
  sellPairedWins: $("sellPairedWins"),
  sellPairedAverage: $("sellPairedAverage"),

  buyDominanceChart: $("buyDominanceChart"),
  sellDominanceChart: $("sellDominanceChart"),

  envelopeRange: $("envelopeRange"),
  pathRange: $("pathRange"),
  sdaEnvelope: $("sdaEnvelope"),
  sdaPath: $("sdaPath"),
  stdEnvelope: $("stdEnvelope"),
  stdPath: $("stdPath"),

  transactionDensity: $("transactionDensity"),
  transactionDensityAverage: $("transactionDensityAverage"),
  transactionDensityRatio: $("transactionDensityRatio"),
  transactionSpikeCount: $("transactionSpikeCount"),
  transactionSpikeFrequency: $("transactionSpikeFrequency"),
  averageTransactionVolume: $("averageTransactionVolume"),

  observationCount: $("observationCount"),
  analysisDuration: $("analysisDuration"),
  analysisVolume: $("analysisVolume"),
  analysisTransactions: $("analysisTransactions"),

  lastUpdated: $("lastUpdated")
};

function formatNumber(value, decimals = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatCompact(value, decimals = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  const absolute = Math.abs(number);

  if (absolute >= 1e9) {
    return `${formatNumber(number / 1e9, decimals)}B`;
  }

  if (absolute >= 1e6) {
    return `${formatNumber(number / 1e6, decimals)}M`;
  }

  if (absolute >= 1e3) {
    return `${formatNumber(number / 1e3, decimals)}K`;
  }

  return formatNumber(number, decimals);
}

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  if (number >= 1000) {
    return number.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  if (number >= 1) {
    return number.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    });
  }

  return number.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 8
  });
}

function formatDuration(hours) {
  const value = Number(hours);

  if (!Number.isFinite(value) || value <= 0) {
    return "0h";
  }

  if (value < 1) {
    return `${formatNumber(value * 60, 1)}m`;
  }

  if (value < 24) {
    return `${formatNumber(value, 2)}h`;
  }

  const days = value / 24;

  return `${formatNumber(days, 2)}d`;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

function setStatus(message, type = "normal") {
  elements.connectionStatus.textContent = message;

  elements.connectionStatus.classList.remove(
    "positive",
    "negative",
    "warning"
  );

  if (type === "positive") {
    elements.connectionStatus.classList.add("positive");
  }

  if (type === "negative") {
    elements.connectionStatus.classList.add("negative");
  }

  if (type === "warning") {
    elements.connectionStatus.classList.add("warning");
  }
}

function setAnalysisStatus(message, type = "normal") {
  elements.analysisStatus.textContent = message;

  elements.analysisStatus.classList.remove(
    "positive",
    "negative",
    "warning"
  );

  if (type === "positive") {
    elements.analysisStatus.classList.add("positive");
  }

  if (type === "negative") {
    elements.analysisStatus.classList.add("negative");
  }

  if (type === "warning") {
    elements.analysisStatus.classList.add("warning");
  }
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function renderTicker(ticker) {
  setText(
    elements.currentPrice,
    formatPrice(ticker.price)
  );

  setText(
    elements.priceChange,
    `${formatNumber(ticker.priceChange, 2)}%`
  );

  setText(
    elements.volume24h,
    formatCompact(ticker.volume, 2)
  );

  setText(
    elements.tradeCount,
    formatCompact(ticker.trades, 0)
  );

  elements.priceChange.classList.remove(
    "positive",
    "negative"
  );

  if (ticker.priceChange > 0) {
    elements.priceChange.classList.add("positive");
  } else if (ticker.priceChange < 0) {
    elements.priceChange.classList.add("negative");
  }
}

async function updateTicker() {
  if (!state.symbol) {
    return;
  }

  try {
    const ticker = await get24hTicker(state.symbol);

    renderTicker(ticker);

    setStatus(
      `${state.symbol} connected`,
      "positive"
    );
  } catch (error) {
    console.error(error);

    setStatus(
      `Ticker error: ${error.message}`,
      "negative"
    );
  }
}

function startTicker() {
  if (state.tickerTimer) {
    clearInterval(state.tickerTimer);
  }

  updateTicker();

  state.tickerTimer = setInterval(
    updateTicker,
    15000
  );
}

function getAnalysisRange() {
  const startValue =
    elements.tradeStart.value;

  const endValue =
    elements.tradeEnd.value;

  if (!startValue || !endValue) {
    throw new Error(
      "Select both a start and end time."
    );
  }

  const startTime =
    new Date(startValue).getTime();

  const endTime =
    new Date(endValue).getTime();

  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime)
  ) {
    throw new Error(
      "Invalid analysis time."
    );
  }

  if (startTime >= endTime) {
    throw new Error(
      "Start time must be before end time."
    );
  }

  return {
    startTime,
    endTime
  };
}

function renderTemporalMetrics(
  metrics,
  prefix
) {
  const target = prefix === "buy"
    ? metrics.buyTemporal
    : metrics.sellTemporal;

  setText(
    elements[`${prefix}TDA`],
    formatCompact(target.tda, 4)
  );

  /*
   * TDR is a series, so this card displays the
   * most recent observation.
   */
  const latest =
    target.tdr.length > 0
      ? target.tdr[target.tdr.length - 1].tdr
      : 0;

  setText(
    elements[`${prefix}TDR`],
    formatNumber(latest, 2)
  );

  setText(
    elements[`${prefix}SC`],
    formatNumber(target.spikeCount, 0)
  );

  setText(
    elements[`${prefix}SF`],
    formatNumber(target.spikeFrequency, 2)
  );
}

function renderPairedDominance(metrics) {
  const dominance =
    metrics.pairedDominance;

  setText(
    elements.buyPairedWins,
    formatNumber(
      dominance.buy.wins,
      0
    )
  );

  setText(
    elements.buyPairedAverage,
    formatNumber(
      dominance.buy.average,
      2
    )
  );

  setText(
    elements.sellPairedWins,
    formatNumber(
      dominance.sell.wins,
      0
    )
  );

  setText(
    elements.sellPairedAverage,
    formatNumber(
      dominance.sell.average,
      2
    )
  );

  drawDominanceChart(
    elements.buyDominanceChart,
    dominance.buy.progression,
    "buy"
  );

  drawDominanceChart(
    elements.sellDominanceChart,
    dominance.sell.progression,
    "sell"
  );
}

function drawDominanceChart(
  canvas,
  values,
  side
) {
  if (!canvas) {
    return;
  }

  const container =
    canvas.parentElement;

  const width =
    Math.max(
      280,
      container.clientWidth
    );

  const height =
    Math.max(
      150,
      container.clientHeight
    );

  const devicePixelRatio =
    window.devicePixelRatio || 1;

  canvas.width =
    width * devicePixelRatio;

  canvas.height =
    height * devicePixelRatio;

  canvas.style.width =
    `${width}px`;

  canvas.style.height =
    `${height}px`;

  const ctx =
    canvas.getContext("2d");

  ctx.setTransform(
    devicePixelRatio,
    0,
    0,
    devicePixelRatio,
    0,
    0
  );

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  if (!values.length) {
    ctx.fillStyle = "#8996a3";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(
      "No paired wins",
      width / 2,
      height / 2
    );

    return;
  }

  const padding = {
    left: 36,
    right: 12,
    top: 14,
    bottom: 25
  };

  const chartWidth =
    width -
    padding.left -
    padding.right;

  const chartHeight =
    height -
    padding.top -
    padding.bottom;

  const maxValue =
    Math.max(...values);

  const minValue =
    Math.min(...values);

  const range =
    maxValue - minValue || 1;

  const chartMax =
    Math.max(
      1,
      maxValue * 1.1
    );

  const chartMin =
    Math.max(
      0,
      Math.min(
        0,
        minValue - range * 0.1
      )
    );

  const chartValueRange =
    chartMax - chartMin || 1;

  /*
   * Grid.
   */
  ctx.strokeStyle =
    "rgba(137,150,163,0.16)";

  ctx.lineWidth = 1;

  const gridLines = 4;

  for (let i = 0; i <= gridLines; i++) {
    const y =
      padding.top +
      (chartHeight * i) /
        gridLines;

    ctx.beginPath();
    ctx.moveTo(
      padding.left,
      y
    );

    ctx.lineTo(
      width - padding.right,
      y
    );

    ctx.stroke();
  }

  /*
   * Y-axis labels.
   */
  ctx.fillStyle = "#8996a3";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= gridLines; i++) {
    const ratio =
      i / gridLines;

    const value =
      chartMax -
      ratio * chartValueRange;

    const y =
      padding.top +
      ratio * chartHeight;

    ctx.fillText(
      formatNumber(value, 1),
      padding.left - 6,
      y
    );
  }

  /*
   * Convert an actual TDR value into
   * canvas coordinates.
   */
  function pointAt(index, value) {
    const x =
      values.length === 1
        ? padding.left +
          chartWidth / 2
        : padding.left +
          (index /
            (values.length - 1)) *
            chartWidth;

    const normalized =
      (value - chartMin) /
      chartValueRange;

    const y =
      padding.top +
      (1 - normalized) *
        chartHeight;

    return {
      x,
      y
    };
  }

  /*
   * Draw progression line.
   */
  ctx.strokeStyle =
    side === "buy"
      ? "#35c98b"
      : "#ff5f6d";

  ctx.lineWidth = 2;

  ctx.beginPath();

  values.forEach((value, index) => {
    const point =
      pointAt(index, value);

    if (index === 0) {
      ctx.moveTo(
        point.x,
        point.y
      );
    } else {
      ctx.lineTo(
        point.x,
        point.y
      );
    }
  });

  ctx.stroke();

  /*
   * Draw event points.
   */
  values.forEach((value, index) => {
    const point =
      pointAt(index, value);

    ctx.beginPath();

    ctx.arc(
      point.x,
      point.y,
      3,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      side === "buy"
        ? "#35c98b"
        : "#ff5f6d";

    ctx.fill();
  });

  /*
   * X-axis labels.
   *
   * These are ordinal dominance events,
   * not timestamps.
   */
  ctx.fillStyle = "#8996a3";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const labelCount =
    Math.min(6, values.length);

  for (let i = 0; i < labelCount; i++) {
    const index =
      labelCount === 1
        ? 0
        : Math.round(
            (i /
              (labelCount - 1)) *
            (values.length - 1)
          );

    const point =
      pointAt(
        index,
        values[index]
      );

    ctx.fillText(
      String(index + 1),
      point.x,
      height - padding.bottom + 8
    );
  }
}

function renderSpatialMetrics(metrics) {
  const spatial =
    metrics.spatial;

  setText(
    elements.envelopeRange,
    formatPrice(
      spatial.envelopeRange
    )
  );

  setText(
    elements.pathRange,
    formatPrice(
      spatial.pathRange
    )
  );

  setText(
    elements.sdaEnvelope,
    formatCompact(
      spatial.sdaEnvelope,
      4
    )
  );

  setText(
    elements.sdaPath,
    formatCompact(
      spatial.sdaPath,
      4
    )
  );

  setText(
    elements.stdEnvelope,
    formatCompact(
      spatial.stdEnvelope,
      4
    )
  );

  setText(
    elements.stdPath,
    formatCompact(
      spatial.stdPath,
      4
    )
  );
}

function renderTransactionMetrics(metrics) {
  const transactions =
    metrics.transactions;

  /*
   * transactionDensity represents
   * the latest transaction-density
   * observation.
   */
  const latest =
    transactions.observations.length > 0
      ? transactions.observations[
          transactions.observations.length - 1
        ].density
      : 0;

  const latestRatio =
    transactions.observations.length > 0
      ? transactions.observations[
          transactions.observations.length - 1
        ].ratio
      : 0;

  setText(
    elements.transactionDensity,
    formatCompact(
      latest,
      2
    )
  );

  setText(
    elements.transactionDensityAverage,
    formatCompact(
      transactions.densityAverage,
      2
    )
  );

  setText(
    elements.transactionDensityRatio,
    formatNumber(
      latestRatio,
      2
    )
  );

  setText(
    elements.transactionSpikeCount,
    formatNumber(
      transactions.spikeCount,
      0
    )
  );

  setText(
    elements.transactionSpikeFrequency,
    formatNumber(
      transactions.spikeFrequency,
      2
    )
  );

  setText(
    elements.averageTransactionVolume,
    formatCompact(
      transactions.averageTransactionVolume,
      6
    )
  );
}

function renderSummary(metrics) {
  const summary =
    metrics.summary;

  setText(
    elements.observationCount,
    formatNumber(
      summary.observationCount,
      0
    )
  );

  setText(
    elements.analysisDuration,
    formatDuration(
      summary.elapsedHours
    )
  );

  setText(
    elements.analysisVolume,
    formatCompact(
      summary.totalVolume,
      2
    )
  );

  setText(
    elements.analysisTransactions,
    formatCompact(
      summary.totalTransactions,
      0
    )
  );
}

function renderAnalysis(metrics) {
  renderTemporalMetrics(
    metrics,
    "buy"
  );

  renderTemporalMetrics(
    metrics,
    "sell"
  );

  renderPairedDominance(
    metrics
  );

  renderSpatialMetrics(
    metrics
  );

  renderTransactionMetrics(
    metrics
  );

  renderSummary(
    metrics
  );
}

async function analyzeWindow() {
  try {
    const {
      startTime,
      endTime
    } = getAnalysisRange();

    setAnalysisStatus(
      `Loading ${state.symbol} historical data...`,
      "warning"
    );

    elements.inspectTradesBtn.disabled = true;

    const candles =
      await getHistoricalKlines(
        state.symbol,
        startTime,
        endTime,
        "5m"
      );

    if (candles.length < 2) {
      throw new Error(
        "Not enough candle observations in this window."
      );
    }

    state.candles = candles;

    const metrics =
      calculateAllMetrics(
        candles
      );

    state.metrics = metrics;

    renderAnalysis(
      metrics
    );

    const duration =
      formatDuration(
        metrics.summary.elapsedHours
      );

    setAnalysisStatus(
      `Analyzed ${candles.length} observations across ${duration}.`,
      "positive"
    );

    setText(
      elements.lastUpdated,
      `Last analysis: ${new Date().toLocaleString()}`
    );
  } catch (error) {
    console.error(error);

    setAnalysisStatus(
      error.message ||
        "Analysis failed.",
      "negative"
    );
  } finally {
    elements.inspectTradesBtn.disabled = false;
  }
}

async function loadPair() {
  try {
    const requested =
      normalizeSymbol(
        elements.pairInput.value
      );

    if (!requested) {
      throw new Error(
        "Enter a trading pair."
      );
    }

    elements.loadPairBtn.disabled = true;

    setStatus(
      `Resolving ${requested}...`,
      "warning"
    );

    const resolved =
      await resolveSymbol(
        requested
      );

    state.symbol = resolved;

    elements.pairInput.value =
      resolved;

    setStatus(
      `${resolved} connected`,
      "positive"
    );

    startTicker();

    /*
     * The historical analysis is intentionally
     * not automatically executed here.
     *
     * The user chooses the analysis window.
     */
  } catch (error) {
    console.error(error);

    setStatus(
      error.message ||
        "Unable to load pair.",
      "negative"
    );
  } finally {
    elements.loadPairBtn.disabled = false;
  }
}

function setDefaultDates() {
  const now =
    Date.now();

  /*
   * Default to the most recent 24 hours.
   */
  const end =
    new Date(now);

  const start =
    new Date(
      now - 24 * 60 * 60 * 1000
    );

  elements.tradeStart.value =
    formatDateTime(start);

  elements.tradeEnd.value =
    formatDateTime(end);
}

function attachEvents() {
  elements.loadPairBtn.addEventListener(
    "click",
    loadPair
  );

  elements.pairInput.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        loadPair();
      }
    }
  );

  elements.inspectTradesBtn.addEventListener(
    "click",
    analyzeWindow
  );

  window.addEventListener(
    "resize",
    () => {
      if (!state.metrics) {
        return;
      }

      drawDominanceChart(
        elements.buyDominanceChart,
        state.metrics.pairedDominance.buy.progression,
        "buy"
      );

      drawDominanceChart(
        elements.sellDominanceChart,
        state.metrics.pairedDominance.sell.progression,
        "sell"
      );
    }
  );
}

async function initialize() {
  setDefaultDates();

  attachEvents();

  elements.pairInput.value =
    state.symbol;

  setStatus(
    "Connecting...",
    "warning"
  );

  try {
    const resolved =
      await resolveSymbol(
        state.symbol
      );

    state.symbol =
      resolved;

    elements.pairInput.value =
      resolved;

    await updateTicker();

    startTicker();
  } catch (error) {
    console.error(error);

    setStatus(
      error.message ||
        "Connection failed.",
      "negative"
    );
  }
}

initialize();
