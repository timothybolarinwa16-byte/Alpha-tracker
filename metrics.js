function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
  return Math.max(0, safeNumber(value));
}

/*
 * Convert candles into a clean internal observation series.
 *
 * The first observation cannot produce a temporal density because
 * there is no previous timestamp to measure elapsed time against.
 */
function buildTemporalObservations(candles, volumeKey) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return [];
  }

  const observations = [];

  for (let i = 1; i < candles.length; i++) {
    const previous = candles[i - 1];
    const current = candles[i];

    const previousTime = safeNumber(previous.time);
    const currentTime = safeNumber(current.time);

    const deltaSeconds =
      (currentTime - previousTime) / 1000;

    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      continue;
    }

    const volume = positiveNumber(current[volumeKey]);

    const td = volume / deltaSeconds;

    observations.push({
      index: i,
      time: currentTime,
      deltaSeconds,
      volume,
      td
    });
  }

  return observations;
}

/*
 * Temporal Density
 *
 * TD_i = Volume_i / elapsed time_i
 *
 * TDA = total volume / total elapsed time
 *
 * TDR_i = TD_i / TDA
 *
 * SC = count of observations where TDR > 1
 *
 * SF = SC / total observed hours
 */
function calculateTemporalMetrics(candles, volumeKey) {
  const observations =
    buildTemporalObservations(candles, volumeKey);

  if (observations.length === 0) {
    return {
      observations: [],
      tda: 0,
      tdr: [],
      spikeCount: 0,
      spikeFrequency: 0,
      elapsedSeconds: 0,
      elapsedHours: 0,
      totalVolume: 0
    };
  }

  const totalVolume = observations.reduce(
    (sum, observation) => sum + observation.volume,
    0
  );

  const elapsedSeconds = observations.reduce(
    (sum, observation) => sum + observation.deltaSeconds,
    0
  );

  const elapsedHours = elapsedSeconds / 3600;

  const tda =
    elapsedSeconds > 0
      ? totalVolume / elapsedSeconds
      : 0;

  const tdr = observations.map(observation => {
    const ratio =
      tda > 0
        ? observation.td / tda
        : 0;

    return {
      index: observation.index,
      time: observation.time,
      td: observation.td,
      tdr: ratio
    };
  });

  const spikeCount = tdr.reduce(
    (count, observation) =>
      count + (observation.tdr > 1 ? 1 : 0),
    0
  );

  const spikeFrequency =
    elapsedHours > 0
      ? spikeCount / elapsedHours
      : 0;

  return {
    observations,
    tda,
    tdr,
    spikeCount,
    spikeFrequency,
    elapsedSeconds,
    elapsedHours,
    totalVolume
  };
}

/*
 * Pair Buy and Sell TDR events ordinally.
 *
 * We deliberately do NOT require the events to occur at the
 * same timestamp.
 *
 * Buy #1 pairs with Sell #1,
 * Buy #2 pairs with Sell #2,
 * etc.
 *
 * Only TDR values above baseline participate.
 */
function calculatePairedTDRDominance(buyMetrics, sellMetrics) {
  const buyEvents = buyMetrics.tdr.filter(
    observation => observation.tdr > 1
  );

  const sellEvents = sellMetrics.tdr.filter(
    observation => observation.tdr > 1
  );

  const pairCount = Math.min(
    buyEvents.length,
    sellEvents.length
  );

  const buyWins = [];
  const sellWins = [];
  const pairs = [];

  for (let i = 0; i < pairCount; i++) {
    const buy = buyEvents[i];
    const sell = sellEvents[i];

    const pair = {
      ordinal: i + 1,
      buyTDR: buy.tdr,
      sellTDR: sell.tdr,
      buyTime: buy.time,
      sellTime: sell.time,
      winner: "tie"
    };

    if (buy.tdr > sell.tdr) {
      buyWins.push(buy.tdr);
      pair.winner = "buy";
    } else if (sell.tdr > buy.tdr) {
      sellWins.push(sell.tdr);
      pair.winner = "sell";
    }

    pairs.push(pair);
  }

  const buyAverage =
    buyWins.length > 0
      ? buyWins.reduce((sum, value) => sum + value, 0) /
        buyWins.length
      : 0;

  const sellAverage =
    sellWins.length > 0
      ? sellWins.reduce((sum, value) => sum + value, 0) /
        sellWins.length
      : 0;

  return {
    buy: {
      wins: buyWins.length,
      average: buyAverage,
      progression: buyWins
    },

    sell: {
      wins: sellWins.length,
      average: sellAverage,
      progression: sellWins
    },

    pairs,
    pairCount,
    unmatchedBuyEvents: Math.max(
      0,
      buyEvents.length - pairCount
    ),
    unmatchedSellEvents: Math.max(
      0,
      sellEvents.length - pairCount
    )
  };
}

/*
 * Spatial Density
 *
 * Range A:
 * Envelope range = highest high - lowest low
 *
 * Range B:
 * Path range = sum of absolute close-to-close movement
 *
 * SDA = total volume / range
 *
 * STD = range / elapsed time
 *
 * Therefore:
 *
 * TDA = SDA * STD
 *
 * STD is fundamentally spatial traversal speed.
 */
function calculateSpatialMetrics(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return {
      envelopeRange: 0,
      pathRange: 0,
      sdaEnvelope: 0,
      sdaPath: 0,
      stdEnvelope: 0,
      stdPath: 0
    };
  }

  let highestHigh = -Infinity;
  let lowestLow = Infinity;

  let pathRange = 0;

  let totalVolume = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    const high = safeNumber(candle.high);
    const low = safeNumber(candle.low);
    const close = safeNumber(candle.close);

    highestHigh = Math.max(highestHigh, high);
    lowestLow = Math.min(lowestLow, low);

    totalVolume += positiveNumber(candle.volume);

    if (i > 0) {
      const previousClose =
        safeNumber(candles[i - 1].close);

      pathRange += Math.abs(close - previousClose);
    }
  }

  const envelopeRange =
    Number.isFinite(highestHigh) &&
    Number.isFinite(lowestLow)
      ? Math.max(0, highestHigh - lowestLow)
      : 0;

  const firstTime = safeNumber(candles[0].time);
  const lastTime =
    safeNumber(candles[candles.length - 1].time);

  const elapsedSeconds =
    Math.max(0, lastTime - firstTime) / 1000;

  const elapsedHours = elapsedSeconds / 3600;

  const sdaEnvelope =
    envelopeRange > 0
      ? totalVolume / envelopeRange
      : 0;

  const sdaPath =
    pathRange > 0
      ? totalVolume / pathRange
      : 0;

  const stdEnvelope =
    elapsedHours > 0
      ? envelopeRange / elapsedHours
      : 0;

  const stdPath =
    elapsedHours > 0
      ? pathRange / elapsedHours
      : 0;

  return {
    envelopeRange,
    pathRange,

    sdaEnvelope,
    sdaPath,

    stdEnvelope,
    stdPath,

    totalVolume,
    elapsedSeconds,
    elapsedHours
  };
}

/*
 * Transaction Participation
 *
 * Transaction Density:
 *
 * TC_D = transactions / elapsed seconds
 *
 * Transaction Density Average:
 *
 * TCDA = arithmetic mean of the individual
 * transaction-density observations.
 *
 * TCDR = TC_D / TCDA
 *
 * TCSC = count of TCDR > 1
 *
 * TCSF = TCSC / observed hours
 *
 * ATV = volume / transactions
 */
function calculateTransactionMetrics(candles) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return {
      observations: [],
      densityAverage: 0,
      densityRatio: 0,
      spikeCount: 0,
      spikeFrequency: 0,
      averageTransactionVolume: 0,
      totalTransactions: 0,
      totalVolume: 0,
      elapsedSeconds: 0,
      elapsedHours: 0
    };
  }

  const observations = [];

  for (let i = 1; i < candles.length; i++) {
    const previous = candles[i - 1];
    const current = candles[i];

    const previousTime = safeNumber(previous.time);
    const currentTime = safeNumber(current.time);

    const deltaSeconds =
      (currentTime - previousTime) / 1000;

    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      continue;
    }

    const transactions =
      positiveNumber(current.trades);

    const volume =
      positiveNumber(current.volume);

    const density =
      transactions / deltaSeconds;

    observations.push({
      index: i,
      time: currentTime,
      deltaSeconds,
      transactions,
      volume,
      density
    });
  }

  if (observations.length === 0) {
    return {
      observations: [],
      densityAverage: 0,
      densityRatio: 0,
      spikeCount: 0,
      spikeFrequency: 0,
      averageTransactionVolume: 0,
      totalTransactions: 0,
      totalVolume: 0,
      elapsedSeconds: 0,
      elapsedHours: 0
    };
  }

  const densityAverage =
    observations.reduce(
      (sum, observation) =>
        sum + observation.density,
      0
    ) / observations.length;

  const withRatios = observations.map(observation => ({
    ...observation,

    ratio:
      densityAverage > 0
        ? observation.density / densityAverage
        : 0
  }));

  const spikeCount = withRatios.reduce(
    (count, observation) =>
      count + (observation.ratio > 1 ? 1 : 0),
    0
  );

  const elapsedSeconds =
    withRatios.reduce(
      (sum, observation) =>
        sum + observation.deltaSeconds,
      0
    );

  const elapsedHours = elapsedSeconds / 3600;

  const spikeFrequency =
    elapsedHours > 0
      ? spikeCount / elapsedHours
      : 0;

  const totalTransactions =
    withRatios.reduce(
      (sum, observation) =>
        sum + observation.transactions,
      0
    );

  const totalVolume =
    withRatios.reduce(
      (sum, observation) =>
        sum + observation.volume,
      0
    );

  const averageTransactionVolume =
    totalTransactions > 0
      ? totalVolume / totalTransactions
      : 0;

  return {
    observations: withRatios,

    densityAverage,

    /*
     * This is intentionally the average transaction-density
     * baseline, not total transactions divided by total time.
     */
    densityRatio:
      withRatios.length > 0
        ? withRatios.reduce(
            (sum, observation) =>
              sum + observation.ratio,
            0
          ) / withRatios.length
        : 0,

    spikeCount,
    spikeFrequency,

    averageTransactionVolume,

    totalTransactions,
    totalVolume,

    elapsedSeconds,
    elapsedHours
  };
}

/*
 * Full analysis bundle.
 *
 * Buy and Sell temporal activity are calculated independently.
 * This is important because each side has its own baseline.
 */
function calculateAllMetrics(candles) {
  const buyTemporal =
    calculateTemporalMetrics(
      candles,
      "buyTaker"
    );

  const sellTemporal =
    calculateTemporalMetrics(
      candles,
      "buyMaker"
    );

  const pairedDominance =
    calculatePairedTDRDominance(
      buyTemporal,
      sellTemporal
    );

  const spatial =
    calculateSpatialMetrics(candles);

  const transactions =
    calculateTransactionMetrics(candles);

  const firstTime =
    candles?.length
      ? safeNumber(candles[0].time)
      : 0;

  const lastTime =
    candles?.length
      ? safeNumber(candles[candles.length - 1].time)
      : 0;

  const elapsedSeconds =
    Math.max(0, lastTime - firstTime) / 1000;

  const totalVolume =
    Array.isArray(candles)
      ? candles.reduce(
          (sum, candle) =>
            sum + positiveNumber(candle.volume),
          0
        )
      : 0;

  const totalTransactions =
    Array.isArray(candles)
      ? candles.reduce(
          (sum, candle) =>
            sum + positiveNumber(candle.trades),
          0
        )
      : 0;

  return {
    buyTemporal,
    sellTemporal,

    pairedDominance,

    spatial,

    transactions,

    summary: {
      observationCount:
        Array.isArray(candles)
          ? candles.length
          : 0,

      elapsedSeconds,

      elapsedHours:
        elapsedSeconds / 3600,

      totalVolume,

      totalTransactions
    }
  };
}

export {
  calculateTemporalMetrics,
  calculatePairedTDRDominance,
  calculateSpatialMetrics,
  calculateTransactionMetrics,
  calculateAllMetrics
};
