/*
 * ALPHA TRACKER
 * Historical temporal flow chart
 *
 * Features:
 *   • Buy Taker line
 *   • Buy Maker line
 *   • Taker - Maker flow line
 *   • Chart-local wheel zoom
 *   • Touch pinch zoom
 *   • Crosshair
 *   • Click/tap to pin
 *   • Double-click to reset
 *   • Exact candle timestamp
 *   • Exact values at crosshair
 *   • Automatic Y-axis rescaling
 */

let chartInstance = null;

function formatQuantity(value) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "--";
  }

  if (Math.abs(n) >= 1000000) {
    return (
      (n / 1000000).toFixed(2) +
      "M"
    );
  }

  if (Math.abs(n) >= 1000) {
    return (
      (n / 1000).toFixed(2) +
      "K"
    );
  }

  if (Math.abs(n) >= 1) {
    return n.toFixed(2);
  }

  if (Math.abs(n) >= 0.01) {
    return n.toFixed(4);
  }

  return n.toFixed(6);
}

function exactTime(timestamp) {

  const d =
    new Date(Number(timestamp));

  if (Number.isNaN(d.getTime())) {
    return "--";
  }

  const pad =
    value =>
      String(value).padStart(2, "0");

  return (
    `${d.getFullYear()}-` +
    `${pad(d.getMonth() + 1)}-` +
    `${pad(d.getDate())} ` +
    `${pad(d.getHours())}:` +
    `${pad(d.getMinutes())}:` +
    `${pad(d.getSeconds())}`
  );
}

function getContainer() {

  let container =
    document.getElementById(
      "tradeFlowChart"
    );

  if (container) {
    return container;
  }

  const tableBody =
    document.getElementById(
      "tradeTableBody"
    );

  if (!tableBody) {
    return null;
  }

  const table =
    tableBody.closest("table");

  if (!table) {
    return null;
  }

  container =
    document.createElement("div");

  container.id =
    "tradeFlowChart";

  container.style.width = "100%";
  container.style.height = "440px";
  container.style.position = "relative";
  container.style.marginTop = "12px";
  container.style.overflow = "hidden";
  container.style.touchAction = "none";

  table.parentElement.insertBefore(
    container,
    table
  );

  table.style.display = "none";

  return container;
}

function normalizeSeries(series) {

  return series
    .map((candle, index) => {

      const buyTaker =
        Number(candle?.buyTaker);

      const buyMaker =
        Number(candle?.buyMaker);

      const flow =
        Number(candle?.flow);

      const time =
        Number(candle?.time);

      return {
        time:
          Number.isFinite(time)
            ? time
            : index,

        buyTaker:
          Number.isFinite(buyTaker)
            ? buyTaker
            : 0,

        buyMaker:
          Number.isFinite(buyMaker)
            ? buyMaker
            : 0,

        flow:
          Number.isFinite(flow)
            ? flow
            : (
                buyTaker -
                buyMaker
              ),

        volume:
          Number(candle?.volume) || 0,

        trades:
          Number(candle?.trades) || 0,

        open:
          Number.isFinite(
            Number(candle?.open)
          )
            ? Number(candle.open)
            : null,

        high:
          Number.isFinite(
            Number(candle?.high)
          )
            ? Number(candle.high)
            : null,

        low:
          Number.isFinite(
            Number(candle?.low)
          )
            ? Number(candle.low)
            : null,

        close:
          Number.isFinite(
            Number(candle?.close)
          )
            ? Number(candle.close)
            : null
      };
    })
    .sort(
      (a, b) =>
        a.time - b.time
    );
}

class FlowChart {

  constructor(container, series) {

    this.container = container;
    this.series = normalizeSeries(series);

    this.canvas =
      document.createElement("canvas");

    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.touchAction = "none";

    container.innerHTML = "";
    container.appendChild(this.canvas);

    this.ctx =
      this.canvas.getContext("2d");

    this.padding = {
      left: 72,
      right: 18,
      top: 48,
      bottom: 58
    };

    this.viewStart =
      this.series[0].time;

    this.viewEnd =
      this.series[
        this.series.length - 1
      ].time;

    this.fullStart =
      this.viewStart;

    this.fullEnd =
      this.viewEnd;

    this.crosshairIndex = -1;
    this.pinned = false;

    this.pointerDown = false;
    this.dragDistance = 0;

    this.touchPoints = new Map();
    this.pinchDistance = null;

    this.resizeObserver = null;

    this.setupEvents();
    this.setupResize();

    this.draw();
  }

  setupResize() {

    if (
      typeof ResizeObserver ===
      "undefined"
    ) {
      window.addEventListener(
        "resize",
        () => this.draw()
      );

      return;
    }

    this.resizeObserver =
      new ResizeObserver(() => {

        /*
         * IMPORTANT:
         * We only redraw.
         * We DO NOT recreate the canvas.
         * We DO NOT create another observer.
         */
        this.draw();

      });

    this.resizeObserver.observe(
      this.container
    );
  }

  destroy() {

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.canvas.replaceWith(
      document.createComment(
        "flow-chart"
      )
    );
  }

  resizeCanvas() {

    const rect =
      this.container.getBoundingClientRect();

    const width =
      Math.max(
        320,
        Math.floor(rect.width)
      );

    const height =
      Math.max(
        300,
        Math.floor(rect.height)
      );

    const dpr =
      Math.max(
        1,
        window.devicePixelRatio || 1
      );

    const targetWidth =
      Math.floor(width * dpr);

    const targetHeight =
      Math.floor(height * dpr);

    if (
      this.canvas.width !==
        targetWidth ||
      this.canvas.height !==
        targetHeight
    ) {

      this.canvas.width =
        targetWidth;

      this.canvas.height =
        targetHeight;
    }

    this.canvas.style.width =
      `${width}px`;

    this.canvas.style.height =
      `${height}px`;

    this.ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    return {
      width,
      height
    };
  }

  visibleData() {

    return this.series.filter(
      candle =>
        candle.time >= this.viewStart &&
        candle.time <= this.viewEnd
    );
  }

  rangeValues() {

    const visible =
      this.visibleData();

    const values = [];

    for (const candle of visible) {
      values.push(candle.buyTaker);
      values.push(candle.buyMaker);
      values.push(candle.flow);
    }

    if (!values.length) {
      return {
        min: -1,
        max: 1
      };
    }

    let min =
      Math.min(...values);

    let max =
      Math.max(...values);

    if (min === max) {
      const pad =
        Math.abs(min) || 1;

      min -= pad;
      max += pad;
    }

    const pad =
      (max - min) * 0.08;

    return {
      min: min - pad,
      max: max + pad
    };
  }

  xForTime(time, width) {

    const left =
      this.padding.left;

    const right =
      width -
      this.padding.right;

    const span =
      this.viewEnd -
      this.viewStart;

    if (span <= 0) {
      return (
        left +
        (right - left) / 2
      );
    }

    return (
      left +
      (
        (time - this.viewStart) /
        span
      ) *
      (right - left)
    );
  }

  timeForX(x, width) {

    const left =
      this.padding.left;

    const right =
      width -
      this.padding.right;

    const clamped =
      Math.max(
        left,
        Math.min(right, x)
      );

    const ratio =
      (
        clamped - left
      ) /
      (right - left);

    return (
      this.viewStart +
      ratio *
      (
        this.viewEnd -
        this.viewStart
      )
    );
  }

  yForValue(
    value,
    min,
    max,
    height
  ) {

    const top =
      this.padding.top;

    const bottom =
      height -
      this.padding.bottom;

    return (
      bottom -
      (
        (value - min) /
        (max - min)
      ) *
      (bottom - top)
    );
  }

  nearestIndex(time) {

    let low = 0;
    let high =
      this.series.length - 1;

    while (low < high) {

      const mid =
        Math.floor(
          (low + high) / 2
        );

      if (
        this.series[mid].time <
        time
      ) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    if (low <= 0) {
      return 0;
    }

    const before =
      this.series[low - 1];

    const after =
      this.series[low];

    return (
      Math.abs(
        before.time - time
      ) <=
      Math.abs(
        after.time - time
      )
        ? low - 1
        : low
    );
  }

  drawLine(
    data,
    field,
    min,
    max,
    width,
    height
  ) {

    const ctx = this.ctx;

    let started = false;

    ctx.beginPath();

    for (const candle of data) {

      const x =
        this.xForTime(
          candle.time,
          width
        );

      const y =
        this.yForValue(
          candle[field],
          min,
          max,
          height
        );

      if (!started) {

        ctx.moveTo(x, y);
        started = true;

      } else {

        ctx.lineTo(x, y);
      }
    }

    if (started) {
      ctx.stroke();
    }
  }

  drawGrid(
    width,
    height,
    min,
    max
  ) {

    const ctx = this.ctx;

    const left =
      this.padding.left;

    const right =
      width -
      this.padding.right;

    const top =
      this.padding.top;

    const bottom =
      height -
      this.padding.bottom;

    ctx.lineWidth = 1;
    ctx.strokeStyle =
      "rgba(128,128,128,.18)";

    ctx.fillStyle =
      "rgba(128,128,128,.75)";

    ctx.font =
      "11px sans-serif";

    const rows = 5;

    for (
      let i = 0;
      i <= rows;
      i++
    ) {

      const ratio =
        i / rows;

      const y =
        top +
        ratio *
        (bottom - top);

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      const value =
        max -
        ratio *
        (max - min);

      ctx.fillText(
        formatQuantity(value),
        6,
        y + 4
      );
    }

    const visible =
      this.visibleData();

    if (!visible.length) {
      return;
    }

    const count =
      Math.min(
        6,
        Math.max(
          2,
          Math.floor(
            width / 130
          )
        )
      );

    for (
      let i = 0;
      i < count;
      i++
    ) {

      const ratio =
        count === 1
          ? 0
          : i / (count - 1);

      const time =
        this.viewStart +
        ratio *
        (
          this.viewEnd -
          this.viewStart
        );

      const x =
        this.xForTime(
          time,
          width
        );

      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();

      const index =
        this.nearestIndex(time);

      const candle =
        this.series[index];

      if (candle) {

        ctx.save();

        ctx.translate(
          x,
          height - 12
        );

        ctx.rotate(
          -Math.PI / 6
        );

        ctx.fillText(
          exactTime(candle.time)
            .slice(0, 16),
          0,
          0
        );

        ctx.restore();
      }
    }
  }

  drawHeader(
    width
  ) {

    const ctx = this.ctx;

    ctx.font =
      "bold 13px sans-serif";

    ctx.fillStyle =
      "rgba(255,255,255,.9)";

    ctx.fillText(
      "Temporal Flow • 5m",
      this.padding.left,
      20
    );

    ctx.font =
      "11px sans-serif";

    ctx.fillStyle =
      "rgba(128,128,128,.9)";

    ctx.fillText(
      "Wheel = zoom • pinch = zoom • click/tap = pin • double-click = reset",
      this.padding.left,
      37
    );
  }

  drawLegend(
    width
  ) {

    const ctx = this.ctx;

    const y = 20;

    const items = [
      ["Buy Taker", "#35d07f"],
      ["Buy Maker", "#ff6b6b"],
      ["Taker - Maker", "#5aa9ff"]
    ];

    let x =
      width -
      300;

    ctx.font =
      "11px sans-serif";

    for (const [name, color] of items) {

      ctx.fillStyle = color;

      ctx.fillRect(
        x,
        y - 8,
        10,
        10
      );

      ctx.fillStyle =
        "rgba(255,255,255,.85)";

      ctx.fillText(
        name,
        x + 15,
        y + 1
      );

      x +=
        92;
    }
  }

  drawCrosshair(
    width,
    height
  ) {

    if (
      this.crosshairIndex < 0
    ) {
      return;
    }

    const candle =
      this.series[
        this.crosshairIndex
      ];

    if (!candle) {
      return;
    }

    const x =
      this.xForTime(
        candle.time,
        width
      );

    const ctx = this.ctx;

    const top =
      this.padding.top;

    const bottom =
      height -
      this.padding.bottom;

    ctx.save();

    ctx.strokeStyle =
      this.pinned
        ? "rgba(255,220,100,.95)"
        : "rgba(255,255,255,.45)";

    ctx.lineWidth =
      this.pinned ? 1.5 : 1;

    ctx.setLineDash([4, 4]);

    ctx.beginPath();

    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);

    ctx.stroke();

    ctx.setLineDash([]);

    /*
     * Highlight selected point.
     */

    const range =
      this.rangeValues();

    for (const field of [
      "buyTaker",
      "buyMaker",
      "flow"
    ]) {

      const y =
        this.yForValue(
          candle[field],
          range.min,
          range.max,
          height
        );

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        3.5,
        0,
        Math.PI * 2
      );

      ctx.fillStyle =
        field === "buyTaker"
          ? "#35d07f"
          : field === "buyMaker"
            ? "#ff6b6b"
            : "#5aa9ff";

      ctx.fill();
    }

    /*
     * Information panel.
     */

    const panelWidth = 230;
    const panelHeight = 112;

    let panelX =
      x + 12;

    if (
      panelX +
      panelWidth >
      width -
      5
    ) {
      panelX =
        x -
        panelWidth -
        12;
    }

    const panelY =
      this.padding.top +
      8;

    ctx.fillStyle =
      "rgba(10,10,14,.94)";

    ctx.fillRect(
      panelX,
      panelY,
      panelWidth,
      panelHeight
    );

    ctx.strokeStyle =
      "rgba(255,255,255,.18)";

    ctx.strokeRect(
      panelX,
      panelY,
      panelWidth,
      panelHeight
    );

    ctx.font =
      "bold 11px sans-serif";

    ctx.fillStyle =
      "#ffffff";

    ctx.fillText(
      this.pinned
        ? "PINNED"
        : "CROSSHAIR",
      panelX + 10,
      panelY + 16
    );

    ctx.font =
      "11px sans-serif";

    ctx.fillStyle =
      "rgba(255,255,255,.85)";

    ctx.fillText(
      exactTime(candle.time),
      panelX + 10,
      panelY + 32
    );

    ctx.fillText(
      `Buy Taker: ${formatQuantity(candle.buyTaker)}`,
      panelX + 10,
      panelY + 51
    );

    ctx.fillText(
      `Buy Maker: ${formatQuantity(candle.buyMaker)}`,
      panelX + 10,
      panelY + 68
    );

    ctx.fillText(
      `Taker - Maker: ${formatQuantity(candle.flow)}`,
      panelX + 10,
      panelY + 85
    );

    ctx.fillText(
      `Trades: ${formatQuantity(candle.trades)}`,
      panelX + 10,
      panelY + 102
    );

    ctx.restore();
  }

  draw() {

    if (!this.series.length) {
      return;
    }

    const { width, height } =
      this.resizeCanvas();

    const ctx = this.ctx;

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    const range =
      this.rangeValues();

    const data =
      this.visibleData();

    if (!data.length) {
      return;
    }

    this.drawGrid(
      width,
      height,
      range.min,
      range.max
    );

    /*
     * Buy Taker
     */
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#35d07f";

    this.drawLine(
      data,
      "buyTaker",
      range.min,
      range.max,
      width,
      height
    );

    /*
     * Buy Maker
     */
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff6b6b";

    this.drawLine(
      data,
      "buyMaker",
      range.min,
      range.max,
      width,
      height
    );

    /*
     * Net flow
     */
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#5aa9ff";

    this.drawLine(
      data,
      "flow",
      range.min,
      range.max,
      width,
      height
    );

    this.drawHeader(width);
    this.drawLegend(width);
    this.drawCrosshair(
      width,
      height
    );
  }

  updateCrosshair(clientX) {

    const rect =
      this.canvas.getBoundingClientRect();

    const x =
      clientX -
      rect.left;

    if (
      x <
        this.padding.left ||
      x >
        rect.width -
          this.padding.right
    ) {
      return;
    }

    const time =
      this.timeForX(
        x,
        rect.width
      );

    this.crosshairIndex =
      this.nearestIndex(time);

    this.draw();
  }

  zoomAt(
    clientX,
    factor
  ) {

    const rect =
      this.canvas.getBoundingClientRect();

    const width =
      rect.width;

    const left =
      this.padding.left;

    const right =
      width -
      this.padding.right;

    const x =
      Math.max(
        left,
        Math.min(
          right,
          clientX
        )
      );

    const ratio =
      (
        x - left
      ) /
      (right - left);

    const oldStart =
      this.viewStart;

    const oldEnd =
      this.viewEnd;

    const anchor =
      oldStart +
      ratio *
      (oldEnd - oldStart);

    const oldSpan =
      oldEnd -
      oldStart;

    let newSpan =
      oldSpan / factor;

    const fullSpan =
      this.fullEnd -
      this.fullStart;

    const minimumSpan =
      Math.max(
        5 * 60 * 1000,
        fullSpan /
          1000
      );

    newSpan =
      Math.max(
        minimumSpan,
        Math.min(
          fullSpan,
          newSpan
        )
      );

    let start =
      anchor -
      ratio *
      newSpan;

    let end =
      start +
      newSpan;

    if (start < this.fullStart) {
      start = this.fullStart;
      end = start + newSpan;
    }

    if (end > this.fullEnd) {
      end = this.fullEnd;
      start = end - newSpan;
    }

    this.viewStart =
      Math.max(
        this.fullStart,
        start
      );

    this.viewEnd =
      Math.min(
        this.fullEnd,
        end
      );

    this.draw();
  }

  setupEvents() {

    const canvas =
      this.canvas;

    canvas.addEventListener(
      "wheel",
      event => {

        event.preventDefault();

        const rect =
          canvas.getBoundingClientRect();

        const x =
          event.clientX -
          rect.left;

        const factor =
          event.deltaY < 0
            ? 1.25
            : 0.8;

        this.zoomAt(
          x,
          factor
        );

      },
      {
        passive: false
      }
    );

    canvas.addEventListener(
      "pointermove",
      event => {

        if (
          this.touchPoints.has(
            event.pointerId
          )
        ) {

          this.touchPoints.set(
            event.pointerId,
            {
              x: event.clientX,
              y: event.clientY
            }
          );

          if (
            this.touchPoints.size === 2
          ) {

            const points =
              Array.from(
                this.touchPoints.values()
              );

            const dx =
              points[0].x -
              points[1].x;

            const dy =
              points[0].y -
              points[1].y;

            const distance =
              Math.sqrt(
                dx * dx +
                dy * dy
              );

            if (
              this.pinchDistance === null
            ) {
              this.pinchDistance =
                distance;
              return;
            }

            if (
              this.pinchDistance > 0
            ) {

              const factor =
                distance /
                this.pinchDistance;

              if (
                Math.abs(
                  factor - 1
                ) > 0.01
              ) {

                const rect =
                  canvas.getBoundingClientRect();

                const centerX =
                  (
                    points[0].x +
                    points[1].x
                  ) / 2 -
                  rect.left;

                this.zoomAt(
                  centerX,
                  factor
                );

                this.pinchDistance =
                  distance;
              }
            }

            return;
          }
        }

        if (
          event.pointerType ===
          "mouse"
        ) {
          this.updateCrosshair(
            event.clientX
          );
        }
      }
    );

    canvas.addEventListener(
      "pointerdown",
      event => {

        if (
          event.pointerType ===
          "touch"
        ) {

          this.touchPoints.set(
            event.pointerId,
            {
              x: event.clientX,
              y: event.clientY
            }
          );

          if (
            this.touchPoints.size === 2
          ) {

            const points =
              Array.from(
                this.touchPoints.values()
              );

            const dx =
              points[0].x -
              points[1].x;

            const dy =
              points[0].y -
              points[1].y;

            this.pinchDistance =
              Math.sqrt(
                dx * dx +
                dy * dy
              );
          }

          this.pointerDown = true;
          this.dragDistance = 0;

          return;
        }

        if (
          event.pointerType ===
          "mouse"
        ) {

          const rect =
            canvas.getBoundingClientRect();

          const x =
            event.clientX -
            rect.left;

          const time =
            this.timeForX(
              x,
              rect.width
            );

          this.crosshairIndex =
            this.nearestIndex(time);

          this.pinned = true;

          this.draw();
        }
      }
    );

    canvas.addEventListener(
      "pointerup",
      event => {

        if (
          event.pointerType ===
          "touch"
        ) {

          const pointsBefore =
            Array.from(
              this.touchPoints.values()
            );

          this.touchPoints.delete(
            event.pointerId
          );

          /*
           * One-finger tap.
           */
          if (
            pointsBefore.length === 1 &&
            this.pointerDown
          ) {

            const rect =
              canvas.getBoundingClientRect();

            const x =
              event.clientX -
              rect.left;

            const time =
              this.timeForX(
                x,
                rect.width
              );

            this.crosshairIndex =
              this.nearestIndex(time);

            this.pinned = true;

            this.draw();
          }

          if (
            this.touchPoints.size < 2
          ) {
            this.pinchDistance = null;
          }

          this.pointerDown = false;
        }
      }
    );

    canvas.addEventListener(
      "pointercancel",
      event => {

        this.touchPoints.delete(
          event.pointerId
        );

        if (
          this.touchPoints.size < 2
        ) {
          this.pinchDistance = null;
        }

        this.pointerDown = false;
      }
    );

    canvas.addEventListener(
      "dblclick",
      event => {

        event.preventDefault();

        this.viewStart =
          this.fullStart;

        this.viewEnd =
          this.fullEnd;

        this.crosshairIndex = -1;
        this.pinned = false;

        this.draw();
      }
    );
  }
}

export function renderTradeFlowChart(series) {

  const container =
    getContainer();

  if (!container) {
    return;
  }

  if (
    !Array.isArray(series) ||
    !series.length
  ) {

    renderTradeFlowError(
      "No flow data found for this window."
    );

    return;
  }

  /*
   * Destroy ONLY the previous chart instance.
   * No observer recursion.
   */
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  chartInstance =
    new FlowChart(
      container,
      series
    );
}

export function renderTradeFlowError(message) {

  const container =
    getContainer();

  if (!container) {
    return;
  }

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  container.innerHTML = "";

  const box =
    document.createElement("div");

  box.style.padding = "24px";
  box.style.textAlign = "center";
  box.style.opacity = ".7";

  box.textContent =
    String(
      message ||
      "Unable to load chart data."
    );

  container.appendChild(box);
  } 
