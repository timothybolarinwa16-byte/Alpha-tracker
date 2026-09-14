"use strict";

/*
 * ALPHA TRACKER
 * Main application controller
 *
 * Current stage:
 * - Binance ticker
 * - Binance aggregate trade WebSocket
 * - Pair switching
 * - Live trade stream statistics
 *
 * The exchange-specific code lives in:
 * exchange/binance.js
 *
 * This file controls the application.
 */


/* =========================================================
   APPLICATION STATE
   ========================================================= */

const state = {

  symbol: "BTCUSDT",

  exchange: null,

  liveTrades: 0,

  liveBuyVolume: 0,

  liveSellVolume: 0,

  liveFlow: 0,

  lastTradePrice: null,

  lastTradeTime: null
};


/* =========================================================
   DOM
   ========================================================= */

const pairInput =
  document.getElementById("pairInput");

const loadPairBtn =
  document.getElementById("loadPairBtn");

const connectionStatus =
  document.getElementById("connectionStatus");

const marketPair =
  document.getElementById("marketPair");

const currentPrice =
  document.getElementById("currentPrice");

const priceChange =
  document.getElementById("priceChange");

const volume24h =
  document.getElementById("volume24h");

const tradeCount =
  document.getElementById("tradeCount");

const buyVolume =
  document.getElementById("buyVolume");

const sellVolume =
  document.getElementById("sellVolume");

const netFlow =
  document.getElementById("netFlow");

const volumeDensity =
  document.getElementById("volumeDensity");

const cumulativeFlow =
  document.getElementById("cumulativeFlow");

const densityIndicator =
  document.getElementById("densityIndicator");

const makerBalance =
  document.getElementById("makerBalance");

const tradeEfficiency =
  document.getElementById("tradeEfficiency");

const lastUpdated =
  document.getElementById("lastUpdated");


/* =========================================================
   FORMATTERS
   ========================================================= */

function formatNumber(
  value,
  decimals = 2
) {

  const number =
    Number(value);


  if (!Number.isFinite(number)) {
    return "--";
  }


  return number.toLocaleString(
    undefined,
    {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }
  );
}


function formatPrice(value) {

  const number =
    Number(value);


  if (!Number.isFinite(number)) {
    return "--";
  }


  let decimals = 2;


  if (number < 1) {

    decimals = 6;

  } else if (number < 100) {

    decimals = 4;

  } else if (number < 1000) {

    decimals = 3;

  }


  return number.toLocaleString(
    undefined,
    {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }
  );
}


/* =========================================================
   STATUS
   ========================================================= */

function setStatus(
  text,
  connected = false
) {

  connectionStatus.textContent =
    text;


  connectionStatus.style.color =
    connected
      ? "var(--positive)"
      : "var(--negative)";
}


/* =========================================================
   MARKET TICKER
   ========================================================= */

async function loadTicker() {

  try {

    const ticker =
      await state.exchange.get24hTicker(
        state.symbol
      );


    currentPrice.textContent =
      formatPrice(
        ticker.lastPrice
      );


    const change =
      Number(
        ticker.priceChangePercent
      );


    priceChange.textContent =
      `${change >= 0 ? "+" : ""}${formatNumber(change, 2)}%`;


    priceChange.style.color =
      change >= 0
        ? "var(--positive)"
        : "var(--negative)";


    volume24h.textContent =
      formatNumber(
        ticker.volume,
        2
      );


    tradeCount.textContent =
      Number(ticker.count).toLocaleString();


  } catch (error) {

    console.error(
      "Ticker error:",
      error
    );

  }
}


/* =========================================================
   TRADE STREAM RESET
   ========================================================= */

function resetTradeStats() {

  state.liveTrades = 0;

  state.liveBuyVolume = 0;

  state.liveSellVolume = 0;

  state.liveFlow = 0;

  state.lastTradePrice = null;

  state.lastTradeTime = null;


  buyVolume.textContent =
    "--";

  sellVolume.textContent =
    "--";

  netFlow.textContent =
    "--";

  volumeDensity.textContent =
    "--";

  cumulativeFlow.textContent =
    "--";

  densityIndicator.textContent =
    "--";

  makerBalance.textContent =
    "--";

  tradeEfficiency.textContent =
    "--";

  lastUpdated.textContent =
    "Last update: --";
}


/* =========================================================
   TRADE STREAM HANDLER
   ========================================================= */

function handleTrade(trade) {

  /*
   * Every message arriving here is one
   * normalized Binance aggregate trade.
   */


  state.liveTrades++;


  state.lastTradePrice =
    trade.price;


  state.lastTradeTime =
    trade.time;


  state.liveBuyVolume +=
    trade.aggressiveBuy;


  state.liveSellVolume +=
    trade.aggressiveSell;


  /*
   * Flow:
   *
   * aggressive buy volume
   * minus
   * aggressive sell volume
   */

  state.liveFlow =
    state.liveBuyVolume -
    state.liveSellVolume;


  updateTradeDisplay();
}


/* =========================================================
   TRADE DISPLAY
   ========================================================= */

function updateTradeDisplay() {

  buyVolume.textContent =
    formatNumber(
      state.liveBuyVolume,
      6
    );


  sellVolume.textContent =
    formatNumber(
      state.liveSellVolume,
      6
    );


  netFlow.textContent =
    formatNumber(
      state.liveFlow,
      6
    );


  /*
   * For now this is live volume per
   * received aggregate trade.
   *
   * The proper price-density calculation
   * comes with the price-bucket engine.
   */

  const totalVolume =
    state.liveBuyVolume +
    state.liveSellVolume;


  const density =
    state.liveTrades > 0
      ? totalVolume / state.liveTrades
      : 0;


  volumeDensity.textContent =
    formatNumber(
      density,
      6
    );


  cumulativeFlow.textContent =
    formatNumber(
      state.liveFlow,
      6
    );


  densityIndicator.textContent =
    formatNumber(
      density,
      6
    );


  /*
   * Maker balance is represented here
   * through aggressive buy vs aggressive sell.
   *
   * This is NOT yet the final maker-balance
   * indicator. That belongs to the analysis layer.
   */

  const total =
    state.liveBuyVolume +
    state.liveSellVolume;


  const balance =
    total > 0
      ? (
          (state.liveBuyVolume -
           state.liveSellVolume)
          / total
        ) * 100
      : 0;


  makerBalance.textContent =
    `${formatNumber(balance, 2)}%`;


  /*
   * Basic trade efficiency placeholder.
   *
   * The real CEA / price-displacement
   * calculation will replace this.
   */

  if (
    state.lastTradePrice !== null
  ) {

    tradeEfficiency.textContent =
      formatPrice(
        state.lastTradePrice
      );

  }


  currentPrice.textContent =
    formatPrice(
      state.lastTradePrice
    );


  if (
    state.lastTradeTime !== null
  ) {

    const time =
      new Date(
        state.lastTradeTime
      );


    lastUpdated.textContent =
      `Last trade: ${time.toLocaleTimeString()}`;
  }
}


/* =========================================================
   CONNECTION EVENTS
   ========================================================= */

function handleConnection(status) {

  if (status === "connected") {

    setStatus(
      "Trade stream live",
      true
    );

    return;
  }


  if (status === "error") {

    setStatus(
      "Trade stream error"
    );

    return;
  }


  if (status === "disconnected") {

    setStatus(
      "Reconnecting..."
    );

    return;
  }


  setStatus(status);
}


/* =========================================================
   CHANGE PAIR
   ========================================================= */

async function changePair() {

  const symbol =
    String(pairInput.value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");


  if (!symbol) {

    setStatus(
      "Enter a pair"
    );

    return;
  }


  try {

    setStatus(
      "Loading..."
    );


    /*
     * Stop old stream before changing pair.
     */

    state.exchange.disconnectTradeStream(
      false
    );


    state.symbol =
      symbol;


    state.exchange.setSymbol(
      symbol
    );


    marketPair.textContent =
      symbol;


    pairInput.value =
      symbol;


    resetTradeStats();


    /*
     * Validate the pair through the
     * 24h ticker endpoint first.
     */

    await state.exchange.get24hTicker(
      symbol
    );


    /*
     * Load current market information.
     */

    await loadTicker();


    /*
     * Start the real-time trade stream.
     */

    state.exchange.connectTradeStream(
      symbol
    );


  } catch (error) {

    console.error(
      "Pair change error:",
      error
    );


    setStatus(
      "Invalid pair"
    );


    currentPrice.textContent =
      "--";

    priceChange.textContent =
      "--";

    volume24h.textContent =
      "--";

    tradeCount.textContent =
      "--";
  }
}


/* =========================================================
   BUTTON
   ========================================================= */

loadPairBtn.addEventListener(
  "click",
  changePair
);


/* =========================================================
   ENTER KEY
   ========================================================= */

pairInput.addEventListener(
  "keydown",
  event => {

    if (event.key === "Enter") {
      changePair();
    }

  }
);


/* =========================================================
   INITIALIZE
   ========================================================= */

function initialize() {

  /*
   * BinanceExchange comes from:
   *
   * exchange/binance.js
   */

  if (
    typeof window.BinanceExchange !==
    "function"
  ) {

    console.error(
      "BinanceExchange is not loaded."
    );


    setStatus(
      "Exchange module missing"
    );


    return;
  }


  state.exchange =
    new window.BinanceExchange();


  state.exchange.onConnectionChange(
    handleConnection
  );


  state.exchange.onTrade(
    handleTrade
  );


  /*
   * Start with BTCUSDT.
   */

  changePair();


  /*
   * Refresh the 24h ticker periodically.
   *
   * Trade price itself is updated from
   * the WebSocket.
   */

  setInterval(
    loadTicker,
    10000
  );
}


/* =========================================================
   START
   ========================================================= */

initialize();
