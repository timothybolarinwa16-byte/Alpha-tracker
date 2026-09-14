const state = {
  symbol: "BTCUSDT",
  exchange: null,

  liveTrades: 0,
  liveBuyVolume: 0,
  liveSellVolume: 0,
  liveFlow: 0,

  lastTradePrice: null,
  lastTradeTime: null,

  tradeHistory: []
};

const $ = (id) => document.getElementById(id);

const els = {
  status: document.getElementById("connectionStatus"),
  pairInput: document.getElementById("pairInput"),
  marketPair: document.getElementById("marketPair"),

  currentPrice: document.getElementById("currentPrice"),
  priceChange: document.getElementById("priceChange"),
  volume24h: document.getElementById("volume24h"),
  tradeCount: document.getElementById("tradeCount"),

  tradeStart: document.getElementById("tradeStart"),
  tradeEnd: document.getElementById("tradeEnd"),
  priceBucket: document.getElementById("priceBucket"),
  inspectTradesBtn: document.getElementById("inspectTradesBtn"),
  tradeTableBody: document.getElementById("tradeTableBody"),

  buyVolume: document.getElementById("buyVolume"),
  sellVolume: document.getElementById("sellVolume"),
  netFlow: document.getElementById("netFlow"),
  volumeDensity: document.getElementById("volumeDensity"),

  orderBookRange: document.getElementById("orderBookRange"),
  orderBookLevels: document.getElementById("orderBookLevels"),
  loadOrderBookBtn: document.getElementById("loadOrderBookBtn"),
  asksBody: document.getElementById("asksBody"),
  bidsBody: document.getElementById("bidsBody"),

  cumulativeFlow: document.getElementById("cumulativeFlow"),
  densityIndicator: document.getElementById("densityIndicator"),
  makerBalance: document.getElementById("makerBalance"),
  tradeEfficiency: document.getElementById("tradeEfficiency"),

  lastUpdated: document.getElementById("lastUpdated")
};


/* =========================
   HELPERS
========================= */

function formatNumber(value, decimals = 2) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "--";
  }

  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}


function formatPrice(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "--";
  }

  if (n >= 1000) return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  if (n >= 1) return n.toFixed(4);

  if (n >= 0.01) return n.toFixed(6);

  return n.toFixed(8);
}


function formatVolume(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "--";
  }

  if (Math.abs(n) >= 1000000) {
    return (n / 1000000).toFixed(2) + "M";
  }

  if (Math.abs(n) >= 1000) {
    return (n / 1000).toFixed(2) + "K";
  }

  return n.toFixed(4);
}


function normalizeSymbol(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}


function formatTime(timestamp) {
  if (!timestamp) return "--";

  const date = new Date(Number(timestamp));

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleTimeString();
}


/* =========================
   MARKET DATA
========================= */

async function loadTicker() {
  try {
    const ticker = await state.exchange.get24hTicker(state.symbol);

    els.currentPrice.textContent =
      formatPrice(ticker.lastPrice);

    els.priceChange.textContent =
      `${formatNumber(ticker.priceChangePercent, 2)}%`;

    els.volume24h.textContent =
      formatVolume(ticker.volume);

    els.tradeCount.textContent =
      formatNumber(ticker.count, 0);

    if (Number(ticker.priceChangePercent) >= 0) {
      els.priceChange.classList.remove("negative");
      els.priceChange.classList.add("positive");
    } else {
      els.priceChange.classList.remove("positive");
      els.priceChange.classList.add("negative");
    }

    els.lastUpdated.textContent =
      `Last updated: ${new Date().toLocaleTimeString()}`;

  } catch (error) {
    console.error("Ticker error:", error);

    els.currentPrice.textContent = "--";
    els.priceChange.textContent = "--";
    els.volume24h.textContent = "--";
    els.tradeCount.textContent = "--";
  }
}


/* =========================
   LIVE TRADES
========================= */

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
  if (!trade) return;

  const price = Number(trade.price);
  const quantity = Number(trade.quantity);

  if (!Number.isFinite(price) || !Number.isFinite(quantity)) {
    return;
  }

  state.liveTrades += 1;

  if (trade.aggressiveSide === "buy") {
    state.liveBuyVolume += quantity;
  } else {
    state.liveSellVolume += quantity;
  }

  state.liveFlow =
    state.liveBuyVolume - state.liveSellVolume;

  state.lastTradePrice = price;
  state.lastTradeTime = trade.time;

  /*
    Keep a rolling local history.

    This is separate from the historical inspection request.
    It gives the live page a short-term record of trades.
  */
  state.tradeHistory.push({
    price,
    quantity,
    time: Number(trade.time),
    aggressiveSide: trade.aggressiveSide
  });

  /*
    Keep the browser memory under control.
  */
  if (state.tradeHistory.length > 10000) {
    state.tradeHistory.splice(
      0,
      state.tradeHistory.length - 10000
    );
  }

  updateTradeDisplay();
}


function updateTradeDisplay() {
  els.buyVolume.textContent =
    formatVolume(state.liveBuyVolume);

  els.sellVolume.textContent =
    formatVolume(state.liveSellVolume);

  els.netFlow.textContent =
    formatVolume(state.liveFlow);

  const totalVolume =
    state.liveBuyVolume + state.liveSellVolume;

  const density =
    state.liveTrades > 0
      ? totalVolume / state.liveTrades
      : 0;

  els.volumeDensity.textContent =
    formatVolume(density);

  /*
    These four indicator values are still temporary.
    We will replace this entire display with line charts.
  */

  els.cumulativeFlow.textContent =
    formatVolume(state.liveFlow);

  els.densityIndicator.textContent =
    formatVolume(density);

  const total =
    state.liveBuyVolume + state.liveSellVolume;

  const balance =
    total > 0
      ? ((state.liveBuyVolume - state.liveSellVolume) / total) * 100
      : 0;

  els.makerBalance.textContent =
    `${formatNumber(balance, 2)}%`;

  els.tradeEfficiency.textContent =
    state.lastTradePrice
      ? formatPrice(state.lastTradePrice)
      : "--";
}


/* =========================
   TRADE INSPECTION
========================= */

function getTimeValue(element) {
  if (!element) return null;

  const value = element.value;

  if (!value) return null;

  /*
    If the control contains a Unix timestamp.
  */
  if (/^\d+$/.test(value)) {
    const n = Number(value);

    /*
      Support seconds and milliseconds.
    */
    return n < 100000000000
      ? n * 1000
      : n;
  }

  /*
    Support datetime-local inputs.
  */
  const parsed = new Date(value).getTime();

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return null;
}


function getInspectionWindow() {
  let start = getTimeValue(els.tradeStart);
  let end = getTimeValue(els.tradeEnd);

  const now = Date.now();

  /*
    If the controls are empty, inspect the
    most recent 15 minutes.
  */
  if (!start && !end) {
    end = now;
    start = now - (15 * 60 * 1000);
  }

  if (!start) {
    start = now - (15 * 60 * 1000);
  }

  if (!end) {
    end = now;
  }

  /*
    If the user accidentally selected them backwards,
    automatically correct the order.
  */
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


function getBucketSize() {
  const value = Number(els.priceBucket.value);

  if (!Number.isFinite(value) || value <= 0) {
    return 0.2;
  }

  return value;
}


function bucketPrice(price, bucketSize) {
  return Math.floor(price / bucketSize) * bucketSize;
}


function normalizeTrade(raw) {
  /*
    Already normalized trade.
  */
  if (
    raw &&
    raw.price !== undefined &&
    raw.quantity !== undefined
  ) {
    return {
      price: Number(raw.price),
      quantity: Number(raw.quantity),
      time: Number(raw.time),
      aggressiveSide: raw.aggressiveSide
    };
  }

  /*
    Raw Binance aggregate trade.
  */
  if (
    raw &&
    raw.p !== undefined &&
    raw.q !== undefined
  ) {
    const buyerIsMaker =
      raw.m === true;

    return {
      price: Number(raw.p),
      quantity: Number(raw.q),
      time: Number(raw.T),
      aggressiveSide:
        buyerIsMaker ? "sell" : "buy"
    };
  }

  return null;
}


function groupTradesByPrice(trades, bucketSize) {
  const groups = new Map();

  for (const rawTrade of trades) {
    const trade = normalizeTrade(rawTrade);

    if (!trade) continue;

    if (
      !Number.isFinite(trade.price) ||
      !Number.isFinite(trade.quantity) ||
      !Number.isFinite(trade.time)
    ) {
      continue;
    }

    const bucket =
      bucketPrice(trade.price, bucketSize);

    const key = bucket.toFixed(12);

    if (!groups.has(key)) {
      groups.set(key, {
        price: bucket,
        trades: 0,
        volume: 0,
        buy: 0,
        sell: 0,
        flow: 0
      });
    }

    const group = groups.get(key);

    group.trades += 1;
    group.volume += trade.quantity;

    if (trade.aggressiveSide === "buy") {
      group.buy += trade.quantity;
    } else {
      group.sell += trade.quantity;
    }

    group.flow =
      group.buy - group.sell;
  }

  return Array.from(groups.values())
    .sort((a, b) => b.price - a.price);
}


function renderTradeTable(groups) {
  if (!els.tradeTableBody) return;

  els.tradeTableBody.innerHTML = "";

  if (!groups.length) {
    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">No trade data found for this window.</td>
      </tr>
    `;

    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const group of groups) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${formatPrice(group.price)}</td>
      <td>${formatNumber(group.trades, 0)}</td>
      <td>${formatVolume(group.volume)}</td>
      <td>${formatVolume(group.buy)}</td>
      <td>${formatVolume(group.sell)}</td>
      <td>${formatVolume(group.flow)}</td>
    `;

    fragment.appendChild(row);
  }

  els.tradeTableBody.appendChild(fragment);
}


async function inspectTrades() {
  if (!state.exchange) return;

  els.inspectTradesBtn.disabled = true;
  els.inspectTradesBtn.textContent = "Loading...";

  try {
    const windowData =
      getInspectionWindow();

    const bucketSize =
      getBucketSize();

    /*
      Fetch actual Binance recent aggregate trades.
    */
    const rawTrades =
      await state.exchange.getRecentTrades(
        state.symbol,
        1000
      );

    const trades = Array.isArray(rawTrades)
      ? rawTrades
      : [];

    /*
      Restrict to selected time window.
    */
    const filteredTrades =
      trades.filter((raw) => {
        const trade =
          normalizeTrade(raw);

        if (!trade) return false;

        return (
          trade.time >= windowData.start &&
          trade.time <= windowData.end
        );
      });

    /*
      IMPORTANT:
      Group by PRICE, not by time.
    */
    const groups =
      groupTradesByPrice(
        filteredTrades,
        bucketSize
      );

    renderTradeTable(groups);

  } catch (error) {
    console.error(
      "Trade inspection error:",
      error
    );

    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          Unable to load trade data.
        </td>
      </tr>
    `;
  } finally {
    els.inspectTradesBtn.disabled = false;
    els.inspectTradesBtn.textContent =
      "Inspect Trades";
  }
}


/* =========================
   ORDER BOOK
========================= */

function renderOrderBookSide(
  body,
  levels,
  currentPrice,
  rangePercent,
  side
) {
  body.innerHTML = "";

  if (!Array.isArray(levels) || !levels.length) {
    body.innerHTML = `
      <tr>
        <td colspan="3">No data</td>
      </tr>
    `;

    return;
  }

  const range =
    Number(rangePercent) / 100;

  let filtered;

  if (side === "asks") {
    const maximum =
      currentPrice * (1 + range);

    filtered =
      levels
        .filter(level =>
          Number(level.price) >= currentPrice &&
          Number(level.price) <= maximum
        )
        .sort((a, b) =>
          Number(a.price) - Number(b.price)
        );

  } else {
    const minimum =
      currentPrice * (1 - range);

    filtered =
      levels
        .filter(level =>
          Number(level.price) <= currentPrice &&
          Number(level.price) >= minimum
        )
        .sort((a, b) =>
          Number(b.price) - Number(a.price)
        );
  }

  const maxLevels =
    Math.max(
      1,
      Number(els.orderBookLevels.value) || 20
    );

  filtered =
    filtered.slice(0, maxLevels);

  if (!filtered.length) {
    body.innerHTML = `
      <tr>
        <td colspan="3">
          No levels inside selected range.
        </td>
      </tr>
    `;

    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const level of filtered) {
    const price =
      Number(level.price);

    const quantity =
      Number(level.quantity);

    const value =
      price * quantity;

    const row =
      document.createElement("tr");

    row.innerHTML = `
      <td>${formatPrice(price)}</td>
      <td>${formatVolume(quantity)}</td>
      <td>${formatVolume(value)}</td>
    `;

    fragment.appendChild(row);
  }

  body.appendChild(fragment);
}


function normalizeBookLevel(level) {
  /*
    Supports [price, quantity]
    from Binance depth response.
  */
  if (Array.isArray(level)) {
    return {
      price: Number(level[0]),
      quantity: Number(level[1])
    };
  }

  /*
    Supports already-normalized objects.
  */
  return {
    price: Number(level.price),
    quantity: Number(
      level.quantity !== undefined
        ? level.quantity
        : level.qty
    )
  };
}


async function loadOrderBook() {
  if (!state.exchange) return;

  els.loadOrderBookBtn.disabled = true;
  els.loadOrderBookBtn.textContent =
    "Loading...";

  try {
    const book =
      await state.exchange.getOrderBook(
        state.symbol,
        1000
      );

    const asks =
      (book.asks || [])
        .map(normalizeBookLevel)
        .filter(level =>
          Number.isFinite(level.price) &&
          Number.isFinite(level.quantity)
        );

    const bids =
      (book.bids || [])
        .map(normalizeBookLevel)
        .filter(level =>
          Number.isFinite(level.price) &&
          Number.isFinite(level.quantity)
        );

    let currentPrice =
      state.lastTradePrice;

    /*
      If the live stream hasn't produced a trade yet,
      use the ticker price.
    */
    if (!Number.isFinite(currentPrice)) {
      currentPrice =
        Number(
          els.currentPrice.textContent
            .replace(/,/g, "")
        );
    }

    if (!Number.isFinite(currentPrice)) {
      throw new Error(
        "Current market price unavailable."
      );
    }

    const range =
      Number(els.orderBookRange.value) || 0.2;

    renderOrderBookSide(
      els.asksBody,
      asks,
      currentPrice,
      range,
      "asks"
    );

    renderOrderBookSide(
      els.bidsBody,
      bids,
      currentPrice,
      range,
      "bids"
    );

  } catch (error) {
    console.error(
      "Order book error:",
      error
    );

    els.asksBody.innerHTML = `
      <tr>
        <td colspan="3">
          Unable to load order book.
        </td>
      </tr>
    `;

    els.bidsBody.innerHTML = `
      <tr>
        <td colspan="3">
          Unable to load order book.
        </td>
      </tr>
    `;
  } finally {
    els.loadOrderBookBtn.disabled = false;
    els.loadOrderBookBtn.textContent =
      "Load Order Book";
  }
}


/* =========================
   CONNECTION
========================= */

function handleConnection(status) {
  if (!els.status) return;

  if (status === "connected") {
    els.status.textContent =
      "Trade stream live";

    els.status.classList.add("connected");
    els.status.classList.remove(
      "error",
      "disconnected"
    );

    return;
  }

  if (status === "error") {
    els.status.textContent =
      "Trade stream error";

    els.status.classList.remove(
      "connected",
      "disconnected"
    );

    els.status.classList.add("error");

    return;
  }

  els.status.textContent =
    "Reconnecting...";

  els.status.classList.remove(
    "connected",
    "error"
  );

  els.status.classList.add(
    "disconnected"
  );
}


/* =========================
   PAIR CHANGE
========================= */

async function changePair() {
  const symbol =
    normalizeSymbol(
      els.pairInput.value
    );

  if (!symbol) {
    return;
  }

  try {
    state.exchange.disconnectTradeStream(false);

    state.symbol = symbol;

    state.exchange.setSymbol(symbol);

    els.pairInput.value = symbol;
    els.marketPair.textContent = symbol;

    resetTradeStats();

    /*
      Validate/load ticker first.
    */
    await loadTicker();

    /*
      Then start the live stream.
    */
    state.exchange.connectTradeStream(
      symbol
    );

    /*
      Clear old tables because they belong
      to the previous pair.
    */
    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          No trade data loaded.
        </td>
      </tr>
    `;

    els.asksBody.innerHTML = `
      <tr>
        <td colspan="3">No data</td>
      </tr>
    `;

    els.bidsBody.innerHTML = `
      <tr>
        <td colspan="3">No data</td>
      </tr>
    `;

  } catch (error) {
    console.error(
      "Pair change error:",
      error
    );

    if (els.status) {
      els.status.textContent =
        "Invalid pair";
    }
  }
}


/* =========================
   EVENTS
========================= */

document
  .getElementById("loadPairBtn")
  ?.addEventListener(
    "click",
    changePair
  );


els.pairInput?.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter") {
      changePair();
    }
  }
);


els.inspectTradesBtn?.addEventListener(
  "click",
  inspectTrades
);


els.loadOrderBookBtn?.addEventListener(
  "click",
  loadOrderBook
);


/* =========================
   INITIALIZE
========================= */

async function initialize() {
  if (
    typeof window.BinanceExchange !==
    "function"
  ) {
    console.error(
      "BinanceExchange is not available."
    );

    if (els.status) {
      els.status.textContent =
        "Exchange module error";
    }

    return;
  }

  state.exchange =
    new window.BinanceExchange(
      state.symbol
    );

  state.exchange.onTrade(
    handleTrade
  );

  state.exchange.onConnection(
    handleConnection
  );

  await changePair();

  /*
    Refresh 24h market information.
  */
  setInterval(
    loadTicker,
    10000
  );
}


initialize();
