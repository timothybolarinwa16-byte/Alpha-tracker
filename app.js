import {
  BinanceFuturesExchange
} from "./exchange.js";

import {
  renderTradeFlowChart,
  renderTradeFlowError
} from "./flow-chart.js";


/* =========================================================
   STATE
========================================================= */

const state = {

  symbol: "BTCUSDT",

  exchange: null,

  liveTrades: 0,
  liveBuyVolume: 0,
  liveSellVolume: 0,
  liveFlow: 0,

  lastTradePrice: null,
  lastTradeTime: null,

  tradeHistory: [],

  symbolResolving: false

};


/* =========================================================
   DOM
========================================================= */

const els = {

  status:
    document.getElementById(
      "connectionStatus"
    ),

  pairInput:
    document.getElementById(
      "pairInput"
    ),

  marketPair:
    document.getElementById(
      "marketPair"
    ),

  currentPrice:
    document.getElementById(
      "currentPrice"
    ),

  priceChange:
    document.getElementById(
      "priceChange"
    ),

  volume24h:
    document.getElementById(
      "volume24h"
    ),

  tradeCount:
    document.getElementById(
      "tradeCount"
    ),

  tradeStart:
    document.getElementById(
      "tradeStart"
    ),

  tradeEnd:
    document.getElementById(
      "tradeEnd"
    ),

  priceBucket:
    document.getElementById(
      "priceBucket"
    ),

  inspectTradesBtn:
    document.getElementById(
      "inspectTradesBtn"
    ),

  tradeTableBody:
    document.getElementById(
      "tradeTableBody"
    ),

  buyVolume:
    document.getElementById(
      "buyVolume"
    ),

  sellVolume:
    document.getElementById(
      "sellVolume"
    ),

  netFlow:
    document.getElementById(
      "netFlow"
    ),

  volumeDensity:
    document.getElementById(
      "volumeDensity"
    ),

  orderBookRange:
    document.getElementById(
      "orderBookRange"
    ),

  orderBookLevels:
    document.getElementById(
      "orderBookLevels"
    ),

  loadOrderBookBtn:
    document.getElementById(
      "loadOrderBookBtn"
    ),

  asksBody:
    document.getElementById(
      "asksBody"
    ),

  bidsBody:
    document.getElementById(
      "bidsBody"
    ),

  cumulativeFlow:
    document.getElementById(
      "cumulativeFlow"
    ),

  densityIndicator:
    document.getElementById(
      "densityIndicator"
    ),

  makerBalance:
    document.getElementById(
      "makerBalance"
    ),

  tradeEfficiency:
    document.getElementById(
      "tradeEfficiency"
    ),

  lastUpdated:
    document.getElementById(
      "lastUpdated"
    )
};


/* =========================================================
   FORMATTING
========================================================= */

function formatNumber(
  value,
  decimals = 2
) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "--";
  }

  return n.toLocaleString(
    undefined,
    {
      minimumFractionDigits:
        decimals,

      maximumFractionDigits:
        decimals
    }
  );
}


function formatPrice(value) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "--";
  }

  if (n >= 1000) {
    return n.toLocaleString(
      undefined,
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    );
  }

  if (n >= 1) {
    return n.toFixed(4);
  }

  if (n >= 0.01) {
    return n.toFixed(6);
  }

  return n.toFixed(10);
}


function formatVolume(value) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "--";
  }

  const abs = Math.abs(n);

  if (abs >= 1000000) {
    return (
      (n / 1000000).toFixed(2) +
      "M"
    );
  }

  if (abs >= 1000) {
    return (
      (n / 1000).toFixed(2) +
      "K"
    );
  }

  if (abs >= 1) {
    return n.toFixed(2);
  }

  if (abs >= 0.01) {
    return n.toFixed(4);
  }

  return n.toFixed(8);
}


function normalizeSymbol(value) {

  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  message,
  type = "disconnected"
) {

  if (!els.status) {
    return;
  }

  els.status.textContent =
    message;

  els.status.classList.remove(
    "connected",
    "error",
    "disconnected"
  );

  els.status.classList.add(
    type
  );
}


/* =========================================================
   TICKER
========================================================= */

async function loadTicker() {

  if (!state.exchange) {
    return;
  }

  try {

    const ticker =
      await state.exchange.get24hTicker(
        state.symbol
      );

    const price =
      Number(ticker.lastPrice);

    if (els.currentPrice) {

      els.currentPrice.textContent =
        formatPrice(price);
    }

    const change =
      Number(
        ticker.priceChangePercent
      );

    if (els.priceChange) {

      els.priceChange.textContent =
        `${formatNumber(change, 2)}%`;

      els.priceChange.classList.remove(
        "positive",
        "negative"
      );

      els.priceChange.classList.add(
        change >= 0
          ? "positive"
          : "negative"
      );
    }

    if (els.volume24h) {

      els.volume24h.textContent =
        formatVolume(
          ticker.volume
        );
    }

    if (els.tradeCount) {

      els.tradeCount.textContent =
        formatNumber(
          ticker.count,
          0
        );
    }

    if (
      !Number.isFinite(
        state.lastTradePrice
      ) &&
      Number.isFinite(price)
    ) {

      state.lastTradePrice =
        price;
    }

    if (els.lastUpdated) {

      els.lastUpdated.textContent =
        `Last updated: ${
          new Date()
            .toLocaleTimeString()
        }`;
    }

  } catch (error) {

    console.error(
      "Futures ticker error:",
      error
    );
  }
}


/* =========================================================
   LIVE TRADE FLOW
========================================================= */

function resetTradeStats() {

  state.liveTrades = 0;
  state.liveBuyVolume = 0;
  state.liveSellVolume = 0;
  state.liveFlow = 0;

  state.lastTradePrice = null;
  state.lastTradeTime = null;

  state.tradeHistory = [];

  updateTradeDisplay();
}


function handleTrade(trade) {

  if (!trade) {
    return;
  }

  const price =
    Number(trade.price);

  const quantity =
    Number(trade.quantity);

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return;
  }

  state.liveTrades++;

  if (
    trade.aggressiveSide ===
    "buy"
  ) {

    state.liveBuyVolume +=
      quantity;

  } else {

    state.liveSellVolume +=
      quantity;
  }

  state.liveFlow =
    state.liveBuyVolume -
    state.liveSellVolume;

  state.lastTradePrice =
    price;

  state.lastTradeTime =
    Number(trade.time) ||
    Date.now();

  state.tradeHistory.push({
    id: Number(trade.id),
    price,
    quantity,
    time: state.lastTradeTime,
    aggressiveSide:
      trade.aggressiveSide,
    buyerIsMaker:
      trade.buyerIsMaker === true
  });

  if (
    state.tradeHistory.length >
    20000
  ) {

    state.tradeHistory.splice(
      0,
      state.tradeHistory.length -
      20000
    );
  }

  updateTradeDisplay();
}


function updateTradeDisplay() {

  if (els.buyVolume) {
    els.buyVolume.textContent =
      formatVolume(
        state.liveBuyVolume
      );
  }

  if (els.sellVolume) {
    els.sellVolume.textContent =
      formatVolume(
        state.liveSellVolume
      );
  }

  if (els.netFlow) {
    els.netFlow.textContent =
      formatVolume(
        state.liveFlow
      );
  }

  const total =
    state.liveBuyVolume +
    state.liveSellVolume;

  const density =
    state.liveTrades > 0
      ? total / state.liveTrades
      : 0;

  if (els.volumeDensity) {
    els.volumeDensity.textContent =
      formatVolume(density);
  }

  if (els.cumulativeFlow) {
    els.cumulativeFlow.textContent =
      formatVolume(
        state.liveFlow
      );
  }

  if (els.densityIndicator) {
    els.densityIndicator.textContent =
      formatVolume(density);
  }

  const balance =
    total > 0
      ? (
          (
            state.liveBuyVolume -
            state.liveSellVolume
          ) /
          total
        ) *
        100
      : 0;

  if (els.makerBalance) {
    els.makerBalance.textContent =
      `${formatNumber(balance, 2)}%`;
  }

  if (els.tradeEfficiency) {

    els.tradeEfficiency.textContent =
      Number.isFinite(
        state.lastTradePrice
      )
        ? formatPrice(
            state.lastTradePrice
          )
        : "--";
  }
}


/* =========================================================
   TIME
========================================================= */

function getTimeValue(element) {

  if (
    !element ||
    !element.value
  ) {
    return null;
  }

  const value =
    element.value;

  if (/^\d+$/.test(value)) {

    const n =
      Number(value);

    return n < 100000000000
      ? n * 1000
      : n;
  }

  const time =
    new Date(value).getTime();

  return Number.isFinite(time)
    ? time
    : null;
}


function getInspectionWindow() {

  let start =
    getTimeValue(
      els.tradeStart
    );

  let end =
    getTimeValue(
      els.tradeEnd
    );

  const now = Date.now();

  if (!start && !end) {

    end = now;

    start =
      now -
      15 * 60 * 1000;
  }

  if (!start) {

    start =
      now -
      15 * 60 * 1000;
  }

  if (!end) {
    end = now;
  }

  if (start > end) {

    const temp = start;

    start = end;
    end = temp;
  }

  return {
    start,
    end
  };
}


/* =========================================================
   INSPECT TRADES
========================================================= */

async function inspectTrades() {

  if (
    !els.inspectTradesBtn ||
    !state.exchange
  ) {
    return;
  }

  els.inspectTradesBtn.disabled =
    true;

  els.inspectTradesBtn.textContent =
    "Loading Futures flow...";

  try {

    const {
      start,
      end
    } =
      getInspectionWindow();

    const series =
      await state.exchange
        .getHistoricalFlowSeries(
          state.symbol,
          start,
          end,
          "5m",
          (
            requestNumber,
            candleCount
          ) => {

            els.inspectTradesBtn.textContent =
              `Loading Futures... ${requestNumber} batches`;

            console.log(
              "Historical Futures kline batch:",
              requestNumber,
              candleCount
            );
          }
        );

    renderTradeFlowChart(
      series
    );
updateTemporalMetrics(series);
  } catch (error) {

    console.error(
      "Historical Futures flow error:",
      error
    );

    renderTradeFlowError(
      error.message ||
      "Unable to load Futures historical flow"
    );

  } finally {

    els.inspectTradesBtn.disabled =
      false;

    els.inspectTradesBtn.textContent =
      "Inspect Trades";
  }
}


/* =========================================================
   ORDER BOOK TOTALS
========================================================= */

function createOrderBookTotals() {

  if (
    !els.asksBody ||
    document.getElementById(
      "orderBookTotals"
    )
  ) {
    return;
  }

  const section =
    els.asksBody.closest(".panel") ||
    els.asksBody.parentElement;

  if (!section) {
    return;
  }

  const totals =
    document.createElement("div");

  totals.id =
    "orderBookTotals";

  totals.style.display =
    "grid";

  totals.style.gridTemplateColumns =
    "1fr 1fr";

  totals.style.gap = "10px";
  totals.style.margin = "12px 0";

  totals.innerHTML = `

    <div class="metric-card">

      <div class="metric-label">
        Total Ask Quantity
      </div>

      <div id="totalAskQuantity">
        --
      </div>

    </div>

    <div class="metric-card">

      <div class="metric-label">
        Total Bid Quantity
      </div>

      <div id="totalBidQuantity">
        --
      </div>

    </div>

  `;

  section.insertBefore(
    totals,
    section.firstChild
  );
}


/* =========================================================
   ORDER BOOK
========================================================= */

function normalizeBookLevel(level) {

  if (Array.isArray(level)) {

    const price =
      Number(level[0]);

    const quantity =
      Number(level[1]);

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity)
    ) {
      return null;
    }

    return {
      price,
      quantity
    };
  }

  if (
    level &&
    typeof level === "object"
  ) {

    const price =
      Number(level.price);

    const quantity =
      Number(
        level.quantity ??
        level.qty
      );

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity)
    ) {
      return null;
    }

    return {
      price,
      quantity
    };
  }

  return null;
}


function getOrderBookReferencePrice() {

  if (
    Number.isFinite(
      state.lastTradePrice
    ) &&
    state.lastTradePrice > 0
  ) {
    return state.lastTradePrice;
  }

  const displayed =
    Number(
      String(
        els.currentPrice?.textContent ||
        ""
      ).replace(
        /[^0-9.-]/g,
        ""
      )
    );

  return (
    Number.isFinite(displayed) &&
    displayed > 0
  )
    ? displayed
    : 0;
}


function createOrderBookZones(
  cmp,
  spacingPercent,
  levels,
  side
) {

  const price =
    Number(cmp);

  const spacing =
    Number(spacingPercent) /
    100;

  const count =
    Math.max(
      1,
      Math.min(
        100,
        Number(levels) || 10
      )
    );

  const zones = [];

  for (
    let i = 0;
    i < count;
    i++
  ) {

    const start =
      spacing * i;

    const end =
      spacing * (i + 1);

    let lower;
    let upper;

    if (side === "asks") {

      lower =
        price * (1 + start);

      upper =
        price * (1 + end);

    } else {

      lower =
        price * (1 - end);

      upper =
        price * (1 - start);
    }

    zones.push({
      level: i + 1,
      lower,
      upper,
      quantity: 0,
      value: 0
    });
  }

  return zones;
}


function aggregateOrderBookLevels(
  levels,
  zones,
  side
) {

  for (const level of levels) {

    const price =
      Number(level.price);

    const quantity =
      Number(level.quantity);

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      price <= 0 ||
      quantity <= 0
    ) {
      continue;
    }

    for (const zone of zones) {

      const inside =
        side === "asks"

          ? (
              price >= zone.lower &&
              price < zone.upper
            )

          : (
              price > zone.lower &&
              price <= zone.upper
            );

      if (!inside) {
        continue;
      }

      zone.quantity +=
        quantity;

      zone.value +=
        price * quantity;

      break;
    }
  }
}


function renderOrderBookSide(
  body,
  zones
) {

  if (!body) {
    return;
  }

  body.innerHTML = "";

  const fragment =
    document.createDocumentFragment();

  for (const zone of zones) {

    const row =
      document.createElement("tr");

    row.innerHTML = `

      <td>
        ${formatPrice(zone.lower)}
        -
        ${formatPrice(zone.upper)}
      </td>

      <td>
        ${formatVolume(zone.quantity)}
      </td>

      <td>
        ${formatVolume(zone.value)}
      </td>

    `;

    fragment.appendChild(row);
  }

  body.appendChild(fragment);
}


function updateOrderBookTotals(
  asks,
  bids
) {

  const askTotal =
    asks.reduce(
      (sum, zone) =>
        sum + zone.quantity,
      0
    );

  const bidTotal =
    bids.reduce(
      (sum, zone) =>
        sum + zone.quantity,
      0
    );

  const ask =
    document.getElementById(
      "totalAskQuantity"
    );

  const bid =
    document.getElementById(
      "totalBidQuantity"
    );

  if (ask) {
    ask.textContent =
      formatVolume(askTotal);
  }

  if (bid) {
    bid.textContent =
      formatVolume(bidTotal);
  }
}


async function loadOrderBook() {

  if (!state.exchange) {
    return;
  }

  if (els.loadOrderBookBtn) {

    els.loadOrderBookBtn.disabled =
      true;

    els.loadOrderBookBtn.textContent =
      "Loading Futures book...";
  }

  try {

    const book =
      await state.exchange
        .getOrderBook(
          state.symbol,
          1000
        );

    const asks =
      (book.asks || [])
        .map(normalizeBookLevel)
        .filter(Boolean)
        .filter(
          level =>
            level.price > 0 &&
            level.quantity > 0
        );

    const bids =
      (book.bids || [])
        .map(normalizeBookLevel)
        .filter(Boolean)
        .filter(
          level =>
            level.price > 0 &&
            level.quantity > 0
        );

    const cmp =
      getOrderBookReferencePrice();

    if (
      !Number.isFinite(cmp) ||
      cmp <= 0
    ) {
      throw new Error(
        "Current Futures market price unavailable"
      );
    }

    const spacing =
      Math.max(
        0.0001,
        Number(
          els.orderBookRange?.value
        ) || 0.2
      );

    const levels =
      Math.max(
        1,
        Math.min(
          100,
          Number(
            els.orderBookLevels?.value
          ) || 10
        )
      );

    const askZones =
      createOrderBookZones(
        cmp,
        spacing,
        levels,
        "asks"
      );

    const bidZones =
      createOrderBookZones(
        cmp,
        spacing,
        levels,
        "bids"
      );

    aggregateOrderBookLevels(
      asks,
      askZones,
      "asks"
    );

    aggregateOrderBookLevels(
      bids,
      bidZones,
      "bids"
    );

    renderOrderBookSide(
      els.asksBody,
      askZones
    );

    renderOrderBookSide(
      els.bidsBody,
      bidZones
    );

    updateOrderBookTotals(
      askZones,
      bidZones
    );

  } catch (error) {

    console.error(
      "Futures order book error:",
      error
    );

    if (els.asksBody) {

      els.asksBody.innerHTML = `
        <tr>
          <td colspan="3">
            Unable to load Futures order book.
          </td>
        </tr>
      `;
    }

    if (els.bidsBody) {

      els.bidsBody.innerHTML = `
        <tr>
          <td colspan="3">
            Unable to load Futures order book.
          </td>
        </tr>
      `;
    }

    updateOrderBookTotals(
      [],
      []
    );

  } finally {

    if (els.loadOrderBookBtn) {

      els.loadOrderBookBtn.disabled =
        false;

      els.loadOrderBookBtn.textContent =
        "Load Order Book";
    }
  }
}


/* =========================================================
   CONNECTION
========================================================= */

function handleConnection(status) {

  if (status === "connected") {

    setStatus(
      "Binance Futures trade stream live",
      "connected"
    );

    return;
  }

  if (status === "error") {

    setStatus(
      "Binance Futures trade stream error",
      "error"
    );

    return;
  }

  setStatus(
    "Reconnecting to Binance Futures...",
    "disconnected"
  );
}


/* =========================================================
   CLEAR
========================================================= */

function clearMarketTables() {

  if (els.tradeTableBody) {

    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          No trade data loaded.
        </td>
      </tr>
    `;
  }

  const chart =
    document.getElementById(
      "tradeFlowChart"
    );

  if (chart) {

    chart.innerHTML = "";

    chart._flowSeries = [];
  }

  if (els.asksBody) {

    els.asksBody.innerHTML = `
      <tr>
        <td colspan="3">
          No data
        </td>
      </tr>
    `;
  }

  if (els.bidsBody) {

    els.bidsBody.innerHTML = `
      <tr>
        <td colspan="3">
          No data
        </td>
      </tr>
    `;
  }

  const ask =
    document.getElementById(
      "totalAskQuantity"
    );

  const bid =
    document.getElementById(
      "totalBidQuantity"
    );

  if (ask) {
    ask.textContent = "--";
  }

  if (bid) {
    bid.textContent = "--";
  }
}


/* =========================================================
   CHANGE PAIR
========================================================= */

async function changePair() {

  if (
    state.symbolResolving ||
    !state.exchange
  ) {
    return;
  }

  const entered =
    normalizeSymbol(
      els.pairInput?.value
    );

  if (!entered) {
    return;
  }

  state.symbolResolving = true;

  if (els.pairInput) {
    els.pairInput.disabled = true;
  }

  setStatus(
    "Resolving Binance Futures pair...",
    "disconnected"
  );

  try {

    const symbol =
      await state.exchange
        .resolveSymbol(
          entered
        );

    state.exchange
      .disconnectTradeStream(true);

    state.symbol = symbol;

    state.exchange
      .setSymbol(symbol);

    if (els.pairInput) {
      els.pairInput.value =
        symbol;
    }

    if (els.marketPair) {
      els.marketPair.textContent =
        symbol;
    }

    resetTradeStats();
    clearMarketTables();

    await loadTicker();

    state.exchange
      .connectTradeStream(symbol);

    setStatus(
      `Loading Binance Futures: ${symbol}`,
      "disconnected"
    );

    await loadOrderBook();

  } catch (error) {

    console.error(
      "Futures pair change error:",
      error
    );

    setStatus(
      error.message ||
      "Invalid Binance Futures pair",
      "error"
    );

  } finally {

    state.symbolResolving =
      false;

    if (els.pairInput) {
      els.pairInput.disabled =
        false;
    }
  }
}


/* =========================================================
   EVENTS
========================================================= */

document
  .getElementById(
    "loadPairBtn"
  )
  ?.addEventListener(
    "click",
    changePair
  );


els.pairInput
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {
        changePair();
      }

    }
  );


els.inspectTradesBtn
  ?.addEventListener(
    "click",
    inspectTrades
  );


els.loadOrderBookBtn
  ?.addEventListener(
    "click",
    loadOrderBook
  );


/* =========================================================
   INITIALIZE
========================================================= */

async function initialize() {

  state.exchange =
    new BinanceFuturesExchange(
      state.symbol
    );

  state.exchange.onTrade(
    handleTrade
  );

  state.exchange.onConnection(
    handleConnection
  );

  createOrderBookTotals();

  /*
   * Deliberately no:
   *
   * updateTradeTableHeaders();
   *
   * That function did not exist in the
   * previous source and could abort
   * initialization.
   */

  await changePair();

  setInterval(
    loadTicker,
    10000
  );
}


initialize();


/* =========================================================
   DEBUG
========================================================= */

window.AlphaTracker = {
  state,
  exchange: () => state.exchange
}; 
