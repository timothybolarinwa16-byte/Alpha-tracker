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
   TEMPORAL DENSITY METRICS
========================================================= */

/*
 * TEMPORAL DENSITY
 *
 * Activity per unit of elapsed time.
 *
 * TD = volume / elapsed time
 *
 * TD is always >= 0.
 */


/*
 * Get the actual elapsed time represented
 * by an observation.
 *
 * We deliberately use timestamps rather
 * than candle indexes.
 */

function getTemporalInterval(
  series,
  index
) {

  if (
    index <= 0 ||
    !series[index - 1] ||
    !series[index]
  ) {
    return 0;
  }

  const current =
    Number(series[index].time);

  const previous =
    Number(series[index - 1].time);

  const delta =
    current - previous;

  return delta > 0
    ? delta / 1000
    : 0;
}


/*
 * Calculate TD for every observation.
 */

function calculateTemporalDensity(
  series,
  field
) {

  const observations = [];

  for (
    let i = 1;
    i < series.length;
    i++
  ) {

    const interval =
      getTemporalInterval(
        series,
        i
      );

    if (interval <= 0) {
      continue;
    }

    const volume =
      Math.max(
        0,
        Number(
          series[i][field]
        ) || 0
      );

    const density =
      volume / interval;

    observations.push({

      time:
        Number(series[i].time),

      volume,

      interval,

      density
    });
  }

  return observations;
}


/*
 * TDA
 *
 * Temporal Density Average.
 *
 * Total activity divided by total
 * elapsed time.
 */

function calculateTDA(
  observations
) {

  if (!observations.length) {
    return 0;
  }

  let totalVolume = 0;
  let totalTime = 0;

  for (
    const observation
    of observations
  ) {

    totalVolume +=
      observation.volume;

    totalTime +=
      observation.interval;
  }

  return totalTime > 0
    ? totalVolume / totalTime
    : 0;
}


/*
 * TDR
 *
 * Temporal Density Ratio.
 *
 * This is calculated for EVERY
 * observation.
 *
 * TDR = TD / TDA
 */

function calculateTDRSeries(
  observations,
  tda
) {

  if (
    !observations.length ||
    tda <= 0
  ) {
    return [];
  }

  return observations.map(
    observation => ({

      time:
        observation.time,

      density:
        observation.density,

      tdr:
        observation.density /
        tda
    })
  );
}


/*
 * SC
 *
 * Spike Count.
 *
 * IMPORTANT:
 *
 * SC is NOT the number of distinct
 * spike episodes.
 *
 * Every observation whose TDR is
 * above 1 counts.
 *
 * Example:
 *
 * TDR:
 * 0.8
 * 1.2  <- SC +1
 * 1.8  <- SC +1
 * 2.1  <- SC +1
 * 0.9
 *
 * SC = 3
 */

function calculateSpikeCount(
  tdrSeries
) {

  if (!tdrSeries.length) {
    return 0;
  }

  return tdrSeries.reduce(
    (
      count,
      observation
    ) => {

      return count +
        (
          observation.tdr > 1
            ? 1
            : 0
        );

    },
    0
  );
}


/*
 * Spike Frequency
 *
 * Number of above-average
 * observations per hour.
 */

function calculateSpikeFrequency(
  spikeCount,
  observations
) {

  if (
    !observations.length ||
    spikeCount <= 0
  ) {
    return 0;
  }

  const totalSeconds =
    observations.reduce(
      (
        total,
        observation
      ) =>
        total +
        observation.interval,
      0
    );

  const hours =
    totalSeconds / 3600;

  return hours > 0
    ? spikeCount / hours
    : 0;
}


/*
 * Build the complete temporal
 * metric structure for one side.
 */

function buildTemporalMetrics(
  series,
  field
) {

  const observations =
    calculateTemporalDensity(
      series,
      field
    );

  const tda =
    calculateTDA(
      observations
    );

  const tdrSeries =
    calculateTDRSeries(
      observations,
      tda
    );

  const sc =
    calculateSpikeCount(
      tdrSeries
    );

  const sf =
    calculateSpikeFrequency(
      sc,
      observations
    );

  const latest =
    tdrSeries.length
      ? tdrSeries[
          tdrSeries.length - 1
        ].tdr
      : 0;

  return {

    field,

    tda,

    latestTDR:
      latest,

    sc,

    sf,

    observations,

    tdrSeries
  };
}


/*
 * Main temporal metric update.
 */

function updateTemporalMetrics(
  series
) {

  if (
    !Array.isArray(series) ||
    series.length < 2
  ) {
    return;
  }


  /*
   * Build Buy Taker and Sell Taker.
   *
   * Buy Taker comes directly from
   * the Futures kline data.
   *
   * Sell Taker =
   * total volume - Buy Taker.
   */

  const normalized =
    series.map(
      candle => {

        const volume =
          Math.max(
            0,
            Number(
              candle.volume
            ) || 0
          );

        const buyTaker =
          Math.max(
            0,
            Number(
              candle.buyTaker
            ) || 0
          );

        const sellTaker =
          Math.max(
            0,
            volume - buyTaker
          );

        return {

          ...candle,

          volume,

          buyTaker,

          sellTaker
        };
      }
    );


  /*
   * Completely independent
   * calculations.
   */

  const buy =
    buildTemporalMetrics(
      normalized,
      "buyTaker"
    );

  const sell =
    buildTemporalMetrics(
      normalized,
      "sellTaker"
    );


  /*
   * Render metric cards.
   */

  renderTemporalMetrics(
    buy,
    sell
  );


  /*
   * Render TDR histogram.
   */

  renderTDRHistogram(
    buy,
    sell
  );


  /*
   * Keep the full metric structures
   * available for inspection.
   */

  window.AlphaTracker.temporalMetrics = {

    buyTaker: buy,

    sellTaker: sell
  };


  console.log(
    "Temporal Density Metrics:",
    window.AlphaTracker.temporalMetrics
  );
}


/* =========================================================
   TEMPORAL METRIC CARDS
========================================================= */

function renderTemporalMetrics(
  buy,
  sell
) {

  const chart =
    document.getElementById(
      "tradeFlowChart"
    );

  if (!chart) {
    return;
  }

  let panel =
    document.getElementById(
      "temporalMetrics"
    );


  if (!panel) {

    panel =
      document.createElement(
        "div"
      );

    panel.id =
      "temporalMetrics";

    panel.style.marginTop =
      "12px";

    panel.style.display =
      "grid";

    panel.style.gridTemplateColumns =
      "1fr 1fr";

    panel.style.gap =
      "10px";

    chart.parentElement.insertBefore(
      panel,
      chart.nextSibling
    );
  }


  panel.innerHTML = `

    <div class="metric-card">

      <div class="metric-label">
        BUY TAKER
      </div>

      <div style="margin-top:8px">
        TDA:
        <strong>
          ${formatVolume(buy.tda)}/s
        </strong>
      </div>

      <div style="margin-top:5px">
        TDR:
        <strong>
          ${buy.latestTDR.toFixed(2)}×
        </strong>
      </div>

      <div style="margin-top:5px">
        SC:
        <strong>
          ${buy.sc}
        </strong>
      </div>

      <div style="margin-top:5px">
        Spike Frequency:
        <strong>
          ${buy.sf.toFixed(2)}/hr
        </strong>
      </div>

    </div>


    <div class="metric-card">

      <div class="metric-label">
        SELL TAKER
      </div>

      <div style="margin-top:8px">
        TDA:
        <strong>
          ${formatVolume(sell.tda)}/s
        </strong>
      </div>

      <div style="margin-top:5px">
        TDR:
        <strong>
          ${sell.latestTDR.toFixed(2)}×
        </strong>
      </div>

      <div style="margin-top:5px">
        SC:
        <strong>
          ${sell.sc}
        </strong>
      </div>

      <div style="margin-top:5px">
        Spike Frequency:
        <strong>
          ${sell.sf.toFixed(2)}/hr
        </strong>
      </div>

    </div>

    <div
      style="
        grid-column:1/-1;
        font-size:11px;
        opacity:.65;
        padding:4px 2px;
      "
    >
      SC = number of observations
      where TDR &gt; 1
    </div>

  `;
}


/* =========================================================
   TDR HISTOGRAM
========================================================= */

function renderTDRHistogram(
  buy,
  sell
) {

  const chart =
    document.getElementById(
      "tradeFlowChart"
    );

  if (!chart) {
    return;
  }


  let container =
    document.getElementById(
      "tdrHistogram"
    );


  if (!container) {

    container =
      document.createElement(
        "div"
      );

    container.id =
      "tdrHistogram";

    container.style.width =
      "100%";

    container.style.height =
      "220px";

    container.style.marginTop =
      "12px";

    container.style.position =
      "relative";

    container.style.overflow =
      "hidden";


    /*
     * Put histogram immediately
     * below the flow chart.
     */

    chart.parentElement.insertBefore(
      container,
      chart.nextSibling
    );
  }


  container.innerHTML = "";


  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.style.display =
    "block";

  canvas.style.width =
    "100%";

  canvas.style.height =
    "100%";

  container.appendChild(
    canvas
  );


  const rect =
    container.getBoundingClientRect();

  const width =
    Math.max(
      320,
      Math.floor(
        rect.width
      )
    );

  const height =
    Math.max(
      180,
      Math.floor(
        rect.height
      )
    );

  const dpr =
    Math.max(
      1,
      window.devicePixelRatio || 1
    );

  canvas.width =
    Math.floor(
      width * dpr
    );

  canvas.height =
    Math.floor(
      height * dpr
    );

  canvas.style.width =
    `${width}px`;

  canvas.style.height =
    `${height}px`;


  const ctx =
    canvas.getContext(
      "2d"
    );

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );


  /*
   * We need both series to share
   * the same temporal positions.
   */

  const buySeries =
    buy.tdrSeries || [];

  const sellSeries =
    sell.tdrSeries || [];


  if (
    !buySeries.length &&
    !sellSeries.length
  ) {
    return;
  }


  /*
   * Use the union of the available
   * timestamps.
   */

  const times = [
    ...new Set([
      ...buySeries.map(
        item => item.time
      ),
      ...sellSeries.map(
        item => item.time
      )
    ])
  ].sort(
    (a, b) => a - b
  );


  if (!times.length) {
    return;
  }


  /*
   * Create quick lookup maps.
   */

  const buyMap =
    new Map(
      buySeries.map(
        item => [
          item.time,
          item.tdr
        ]
      )
    );

  const sellMap =
    new Map(
      sellSeries.map(
        item => [
          item.time,
          item.tdr
        ]
      )
    );


  const left = 42;
  const right = 12;
  const top = 28;
  const bottom = 26;

  const plotWidth =
    width -
    left -
    right;

  const plotHeight =
    height -
    top -
    bottom;


  /*
   * Find maximum TDR.
   */

  let maxTDR = 1;

  for (
    const time
    of times
  ) {

    const buyValue =
      Number(
        buyMap.get(time)
      ) || 0;

    const sellValue =
      Number(
        sellMap.get(time)
      ) || 0;

    maxTDR =
      Math.max(
        maxTDR,
        buyValue,
        sellValue
      );
  }


  /*
   * Give the histogram some
   * headroom.
   */

  maxTDR *= 1.12;


  /*
   * Header.
   */

  ctx.font =
    "bold 12px sans-serif";

  ctx.fillStyle =
    "rgba(255,255,255,.9)";

  ctx.fillText(
    "Temporal Density Ratio",
    left,
    15
  );


  ctx.font =
    "10px sans-serif";

  ctx.fillStyle =
    "rgba(128,128,128,.8)";

  ctx.fillText(
    "Buy Taker / Sell Taker • baseline = 1× TDA",
    left + 145,
    15
  );


  /*
   * Grid.
   */

  ctx.strokeStyle =
    "rgba(128,128,128,.15)";

  ctx.lineWidth = 1;

  const gridRows = 4;

  for (
    let i = 0;
    i <= gridRows;
    i++
  ) {

    const ratio =
      i / gridRows;

    const y =
      top +
      ratio *
      plotHeight;

    ctx.beginPath();

    ctx.moveTo(
      left,
      y
    );

    ctx.lineTo(
      width - right,
      y
    );

    ctx.stroke();
  }


  /*
   * TDA baseline.
   *
   * TDR = 1 means TD = TDA.
   */

  const baselineY =
    top +
    (
      1 -
      1 / maxTDR
    ) *
    plotHeight;

  ctx.strokeStyle =
    "rgba(255,220,100,.85)";

  ctx.setLineDash([
    5,
    4
  ]);

  ctx.beginPath();

  ctx.moveTo(
    left,
    baselineY
  );

  ctx.lineTo(
    width - right,
    baselineY
  );

  ctx.stroke();

  ctx.setLineDash([]);


  ctx.fillStyle =
    "rgba(255,220,100,.9)";

  ctx.font =
    "10px sans-serif";

  ctx.fillText(
    "1×",
    8,
    baselineY + 3
  );


  /*
   * Bar width.
   */

  const barWidth =
    Math.max(
      1,
      plotWidth /
        times.length *
        0.72
    );


  /*
   * Draw the two TDR series.
   *
   * Buy Taker is drawn from the
   * baseline downward toward zero.
   *
   * Sell Taker is drawn from the
   * baseline upward.
   *
   * This keeps both distributions
   * visually separate.
   */

  for (
    let i = 0;
    i < times.length;
    i++
  ) {

    const time =
      times[i];

    const x =
      left +
      (
        i /
        Math.max(
          1,
          times.length - 1
        )
      ) *
      plotWidth;


    const buyValue =
      Number(
        buyMap.get(time)
      ) || 0;

    const sellValue =
      Number(
        sellMap.get(time)
      ) || 0;


    /*
     * BUY TAKER
     */

    const buyY =
      top +
      (
        1 -
        Math.min(
          buyValue,
          maxTDR
        ) /
        maxTDR
      ) *
      plotHeight;

    ctx.fillStyle =
      "rgba(53,208,127,.78)";

    ctx.fillRect(
      x -
      barWidth / 2,
      buyY,
      barWidth,
      Math.max(
        1,
        baselineY -
        buyY
      )
    );


    /*
     * SELL TAKER
     */

    const sellY =
      top +
      (
        1 -
        Math.min(
          sellValue,
          maxTDR
        ) /
        maxTDR
      ) *
      plotHeight;

    ctx.fillStyle =
      "rgba(255,107,107,.78)";

    ctx.fillRect(
      x -
      barWidth / 2,
      sellY,
      barWidth,
      Math.max(
        1,
        baselineY -
        sellY
      )
    );
  }


  /*
   * Y-axis labels.
   */

  ctx.fillStyle =
    "rgba(128,128,128,.8)";

  ctx.font =
    "10px sans-serif";

  for (
    let i = 0;
    i <= gridRows;
    i++
  ) {

    const value =
      maxTDR *
      (
        1 -
        i / gridRows
      );

    const y =
      top +
      (
        i /
        gridRows
      ) *
      plotHeight;

    ctx.fillText(
      `${value.toFixed(1)}×`,
      4,
      y + 3
    );
  }


  /*
   * Time labels.
   */

  const labelCount =
    Math.min(
      5,
      times.length
    );

  for (
    let i = 0;
    i < labelCount;
    i++
  ) {

    const index =
      labelCount === 1
        ? 0
        : Math.floor(
            i *
            (
              times.length - 1
            ) /
            (
              labelCount - 1
            )
          );

    const time =
      times[index];

    const x =
      left +
      (
        index /
        Math.max(
          1,
          times.length - 1
        )
      ) *
      plotWidth;

    const date =
      new Date(time);

    const label =
      `${String(
        date.getMonth() + 1
      ).padStart(2, "0")}/` +
      `${String(
        date.getDate()
      ).padStart(2, "0")} ` +
      `${String(
        date.getHours()
      ).padStart(2, "0")}:` +
      `${String(
        date.getMinutes()
      ).padStart(2, "0")}`;

    ctx.fillText(
      label,
      x - 22,
      height - 7
    );
  }


  /*
   * Legend.
   */

  ctx.fillStyle =
    "#35d07f";

  ctx.fillRect(
    width - 170,
    8,
    8,
    8
  );

  ctx.fillStyle =
    "rgba(255,255,255,.8)";

  ctx.fillText(
    "Buy Taker",
    width - 157,
    16
  );


  ctx.fillStyle =
    "#ff6b6b";

  ctx.fillRect(
    width - 90,
    8,
    8,
    8
  );

  ctx.fillStyle =
    "rgba(255,255,255,.8)";

  ctx.fillText(
    "Sell Taker",
    width - 77,
    16
  );
}

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
