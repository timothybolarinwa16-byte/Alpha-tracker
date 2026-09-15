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


/* =========================
   DOM
========================= */

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
   FORMATTING
========================= */

function formatNumber(value, decimals = 2) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "--";

  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}


function formatPrice(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "--";

  if (n >= 1000) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(6);

  return n.toFixed(8);
}


function formatVolume(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "--";

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


/* =========================
   MARKET
========================= */

async function loadTicker() {
  try {
    const ticker =
      await state.exchange.get24hTicker(
        state.symbol
      );

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
  }
}


/* =========================
   LIVE TRADE STREAM
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

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(quantity)
  ) {
    return;
  }

  state.liveTrades++;

  if (trade.aggressiveSide === "buy") {
    state.liveBuyVolume += quantity;
  } else {
    state.liveSellVolume += quantity;
  }

  state.liveFlow =
    state.liveBuyVolume -
    state.liveSellVolume;

  state.lastTradePrice = price;
  state.lastTradeTime = Number(trade.time);

  state.tradeHistory.push({
    price,
    quantity,
    time: Number(trade.time),
    aggressiveSide: trade.aggressiveSide
  });

  if (state.tradeHistory.length > 20000) {
    state.tradeHistory.splice(
      0,
      state.tradeHistory.length - 20000
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
    state.liveBuyVolume +
    state.liveSellVolume;

  const density =
    state.liveTrades > 0
      ? totalVolume / state.liveTrades
      : 0;

  els.volumeDensity.textContent =
    formatVolume(density);

  els.cumulativeFlow.textContent =
    formatVolume(state.liveFlow);

  els.densityIndicator.textContent =
    formatVolume(density);

  const balance =
    totalVolume > 0
      ? (
          (state.liveBuyVolume -
            state.liveSellVolume) /
          totalVolume
        ) * 100
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
  if (!element || !element.value) {
    return null;
  }

  const value = element.value;

  if (/^\d+$/.test(value)) {
    const n = Number(value);

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
    getTimeValue(els.tradeStart);

  let end =
    getTimeValue(els.tradeEnd);

  const now = Date.now();

  if (!start && !end) {
    end = now;
    start = now - 15 * 60 * 1000;
  }

  if (!start) {
    start = now - 15 * 60 * 1000;
  }

  if (!end) {
    end = now;
  }

  if (start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  return { start, end };
}


function getBucketSize() {
  const value =
    Number(els.priceBucket.value);

  return Number.isFinite(value) && value > 0
    ? value
    : 0.2;
}


function normalizeTrade(raw) {
  if (!raw) return null;

  if (
    raw.price !== undefined &&
    raw.quantity !== undefined
  ) {
    return {
      id: Number(raw.id),
      price: Number(raw.price),
      quantity: Number(raw.quantity),
      time: Number(raw.time),
      aggressiveSide:
        raw.aggressiveSide
    };
  }

  if (
    raw.p !== undefined &&
    raw.q !== undefined
  ) {
    const buyerIsMaker =
      raw.m === true;

    return {
      id: Number(raw.a),
      price: Number(raw.p),
      quantity: Number(raw.q),
      time: Number(raw.T),
      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy"
    };
  }

  return null;
}


async function fetchHistoricalTrades(
  symbol,
  startTime,
  endTime
) {
  const base =
    "https://data-api.binance.vision/api/v3/aggTrades";

  const results = [];

  let firstRequest = true;
  let fromId = null;

  let requestCount = 0;

  const MAX_REQUESTS = 150;

  while (requestCount < MAX_REQUESTS) {
    requestCount++;

    const params =
      new URLSearchParams();

    params.set("symbol", symbol);
    params.set("limit", "1000");

    if (firstRequest) {
      params.set(
        "startTime",
        String(startTime)
      );

      params.set(
        "endTime",
        String(endTime)
      );

      firstRequest = false;
    } else {
      params.set(
        "fromId",
        String(fromId)
      );
    }

    const url =
      `${base}?${params.toString()}`;

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Historical trade request failed: ${response.status}`
      );
    }

    const batch =
      await response.json();

    if (
      !Array.isArray(batch) ||
      batch.length === 0
    ) {
      break;
    }

    let reachedEnd = false;

    for (const raw of batch) {
      const trade =
        normalizeTrade(raw);

      if (!trade) continue;

      if (trade.time < startTime) {
        continue;
      }

      if (trade.time > endTime) {
        reachedEnd = true;
        break;
      }

      results.push(trade);
    }

    if (reachedEnd) {
      break;
    }

    if (batch.length < 1000) {
      break;
    }

    const last =
      normalizeTrade(
        batch[batch.length - 1]
      );

    if (!last || !Number.isFinite(last.id)) {
      break;
    }

    fromId = last.id + 1;
  }

  return results;
}


function groupTradesByPrice(
  trades,
  bucketSize
) {
  const groups = new Map();

  for (const trade of trades) {
    const bucket =
      Math.floor(
        trade.price / bucketSize
      ) * bucketSize;

    const key =
      bucket.toFixed(12);

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

    const group =
      groups.get(key);

    group.trades++;
    group.volume += trade.quantity;

    if (
      trade.aggressiveSide === "buy"
    ) {
      group.buy += trade.quantity;
    } else {
      group.sell += trade.quantity;
    }

    group.flow =
      group.buy - group.sell;
  }

  return Array.from(groups.values())
    .sort(
      (a, b) =>
        b.price - a.price
    );
}


function renderTradeTable(groups) {
  els.tradeTableBody.innerHTML = "";

  if (!groups.length) {
    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          No trade data found for this window.
        </td>
      </tr>
    `;

    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const group of groups) {
    const row =
      document.createElement("tr");

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

  els.tradeTableBody.appendChild(
    fragment
  );
}


async function inspectTrades() {
  els.inspectTradesBtn.disabled = true;
  els.inspectTradesBtn.textContent =
    "Loading...";

  try {
    const {
      start,
      end
    } = getInspectionWindow();

    const bucketSize =
      getBucketSize();

    console.log(
      "Trade inspection:",
      new Date(start),
      new Date(end)
    );

    const trades =
      await fetchHistoricalTrades(
        state.symbol,
        start,
        end
      );

    console.log(
      "Historical trades received:",
      trades.length
    );

    const groups =
      groupTradesByPrice(
        trades,
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
          Unable to load historical trades.
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

/*
  Create the total quantity
  display boxes once.
*/

function createOrderBookTotals() {
  if (!els.asksBody) return;

  const section =
    els.asksBody.closest(".panel") ||
    els.asksBody.parentElement;

  if (!section) return;

  if (
    document.getElementById(
      "orderBookTotals"
    )
  ) {
    return;
  }

  const totals =
    document.createElement("div");

  totals.id =
    "orderBookTotals";

  totals.style.display = "grid";
  totals.style.gridTemplateColumns =
    "1fr 1fr";
  totals.style.gap = "10px";
  totals.style.margin =
    "12px 0";

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


/*
  Determine how many decimal places
  are useful for displaying a price.
*/

function getPriceDecimals(price) {
  const n = Math.abs(Number(price));

  if (!Number.isFinite(n)) return 8;

  if (n >= 1000) return 2;
  if (n >= 1) return 4;
  if (n >= 0.01) return 6;
  if (n >= 0.000001) return 8;

  return 12;
}


/*
  Choose a clean aggregation width.

  Example:

  BTC = 80,000
  range = 5%
  levels = 10

  Total side range ≈ 4,000

  Therefore each zone is
  approximately 400 USDT wide.

  For SHIB the same calculation
  automatically produces a much
  smaller price zone.
*/

function getAggregationStep(
  currentPrice,
  rangePercent,
  maxRows
) {
  const price =
    Number(currentPrice);

  const range =
    Number(rangePercent) / 100;

  const rows =
    Math.max(
      1,
      Number(maxRows) || 10
    );

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(range) ||
    range <= 0
  ) {
    return 0;
  }

  const totalRange =
    price * range;

  const rawStep =
    totalRange / rows;

  if (
    !Number.isFinite(rawStep) ||
    rawStep <= 0
  ) {
    return 0;
  }

  /*
    Round to a clean 1 / 2 / 5 / 10
    number so the zones are readable.
  */

  const magnitude =
    Math.pow(
      10,
      Math.floor(
        Math.log10(rawStep)
      )
    );

  const normalized =
    rawStep / magnitude;

  let nice;

  if (normalized <= 1) {
    nice = 1;
  } else if (normalized <= 2) {
    nice = 2;
  } else if (normalized <= 5) {
    nice = 5;
  } else {
    nice = 10;
  }

  return nice * magnitude;
}


/*
  Aggregate raw Binance order-book
  levels into price zones.
*/

function aggregateOrderBookLevels(
  levels,
  currentPrice,
  rangePercent,
  side,
  maxRows
) {
  const price =
    Number(currentPrice);

  const range =
    Number(rangePercent) / 100;

  const rows =
    Math.max(
      1,
      Number(maxRows) || 10
    );

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(range) ||
    range <= 0
  ) {
    return {
      rows: [],
      step: 0,
      rawCount: 0
    };
  }

  const lower =
    price * (1 - range);

  const upper =
    price * (1 + range);

  const step =
    getAggregationStep(
      price,
      rangePercent,
      rows
    );

  if (
    !Number.isFinite(step) ||
    step <= 0
  ) {
    return {
      rows: [],
      step: 0,
      rawCount: 0
    };
  }

  const groups =
    new Map();

  let rawCount = 0;

  for (const level of levels) {
    const levelPrice =
      Number(level.price);

    const quantity =
      Number(level.quantity);

    if (
      !Number.isFinite(levelPrice) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue;
    }

    /*
      Only include the selected
      percentage range.
    */

    if (side === "asks") {
      if (
        levelPrice < price ||
        levelPrice > upper
      ) {
        continue;
      }
    } else {
      if (
        levelPrice > price ||
        levelPrice < lower
      ) {
        continue;
      }
    }

    rawCount++;

    let zone;

    if (side === "asks") {

      /*
        Ask zones start at CMP
        and move upward.

        Example:

        CMP 80,000
        step 400

        80,000 - 80,400
        80,400 - 80,800
        etc.
      */

      zone =
        Math.floor(
          (levelPrice - price) /
            step
        ) * step +
        price;

    } else {

      /*
        Bid zones start at CMP
        and move downward.

        Example:

        80,000 - 79,600
        79,600 - 79,200
        etc.
      */

      zone =
        Math.ceil(
          (levelPrice - price) /
            step
        ) * step +
        price;
    }

    /*
      Prevent floating-point
      values becoming map keys.
    */

    const decimals =
      Math.min(
        12,
        Math.max(
          2,
          getPriceDecimals(step) + 2
        )
      );

    const key =
      zone.toFixed(decimals);

    if (!groups.has(key)) {
      groups.set(key, {
        price: zone,
        quantity: 0,
        value: 0,
        rawLevels: 0
      });
    }

    const group =
      groups.get(key);

    group.quantity += quantity;

    group.value +=
      levelPrice * quantity;

    group.rawLevels++;
  }

  let result =
    Array.from(groups.values());

  if (side === "asks") {
    result.sort(
      (a, b) =>
        a.price - b.price
    );
  } else {
    result.sort(
      (a, b) =>
        b.price - a.price
    );
  }

  /*
    The user requested N zones.

    We display up to N populated
    zones on each side.
  */

  result =
    result.slice(0, rows);

  return {
    rows: result,
    step,
    rawCount
  };
}


/*
  Render one side of the
  aggregated order book.
*/

function renderOrderBookSide(
  body,
  levels,
  currentPrice,
  rangePercent,
  side
) {
  if (!body) return;

  body.innerHTML = "";

  const maxRows =
    Math.max(
      1,
      Number(
        els.orderBookLevels.value
      ) || 10
    );

  const result =
    aggregateOrderBookLevels(
      levels,
      currentPrice,
      rangePercent,
      side,
      maxRows
    );

  if (!result.rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="3">
          No levels inside selected range.
        </td>
      </tr>
    `;

    return result;
  }

  const fragment =
    document.createDocumentFragment();

  for (const level of result.rows) {
    const row =
      document.createElement("tr");

    row.innerHTML = `
      <td>${formatPrice(level.price)}</td>
      <td>${formatVolume(level.quantity)}</td>
      <td>${formatVolume(level.value)}</td>
    `;

    fragment.appendChild(row);
  }

  body.appendChild(fragment);

  return result;
}


/*
  Update total quantities.

  IMPORTANT:

  These totals represent the
  aggregated zones actually displayed,
  not the entire 1000-level Binance
  snapshot.
*/

function updateOrderBookTotals(
  asks,
  bids
) {
  const askTotal =
    asks.reduce(
      (sum, level) =>
        sum + Number(level.quantity),
      0
    );

  const bidTotal =
    bids.reduce(
      (sum, level) =>
        sum + Number(level.quantity),
      0
    );

  const askElement =
    document.getElementById(
      "totalAskQuantity"
    );

  const bidElement =
    document.getElementById(
      "totalBidQuantity"
    );

  if (askElement) {
    askElement.textContent =
      formatVolume(askTotal);
  }

  if (bidElement) {
    bidElement.textContent =
      formatVolume(bidTotal);
  }
}


/*
  Convert Binance's array format:

  [price, quantity]

  into our internal format.
*/

function normalizeBookLevel(level) {
  if (Array.isArray(level)) {
    return {
      price: Number(level[0]),
      quantity: Number(level[1])
    };
  }

  return {
    price: Number(level.price),
    quantity: Number(
      level.quantity ??
      level.qty
    )
  };
}


/*
  Load and aggregate the order book.
*/

async function loadOrderBook() {
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
        .filter(
          level =>
            Number.isFinite(level.price) &&
            Number.isFinite(level.quantity) &&
            level.price > 0 &&
            level.quantity > 0
        );

    const bids =
      (book.bids || [])
        .map(normalizeBookLevel)
        .filter(
          level =>
            Number.isFinite(level.price) &&
            Number.isFinite(level.quantity) &&
            level.price > 0 &&
            level.quantity > 0
        );

    /*
      Prefer the most recent live
      trade price.
    */

    let currentPrice =
      state.lastTradePrice;

    /*
      If no live trade exists yet,
      use the ticker displayed price.
    */

    if (!Number.isFinite(currentPrice)) {
      currentPrice =
        Number(
          String(
            els.currentPrice.textContent
          ).replace(/,/g, "")
        );
    }

    if (
      !Number.isFinite(currentPrice) ||
      currentPrice <= 0
    ) {
      throw new Error(
        "Current price unavailable"
      );
    }

    const range =
      Number(
        els.orderBookRange.value
      ) || 5;

    const maxRows =
      Math.max(
        1,
        Number(
          els.orderBookLevels.value
        ) || 10
      );

    /*
      Aggregate asks.
    */

    const askResult =
      aggregateOrderBookLevels(
        asks,
        currentPrice,
        range,
        "asks",
        maxRows
      );

    /*
      Aggregate bids.
    */

    const bidResult =
      aggregateOrderBookLevels(
        bids,
        currentPrice,
        range,
        "bids",
        maxRows
      );

    /*
      Render.
    */

    els.asksBody.innerHTML = "";

    els.bidsBody.innerHTML = "";

    if (!askResult.rows.length) {
      els.asksBody.innerHTML = `
        <tr>
          <td colspan="3">
            No levels inside selected range.
          </td>
        </tr>
      `;
    } else {
      const fragment =
        document.createDocumentFragment();

      for (const level of askResult.rows) {
        const row =
          document.createElement("tr");

        row.innerHTML = `
          <td>${formatPrice(level.price)}</td>
          <td>${formatVolume(level.quantity)}</td>
          <td>${formatVolume(level.value)}</td>
        `;

        fragment.appendChild(row);
      }

      els.asksBody.appendChild(
        fragment
      );
    }

    if (!bidResult.rows.length) {
      els.bidsBody.innerHTML = `
        <tr>
          <td colspan="3">
            No levels inside selected range.
          </td>
        </tr>
      `;
    } else {
      const fragment =
        document.createDocumentFragment();

      for (const level of bidResult.rows) {
        const row =
          document.createElement("tr");

        row.innerHTML = `
          <td>${formatPrice(level.price)}</td>
          <td>${formatVolume(level.quantity)}</td>
          <td>${formatVolume(level.value)}</td>
        `;

        fragment.appendChild(row);
      }

      els.bidsBody.appendChild(
        fragment
      );
    }

    /*
      Totals correspond to the
      displayed aggregated zones.
    */

    updateOrderBookTotals(
      askResult.rows,
      bidResult.rows
    );

    console.log(
      "Order book:",
      {
        symbol: state.symbol,
        currentPrice,
        rangePercent: range,
        requestedZones: maxRows,

        askZoneSize:
          formatPrice(
            askResult.step
          ),

        bidZoneSize:
          formatPrice(
            bidResult.step
          ),

        rawAskLevels:
          askResult.rawCount,

        rawBidLevels:
          bidResult.rawCount,

        displayedAskZones:
          askResult.rows.length,

        displayedBidZones:
          bidResult.rows.length
      }
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

    updateOrderBookTotals(
      [],
      []
    );

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

    els.status.classList.add(
      "connected"
    );

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

    els.status.classList.add(
      "error"
    );

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

  if (!symbol) return;

  const oldSymbol =
    state.exchange
      ? state.exchange.getSymbol()
      : null;

  const symbolChanged =
    oldSymbol &&
    oldSymbol !== symbol;

  if (symbolChanged) {
    state.exchange.disconnectTradeStream(
      false
    );
  }

  state.symbol = symbol;

  state.exchange.setSymbol(
    symbol
  );

  els.pairInput.value =
    symbol;

  els.marketPair.textContent =
    symbol;

  resetTradeStats();

  try {
    await loadTicker();

    state.exchange.connectTradeStream(
      symbol
    );

    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          No trade data loaded.
        </td>
      </tr>
    `;

    els.asksBody.innerHTML = `
      <tr>
        <td colspan="3">
          No data
        </td>
      </tr>
    `;

    els.bidsBody.innerHTML = `
      <tr>
        <td colspan="3">
          No data
        </td>
      </tr>
    `;

    /*
      Clear old order-book totals
      when changing pairs.
    */

    const askTotal =
      document.getElementById(
        "totalAskQuantity"
      );

    const bidTotal =
      document.getElementById(
        "totalBidQuantity"
      );

    if (askTotal) {
      askTotal.textContent = "--";
    }

    if (bidTotal) {
      bidTotal.textContent = "--";
    }

  } catch (error) {
    console.error(
      "Pair change error:",
      error
    );

    els.status.textContent =
      "Invalid pair";
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
  event => {
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
      "BinanceExchange unavailable."
    );

    els.status.textContent =
      "Exchange module error";

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

  createOrderBookTotals();

  await changePair();

  setInterval(
    loadTicker,
    10000
  );
}


initialize();
