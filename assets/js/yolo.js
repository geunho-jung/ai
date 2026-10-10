/* YOLO11 (검출 · 분류) 브라우저 실행
   수업 Colab 의 ultralytics YOLO11n 모델을 ONNX 로 바꾼 것과 같은 모델을 사용 */
(function () {
  const YOLO = (window.YOLO = {});

  // 사진을 정사각형(S×S)에 맞추고 남는 곳은 회색(114)으로 채움 (ultralytics letterbox 와 같은 방식)
  YOLO.letterbox = function (src, S) {
    const w0 = src.width, h0 = src.height;
    const r = Math.min(S / w0, S / h0);
    const nw = Math.round(w0 * r), nh = Math.round(h0 * r);
    const padX = Math.round((S - nw) / 2 - 0.1), padY = Math.round((S - nh) / 2 - 0.1);
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "rgb(114,114,114)";
    ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, padX, padY, nw, nh);
    const px = ctx.getImageData(0, 0, S, S).data;
    const n = S * S;
    const data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      data[i] = px[i * 4] / 255;
      data[n + i] = px[i * 4 + 1] / 255;
      data[2 * n + i] = px[i * 4 + 2] / 255;
    }
    return { data, scale: r, padX, padY, S, w0, h0 };
  };

  function iou(a, b) {
    const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
    const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return u > 0 ? inter / u : 0;
  }
  YOLO.iou = iou;

  // 겹친 상자 정리 (같은 종류끼리, 신뢰도 높은 순)
  YOLO.nms = function (cands, conf, iouTh, maxDet = 300) {
    const list = cands.filter((d) => d.score >= conf).sort((a, b) => b.score - a.score);
    const keep = [];
    for (const d of list) {
      if (iouTh < 1 && keep.some((k) => k.cls === d.cls && iou(k, d) > iouTh)) continue;
      keep.push(d);
      if (keep.length >= maxDet) break;
    }
    return keep;
  };

  // 모델 출력(1, 4+클래스수, N) → 후보 상자 목록 (원래 사진 좌표)
  function decode(out, lb, nCls, minConf) {
    const dims = out.dims, N = dims[2], A = out.data;
    const res = [];
    for (let i = 0; i < N; i++) {
      let best = -1, bc = 0;
      for (let c = 0; c < nCls; c++) {
        const v = A[(4 + c) * N + i];
        if (v > bc) { bc = v; best = c; }
      }
      if (bc < minConf) continue;
      const cx = A[i], cy = A[N + i], w = A[2 * N + i], h = A[3 * N + i];
      const d = {
        cls: best, score: bc,
        x1: Math.max(0, (cx - w / 2 - lb.padX) / lb.scale),
        y1: Math.max(0, (cy - h / 2 - lb.padY) / lb.scale),
        x2: Math.min(lb.w0, (cx + w / 2 - lb.padX) / lb.scale),
        y2: Math.min(lb.h0, (cy + h / 2 - lb.padY) / lb.scale),
      };
      res.push(d);
    }
    return res;
  }

  // 검출: 후보 상자(신뢰도 minConf 이상)를 모두 돌려줌 → 기준값 · NMS 는 화면에서 바로 바꿔 볼 수 있음
  YOLO.detect = async function (session, src, { size = 640, minConf = 0.05 } = {}) {
    const lb = YOLO.letterbox(src, size);
    const t0 = performance.now();
    const feeds = {};
    feeds[session.inputNames[0]] = new ort.Tensor("float32", lb.data, [1, 3, size, size]);
    const out = await session.run(feeds);
    const ms = performance.now() - t0;
    const o = out[session.outputNames[0]];
    return { cands: decode(o, lb, o.dims[1] - 4, minConf), lb, ms };
  };

  // 분류: 짧은 쪽을 224 로 줄이고 가운데를 잘라 넣음 → 1000종 확률
  YOLO.classifyInput = function (src, S = 224) {
    const r = S / Math.min(src.width, src.height);
    const nw = Math.round(src.width * r), nh = Math.round(src.height * r);
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, Math.round((S - nw) / 2), Math.round((S - nh) / 2), nw, nh);
    return c;
  };
  YOLO.toTensorData = function (c) {
    const S = c.width, n = S * S;
    const px = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, S, S).data;
    const data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      data[i] = px[i * 4] / 255;
      data[n + i] = px[i * 4 + 1] / 255;
      data[2 * n + i] = px[i * 4 + 2] / 255;
    }
    return data;
  };
  YOLO.classifyData = async function (session, data, batch = 1, S = 224) {
    const feeds = {};
    feeds[session.inputNames[0]] = new ort.Tensor("float32", data, [batch, 3, S, S]);
    const out = await session.run(feeds);
    return out[session.outputNames[0]].data;
  };
  // 분류 모델의 마지막 특징값 1280개 (나만의 AI 만들기에서 사용)
  YOLO.embed = async function (session, data, S = 224) {
    const feeds = {};
    feeds[session.inputNames[0]] = new ort.Tensor("float32", data, [1, 3, S, S]);
    const out = await session.run(feeds);
    return { probs: out[session.outputNames[0]].data, feat: out[session.outputNames[1]].data };
  };
})();
