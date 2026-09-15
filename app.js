"use strict";

/*
 * ALPHA TRACKER
 * Binance USDⓈ-M Futures Interface
 *
 * Data source:
 * Binance USDⓈ-M Futures only.
 *
 * Responsibilities:
 * - Futures pair selection
 * - Futures ticker display
 * - Live Futures aggregate trades
 * - Futures historical trade inspection
 * - Buy Taker / Buy Maker classification
 * - Percentage-based order-book zones
 * - Order-book quantity aggregation
 * - Live market metrics
 */


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

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "--";
  }

  return number.toLocaleString(
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

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "--";
  }

  if (
    number >= 1000
  ) {

    return number.toLocaleString(
      undefined,
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    );

  }

  if (
    number >= 1
  ) {
    return number.toFixed(4);
  }

  if (
    number >= 0.01
  ) {
    return number.toFixed(6);
  }

  return number.toFixed(8);
}


function formatVolume(value) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "--";
  }

  if (
    Math.abs(number) >= 1000000
  ) {

    return (
      number / 1000000
    ).toFixed(2) + "M";

  }

  if (
    Math.abs(number) >= 1000
  ) {

    return (
      number / 1000
    ).toFixed(2) + "K";

  }

  return number.toFixed(4);
}


function normalizeSymbol(value) {

  return String(value || "")
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ""
    );

}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  message,
  type = "disconnected"
) {

  if (
    !els.status
  ) {
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
   FUTURES TICKER
========================================================= */

async function loadTicker() {

  try {

    if (
      !state.exchange
    ) {
      return;
    }

    const ticker =
      await state.exchange.get24hTicker(
        state.symbol
      );

    const tickerPrice =
      Number(
        ticker.lastPrice
      );

    if (
      els.currentPrice
    ) {

      els.currentPrice.textContent =
        formatPrice(
          tickerPrice
        );

    }

    if (
      els.priceChange
    ) {

      const percent =
        Number(
          ticker.priceChangePercent
        );

      els.priceChange.textContent =
        `${formatNumber(
          percent,
          2
        )}%`;

      els.priceChange.classList.remove(
        "positive",
        "negative"
      );

      els.priceChange.classList.add(
        percent >= 0
          ? "positive"
          : "negative"
      );

    }

    if (
      els.volume24h
    ) {

      /*
       * Binance Futures ticker volume
       * is the contract/base quantity.
       */

      els.volume24h.textContent =
        formatVolume(
          ticker.volume
        );

    }

    if (
      els.tradeCount
    ) {

      els.tradeCount.textContent =
        formatNumber(
          ticker.count,
          0
        );

    }

    /*
     * Ticker is only a fallback.
     * Live Futures trades remain preferred.
     */

    if (
      !Number.isFinite(
        state.lastTradePrice
      ) &&
      Number.isFinite(
        tickerPrice
      )
    ) {

      state.lastTradePrice =
        tickerPrice;

    }

    if (
      els.lastUpdated
    ) {

      els.lastUpdated.textContent =
        `Last updated: ${
          new Date().toLocaleTimeString()
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
   LIVE TRADE STATISTICS
========================================================= */

function resetTradeStats() {

  state.liveTrades =
    0;

  state.liveBuyVolume =
    0;

  state.liveSellVolume =
    0;

  state.liveFlow =
    0;

  state.lastTradePrice =
    null;

  state.lastTradeTime =
    null;

  state.tradeHistory =
    [];

  updateTradeDisplay();

}


function handleTrade(
  trade
) {

  if (
    !trade
  ) {
    return;
  }

  const price =
    Number(
      trade.price
    );

  const quantity =
    Number(
      trade.quantity
    );

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return;
  }

  state.liveTrades++;

  /*
   * Binance Futures aggTrade:
   *
   * m = false:
   * buyer is taker
   *
   * m = true:
   * buyer is maker
   */

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
    Number(
      trade.time
    ) ||
    Date.now();

  state.tradeHistory.push({

    id:
      Number(
        trade.id
      ),

    price,

    quantity,

    time:
      state.lastTradeTime,

    aggressiveSide:
      trade.aggressiveSide,

    buyerIsMaker:
      trade.buyerIsMaker === true

  });

  /*
   * Keep memory bounded.
   */

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

  if (
    els.buyVolume
  ) {

    els.buyVolume.textContent =
      formatVolume(
        state.liveBuyVolume
      );

  }

  if (
    els.sellVolume
  ) {

    els.sellVolume.textContent =
      formatVolume(
        state.liveSellVolume
      );

  }

  if (
    els.netFlow
  ) {

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
      ? totalVolume /
        state.liveTrades
      : 0;

  if (
    els.volumeDensity
  ) {

    els.volumeDensity.textContent =
      formatVolume(
        density
      );

  }

  if (
    els.cumulativeFlow
  ) {

    els.cumulativeFlow.textContent =
      formatVolume(
        state.liveFlow
      );

  }

  if (
    els.densityIndicator
  ) {

    els.densityIndicator.textContent =
      formatVolume(
        density
      );

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

  if (
    els.makerBalance
  ) {

    els.makerBalance.textContent =
      `${formatNumber(
        balance,
        2
      )}%`;

  }

  if (
    els.tradeEfficiency
  ) {

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
   TRADE INSPECTION TIME HELPERS
========================================================= */

function getTimeValue(
  element
) {

  if (
    !element ||
    !element.value
  ) {
    return null;
  }

  const value =
    element.value;

  /*
   * Numeric timestamp support.
   *
   * Seconds are converted to milliseconds.
   */

  if (
    /^\d+$/.test(value)
  ) {

    const number =
      Number(value);

    return number <
      100000000000
      ? number * 1000
      : number;

  }

  const time =
    new Date(
      value
    ).getTime();

  return Number.isFinite(
    time
  )
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

  const now =
    Date.now();

  if (
    !start &&
    !end
  ) {

    end =
      now;

    start =
      now -
      15 * 60 * 1000;

  }

  if (
    !start
  ) {

    start =
      now -
      15 * 60 * 1000;

  }

  if (
    !end
  ) {

    end =
      now;

  }

  if (
    start > end
  ) {

    const temporary =
      start;

    start =
      end;

    end =
      temporary;

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

  return Number.isFinite(
    value
  ) &&
    value > 0
    ? value
    : 0.2;

}


/* =========================================================
   TRADE NORMALIZATION
========================================================= */

function normalizeTrade(
  raw
) {

  if (
    !raw
  ) {
    return null;
  }

  /*
   * Already-normalized trade.
   */

  if (
    raw.price !== undefined &&
    raw.quantity !== undefined
  ) {

    const price =
      Number(
        raw.price
      );

    const quantity =
      Number(
        raw.quantity
      );

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

      id:
        Number(
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
        ) ||
        Date.now(),

      buyerIsMaker,

      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy"

    };

  }

  /*
   * Binance Futures aggregate-trade format:
   *
   * a = aggregate trade ID
   * p = price
   * q = quantity
   * T = timestamp
   * m = buyer is maker
   */

  if (
    raw.p !== undefined &&
    raw.q !== undefined
  ) {

    const price =
      Number(
        raw.p
      );

    const quantity =
      Number(
        raw.q
      );

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

      id:
        Number(
          raw.a
        ),

      price,

      quantity,

      time:
        Number(
          raw.T
        ) ||
        Date.now(),

      buyerIsMaker,

      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy"

    };

  }

  return null;

}


/* =========================================================
   HISTORICAL FUTURES TRADES
========================================================= */

async function fetchHistoricalTrades(
  symbol,
  startTime,
  endTime
) {

  if (
    !state.exchange
  ) {

    throw new Error(
      "Futures exchange layer unavailable"
    );

  }

  /*
   * IMPORTANT:
   *
   * Historical trades are now fetched
   * through BinanceExchange.
   *
   * The exchange layer uses:
   *
   * https://fapi.binance.com/fapi/v1
   *
   * This is Binance USDⓈ-M Futures.
   *
   * No Spot endpoint is used here.
   */

  const trades =
    await state.exchange.getHistoricalTrades(
      symbol,
      startTime,
      endTime,
      1000
    );

  return Array.isArray(
    trades
  )
    ? trades
    : [];

}


/* =========================================================
   GROUP TRADES BY PRICE
========================================================= */

function groupTradesByPrice(
  trades,
  bucketSize
) {

  const groups =
    new Map();

  for (
    const trade of trades
  ) {

    const price =
      Number(
        trade.price
      );

    const quantity =
      Number(
        trade.quantity
      );

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue;
    }

    const bucket =
      Math.floor(
        price /
        bucketSize
      ) *
      bucketSize;

    const key =
      bucket.toFixed(
        12
      );

    if (
      !groups.has(key)
    ) {

      groups.set(
        key,
        {

          price:
            bucket,

          trades:
            0,

          volume:
            0,

          buyTaker:
            0,

          buyMaker:
            0,

          flow:
            0

        }
      );

    }

    const group =
      groups.get(
        key
      );

    group.trades++;

    group.volume +=
      quantity;

    if (
      trade.buyerIsMaker === true
    ) {

      /*
       * Buyer was maker.
       * This is Buy Maker volume.
       */

      group.buyMaker +=
        quantity;

    } else {

      /*
       * Buyer was taker.
       * This is Buy Taker volume.
       */

      group.buyTaker +=
        quantity;

    }

    /*
     * This is not traditional aggressive
     * buy minus aggressive sell flow.
     *
     * It is:
     *
     * Buy Taker - Buy Maker
     */

    group.flow =
      group.buyTaker -
      group.buyMaker;

  }

  return Array.from(
    groups.values()
  ).sort(
    (
      first,
      second
    ) =>
      second.price -
      first.price
  );

}


/* =========================================================
   TRADE TABLE HEADERS
========================================================= */

function updateTradeTableHeaders() {

  if (
    !els.tradeTableBody
  ) {
    return;
  }

  const table =
    els.tradeTableBody.closest(
      "table"
    );

  if (
    !table
  ) {
    return;
  }

  const headerRow =
    table.querySelector(
      "thead tr"
    );

  if (
    !headerRow
  ) {
    return;
  }

  const headers =
    headerRow.querySelectorAll(
      "th"
    );

  const labels = [

    "Price Zone",

    "Trades",

    "Volume",

    "Buy Taker",

    "Buy Maker",

    "Taker - Maker"

  ];

  labels.forEach(
    (
      label,
      index
    ) => {

      if (
        headers[index]
      ) {

        headers[index].textContent =
          label;

      }

    }
  );

}


/* =========================================================
   RENDER TRADE TABLE
========================================================= */

function renderTradeTable(
  groups
) {

  if (
    !els.tradeTableBody
  ) {
    return;
  }

  updateTradeTableHeaders();

  els.tradeTableBody.innerHTML =
    "";

  if (
    !groups.length
  ) {

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

  for (
    const group of groups
  ) {

    const row =
      document.createElement(
        "tr"
      );

    /*
     * Existing six-column structure:
     *
     * Price Zone
     * Trades
     * Volume
     * Buy Taker
     * Buy Maker
     * Taker - Maker
     */

    row.innerHTML = `

      <td>
        ${formatPrice(
          group.price
        )}
      </td>

      <td>
        ${formatNumber(
          group.trades,
          0
        )}
      </td>

      <td>
        ${formatVolume(
          group.volume
        )}
      </td>

      <td>
        ${formatVolume(
          group.buyTaker
        )}
      </td>

      <td>
        ${formatVolume(
          group.buyMaker
        )}
      </td>

      <td>
        ${formatVolume(
          group.flow
        )}
      </td>

    `;

    fragment.appendChild(
      row
    );

  }

  els.tradeTableBody.appendChild(
    fragment
  );

}


/* =========================================================
   TRADE INSPECTION
========================================================= */

async function inspectTrades() {

  if (
    !els.inspectTradesBtn
  ) {
    return;
  }

  if (
    !state.exchange
  ) {
    return;
  }

  els.inspectTradesBtn.disabled =
    true;

  els.inspectTradesBtn.textContent =
    "Loading Futures trades...";

  try {

    const {
      start,
      end
    } =
      getInspectionWindow();

    const bucketSize =
      getBucketSize();

    console.log(
      "Futures trade inspection:",
      {
        symbol:
          state.symbol,

        start:
          new Date(start),

        end:
          new Date(end),

        bucketSize
      }
    );

    const trades =
      await fetchHistoricalTrades(
        state.symbol,
        start,
        end
      );

    console.log(
      "Futures historical trades received:",
      trades.length
    );

    const groups =
      groupTradesByPrice(
        trades,
        bucketSize
      );

    renderTradeTable(
      groups
    );

    /*
     * Do not overwrite the live summary
     * with historical inspection values.
     *
     * The live summary belongs to the
     * current WebSocket stream.
     */

  } catch (error) {

    console.error(
      "Futures trade inspection error:",
      error
    );

    if (
      els.tradeTableBody
    ) {

      els.tradeTableBody.innerHTML = `
        <tr>
          <td colspan="6">
            Unable to load Futures historical trades.
          </td>
        </tr>
      `;

    }

  } finally {

    els.inspectTradesBtn.disabled =
      false;

    els.inspectTradesBtn.textContent =
      "Inspect Trades";

  }

}


/* =========================================================
   ORDER-BOOK TOTALS
========================================================= */

function createOrderBookTotals() {

  if (
    !els.asksBody
  ) {
    return;
  }

  const section =
    els.asksBody.closest(
      ".panel"
    ) ||
    els.asksBody.parentElement;

  if (
    !section
  ) {
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
    document.createElement(
      "div"
    );

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


function normalizeBookLevel(
  level
) {

  if (
    Array.isArray(level)
  ) {

    const price =
      Number(
        level[0]
      );

    const quantity =
      Number(
        level[1]
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

  if (
    level &&
    typeof level ===
      "object"
  ) {

    const price =
      Number(
        level.price
      );

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


/* =========================================================
   ORDER-BOOK CMP
========================================================= */

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
        els.currentPrice?.textContent ||
        ""
      ).replace(
        /[^0-9.-]/g,
        ""
      )
    );

  if (
    Number.isFinite(
      displayedPrice
    ) &&
    displayedPrice > 0
  ) {

    return displayedPrice;

  }

  return 0;

}


/* =========================================================
   ORDER-BOOK ZONES
========================================================= */

/*
 * The range input means spacing per level.
 *
 * Example:
 *
 * CMP = 80,000
 * Range = 0.2%
 * Levels = 10
 *
 * Ask zones:
 *
 * Level 1:
 * CMP to +0.2%
 *
 * Level 2:
 * +0.2% to +0.4%
 *
 * Level 3:
 * +0.4% to +0.6%
 *
 * ...
 *
 * Level 10:
 * +1.8% to +2.0%
 *
 * Bid zones:
 *
 * Level 1:
 * CMP to -0.2%
 *
 * Level 2:
 * -0.2% to -0.4%
 *
 * ...
 *
 * Level 10:
 * -1.8% to -2.0%
 */

function createOrderBookZones(
  cmp,
  spacingPercent,
  levels,
  side
) {

  const price =
    Number(
      cmp
    );

  const spacing =
    Number(
      spacingPercent
    ) / 100;

  const count =
    Math.max(
      1,
      Math.min(
        100,
        Number(levels) ||
          10
      )
    );

  const zones =
    [];

  for (
    let index = 0;
    index < count;
    index++
  ) {

    const startPercent =
      spacing *
      index;

    const endPercent =
      spacing *
      (index + 1);

    let lower;

    let upper;

    if (
      side ===
      "asks"
    ) {

      lower =
        price *
        (
          1 +
          startPercent
        );

      upper =
        price *
        (
          1 +
          endPercent
        );

    } else {

      lower =
        price *
        (
          1 -
          endPercent
        );

      upper =
        price *
        (
          1 -
          startPercent
        );

    }

    zones.push({

      level:
        index + 1,

      lower,

      upper,

      quantity:
        0,

      value:
        0,

      rawLevels:
        0

    });

  }

  return zones;

}


/* =========================================================
   AGGREGATE ORDER-BOOK LEVELS
========================================================= */

function aggregateOrderBookLevels(
  rawLevels,
  zones,
  side
) {

  for (
    const level of rawLevels
  ) {

    const price =
      Number(
        level.price
      );

    const quantity =
      Number(
        level.quantity
      );

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      price <= 0 ||
      quantity <= 0
    ) {
      continue;
    }

    for (
      const zone of zones
    ) {

      let inside =
        false;

      if (
        side ===
        "asks"
      ) {

        inside =
          price >=
            zone.lower &&
          price <
            zone.upper;

      } else {

        inside =
          price >
            zone.lower &&
          price <=
            zone.upper;

      }

      if (
        !inside
      ) {
        continue;
      }

      zone.quantity +=
        quantity;

      zone.value +=
        price *
        quantity;

      zone.rawLevels++;

      break;

    }

  }

  return zones;

}


/* =========================================================
   ORDER-BOOK ZONE FORMAT
========================================================= */

function formatOrderBookZone(
  zone
) {

  const lower =
    formatPrice(
      zone.lower
    );

  const upper =
    formatPrice(
      zone.upper
    );

  return `${lower} - ${upper}`;

}


/* =========================================================
   RENDER ORDER-BOOK SIDE
========================================================= */

function renderOrderBookSide(
  body,
  zones
) {

  if (
    !body
  ) {
    return;
  }

  body.innerHTML =
    "";

  const fragment =
    document.createDocumentFragment();

  for (
    const zone of zones
  ) {

    const row =
      document.createElement(
        "tr"
      );

    row.innerHTML = `

      <td>
        ${formatOrderBookZone(
          zone
        )}
      </td>

      <td>
        ${formatVolume(
          zone.quantity
        )}
      </td>

      <td>
        ${formatVolume(
          zone.value
        )}
      </td>

    `;

    fragment.appendChild(
      row
    );

  }

  body.appendChild(
    fragment
  );

}


/* =========================================================
   ORDER-BOOK TOTALS DISPLAY
========================================================= */

function updateOrderBookTotals(
  asks,
  bids
) {

  const askTotal =
    asks.reduce(
      (
        total,
        zone
      ) =>
        total +
        zone.quantity,
      0
    );

  const bidTotal =
    bids.reduce(
      (
        total,
        zone
      ) =>
        total +
        zone.quantity,
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

  if (
    askElement
  ) {

    askElement.textContent =
      formatVolume(
        askTotal
      );

  }

  if (
    bidElement
  ) {

    bidElement.textContent =
      formatVolume(
        bidTotal
      );

  }

}


/* =========================================================
   LOAD FUTURES ORDER BOOK
========================================================= */

async function loadOrderBook() {

  if (
    !state.exchange
  ) {
    return;
  }

  if (
    els.loadOrderBookBtn
  ) {

    els.loadOrderBookBtn.disabled =
      true;

    els.loadOrderBookBtn.textContent =
      "Loading Futures book...";

  }

  try {

    const book =
      await state.exchange.getOrderBook(
        state.symbol,
        1000
      );

    const asks =
      (
        book.asks ||
        []
      )
        .map(
          normalizeBookLevel
        )
        .filter(
          Boolean
        )
        .filter(
          level =>
            level.price > 0 &&
            level.quantity > 0
        );

    const bids =
      (
        book.bids ||
        []
      )
        .map(
          normalizeBookLevel
        )
        .filter(
          Boolean
        )
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

    const spacingPercent =
      Math.max(
        0.0001,
        Number(
          els.orderBookRange?.value
        ) ||
          0.2
      );

    const levels =
      Math.max(
        1,
        Math.min(
          100,
          Number(
            els.orderBookLevels?.value
          ) ||
            10
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
      "Binance Futures order book loaded:",
      {

        symbol:
          state.symbol,

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
      "Futures order book error:",
      error
    );

    if (
      els.asksBody
    ) {

      els.asksBody.innerHTML = `
        <tr>
          <td colspan="3">
            Unable to load Futures order book.
          </td>
        </tr>
      `;

    }

    if (
      els.bidsBody
    ) {

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

    if (
      els.loadOrderBookBtn
    ) {

      els.loadOrderBookBtn.disabled =
        false;

      els.loadOrderBookBtn.textContent =
        "Load Order Book";

    }

  }

}


/* =========================================================
   CONNECTION CALLBACK
========================================================= */

function handleConnection(
  status
) {

  if (
    status ===
    "connected"
  ) {

    setStatus(
      "Binance Futures trade stream live",
      "connected"
    );

    return;

  }

  if (
    status ===
    "error"
  ) {

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
   RESET PAGE DATA
========================================================= */

function clearMarketTables() {

  if (
    els.tradeTableBody
  ) {

    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          No trade data loaded.
        </td>
      </tr>
    `;

  }

  if (
    els.asksBody
  ) {

    els.asksBody.innerHTML = `
      <tr>
        <td colspan="3">
          No data
        </td>
      </tr>
    `;

  }

  if (
    els.bidsBody
  ) {

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

  if (
    askTotal
  ) {

    askTotal.textContent =
      "--";

  }

  if (
    bidTotal
  ) {

    bidTotal.textContent =
      "--";

  }

}


/* =========================================================
   PAIR CHANGE
========================================================= */

async function changePair() {

  if (
    state.symbolResolving
  ) {
    return;
  }

  if (
    !state.exchange
  ) {
    return;
  }

  const entered =
    normalizeSymbol(
      els.pairInput?.value
    );

  if (
    !entered
  ) {
    return;
  }

  state.symbolResolving =
    true;

  if (
    els.pairInput
  ) {

    els.pairInput.disabled =
      true;

  }

  setStatus(
    "Resolving Binance Futures pair...",
    "disconnected"
  );

  try {

    /*
     * Resolve through the Futures
     * exchangeInfo symbol list.
     *
     * Examples:
     *
     * TA -> TAUSDT
     * CLANKER -> CLANKERUSDT
     * BTCUSDT -> BTCUSDT
     */

    const symbol =
      await state.exchange.resolveSymbol(
        entered
      );

    const oldSymbol =
      state.exchange.getSymbol();

    const symbolChanged =
      oldSymbol !==
      symbol;

    if (
      symbolChanged
    ) {

      state.exchange.disconnectTradeStream(
        false
      );

    }

    state.symbol =
      symbol;

    state.exchange.setSymbol(
      symbol
    );

    if (
      els.pairInput
    ) {

      els.pairInput.value =
        symbol;

    }

    if (
      els.marketPair
    ) {

      els.marketPair.textContent =
        symbol;

    }

    resetTradeStats();

    clearMarketTables();

    await loadTicker();

    state.exchange.connectTradeStream(
      symbol
    );

    setStatus(
      `Loading Binance Futures: ${symbol}`,
      "disconnected"
    );

    /*
     * Load the current Futures order book
     * after the symbol and ticker are ready.
     */

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

    if (
      els.pairInput
    ) {

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


els.pairInput?.addEventListener(
  "keydown",
  event => {

    if (
      event.key ===
      "Enter"
    ) {

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


/* =========================================================
   INITIALIZE
========================================================= */

async function initialize() {

  if (
    typeof window.BinanceExchange !==
    "function"
  ) {

    console.error(
      "BinanceExchange unavailable."
    );

    setStatus(
      "Futures exchange module error",
      "error"
    );

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

  updateTradeTableHeaders();

  await changePair();

  /*
   * Refresh Futures ticker every 10 seconds.
   */

  setInterval(
    loadTicker,
    10000
  );

}


initialize();
