"use strict";

/*
 * ALPHA TRACKER
 * Binance USDⓈ-M Futures Only
 *
 * Historical inspection:
 * - Processes Futures aggTrades in batches
 * - Aggregates immediately by price bucket
 * - Does NOT retain the entire historical trade set
 * - Buy Taker = Binance m:false
 * - Buy Maker = Binance m:true
 *   (buyer is maker / seller is taker)
 */


/* =========================================================
   BINANCE FUTURES EXCHANGE
========================================================= */

class BinanceFuturesExchange {

  constructor(symbol = "BTCUSDT") {

    this.symbol =
      String(symbol).toUpperCase();

    this.restBase =
      "https://fapi.binance.com/fapi/v1";

    this.websocketBase =
      "wss://fstream.binance.com/ws";

    this.tradeCallback =
      null;

    this.connectionCallback =
      null;

    this.socket =
      null;

    this.reconnectTimer =
      null;

    this.reconnectAttempts =
      0;

    this.manualDisconnect =
      false;

    this.futuresSymbols =
      null;

  }


  onTrade(callback) {

    this.tradeCallback =
      typeof callback === "function"
        ? callback
        : null;

  }


  onConnection(callback) {

    this.connectionCallback =
      typeof callback === "function"
        ? callback
        : null;

  }


  getSymbol() {

    return this.symbol;

  }


  setSymbol(symbol) {

    this.symbol =
      String(symbol).toUpperCase();

  }


  emitConnection(status) {

    if (
      this.connectionCallback
    ) {

      this.connectionCallback(
        status
      );

    }

  }


  async request(
    path,
    params = {},
    retryCount = 0
  ) {

    const query =
      new URLSearchParams();

    Object.entries(
      params
    ).forEach(
      ([key, value]) => {

        if (
          value !== undefined &&
          value !== null &&
          value !== ""
        ) {

          query.set(
            key,
            String(value)
          );

        }

      }
    );

    const url =
      `${this.restBase}${path}?${query.toString()}`;

    let response;

    try {

      response =
        await fetch(
          url
        );

    } catch (
      error
    ) {

      throw new Error(
        "Unable to connect to Binance Futures API"
      );

    }

    /*
     * Binance rate-limit protection.
     *
     * If Binance returns 429, wait and retry.
     */

    if (
      response.status === 429
    ) {

      if (
        retryCount >= 5
      ) {

        throw new Error(
          "Binance Futures rate limit reached. Please wait and try again."
        );

      }

      const retryAfter =
        Number(
          response.headers.get(
            "Retry-After"
          )
        );

      const delay =
        Number.isFinite(
          retryAfter
        )
          ? retryAfter * 1000
          : 3000;

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            delay
          )
      );

      return this.request(
        path,
        params,
        retryCount + 1
      );

    }

    let data;

    try {

      data =
        await response.json();

    } catch {

      throw new Error(
        `Binance Futures returned invalid data: HTTP ${response.status}`
      );

    }

    if (
      !response.ok
    ) {

      throw new Error(
        data?.msg ||
        `Binance Futures HTTP error ${response.status}`
      );

    }

    if (
      data &&
      typeof data.code === "number" &&
      data.code < 0
    ) {

      throw new Error(
        data.msg ||
        "Binance Futures API error"
      );

    }

    return data;

  }


  /* =======================================================
     FUTURES SYMBOLS
  ======================================================= */

  async getExchangeInfo() {

    if (
      Array.isArray(
        this.futuresSymbols
      )
    ) {

      return this.futuresSymbols;

    }

    const data =
      await this.request(
        "/exchangeInfo"
      );

    this.futuresSymbols =
      Array.isArray(
        data.symbols
      )
        ? data.symbols
            .filter(
              item =>
                item.status === "TRADING"
            )
            .map(
              item =>
                item.symbol.toUpperCase()
            )
        : [];

    return this.futuresSymbols;

  }


  async resolveSymbol(input) {

    const entered =
      String(input || "")
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ""
        );

    if (
      !entered
    ) {

      throw new Error(
        "Enter a Futures symbol"
      );

    }

    const symbols =
      await this.getExchangeInfo();

    if (
      symbols.includes(
        entered
      )
    ) {

      return entered;

    }

    const candidates = [

      `${entered}USDT`,

      `${entered}USDC`,

      `${entered}BUSD`

    ];

    const found =
      candidates.find(
        symbol =>
          symbols.includes(
            symbol
          )
      );

    if (
      found
    ) {

      return found;

    }

    throw new Error(
      `${entered} is not a currently trading Binance USDⓈ-M Futures pair`
    );

  }


  /* =======================================================
     TICKER
  ======================================================= */

  async get24hTicker(symbol) {

    return this.request(
      "/ticker/24hr",
      {
        symbol:
          String(symbol).toUpperCase()
      }
    );

  }


  /* =======================================================
     ORDER BOOK
  ======================================================= */

  async getOrderBook(
    symbol,
    limit = 1000
  ) {

    return this.request(
      "/depth",
      {
        symbol:
          String(symbol).toUpperCase(),

        limit
      }
    );

  }


  /* =======================================================
     HISTORICAL AGGREGATE TRADES
     
     IMPORTANT:
     
     This function now returns PRICE-BUCKET
     AGGREGATES rather than retaining every trade.
     
     The aggregation is performed while the
     Binance batches are being downloaded.
  ======================================================= */

  async getHistoricalTradeBuckets(
    symbol,
    startTime,
    endTime,
    bucketSize,
    progressCallback = null
  ) {

    const groups =
      new Map();

    let fromId =
      null;

    let requests =
      0;

    let finished =
      false;

    let lastProcessedId =
      null;

    const normalizedSymbol =
      String(symbol).toUpperCase();

    /*
     * First request uses the requested
     * time range.
     *
     * Subsequent requests use fromId
     * to continue through the range.
     */

    while (
      !finished
    ) {

      const params = {

        symbol:
          normalizedSymbol,

        limit:
          1000

      };

      if (
        fromId === null
      ) {

        params.startTime =
          startTime;

        params.endTime =
          endTime;

      } else {

        params.fromId =
          fromId;

      }

      const batch =
        await this.request(
          "/aggTrades",
          params
        );

      requests++;

      if (
        typeof progressCallback ===
        "function"
      ) {

        progressCallback(
          requests,
          batch?.length || 0
        );

      }

      if (
        !Array.isArray(batch) ||
        !batch.length
      ) {

        break;

      }

      let reachedEnd =
        false;

      let newestTime =
        0;

      let newestId =
        null;

      for (
        const raw of batch
      ) {

        const price =
          Number(
            raw.p
          );

        const quantity =
          Number(
            raw.q
          );

        const time =
          Number(
            raw.T
          );

        const tradeId =
          Number(
            raw.a
          );

        const buyerIsMaker =
          raw.m === true ||
          raw.m === "true";

        if (
          !Number.isFinite(price) ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(time)
        ) {

          continue;

        }

        if (
          Number.isFinite(
            tradeId
          )
        ) {

          newestId =
            tradeId;

        }

        if (
          time > newestTime
        ) {

          newestTime =
            time;

        }

        /*
         * Ignore anything before the requested
         * starting timestamp.
         */

        if (
          time < startTime
        ) {

          continue;

        }

        /*
         * Once we reach the requested end,
         * don't add trades after it.
         */

        if (
          time > endTime
        ) {

          reachedEnd =
            true;

          continue;

        }

        /*
         * PRICE BUCKET
         */

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
          !groups.has(
            key
          )
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

        /*
         * Binance aggregate trade:
         *
         * m:false
         * Buyer is TAKer.
         *
         * Therefore:
         * BUY TAKER
         */

        if (
          !buyerIsMaker
        ) {

          group.buyTaker +=
            quantity;

        }

        /*
         * Binance:
         *
         * m:true
         * Buyer is MAKER.
         *
         * Therefore seller is TAKER.
         *
         * In your framework this is:
         *
         * BUY MAKER
         */

        else {

          group.buyMaker +=
            quantity;

        }

        /*
         * Your requested flow:
         *
         * Buy Taker - Buy Maker
         */

        group.flow =
          group.buyTaker -
          group.buyMaker;

      }

      /*
       * If the batch has reached the requested
       * end timestamp, we are finished.
       */

      if (
        reachedEnd ||
        newestTime >= endTime
      ) {

        finished =
          true;

        break;

      }

      /*
       * Continue from the last aggregate
       * trade ID.
       */

      const lastRaw =
        batch[
          batch.length - 1
        ];

      const lastBatchId =
        Number(
          lastRaw?.a
        );

      if (
        !Number.isFinite(
          lastBatchId
        )
      ) {

        break;

      }

      /*
       * Protection against accidentally
       * requesting the same batch repeatedly.
       */

      if (
        lastProcessedId !== null &&
        lastBatchId <=
          lastProcessedId
      ) {

        break;

      }

      lastProcessedId =
        lastBatchId;

      fromId =
        lastBatchId + 1;

      /*
       * A short pause prevents a long historical
       * request from hammering the API.
       */

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            50
          )
      );

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


  /* =======================================================
     LIVE TRADE NORMALIZATION
  ======================================================= */

  normalizeAggregateTrade(raw) {

    if (
      !raw
    ) {

      return null;

    }

    const price =
      Number(
        raw.p
      );

    const quantity =
      Number(
        raw.q
      );

    const time =
      Number(
        raw.T
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
        Number.isFinite(time)
          ? time
          : Date.now(),

      buyerIsMaker,

      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy"

    };

  }


  /* =======================================================
     LIVE WEBSOCKET
  ======================================================= */

  connectTradeStream(symbol) {

    this.disconnectTradeStream(
      false
    );

    this.symbol =
      String(symbol).toUpperCase();

    this.manualDisconnect =
      false;

    this.reconnectAttempts =
      0;

    this.openTradeSocket();

  }


  openTradeSocket() {

    if (
      this.manualDisconnect
    ) {

      return;

    }

    const symbol =
      this.symbol.toLowerCase();

    const url =
      `${this.websocketBase}/${symbol}@aggTrade`;

    try {

      this.socket =
        new WebSocket(
          url
        );

    } catch (
      error
    ) {

      console.error(
        "Futures WebSocket creation error:",
        error
      );

      this.emitConnection(
        "error"
      );

      this.scheduleReconnect();

      return;

    }

    this.socket.onopen =
      () => {

        this.reconnectAttempts =
          0;

        this.emitConnection(
          "connected"
        );

      };


    this.socket.onmessage =
      event => {

        try {

          const raw =
            JSON.parse(
              event.data
            );

          const trade =
            this.normalizeAggregateTrade(
              raw
            );

          if (
            trade &&
            this.tradeCallback
          ) {

            this.tradeCallback(
              trade
            );

          }

        } catch (
          error
        ) {

          console.error(
            "Futures trade message error:",
            error
          );

        }

      };


    this.socket.onerror =
      error => {

        console.error(
          "Futures WebSocket error:",
          error
        );

        this.emitConnection(
          "error"
        );

      };


    this.socket.onclose =
      () => {

        this.socket =
          null;

        if (
          !this.manualDisconnect
        ) {

          this.emitConnection(
            "disconnected"
          );

          this.scheduleReconnect();

        }

      };

  }


  scheduleReconnect() {

    if (
      this.manualDisconnect
    ) {

      return;

    }

    if (
      this.reconnectTimer
    ) {

      return;

    }

    this.reconnectAttempts++;

    const delay =
      Math.min(
        30000,
        1000 *
        Math.pow(
          2,
          Math.min(
            this.reconnectAttempts,
            5
          )
        )
      );

    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer =
            null;

          this.openTradeSocket();

        },
        delay
      );

  }


  disconnectTradeStream(
    manual = true
  ) {

    this.manualDisconnect =
      manual;

    if (
      this.reconnectTimer
    ) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer =
        null;

    }

    if (
      this.socket
    ) {

      this.socket.onclose =
        null;

      this.socket.close();

      this.socket =
        null;

    }

  }

}


/* =========================================================
   STATE
========================================================= */

const state = {

  symbol:
    "BTCUSDT",

  exchange:
    null,

  liveTrades:
    0,

  liveBuyVolume:
    0,

  liveSellVolume:
    0,

  liveFlow:
    0,

  lastTradePrice:
    null,

  lastTradeTime:
    null,

  tradeHistory:
    [],

  symbolResolving:
    false

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

        minimumFractionDigits:
          2,

        maximumFractionDigits:
          2

      }
    );

  }

  if (
    number >= 1
  ) {

    return number.toFixed(
      4
    );

  }

  if (
    number >= 0.01
  ) {

    return number.toFixed(
      6
    );

  }

  return number.toFixed(
    8
  );

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
    Math.abs(number) >=
    1000000
  ) {

    return (
      number / 1000000
    ).toFixed(2) + "M";

  }

  if (
    Math.abs(number) >=
    1000
  ) {

    return (
      number / 1000
    ).toFixed(2) + "K";

  }

  return number.toFixed(
    4
  );

}


function normalizeSymbol(value) {

  return String(
    value || ""
  )
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
   TICKER
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

  } catch (
    error
  ) {

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

  /*
   * Keep only the recent live stream.
   * This does NOT affect historical inspection.
   */

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
   TIME HELPERS
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

  if (
    /^\d+$/.test(
      value
    )
  ) {

    const number =
      Number(
        value
      );

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
   HISTORICAL INSPECTION
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
    "Loading Futures trades...";

  try {

    const {
      start,
      end
    } =
      getInspectionWindow();

    const bucketSize =
      getBucketSize();

    /*
     * The exchange now performs the aggregation
     * while downloading the historical batches.
     */

    const groups =
      await state.exchange.getHistoricalTradeBuckets(
        state.symbol,
        start,
        end,
        bucketSize,
        (
          requestNumber,
          batchSize
        ) => {

          els.inspectTradesBtn.textContent =
            `Loading Futures... ${requestNumber} batches`;

          console.log(
            "Historical Futures batch:",
            requestNumber,
            batchSize
          );

        }
      );

    renderTradeTable(
      groups
    );

  } catch (
    error
  ) {

    console.error(
      "Futures historical trade error:",
      error
    );

    if (
      els.tradeTableBody
    ) {

      els.tradeTableBody.innerHTML = `
        <tr>
          <td colspan="6">
            ${error.message ||
              "Unable to load Futures historical trades"}
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
   TRADE TABLE
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
   ORDER BOOK TOTALS
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
    typeof level === "object"
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
   ORDER BOOK ZONES
========================================================= */

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
      side === "asks"
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
        side === "asks"
      ) {

        inside =
          price >= zone.lower &&
          price < zone.upper;

      } else {

        inside =
          price > zone.lower &&
          price <= zone.upper;

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


function formatOrderBookZone(
  zone
) {

  return `${formatPrice(
    zone.lower
  )} - ${formatPrice(
    zone.upper
  )}`;

}


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
   LOAD ORDER BOOK
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

  } catch (
    error
  ) {

    console.error(
      "Futures order-book error:",
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
   CONNECTION STATUS
========================================================= */

function handleConnection(
  status
) {

  if (
    status === "connected"
  ) {

    setStatus(
      "Binance Futures trade stream live",
      "connected"
    );

    return;

  }

  if (
    status === "error"
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
   CLEAR TABLES
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
   CHANGE PAIR
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

    const symbol =
      await state.exchange.resolveSymbol(
        entered
      );

    const oldSymbol =
      state.exchange.getSymbol();

    const symbolChanged =
      oldSymbol !== symbol;

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

    await loadOrderBook();

  } catch (
    error
  ) {

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
      event.key === "Enter"
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

  updateTradeTableHeaders();

  await changePair();

  setInterval(
    loadTicker,
    10000
  );

}


initialize();


/* =========================================================
   DEBUG ACCESS
========================================================= */

window.BinanceFuturesExchange =
  BinanceFuturesExchange;
