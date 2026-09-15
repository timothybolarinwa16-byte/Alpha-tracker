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

  /*
    Temporary values.
    These will become line charts next.
  */

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

  /*
    Normalized trade.
  */
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

  /*
    Binance aggregate trade.
  */
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


/*
  Binance's public aggregate-trade endpoint
  supports time-based queries, but each request
  is limited to 1000 records.

  We therefore:
    1. request the selected time range
    2. take the returned trades
    3. if the batch is full, continue from the
       last aggregate-trade ID
    4. stop once the selected end time is reached

  This is deliberately capped so a phone browser
  cannot be hammered indefinitely.
*/

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

    /*
      If fewer than 1000 came back,
      there is normally no more data in
      the requested range.
    */
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

function createOrderBookTotals() {
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
  Return the smallest meaningful
  price increment found in the
  exchange order-book data.

  This adapts to different pairs:

  BTC:
    0.1 / 0.01 / 1

  SHIB:
    0.00000001 / 0.0000001

  XRP:
    0.0001 / 0.001
*/
function getBookTickSize(levels) {
  const prices =
    levels
      .map(level => Number(level.price))
      .filter(
        price =>
          Number.isFinite(price) &&
          price > 0
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (prices.length < 2) {
    return 0.00000001;
  }

  let smallestDifference =
    Infinity;

  for (let i = 1; i < prices.length; i++) {
    const difference =
      prices[i] -
      prices[i - 1];

    if (
      difference > 0 &&
      difference < smallestDifference
    ) {
      smallestDifference =
        difference;
    }
  }

  return Number.isFinite(
    smallestDifference
  )
    ? smallestDifference
    : 0.00000001;
}


/*
  Round a value to a safe decimal
  precision based on its magnitude.
*/
function getDecimalPlaces(value) {
  const n =
    Math.abs(Number(value));

  if (!Number.isFinite(n) || n === 0) {
    return 8;
  }

  if (n >= 1000) return 2;
  if (n >= 1) return 4;
  if (n >= 0.01) return 6;
  if (n >= 0.000001) return 8;
  return 12;
}


/*
  Create a clean price-grouping step.

  The selected range is divided
  into the requested number of
  displayed rows.

  Then the result is rounded to
  a sensible 1/2/5/10 step.
*/
function getAggregationStep(
  currentPrice,
  rangePercent,
  maxRows,
  tickSize
) {
  const range =
    Number(rangePercent) / 100;

  const safePrice =
    Number(currentPrice);

  const safeRows =
    Math.max(
      1,
      Number(maxRows) || 10
    );

  const safeTick =
    Math.max(
      Number(tickSize) || 0.00000001,
      0.000000000001
    );

  const totalRange =
    safePrice * range;

  const rawStep =
    totalRange / safeRows;

  if (
    !Number.isFinite(rawStep) ||
    rawStep <= 0
  ) {
    return safeTick;
  }

  const magnitude =
    Math.pow(
      10,
      Math.floor(
        Math.log10(rawStep)
      )
    );

  const normalized =
    rawStep / magnitude;

  let niceStep;

  if (normalized <= 1) {
    niceStep = 1;
  } else if (normalized <= 2) {
    niceStep = 2;
  } else if (normalized <= 5) {
    niceStep = 5;
  } else {
    niceStep = 10;
  }

  const calculatedStep =
    niceStep * magnitude;

  /*
    Never use a grouping step
    smaller than the exchange
    price increment.
  */
  return Math.max(
    calculatedStep,
    safeTick
  );
}


/*
  Group raw order-book levels
  into price buckets.
*/
function aggregateOrderBookLevels(
  levels,
  currentPrice,
  rangePercent,
  side,
  maxRows
) {
  const range =
    Number(rangePercent) / 100;

  const safePrice =
    Number(currentPrice);

  if (
    !Number.isFinite(safePrice) ||
    safePrice <= 0
  ) {
    return {
      rows: [],
      step: 0,
      lowerBound: 0,
      upperBound: 0,
      rawCount: 0
    };
  }

  const tickSize =
    getBookTickSize(levels);

  const step =
    getAggregationStep(
      safePrice,
      rangePercent,
      maxRows,
      tickSize
    );

  const lowerBound =
    safePrice * (1 - range);

  const upperBound =
    safePrice * (1 + range);

  const groups =
    new Map();

  const filtered =
    levels.filter(level => {
      const price =
        Number(level.price);

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return false;
      }

      if (side === "asks") {
        return (
          price >= safePrice &&
          price <= upperBound
        );
      }

      return (
        price <= safePrice &&
        price >= lowerBound
      );
    });

  for (const level of filtered) {
    const price =
      Number(level.price);

    const quantity =
      Number(level.quantity);

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue;
    }

    /*
      For asks:
        bucket starts upward
        from the lower range boundary.

      For bids:
        bucket starts downward
        from the upper range boundary.

      This keeps the displayed
      price zones aligned with CMP.
    */
    let bucket;

    if (side === "asks") {
      bucket =
        Math.floor(
          (price - safePrice) /
            step
        ) * step +
        safePrice;
    } else {
      bucket =
        Math.ceil(
          (price - safePrice) /
            step
        ) * step +
        safePrice;
    }

    /*
      Avoid floating-point keys
      such as 0.000010000000001.
    */
    const decimals =
      Math.min(
        16,
        Math.max(
          2,
          getDecimalPlaces(step) + 2
        )
      );

    const key =
      bucket.toFixed(decimals);

    if (!groups.has(key)) {
      groups.set(key, {
        price: bucket,
        quantity: 0,
        value: 0,
        rawLevels: 0
      });
    }

    const group =
      groups.get(key);

    group.quantity += quantity;
    group.value +=
      price * quantity;
    group.rawLevels++;
  }

  let rows =
    Array.from(
      groups.values()
    );

  if (side === "asks") {
    rows.sort(
      (a, b) =>
        a.price - b.price
    );
  } else {
    rows.sort(
      (a, b) =>
        b.price - a.price
    );
  }

  /*
    Keep the requested number
    of aggregated rows.
  */
  rows =
    rows.slice(
      0,
      Math.max(
        1,
        Number(maxRows) || 10
      )
    );

  return {
    rows,
    step,
    lowerBound,
    upperBound,
    rawCount: filtered.length
  };
}


/*
  Format the aggregation step
  for the order-book heading.
*/
function formatAggregationStep(step) {
  if (
    !Number.isFinite(step) ||
    step <= 0
  ) {
    return "--";
  }

  return formatPrice(step);
}


/*
  Render one aggregated side.
*/
function renderOrderBookSide(
  body,
  levels,
  currentPrice,
  rangePercent,
  side
) {
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

  const rows =
    result.rows;

  if (!rows.length) {
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

  for (const level of rows) {
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
}


/*
  Update total quantities using
  the same aggregated rows that
  are displayed in the table.
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
          x =>
            Number.isFinite(x.price) &&
            Number.isFinite(x.quantity) &&
            x.price > 0 &&
            x.quantity > 0
        );

    const bids =
      (book.bids || [])
        .map(normalizeBookLevel)
        .filter(
          x =>
            Number.isFinite(x.price) &&
            Number.isFinite(x.quantity) &&
            x.price > 0 &&
            x.quantity > 0
        );

    let currentPrice =
      state.lastTradePrice;

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

    const askResult =
      aggregateOrderBookLevels(
        asks,
        currentPrice,
        range,
        "asks",
        maxRows
      );

    const bidResult =
      aggregateOrderBookLevels(
        bids,
        currentPrice,
        range,
        "bids",
        maxRows
      );

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

    /*
      Totals use the same rows
      displayed in the tables.
    */
    updateOrderBookTotals(
      askResult.rows,
      bidResult.rows
    );

    console.log(
      "Order book aggregation:",
      {
        symbol: state.symbol,
        currentPrice,
        rangePercent: range,
        maxRows,
        askAggregationStep:
          formatAggregationStep(
            askResult.step
          ),
        bidAggregationStep:
          formatAggregationStep(
            bidResult.step
          ),
        rawAskLevels:
          askResult.rawCount,
        rawBidLevels:
          bidResult.rawCount,
        displayedAskRows:
          askResult.rows.length,
        displayedBidRows:
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


function renderOrderBookSide(
  body,
  levels,
  currentPrice,
  rangePercent,
  side
) {
  body.innerHTML = "";

  const range =
    Number(rangePercent) / 100;

  const maxLevels =
    Math.max(
      1,
      Number(
        els.orderBookLevels.value
      ) || 20
    );

  let filtered;

  if (side === "asks") {
    const maximum =
      currentPrice *
      (1 + range);

    filtered =
      levels
        .filter(
          level =>
            level.price >= currentPrice &&
            level.price <= maximum
        )
        .sort(
          (a, b) =>
            a.price - b.price
        );
  } else {
    const minimum =
      currentPrice *
      (1 - range);

    filtered =
      levels
        .filter(
          level =>
            level.price <= currentPrice &&
            level.price >= minimum
        )
        .sort(
          (a, b) =>
            b.price - a.price
        );
  }

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
    const value =
      level.price *
      level.quantity;

    const row =
      document.createElement("tr");

    row.innerHTML = `
      <td>${formatPrice(level.price)}</td>
      <td>${formatVolume(level.quantity)}</td>
      <td>${formatVolume(value)}</td>
    `;

    fragment.appendChild(row);
  }

  body.appendChild(fragment);
}


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
          x =>
            Number.isFinite(x.price) &&
            Number.isFinite(x.quantity)
        );

    const bids =
      (book.bids || [])
        .map(normalizeBookLevel)
        .filter(
          x =>
            Number.isFinite(x.price) &&
            Number.isFinite(x.quantity)
        );

    let currentPrice =
      state.lastTradePrice;

    if (!Number.isFinite(currentPrice)) {
      currentPrice =
        Number(
          String(
            els.currentPrice.textContent
          ).replace(/,/g, "")
        );
    }

    if (!Number.isFinite(currentPrice)) {
      throw new Error(
        "Current price unavailable"
      );
    }

    const range =
      Number(
        els.orderBookRange.value
      ) || 0.2;

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

    /*
      Totals are for the displayed
      range/levels, not the entire
      Binance order book.
    */
    const askRange =
      getVisibleBookLevels(
        asks,
        currentPrice,
        range,
        "asks"
      );

    const bidRange =
      getVisibleBookLevels(
        bids,
        currentPrice,
        range,
        "bids"
      );

    updateOrderBookTotals(
      askRange,
      bidRange
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


function getVisibleBookLevels(
  levels,
  currentPrice,
  rangePercent,
  side
) {
  const range =
    Number(rangePercent) / 100;

  const maxLevels =
    Math.max(
      1,
      Number(
        els.orderBookLevels.value
      ) || 20
    );

  let filtered;

  if (side === "asks") {
    const maximum =
      currentPrice *
      (1 + range);

    filtered =
      levels
        .filter(
          x =>
            x.price >= currentPrice &&
            x.price <= maximum
        )
        .sort(
          (a, b) =>
            a.price - b.price
        );
  } else {
    const minimum =
      currentPrice *
      (1 - range);

    filtered =
      levels
        .filter(
          x =>
            x.price <= currentPrice &&
            x.price >= minimum
        )
        .sort(
          (a, b) =>
            b.price - a.price
        );
  }

  return filtered.slice(
    0,
    maxLevels
  );
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

  /*
    IMPORTANT:
    Do NOT disconnect the stream
    during the initial load.

    Only disconnect when the user
    actually changes to another pair.
  */

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

    /*
      Start/restart stream after
      the ticker has been validated.
    */
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

  /*
    Create quantity total boxes.
  */
  createOrderBookTotals();

  /*
    Initial pair load.
    The WebSocket is NOT disconnected
    here anymore.
  */
  await changePair();

  /*
    Refresh 24h ticker.
  */
  setInterval(
    loadTicker,
    10000
  );
}


initialize();
