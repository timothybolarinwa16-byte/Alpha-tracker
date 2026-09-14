"use strict";

/*
 * ALPHA TRACKER
 * Main application controller
 *
 * Current stage:
 * - Binance REST connection
 * - Live ticker
 * - Pair switching
 * - Basic market information
 *
 * Later stages will add:
 * - Aggregate trades
 * - Price-bucket trade inspection
 * - Flow
 * - Volume density
 * - Order book
 * - Indicator compilation
 */


const state = {
  symbol: "BTCUSDT",
  tickerTimer: null,
  requestId: 0
};


/* =========================================================
   DOM REFERENCES
   ========================================================= */

const pairInput = document.getElementById("pairInput");
const loadPairBtn = document.getElementById("loadPairBtn");

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


/* =========================================================
   BINANCE API
   ========================================================= */

const BINANCE_API =
  "https://api.binance.com/api/v3";


/* =========================================================
   HELPERS
   ========================================================= */

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}


function formatNumber(value, decimals = 2) {

  const number = Number(value);

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

  const number = Number(value);

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


function setStatus(text, connected = false) {

  connectionStatus.textContent = text;

  connectionStatus.style.color =
    connected
      ? "var(--positive)"
      : "var(--negative)";
}


function setLoading() {

  currentPrice.textContent = "...";
  priceChange.textContent = "...";
  volume24h.textContent = "...";
  tradeCount.textContent = "...";
}


/* =========================================================
   API REQUEST
   ========================================================= */

async function binanceRequest(endpoint) {

  const response = await fetch(
    `${BINANCE_API}${endpoint}`,
    {
      method: "GET",
      cache: "no-store"
    }
  );

  if (!response.ok) {

    let message =
      `Binance request failed (${response.status})`;

    try {

      const errorData =
        await response.json();

      if (errorData.msg) {
        message = errorData.msg;
      }

    } catch (_) {
      // Keep default error message.
    }

    throw new Error(message);
  }

  return response.json();
}


/* =========================================================
   SYMBOL VALIDATION
   ========================================================= */

async function validateSymbol(symbol) {

  const data =
    await binanceRequest(
      `/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
    );

  return data;
}


/* =========================================================
   LOAD MARKET
   ========================================================= */

async function loadMarket(symbol) {

  const normalized =
    normalizeSymbol(symbol);

  if (!normalized) {

    setStatus("Enter a pair");

    return;
  }


  const requestNumber =
    ++state.requestId;


  setStatus("Connecting...");

  setLoading();


  try {

    const ticker =
      await validateSymbol(normalized);


    /*
     * If the user changed the pair while the
     * previous request was still running,
     * ignore the old response.
     */

    if (requestNumber !== state.requestId) {
      return;
    }


    state.symbol = normalized;

    pairInput.value = normalized;
    marketPair.textContent = normalized;


    updateTicker(ticker);


    setStatus("Live", true);


    /*
     * Restart the automatic ticker.
     */

    startTicker();

  } catch (error) {

    if (requestNumber !== state.requestId) {
      return;
    }

    console.error(error);

    setStatus("Connection error");

    currentPrice.textContent = "--";
    priceChange.textContent = "--";
    volume24h.textContent = "--";
    tradeCount.textContent = "--";

    marketPair.textContent = normalized;
  }
}


/* =========================================================
   UPDATE TICKER
   ========================================================= */

function updateTicker(ticker) {

  const lastPrice =
    Number(ticker.lastPrice);

  const change =
    Number(ticker.priceChangePercent);

  const volume =
    Number(ticker.volume);

  const count =
    Number(ticker.count);


  currentPrice.textContent =
    formatPrice(lastPrice);


  priceChange.textContent =
    `${change >= 0 ? "+" : ""}${formatNumber(change, 2)}%`;


  priceChange.style.color =
    change >= 0
      ? "var(--positive)"
      : "var(--negative)";


  volume24h.textContent =
    formatNumber(volume, 2);


  tradeCount.textContent =
    Number.isFinite(count)
      ? count.toLocaleString()
      : "--";
}


/* =========================================================
   REFRESH CURRENT TICKER
   ========================================================= */

async function refreshTicker() {

  try {

    const ticker =
      await binanceRequest(
        `/ticker/24hr?symbol=${encodeURIComponent(state.symbol)}`
      );


    updateTicker(ticker);

    setStatus("Live", true);

  } catch (error) {

    console.error(
      "Ticker refresh failed:",
      error
    );

    setStatus("Connection lost");
  }
}


/* =========================================================
   AUTOMATIC REFRESH
   ========================================================= */

function startTicker() {

  if (state.tickerTimer) {
    clearInterval(state.tickerTimer);
  }


  /*
   * The REST ticker is intentionally kept slow
   * for this first connection test.
   *
   * Later we will use Binance WebSockets for
   * the high-frequency trade/order-book streams.
   */

  state.tickerTimer =
    setInterval(
      refreshTicker,
      5000
    );
}


/* =========================================================
   PAIR LOADING
   ========================================================= */

function handlePairLoad() {

  const symbol =
    normalizeSymbol(pairInput.value);

  loadMarket(symbol);
}


loadPairBtn.addEventListener(
  "click",
  handlePairLoad
);


pairInput.addEventListener(
  "keydown",
  event => {

    if (event.key === "Enter") {
      handlePairLoad();
    }

  }
);


/* =========================================================
   INITIALIZE
   ========================================================= */

function initialize() {

  pairInput.value = state.symbol;

  marketPair.textContent = state.symbol;

  loadMarket(state.symbol);
}


initialize();
