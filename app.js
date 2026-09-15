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
    if (!state.exchange) return;

    const ticker =
      await state.exchange.get24hTicker(
        state.symbol
      );

    const tickerPrice =
      Number(ticker.lastPrice);

    els.currentPrice.textContent =
      formatPrice(tickerPrice);

    els.priceChange.textContent =
      `${formatNumber(
        ticker.priceChangePercent,
        2
      )}%`;

    els.volume24h.textContent =
      formatVolume(ticker.volume);

    els.tradeCount.textContent =
      formatNumber(ticker.count, 0);

    if (
      Number(ticker.priceChangePercent) >= 0
    ) {
      els.priceChange.classList.remove(
        "negative"
      );

      els.priceChange.classList.add(
        "positive"
      );
    } else {
      els.priceChange.classList.remove(
        "positive"
      );

      els.priceChange.classList.add(
        "negative"
      );
    }

    /*
      Use ticker price as fallback only.
      Live trade price remains preferred
      when loading the order book.
    */

    if (
      !Number.isFinite(
        state.lastTradePrice
      ) &&
      Number.isFinite(tickerPrice)
    ) {
      state.lastTradePrice = tickerPrice;
    }

    if (els.lastUpdated) {
      els.lastUpdated.textContent =
        `Last updated: ${
          new Date().toLocaleTimeString()
        }`;
    }

  } catch (error) {
    console.error(
      "Ticker error:",
      error
    );
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
    trade.aggressiveSide === "buy"
  ) {
    state.liveBuyVolume += quantity;
  } else {
    state.liveSellVolume += quantity;
  }

  state.liveFlow =
    state.liveBuyVolume -
    state.liveSellVolume;

  state.lastTradePrice = price;

  state.lastTradeTime =
    Number(trade.time) || Date.now();

  state.tradeHistory.push({
    price,
    quantity,
    time: state.lastTradeTime,
    aggressiveSide:
      trade.aggressiveSide,
    buyerIsMaker:
      trade.buyerIsMaker === true
  });

  if (
    state.tradeHistory.length > 20000
  ) {
    state.tradeHistory.splice(
      0,
      state.tradeHistory.length - 20000
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

  const totalVolume =
    state.liveBuyVolume +
    state.liveSellVolume;

  const density =
    state.liveTrades > 0
      ? totalVolume / state.liveTrades
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
    totalVolume > 0
      ? (
          (
            state.liveBuyVolume -
            state.liveSellVolume
          ) /
          totalVolume
        ) * 100
      : 0;

  if (els.makerBalance) {
    els.makerBalance.textContent =
      `${formatNumber(balance, 2)}%`;
  }

  if (els.tradeEfficiency) {
    els.tradeEfficiency.textContent =
      state.lastTradePrice
        ? formatPrice(
            state.lastTradePrice
          )
        : "--";
  }
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


function getBucketSize() {
  const value =
    Number(
      els.priceBucket?.value
    );

  return Number.isFinite(value) &&
    value > 0
    ? value
    : 0.2;
}


/*
  Binance aggregate trade:

  m = false:
    buyer is taker
    Buy Taker volume

  m = true:
    buyer is maker
    Buy Maker volume
*/

function normalizeTrade(raw) {
  if (!raw) return null;

  /*
    Already-normalized trade.
  */

  if (
    raw.price !== undefined &&
    raw.quantity !== undefined
  ) {
    const price =
      Number(raw.price);

    const quantity =
      Number(raw.quantity);

    const buyerIsMaker =
      raw.buyerIsMaker === true ||
      raw.buyerIsMaker === "true";

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return null;
    }

    return {
      id: Number(
        raw.id ??
        raw.tradeId ??
        raw.a
      ),

      price,
      quantity,

      time:
        Number(
          raw.time ??
          raw.timestamp ??
          raw.T
        ) || Date.now(),

      buyerIsMaker,

      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy"
    };
  }

  /*
    Binance aggregate trade format:

    a = aggregate trade ID
    p = price
    q = quantity
    T = timestamp
    m = buyer is maker
  */

  if (
    raw.p !== undefined &&
    raw.q !== undefined
  ) {
    const price =
      Number(raw.p);

    const quantity =
      Number(raw.q);

    const buyerIsMaker =
      raw.m === true ||
      raw.m === "true";

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return null;
    }

    return {
      id: Number(raw.a),
      price,
      quantity,
      time: Number(raw.T),
      buyerIsMaker,

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

  while (
    requestCount < MAX_REQUESTS
  ) {
    requestCount++;

    const params =
      new URLSearchParams();

    params.set(
      "symbol",
      symbol
    );

    params.set(
      "limit",
      "1000"
    );

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
        `Historical trade request failed: ${
          response.status
        }`
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

      if (
        trade.time < startTime
      ) {
        continue;
      }

      if (
        trade.time > endTime
      ) {
        reachedEnd = true;
        break;
      }

      results.push(trade);
    }

    if (reachedEnd) {
      break;
    }

    if (
      batch.length < 1000
    ) {
      break;
    }

    const last =
      normalizeTrade(
        batch[
          batch.length - 1
        ]
      );

    if (
      !last ||
      !Number.isFinite(last.id)
    ) {
      break;
    }

    fromId =
      last.id + 1;
  }

  return results;
}


function groupTradesByPrice(
  trades,
  bucketSize
) {
  const groups =
    new Map();

  for (const trade of trades) {
    const price =
      Number(trade.price);

    const quantity =
      Number(trade.quantity);

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue;
    }

    const bucket =
      Math.floor(
        price / bucketSize
      ) * bucketSize;

    const key =
      bucket.toFixed(12);

    if (!groups.has(key)) {
      groups.set(key, {
        price: bucket,
        trades: 0,
        volume: 0,

        buyTaker: 0,
        buyMaker: 0,

        flow: 0
      });
    }

    const group =
      groups.get(key);

    group.trades++;
    group.volume += quantity;

    if (
      trade.buyerIsMaker === true
    ) {
      group.buyMaker += quantity;
    } else {
      group.buyTaker += quantity;
    }

    group.flow =
      group.buyTaker -
      group.buyMaker;
  }

  return Array.from(
    groups.values()
  ).sort(
    (a, b) =>
      b.price - a.price
  );
}


function renderTradeTable(groups) {
  if (!els.tradeTableBody) {
    return;
  }

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

    /*
      Existing six-column HTML is preserved:

      Price
      Trades
      Volume
      Buy
      Sell
      Flow

      Buy now means Buy Taker.
      Sell now means Buy Maker.
    */

    row.innerHTML = `
      <td>${formatPrice(group.price)}</td>
      <td>${formatNumber(group.trades, 0)}</td>
      <td>${formatVolume(group.volume)}</td>
      <td>${formatVolume(group.buyTaker)}</td>
      <td>${formatVolume(group.buyMaker)}</td>
      <td>${formatVolume(group.flow)}</td>
    `;

    fragment.appendChild(row);
  }

  els.tradeTableBody.appendChild(
    fragment
  );
}


async function inspectTrades() {
  if (!els.inspectTradesBtn) {
    return;
  }

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

    const totalBuyTaker =
      groups.reduce(
        (total, group) =>
          total + group.buyTaker,
        0
      );

    const totalBuyMaker =
      groups.reduce(
        (total, group) =>
          total + group.buyMaker,
        0
      );

    const totalFlow =
      totalBuyTaker -
      totalBuyMaker;

    /*
      Keep the existing summary IDs.

      buyVolume displays Buy Taker.
      sellVolume displays Buy Maker.
    */

    if (els.buyVolume) {
      els.buyVolume.textContent =
        formatVolume(
          totalBuyTaker
        );
    }

    if (els.sellVolume) {
      els.sellVolume.textContent =
        formatVolume(
          totalBuyMaker
        );
    }

    if (els.netFlow) {
      els.netFlow.textContent =
        formatVolume(
          totalFlow
        );
    }

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
  if (!els.asksBody) {
    return;
  }

  const section =
    els.asksBody.closest(".panel") ||
    els.asksBody.parentElement;

  if (!section) {
    return;
  }

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

  totals.style.display =
    "grid";

  totals.style.gridTemplateColumns =
    "1fr 1fr";

  totals.style.gap =
    "10px";

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


/*
  Get CMP.

  The live trade price is preferred.
  The displayed ticker price is the fallback.
*/

function getOrderBookReferencePrice() {
  const livePrice =
    Number(
      state.lastTradePrice
    );

  if (
    Number.isFinite(livePrice) &&
    livePrice > 0
  ) {
    return livePrice;
  }

  const displayedPrice =
    Number(
      String(
        els.currentPrice?.textContent || ""
      ).replace(
        /[^0-9.-]/g,
        ""
      )
    );

  if (
    Number.isFinite(displayedPrice) &&
    displayedPrice > 0
  ) {
    return displayedPrice;
  }

  return 0;
}


/*
  Create exactly N zones per side.

  Range is spacing per level.

  Example:

  CMP = 80,000
  spacing = 0.2%
  levels = 10

  Each level is approximately 160 USDT wide.

  Ask side:
    CMP to +0.2%
    +0.2% to +0.4%
    ...
    +1.8% to +2.0%

  Bid side:
    CMP to -0.2%
    -0.2% to -0.4%
    ...
    -1.8% to -2.0%
*/

function createOrderBookZones(
  cmp,
  spacingPercent,
  levels,
  side
) {
  const price =
    Number(cmp);

  const spacing =
    Number(spacingPercent) / 100;

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
    let index = 0;
    index < count;
    index++
  ) {
    const startPercent =
      spacing * index;

    const endPercent =
      spacing * (index + 1);

    let lower;
    let upper;

    if (side === "asks") {
      lower =
        price *
        (1 + startPercent);

      upper =
        price *
        (1 + endPercent);
    } else {
      lower =
        price *
        (1 - endPercent);

      upper =
        price *
        (1 - startPercent);
    }

    zones.push({
      level: index + 1,
      lower,
      upper,
      quantity: 0,
      value: 0,
      rawLevels: 0
    });
  }

  return zones;
}


/*
  Place every raw order-book level
  into its correct percentage zone.

  Empty zones remain visible.
*/

function aggregateOrderBookLevels(
  rawLevels,
  zones,
  side
) {
  for (const level of rawLevels) {
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
      let inside = false;

      if (side === "asks") {
        inside =
          price >= zone.lower &&
          price < zone.upper;
      } else {
        inside =
          price > zone.lower &&
          price <= zone.upper;
      }

      if (!inside) {
        continue;
      }

      zone.quantity += quantity;

      zone.value +=
        price * quantity;

      zone.rawLevels++;

      break;
    }
  }

  return zones;
}


/*
  Display the actual percentage zone,
  not just one boundary price.

  This prevents the first ask and
  first bid from looking identical.
*/

function formatOrderBookZone(
  zone,
  side
) {
  const lower =
    formatPrice(zone.lower);

  const upper =
    formatPrice(zone.upper);

  return `${lower} - ${upper}`;
}


function renderOrderBookSide(
  body,
  zones,
  side
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
      <td>${formatOrderBookZone(zone, side)}</td>
      <td>${formatVolume(zone.quantity)}</td>
      <td>${formatVolume(zone.value)}</td>
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
      formatVolume(
        askTotal
      );
  }

  if (bidElement) {
    bidElement.textContent =
      formatVolume(
        bidTotal
      );
  }
}


async function loadOrderBook() {
  if (!state.exchange) {
    return;
  }

  if (els.loadOrderBookBtn) {
    els.loadOrderBookBtn.disabled = true;

    els.loadOrderBookBtn.textContent =
      "Loading...";
  }

  try {
    const book =
      await state.exchange.getOrderBook(
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
        "Current market price unavailable"
      );
    }

    /*
      Range now means spacing per level.

      0.2% with 10 levels gives
      approximately 2% on each side.
    */

    const spacingPercent =
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
        spacingPercent,
        levels,
        "asks"
      );

    const bidZones =
      createOrderBookZones(
        cmp,
        spacingPercent,
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
      askZones,
      "asks"
    );

    renderOrderBookSide(
      els.bidsBody,
      bidZones,
      "bids"
    );

    updateOrderBookTotals(
      askZones,
      bidZones
    );

    console.log(
      "Order book loaded:",
      {
        symbol: state.symbol,
        cmp,
        spacingPercent,
        levels,
        totalRangePerSide:
          `${spacingPercent * levels}%`,
        askZones,
        bidZones
      }
    );

  } catch (error) {
    console.error(
      "Order book error:",
      error
    );

    if (els.asksBody) {
      els.asksBody.innerHTML = `
        <tr>
          <td colspan="3">
            Unable to load order book.
          </td>
        </tr>
      `;
    }

    if (els.bidsBody) {
      els.bidsBody.innerHTML = `
        <tr>
          <td colspan="3">
            Unable to load order book.
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
      els.loadOrderBookBtn.disabled = false;

      els.loadOrderBookBtn.textContent =
        "Load Order Book";
    }
  }
}


/* =========================
   CONNECTION
========================= */

function handleConnection(status) {
  if (!els.status) {
    return;
  }

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
      els.pairInput?.value
    );

  if (!symbol) {
    return;
  }

  const oldSymbol =
    state.exchange
      ? state.exchange.getSymbol()
      : null;

  const symbolChanged =
    oldSymbol &&
    oldSymbol !== symbol;

  if (
    symbolChanged &&
    state.exchange
  ) {
    state.exchange.disconnectTradeStream(
      false
    );
  }

  state.symbol =
    symbol;

  if (state.exchange) {
    state.exchange.setSymbol(
      symbol
    );
  }

  if (els.pairInput) {
    els.pairInput.value =
      symbol;
  }

  if (els.marketPair) {
    els.marketPair.textContent =
      symbol;
  }

  resetTradeStats();

  try {
    await loadTicker();

    if (state.exchange) {
      state.exchange.connectTradeStream(
        symbol
      );
    }

    if (els.tradeTableBody) {
      els.tradeTableBody.innerHTML = `
        <tr>
          <td colspan="6">
            No trade data loaded.
          </td>
        </tr>
      `;
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

    const askTotal =
      document.getElementById(
        "totalAskQuantity"
      );

    const bidTotal =
      document.getElementById(
        "totalBidQuantity"
      );

    if (askTotal) {
      askTotal.textContent =
        "--";
    }

    if (bidTotal) {
      bidTotal.textContent =
        "--";
    }

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

  createOrderBookTotals();

  await changePair();

  setInterval(
    loadTicker,
    10000
  );
}


initialize();
