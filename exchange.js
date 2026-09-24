/*
 * ALPHA TRACKER
 * Binance USDⓈ-M Futures exchange layer
 *
 * Historical flow:
 *   Buy Taker  = kline taker-buy base volume
 *   Buy Maker  = total volume - taker-buy volume
 *   Flow       = Buy Taker - Buy Maker
 *
 * Live flow:
 *   Binance Futures aggTrade WebSocket
 */

export class BinanceFuturesExchange {

  constructor(symbol = "BTCUSDT") {
    this.symbol = String(symbol).toUpperCase();

    this.restBase = "https://fapi.binance.com/fapi/v1";
    this.websocketBase = "wss://fstream.binance.com/ws";

    this.tradeCallback = null;
    this.connectionCallback = null;

    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.manualDisconnect = false;

    this.futuresSymbols = null;
  }

  onTrade(callback) {
    this.tradeCallback =
      typeof callback === "function" ? callback : null;
  }

  onConnection(callback) {
    this.connectionCallback =
      typeof callback === "function" ? callback : null;
  }

  getSymbol() {
    return this.symbol;
  }

  setSymbol(symbol) {
    this.symbol = String(symbol).toUpperCase();
  }

  emitConnection(status) {
    if (this.connectionCallback) {
      this.connectionCallback(status);
    }
  }

  async request(path, params = {}, retryCount = 0) {

    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {
        query.set(key, String(value));
      }
    }

    const queryString = query.toString();

    const url = queryString
      ? `${this.restBase}${path}?${queryString}`
      : `${this.restBase}${path}`;

    let response;

    try {
      response = await fetch(url);
    } catch {
      throw new Error(
        "Unable to connect to Binance Futures API"
      );
    }

    if (response.status === 429) {

      if (retryCount >= 5) {
        throw new Error(
          "Binance Futures rate limit reached. Please wait and try again."
        );
      }

      const retryAfter =
        Number(response.headers.get("Retry-After"));

      const delay =
        Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 3000;

      await new Promise(resolve =>
        setTimeout(resolve, delay)
      );

      return this.request(
        path,
        params,
        retryCount + 1
      );
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Binance Futures returned invalid data: HTTP ${response.status}`
      );
    }

    if (!response.ok) {
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

  /* =====================================================
     SYMBOLS
  ===================================================== */

  async getExchangeInfo() {

    if (Array.isArray(this.futuresSymbols)) {
      return this.futuresSymbols;
    }

    const data =
      await this.request("/exchangeInfo");

    this.futuresSymbols =
      Array.isArray(data.symbols)
        ? data.symbols
            .filter(item =>
              item.status === "TRADING"
            )
            .map(item =>
              item.symbol.toUpperCase()
            )
        : [];

    return this.futuresSymbols;
  }

  async resolveSymbol(input) {

    const entered =
      String(input || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!entered) {
      throw new Error(
        "Enter a Futures symbol"
      );
    }

    const symbols =
      await this.getExchangeInfo();

    if (symbols.includes(entered)) {
      return entered;
    }

    const candidates = [
      `${entered}USDT`,
      `${entered}USDC`,
      `${entered}BUSD`
    ];

    const found =
      candidates.find(symbol =>
        symbols.includes(symbol)
      );

    if (found) {
      return found;
    }

    throw new Error(
      `${entered} is not a currently trading Binance USDⓈ-M Futures pair`
    );
  }

  /* =====================================================
     TICKER
  ===================================================== */

  async get24hTicker(symbol) {

    return this.request(
      "/ticker/24hr",
      {
        symbol:
          String(symbol).toUpperCase()
      }
    );
  }

  /* =====================================================
     ORDER BOOK
  ===================================================== */

  async getOrderBook(symbol, limit = 1000) {

    return this.request(
      "/depth",
      {
        symbol:
          String(symbol).toUpperCase(),

        limit
      }
    );
  }

  /* =====================================================
     HISTORICAL FLOW
  ===================================================== */

  async getHistoricalFlowSeries(
    symbol,
    startTime,
    endTime,
    interval = "5m",
    progressCallback = null
  ) {

    const candles = [];

    const normalizedSymbol =
      String(symbol).toUpperCase();

    const intervalMilliseconds =
      this.getKlineIntervalMilliseconds(interval);

    let currentStart = startTime;
    let requestNumber = 0;
    let safetyCounter = 0;

    const maxRequests = 10000;

    while (
      currentStart <= endTime &&
      safetyCounter < maxRequests
    ) {

      safetyCounter++;

      const batch =
        await this.request(
          "/klines",
          {
            symbol: normalizedSymbol,
            interval,
            startTime: currentStart,
            endTime,
            limit: 1500
          }
        );

      requestNumber++;

      if (typeof progressCallback === "function") {
        progressCallback(
          requestNumber,
          batch?.length || 0
        );
      }

      if (
        !Array.isArray(batch) ||
        !batch.length
      ) {
        break;
      }

      let lastOpenTime = null;

      for (const raw of batch) {

        if (
          !Array.isArray(raw) ||
          raw.length < 10
        ) {
          continue;
        }

        const openTime = Number(raw[0]);
        const open = Number(raw[1]);
        const high = Number(raw[2]);
        const low = Number(raw[3]);
        const close = Number(raw[4]);
        const volume = Number(raw[5]);
        const closeTime = Number(raw[6]);
        const tradeCount = Number(raw[8]);
        const takerBuyVolume = Number(raw[9]);

        if (!Number.isFinite(openTime)) {
          continue;
        }

        lastOpenTime = openTime;

        if (
          openTime < startTime ||
          openTime > endTime
        ) {
          continue;
        }

        if (
          !Number.isFinite(volume) ||
          !Number.isFinite(takerBuyVolume)
        ) {
          continue;
        }

        const buyTaker =
          Math.min(
            Math.max(0, takerBuyVolume),
            Math.max(0, volume)
          );

        const buyMaker =
          Math.max(
            0,
            volume - buyTaker
          );

        const flow =
          buyTaker - buyMaker;

        candles.push({
          time: openTime,

          closeTime:
            Number.isFinite(closeTime)
              ? closeTime
              : (
                  openTime +
                  intervalMilliseconds -
                  1
                ),

          open:
            Number.isFinite(open)
              ? open
              : null,

          high:
            Number.isFinite(high)
              ? high
              : null,

          low:
            Number.isFinite(low)
              ? low
              : null,

          close:
            Number.isFinite(close)
              ? close
              : null,

          volume,
          buyTaker,
          buyMaker,
          flow,

          trades:
            Number.isFinite(tradeCount)
              ? tradeCount
              : 0
        });
      }

      if (
        Number.isFinite(lastOpenTime) &&
        lastOpenTime >= endTime
      ) {
        break;
      }

      if (batch.length < 1500) {
        break;
      }

      if (!Number.isFinite(lastOpenTime)) {
        break;
      }

      const nextStart =
        lastOpenTime +
        intervalMilliseconds;

      if (nextStart <= currentStart) {
        break;
      }

      currentStart = nextStart;
    }

    const unique = new Map();

    for (const candle of candles) {
      unique.set(candle.time, candle);
    }

    return Array.from(unique.values()).sort(
      (a, b) => a.time - b.time
    );
  }

  getKlineIntervalMilliseconds(interval) {

    const value =
      String(interval || "")
        .trim()
        .toLowerCase();

    const match =
      value.match(/^(\d+)([smhdw])$/);

    if (!match) {
      throw new Error(
        `Unsupported Futures kline interval: ${interval}`
      );
    }

    const amount = Number(match[1]);
    const unit = match[2];

    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000
    };

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !multipliers[unit]
    ) {
      throw new Error(
        `Invalid Futures kline interval: ${interval}`
      );
    }

    return amount * multipliers[unit];
  }

  /* =====================================================
     LIVE AGG TRADE
  ===================================================== */

  normalizeAggregateTrade(raw) {

    if (!raw) {
      return null;
    }

    const price = Number(raw.p);
    const quantity = Number(raw.q);
    const time = Number(raw.T);

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

  connectTradeStream(symbol) {

    this.disconnectTradeStream(false);

    this.symbol =
      String(symbol).toUpperCase();

    this.manualDisconnect = false;
    this.reconnectAttempts = 0;

    this.openTradeSocket();
  }

  openTradeSocket() {

    if (this.manualDisconnect) {
      return;
    }

    const symbol =
      this.symbol.toLowerCase();

    const url =
      `${this.websocketBase}/${symbol}@aggTrade`;

    try {
      this.socket =
        new WebSocket(url);
    } catch (error) {

      console.error(
        "Futures WebSocket creation error:",
        error
      );

      this.emitConnection("error");
      this.scheduleReconnect();

      return;
    }

    const socket = this.socket;

    socket.onopen = () => {

      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempts = 0;
      this.emitConnection("connected");
    };

    socket.onmessage = event => {

      if (this.socket !== socket) {
        return;
      }

      try {

        const raw =
          JSON.parse(event.data);

        const trade =
          this.normalizeAggregateTrade(raw);

        if (
          trade &&
          this.tradeCallback
        ) {
          this.tradeCallback(trade);
        }

      } catch (error) {
        console.error(
          "Futures trade message error:",
          error
        );
      }
    };

    socket.onerror = error => {

      if (this.socket !== socket) {
        return;
      }

      console.error(
        "Futures WebSocket error:",
        error
      );

      this.emitConnection("error");
    };

    socket.onclose = () => {

      if (this.socket !== socket) {
        return;
      }

      this.socket = null;

      if (!this.manualDisconnect) {

        this.emitConnection(
          "disconnected"
        );

        this.scheduleReconnect();
      }
    };
  }

  scheduleReconnect() {

    if (
      this.manualDisconnect ||
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
      setTimeout(() => {

        this.reconnectTimer = null;

        this.openTradeSocket();

      }, delay);
  }

  disconnectTradeStream(manual = true) {

    this.manualDisconnect = manual;

    if (this.reconnectTimer) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }

    const socket = this.socket;

    this.socket = null;

    if (socket) {

      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      try {
        socket.close();
      } catch {}
    }
  }
        }
