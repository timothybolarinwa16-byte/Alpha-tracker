"use strict";

/*
 * ALPHA TRACKER
 * Binance Exchange Layer
 *
 * Responsibilities:
 * - Fetch Binance public market data
 * - Connect to real-time aggregate trades
 * - Normalize Binance trade data
 * - Provide order-book snapshots
 * - Manage WebSocket reconnects safely
 */


/* =========================================================
   BINANCE ENDPOINTS
   ========================================================= */

const BINANCE_REST =
  "https://data-api.binance.vision/api/v3";

const BINANCE_WS =
  "wss://stream.binance.com:9443/ws";


/* =========================================================
   EXCHANGE CLIENT
   ========================================================= */

class BinanceExchange {

  constructor(symbol = null) {

    this.symbol = null;

    this.tradeSocket = null;

    this.tradeListeners = [];

    this.connectionListeners = [];

    this.reconnectTimer = null;

    this.reconnectAttempts = 0;

    this.maxReconnectDelay = 10000;

    this.connected = false;

    /*
     * Used to distinguish an intentional socket
     * shutdown from an unexpected disconnect.
     */
    this.intentionalDisconnect = false;

    if (symbol) {
      this.setSymbol(symbol);
    }
  }


  /* =======================================================
     SYMBOL
     ======================================================= */

  setSymbol(symbol) {

    const normalized =
      String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new Error("Invalid symbol");
    }

    this.symbol = normalized;
  }


  getSymbol() {

    return this.symbol;
  }


  /* =======================================================
     REST REQUEST
     ======================================================= */

  async request(endpoint) {

    const response =
      await fetch(
        `${BINANCE_REST}${endpoint}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );

    if (!response.ok) {

      let message =
        `Binance HTTP ${response.status}`;

      try {

        const error =
          await response.json();

        if (error && error.msg) {
          message = error.msg;
        }

      } catch (_) {
        // Keep default message.
      }

      throw new Error(message);
    }

    return response.json();
  }


  /* =======================================================
     24H TICKER
     ======================================================= */

  async get24hTicker(symbol = this.symbol) {

    if (!symbol) {
      throw new Error("No symbol selected");
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase();

    return this.request(
      `/ticker/24hr?symbol=${encodeURIComponent(normalized)}`
    );
  }


  /* =======================================================
     ORDER BOOK SNAPSHOT
     ======================================================= */

  async getOrderBook(
    symbol = this.symbol,
    limit = 100
  ) {

    if (!symbol) {
      throw new Error("No symbol selected");
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase();

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 100,
          5
        ),
        5000
      );

    const raw =
      await this.request(
        `/depth?symbol=${encodeURIComponent(normalized)}&limit=${safeLimit}`
      );

    return {

      lastUpdateId:
        raw.lastUpdateId,

      bids:
        Array.isArray(raw.bids)
          ? raw.bids.map(level => ({
              price: Number(level[0]),
              quantity: Number(level[1])
            }))
          : [],

      asks:
        Array.isArray(raw.asks)
          ? raw.asks.map(level => ({
              price: Number(level[0]),
              quantity: Number(level[1])
            }))
          : []
    };
  }


  /* =======================================================
     RECENT AGGREGATE TRADES
     ======================================================= */

  async getRecentTrades(
    symbol = this.symbol,
    limit = 1000
  ) {

    if (!symbol) {
      throw new Error("No symbol selected");
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase();

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 1000,
          1
        ),
        1000
      );

    const raw =
      await this.request(
        `/aggTrades?symbol=${encodeURIComponent(normalized)}&limit=${safeLimit}`
      );

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map(
      trade =>
        this.normalizeAggregateTrade(trade)
    );
  }


  /* =======================================================
     NORMALIZE AGGREGATE TRADE
     ======================================================= */

  normalizeAggregateTrade(trade) {

    if (!trade) {
      return null;
    }

    const price =
      Number(trade.p);

    const quantity =
      Number(trade.q);

    const time =
      Number(trade.T);

    const buyerIsMaker =
      trade.m === true;

    return {

      id:
        Number(trade.a),

      time,

      price,

      quantity,

      value:
        price * quantity,

      buyerIsMaker,

      /*
       * Binance:
       *
       * m = true
       * buyer is maker
       * seller is aggressive/taker
       *
       * m = false
       * seller is maker
       * buyer is aggressive/taker
       */

      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy",

      aggressiveBuy:
        buyerIsMaker
          ? 0
          : quantity,

      aggressiveSell:
        buyerIsMaker
          ? quantity
          : 0
    };
  }


  /* =======================================================
     TRADE LISTENERS
     ======================================================= */

  onTrade(callback) {

    if (
      typeof callback !==
      "function"
    ) {
      return;
    }

    this.tradeListeners.push(
      callback
    );
  }


  removeTradeListener(callback) {

    this.tradeListeners =
      this.tradeListeners.filter(
        listener =>
          listener !== callback
      );
  }


  emitTrade(trade) {

    if (!trade) {
      return;
    }

    for (
      const listener of
      this.tradeListeners
    ) {

      try {

        listener(trade);

      } catch (error) {

        console.error(
          "Trade listener error:",
          error
        );

      }
    }
  }


  /* =======================================================
     CONNECTION LISTENERS
     ======================================================= */

  onConnection(callback) {

    if (
      typeof callback !==
      "function"
    ) {
      return;
    }

    this.connectionListeners.push(
      callback
    );
  }


  /*
   * Backward-compatible alias.
   */

  onConnectionChange(callback) {

    this.onConnection(callback);
  }


  removeConnectionListener(callback) {

    this.connectionListeners =
      this.connectionListeners.filter(
        listener =>
          listener !== callback
      );
  }


  emitConnection(status) {

    this.connected =
      status === "connected";

    for (
      const listener of
      this.connectionListeners
    ) {

      try {

        listener(status);

      } catch (error) {

        console.error(
          "Connection listener error:",
          error
        );

      }
    }
  }


  /* =======================================================
     AGGREGATE TRADE WEBSOCKET
     ======================================================= */

  connectTradeStream(
    symbol = this.symbol
  ) {

    if (!symbol) {
      throw new Error(
        "No symbol selected"
      );
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new Error(
        "Invalid symbol"
      );
    }

    /*
     * Cancel any pending reconnect.
     */
    if (this.reconnectTimer) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }

    /*
     * Close an existing socket without
     * allowing its close event to start
     * another reconnect cycle.
     */
    if (this.tradeSocket) {

      this.intentionalDisconnect =
        true;

      try {
        this.tradeSocket.close();
      } catch (_) {
        // Ignore closed socket.
      }

      this.tradeSocket = null;
    }

    this.setSymbol(normalized);

    this.intentionalDisconnect =
      false;

    const streamSymbol =
      this.symbol.toLowerCase();

    const url =
      `${BINANCE_WS}/${streamSymbol}@aggTrade`;

    console.log(
      `Connecting trade stream: ${url}`
    );

    try {

      const socket =
        new WebSocket(url);

      this.tradeSocket =
        socket;

      socket.onopen =
        () => {

          /*
           * Ignore an old socket that somehow
           * opened after a replacement socket
           * was created.
           */
          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          console.log(
            `Trade stream connected: ${this.symbol}`
          );

          this.reconnectAttempts =
            0;

          this.emitConnection(
            "connected"
          );
        };


      socket.onmessage =
        event => {

          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          try {

            const raw =
              JSON.parse(event.data);

            const trade =
              this.normalizeAggregateTrade(
                raw
              );

            this.emitTrade(trade);

          } catch (error) {

            console.error(
              "Trade message error:",
              error
            );

          }
        };


      socket.onerror =
        error => {

          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          console.error(
            "Trade WebSocket error:",
            error
          );

          this.emitConnection(
            "error"
          );
        };


      socket.onclose =
        () => {

          /*
           * If this isn't the current socket,
           * it was already replaced intentionally.
           */
          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          this.tradeSocket =
            null;

          console.log(
            `Trade stream closed: ${this.symbol}`
          );

          this.emitConnection(
            "disconnected"
          );

          if (
            !this.intentionalDisconnect &&
            this.symbol
          ) {

            this.scheduleReconnect();
          }
        };

    } catch (error) {

      console.error(
        "WebSocket creation failed:",
        error
      );

      this.emitConnection(
        "error"
      );

      this.scheduleReconnect();
    }
  }


  /* =======================================================
     RECONNECT
     ======================================================= */

  scheduleReconnect() {

    if (
      this.reconnectTimer ||
      !this.symbol
    ) {
      return;
    }

    const delay =
      Math.min(
        1000 *
          Math.pow(
            2,
            this.reconnectAttempts
          ),
        this.maxReconnectDelay
      );

    this.reconnectAttempts++;

    console.log(
      `Reconnecting trade stream in ${delay}ms`
    );

    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer =
            null;

          if (this.symbol) {

            this.connectTradeStream(
              this.symbol
            );
          }

        },
        delay
      );
  }


  /* =======================================================
     DISCONNECT
     ======================================================= */

  disconnectTradeStream(
    allowReconnect = false
  ) {

    if (this.reconnectTimer) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }

    const socket =
      this.tradeSocket;

    this.intentionalDisconnect =
      true;

    this.tradeSocket =
      null;

    if (socket) {

      try {
        socket.close();
      } catch (_) {
        // Ignore closed socket.
      }
    }

    this.connected =
      false;

    if (allowReconnect) {

      this.intentionalDisconnect =
        false;

      if (this.symbol) {
        this.scheduleReconnect();
      }

    }
  }


  /* =======================================================
     CHANGE SYMBOL
     ======================================================= */

  changeSymbol(symbol) {

    const normalized =
      String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new Error(
        "Invalid symbol"
      );
    }

    this.disconnectTradeStream(
      false
    );

    this.setSymbol(
      normalized
    );

    this.connectTradeStream(
      normalized
    );
  }
}


/* =========================================================
   GLOBAL EXPORT
   ========================================================= */

window.BinanceExchange =
  BinanceExchange;
