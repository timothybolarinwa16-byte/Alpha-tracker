const REST_BASE = "https://fapi.binance.com/fapi/v1";

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function requestJson(url) {
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      "Unable to connect to Binance Futures API."
    );
  }

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(
      `Binance Futures returned invalid data. HTTP ${response.status}`
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
      "Binance Futures API error."
    );
  }

  return data;
}


/* =========================================================
   SYMBOL RESOLUTION
========================================================= */

async function resolveSymbol(symbol) {
  const entered =
    normalizeSymbol(symbol);

  if (!entered) {
    throw new Error(
      "Enter a Futures symbol."
    );
  }

  const data =
    await requestJson(
      `${REST_BASE}/exchangeInfo`
    );

  const symbols =
    Array.isArray(data.symbols)
      ? data.symbols
      : [];

  /*
   * First check whether the user entered
   * a complete Binance Futures symbol.
   *
   * BTCUSDT -> BTCUSDT
   * ETHUSDT -> ETHUSDT
   */
  const exact =
    symbols.find(
      item =>
        item.symbol === entered &&
        item.status === "TRADING" &&
        item.contractType === "PERPETUAL"
    );

  if (exact) {
    return exact.symbol;
  }

  /*
   * If only the asset was entered,
   * automatically try the common
   * USDⓈ-M quote currencies.
   *
   * BTC -> BTCUSDT
   * ETH -> ETHUSDT
   * SOL -> SOLUSDT
   */
  const candidates = [
    `${entered}USDT`,
    `${entered}USDC`,
    `${entered}BUSD`
  ];

  const resolved =
    symbols.find(
      item =>
        candidates.includes(item.symbol) &&
        item.status === "TRADING" &&
        item.contractType === "PERPETUAL"
    );

  if (resolved) {
    return resolved.symbol;
  }

  throw new Error(
    `${entered} is not a currently trading Binance USDⓈ-M Futures pair.`
  );
}


/* =========================================================
   24H TICKER
========================================================= */

async function get24hTicker(symbol) {
  const normalized =
    normalizeSymbol(symbol);

  if (!normalized) {
    throw new Error(
      "Invalid Futures symbol."
    );
  }

  const url =
    `${REST_BASE}/ticker/24hr` +
    `?symbol=${encodeURIComponent(normalized)}`;

  const data =
    await requestJson(url);

  return {
    symbol: data.symbol,

    price:
      Number(data.lastPrice),

    priceChange:
      Number(data.priceChangePercent),

    volume:
      Number(data.volume),

    trades:
      Number(data.count)
  };
}


/* =========================================================
   KLINE INTERVAL
========================================================= */

function getKlineIntervalMilliseconds(
  interval
) {
  const match =
    String(interval)
      .trim()
      .match(/^(\d+)([smhdwM])$/);

  if (!match) {
    throw new Error(
      `Unsupported kline interval: ${interval}`
    );
  }

  const amount =
    Number(match[1]);

  const unit =
    match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,

    /*
     * Binance monthly candles are not
     * used by Alpha Tracker currently,
     * but retaining the unit keeps the
     * helper general.
     */
    M: 30 * 24 * 60 * 60 * 1000
  };

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !multipliers[unit]
  ) {
    throw new Error(
      `Invalid kline interval: ${interval}`
    );
  }

  return (
    amount *
    multipliers[unit]
  );
}


/* =========================================================
   HISTORICAL KLINES
========================================================= */

async function getHistoricalKlines(
  symbol,
  startTime,
  endTime,
  interval = "5m"
) {
  const normalized =
    normalizeSymbol(symbol);

  if (!normalized) {
    throw new Error(
      "Invalid Futures symbol."
    );
  }

  const intervalMs =
    getKlineIntervalMilliseconds(
      interval
    );

  const start =
    Number(startTime);

  const end =
    Number(endTime);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    throw new Error(
      "Invalid analysis time range."
    );
  }

  if (start >= end) {
    throw new Error(
      "Start time must be before end time."
    );
  }

  const candles = [];

  let cursor = start;

  /*
   * Binance allows large kline batches.
   *
   * Keep a generous safety limit so a
   * long analysis window cannot create
   * an infinite request loop.
   */
  const maxLimit = 1500;
  const maxRequests = 10000;

  let requestCount = 0;

  while (
    cursor <= end &&
    requestCount < maxRequests
  ) {
    const url =
      `${REST_BASE}/klines` +
      `?symbol=${encodeURIComponent(normalized)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&startTime=${cursor}` +
      `&endTime=${end}` +
      `&limit=${maxLimit}`;

    const rows =
      await requestJson(url);

    requestCount++;

    if (
      !Array.isArray(rows) ||
      rows.length === 0
    ) {
      break;
    }

    let lastOpenTime =
      null;

    for (const raw of rows) {
      if (
        !Array.isArray(raw) ||
        raw.length < 10
      ) {
        continue;
      }

      const openTime =
        Number(raw[0]);

      if (
        !Number.isFinite(openTime)
      ) {
        continue;
      }

      lastOpenTime =
        openTime;

      if (
        openTime < start ||
        openTime > end
      ) {
        continue;
      }

      const open =
        Number(raw[1]);

      const high =
        Number(raw[2]);

      const low =
        Number(raw[3]);

      const close =
        Number(raw[4]);

      const volume =
        Math.max(
          0,
          Number(raw[5]) || 0
        );

      const closeTime =
        Number(raw[6]);

      const tradeCount =
        Math.max(
          0,
          Number(raw[8]) || 0
        );

      /*
       * Binance Futures kline field [9]
       * is taker-buy base volume.
       *
       * This is our Buy Taker volume.
       *
       * The remaining volume represents
       * passive buys, which is economically
       * equivalent to Sell Taker volume.
       *
       * Therefore:
       *
       * Buy Maker = Volume - Buy Taker
       * Buy Maker = Sell Taker
       */
      const takerBuyVolume =
        Math.max(
          0,
          Number(raw[9]) || 0
        );

      const buyTaker =
        Math.min(
          takerBuyVolume,
          volume
        );

      const buyMaker =
        Math.max(
          0,
          volume - buyTaker
        );

      candles.push({
        time:
          openTime,

        closeTime:
          Number.isFinite(closeTime)
            ? closeTime
            : (
                openTime +
                intervalMs -
                1
              ),

        open:
          Number.isFinite(open)
            ? open
            : 0,

        high:
          Number.isFinite(high)
            ? high
            : 0,

        low:
          Number.isFinite(low)
            ? low
            : 0,

        close:
          Number.isFinite(close)
            ? close
            : 0,

        volume,

        buyTaker,

        buyMaker,

        trades:
          tradeCount
      });
    }

    /*
     * We reached the requested end.
     */
    if (
      Number.isFinite(lastOpenTime) &&
      lastOpenTime >= end
    ) {
      break;
    }

    /*
     * Fewer than maxLimit means Binance
     * has no more candles in this request
     * range.
     */
    if (
      rows.length < maxLimit
    ) {
      break;
    }

    if (
      !Number.isFinite(lastOpenTime)
    ) {
      break;
    }

    const nextCursor =
      lastOpenTime +
      intervalMs;

    /*
     * Safety against a pagination loop.
     */
    if (
      nextCursor <= cursor
    ) {
      break;
    }

    cursor =
      nextCursor;
  }

  /*
   * Sort chronologically.
   */
  candles.sort(
    (a, b) =>
      a.time - b.time
  );

  /*
   * Remove duplicate candles that
   * could occur around pagination
   * boundaries.
   */
  const unique = [];

  let previousTime =
    null;

  for (const candle of candles) {
    if (
      candle.time === previousTime
    ) {
      continue;
    }

    unique.push(candle);

    previousTime =
      candle.time;
  }

  return unique;
}


/* =========================================================
   EXPORTS
========================================================= */

export {
  normalizeSymbol,
  resolveSymbol,
  get24hTicker,
  getHistoricalKlines,
  getKlineIntervalMilliseconds
};
