/* AI 체험 실습 - 공통 함수
   - 사진 넣기(클릭 · 끌어다 놓기 · 붙여넣기 · 예제)
   - 모델 내려받기(진행률 표시) · ONNX 실행 준비
   - 화면 표시 도우미 */
(function () {
  const AI = (window.AI = {});

  AI.$ = (sel, root = document) => root.querySelector(sel);
  AI.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  AI.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 화면 갱신 한 번 기다리기. 탭이 가려져 있으면 requestAnimationFrame이 멈추므로 setTimeout으로도 넘어가게 함
  AI.nextFrame = () => new Promise((r) => {
    let done = false;
    const go = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(go);
    setTimeout(go, 50);
  });

  /* ---------- 사진 열기 ---------- */
  // 사진 파일(Blob)을 열어 긴 쪽이 maxSide 이하인 캔버스로 돌려줌
  AI.blobToCanvas = async function (blob, maxSide = 1280) {
    let bmp = null;
    try {
      bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch (e) {
      // 일부 형식은 <img>로만 열림
      bmp = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
        img.src = url;
      });
    }
    const w0 = bmp.width, h0 = bmp.height;
    if (!w0 || !h0) throw new Error("decode");
    const r = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * r));
    c.height = Math.max(1, Math.round(h0 * r));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  };

  AI.urlToCanvas = async function (url, maxSide) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch");
    return AI.blobToCanvas(await res.blob(), maxSide);
  };

  AI.copyCanvas = function (src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  };

  const MSG_DECODE = "이 파일은 열 수 없어요. JPG나 PNG 사진을 사용해 주세요. (아이폰 HEIC 사진은 브라우저에서 열리지 않아요)";
  const MSG_LINK = "인터넷 사진을 바로 가져오지 못했어요. 사진에서 마우스 오른쪽 → '이미지 복사' 후 이 화면에서 Ctrl+V 를 눌러 주세요.";

  /* 사진 넣는 곳 설정
     opts: { drop, samplesEl, samples:[{src,label}], maxSide, onImage(canvas, info), onError(msg), accept } */
  AI.setupPicker = function (opts) {
    const maxSide = opts.maxSide || 1280;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = opts.accept || "image/*";
    input.style.display = "none";
    document.body.appendChild(input);

    const fail = (msg) => (opts.onError ? opts.onError(msg) : alert(msg));
    let busy = false;
    const use = async (getCanvas, info) => {
      if (busy) return;
      busy = true;
      try {
        const c = await getCanvas();
        AI.$$("button", opts.samplesEl || document.createElement("div")).forEach((b) => b.classList.toggle("on", b.dataset.src === info.src));
        await opts.onImage(c, info);
      } catch (e) {
        console.error(e);
        fail(e && e.userMessage ? e.userMessage : info.kind === "link" ? MSG_LINK : MSG_DECODE);
      } finally {
        busy = false;
      }
    };
    const useBlob = (blob, name, kind) => {
      if (!blob.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name || "")) {
        if (/\.hei[cf]$/i.test(name || "")) return fail(MSG_DECODE);
        return fail("사진 파일이 아니에요. JPG나 PNG 사진을 넣어 주세요.");
      }
      use(() => AI.blobToCanvas(blob, maxSide), { name: name || "사진", kind });
    };

    if (opts.drop) {
      const d = opts.drop;
      d.addEventListener("click", () => input.click());
      d.addEventListener("dragover", (e) => { e.preventDefault(); d.classList.add("over"); });
      d.addEventListener("dragleave", () => d.classList.remove("over"));
      d.addEventListener("drop", (e) => {
        e.preventDefault();
        d.classList.remove("over");
        const dt = e.dataTransfer;
        if (dt.files && dt.files.length) return useBlob(dt.files[0], dt.files[0].name, "file");
        // 다른 탭의 사진을 끌어온 경우: 주소로 가져오기 시도
        let url = "";
        const html = dt.getData("text/html");
        const m = html && html.match(/<img[^>]+src="([^"]+)"/i);
        if (m) url = m[1].replace(/&amp;/g, "&");
        if (!url) url = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").trim();
        if (!/^https?:|^data:image/.test(url)) return fail(MSG_LINK);
        use(() => AI.urlToCanvas(url, maxSide), { name: "인터넷 사진", kind: "link" });
      });
    }
    input.addEventListener("change", () => {
      if (input.files[0]) useBlob(input.files[0], input.files[0].name, "file");
      input.value = "";
    });
    // Ctrl+V 붙여넣기
    if (opts.paste !== false) document.addEventListener("paste", (e) => {
      const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
      const it = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (it) { e.preventDefault(); useBlob(it.getAsFile(), "붙여넣은 사진", "paste"); }
    });
    // 예제 사진
    if (opts.samplesEl && opts.samples) {
      opts.samplesEl.innerHTML = "";
      for (const s of opts.samples) {
        const b = document.createElement("button");
        b.type = "button";
        b.title = s.label;
        b.dataset.src = s.src;
        b.innerHTML = `<img src="${s.thumb || s.src}" alt="${s.label}" loading="lazy">`;
        b.addEventListener("click", () => use(() => AI.urlToCanvas(s.src, maxSide), { name: s.label, src: s.src, kind: "sample", ...s }));
        opts.samplesEl.appendChild(b);
      }
    }
    return {
      open: () => input.click(),
      loadSample: (i) => {
        const s = opts.samples[i];
        return use(() => AI.urlToCanvas(s.src, maxSide), { name: s.label, src: s.src, kind: "sample", ...s });
      },
    };
  };

  // 사진 넣는 곳 HTML (모든 페이지 같은 모양)
  AI.pickerHTML = function (extra = "") {
    return `
      <div class="drop" id="drop"><b>사진 넣기</b>끌어다 놓기 · 클릭 · 복사 후 Ctrl+V</div>
      <div class="links">무료 사진 <a href="https://www.pexels.com/ko-kr/" target="_blank" rel="noopener">Pexels</a> <a href="https://unsplash.com/ko" target="_blank" rel="noopener">Unsplash</a>${extra}<span class="fmt">JPG · PNG · WEBP</span></div>
      <div class="samples" id="samples"></div>`;
  };

  /* ---------- 오류 · 로딩 표시 ---------- */
  AI.errorBox = function (el) {
    return {
      show(msg) { el.textContent = msg; el.classList.add("show"); },
      hide() { el.classList.remove("show"); },
    };
  };

  AI.loader = function (stage) {
    let el = AI.$(".loading", stage);
    if (!el) {
      el = document.createElement("div");
      el.className = "loading";
      el.innerHTML = `<div><div class="spin"></div><div class="msg"></div><div class="sub"></div><div class="bar"><i></i></div></div>`;
      stage.appendChild(el);
    }
    const msg = AI.$(".msg", el), sub = AI.$(".sub", el), bar = AI.$(".bar", el), fill = AI.$(".bar i", el);
    return {
      show(m, s = "", pct = null) {
        msg.textContent = m;
        sub.textContent = s;
        bar.style.display = pct == null ? "none" : "block";
        if (pct != null) fill.style.width = Math.round(pct * 100) + "%";
        el.classList.add("show");
      },
      progress(p) { bar.style.display = "block"; fill.style.width = Math.round(p * 100) + "%"; },
      hide() { el.classList.remove("show"); },
    };
  };

  /* ---------- 파일 내려받기 (진행률) ---------- */
  // url 이 배열이면 조각들을 차례로 받아 하나로 합침 (큰 모델을 25MB 이하로 나눠 둔 경우)
  AI.fetchParts = async function (urls, onProgress) {
    const bufs = [];
    for (let i = 0; i < urls.length; i++) {
      bufs.push(new Uint8Array(await AI.fetchBuffer(urls[i], (p) => onProgress && onProgress((i + p) / urls.length))));
    }
    const out = new Uint8Array(bufs.reduce((s, b) => s + b.length, 0));
    let o = 0;
    for (const b of bufs) { out.set(b, o); o += b.length; }
    return out.buffer;
  };

  AI.fetchBuffer = async function (url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`내려받기 실패 (${res.status}) : ${url}`);
    const total = +res.headers.get("Content-Length") || 0;
    if (!res.body || !total) {
      const buf = await res.arrayBuffer();
      onProgress && onProgress(1);
      return buf;
    }
    const reader = res.body.getReader();
    const out = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > out.length) { // 압축 전송 등으로 길이가 다를 때
        const bigger = new Uint8Array(Math.max(out.length * 2, got + value.length));
        bigger.set(out.subarray(0, got));
        return finishGrow(reader, bigger, got, value, onProgress);
      }
      out.set(value, got);
      got += value.length;
      onProgress && onProgress(Math.min(1, got / total));
    }
    return out.buffer.slice(0, got);
  };
  async function finishGrow(reader, buf, got, value, onProgress) {
    const chunks = [buf.subarray(0, got), value];
    let n = got + value.length;
    for (;;) {
      const { done, value: v } = await reader.read();
      if (done) break;
      chunks.push(v); n += v.length;
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    onProgress && onProgress(1);
    return out.buffer;
  }

  /* ---------- ONNX 모델 실행 준비 ---------- */
  const sessions = {};
  AI.loadModel = async function (url, onProgress) {
    if (sessions[url]) return sessions[url];
    if (!window.ort) throw new Error("ONNX Runtime 이 없습니다 (lib/ort 폴더 확인)");
    ort.env.wasm.wasmPaths = new URL("lib/ort/", location.href).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const buf = Array.isArray(url) ? await AI.fetchParts(url, onProgress) : await AI.fetchBuffer(url, onProgress);
    sessions[url] = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return sessions[url];
  };

  /* ---------- 그리기 도우미 ---------- */
  // 물체 종류마다 다른 색 (보기 좋은 색 12개)
  const PALETTE = ["#ee6b55", "#3b82c4", "#2f9e6d", "#e0a020", "#8e5bd0", "#d64f8a", "#1aa3a3", "#7a8b2a", "#c4642a", "#4f6bd6", "#b0454a", "#3c9a4a"];
  AI.color = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
  AI.hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  AI.fontFamily = getComputedStyle(document.documentElement).fontFamily || "sans-serif";

  // 상자 위 이름표
  AI.drawTag = function (ctx, x, y, text, color, size) {
    const fs = size || Math.max(13, Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 42));
    ctx.font = `800 ${fs}px ${AI.fontFamily}`;
    const tw = ctx.measureText(text).width;
    const h = fs + 8, w = tw + 12;
    let ty = y - h;
    if (ty < 0) ty = y;
    let tx = Math.min(Math.max(0, x), ctx.canvas.width - w);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx, ty, w, h, 4); else ctx.rect(tx, ty, w, h);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, tx + 6, ty + h / 2 + 1);
  };

  AI.drawBox = function (ctx, x1, y1, x2, y2, color, lw) {
    ctx.lineWidth = lw || Math.max(2, Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 280));
    ctx.strokeStyle = color;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  };

  // 사진 밝기 · 흐림 바꾸기 (원본은 그대로)
  AI.adjust = function (src, { bright = 1, blur = 0, rotate = 0 } = {}) {
    const rad = (rotate * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const w = Math.round(src.width * cos + src.height * sin);
    const h = Math.round(src.width * sin + src.height * cos);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const f = [];
    if (bright !== 1) f.push(`brightness(${bright})`);
    if (blur > 0) f.push(`blur(${blur * (Math.max(src.width, src.height) / 640)}px)`);
    ctx.filter = f.length ? f.join(" ") : "none";
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  };

  // 캔버스를 PNG로 내려받기
  AI.download = function (canvas, name) {
    canvas.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };

  /* ---------- 전후 비교 (가운데 막대를 끌어서 비교) ----------
     el 안에 비교 화면을 만들고 set(왼쪽 캔버스, 오른쪽 캔버스, 왼쪽 이름, 오른쪽 이름) 으로 그림 */
  AI.compare = function (el) {
    el.classList.add("cmp");
    el.innerHTML = `<canvas class="under"></canvas><canvas class="over"></canvas><div class="line"></div><div class="knob">↔</div><span class="tag l"></span><span class="tag r"></span>`;
    const under = AI.$(".under", el), over = AI.$(".over", el);
    let pos = 0.5, drag = false;
    const setPos = (p) => {
      pos = Math.max(0, Math.min(1, p));
      over.style.clipPath = `inset(0 ${(1 - pos) * 100}% 0 0)`;
      AI.$(".line", el).style.left = AI.$(".knob", el).style.left = pos * 100 + "%";
    };
    const mv = (e) => { const r = el.getBoundingClientRect(); setPos((e.clientX - r.left) / r.width); };
    el.addEventListener("pointerdown", (e) => { drag = true; try { el.setPointerCapture(e.pointerId); } catch (_) {} mv(e); });
    el.addEventListener("pointermove", (e) => drag && mv(e));
    el.addEventListener("pointerup", () => (drag = false));
    return {
      set(left, right, ln, rn, maxH = 0.68) {
        under.width = over.width = right.width; under.height = over.height = right.height;
        under.getContext("2d").drawImage(right, 0, 0);
        over.getContext("2d").drawImage(left, 0, 0, right.width, right.height);
        AI.$(".tag.l", el).textContent = ln; AI.$(".tag.r", el).textContent = rn;
        const avail = el.parentElement.clientWidth, vh = window.innerHeight * maxH;
        const w = Math.min(avail, right.width * (vh / right.height));
        el.style.width = w + "px";
        const pix = w > right.width * 1.05;
        under.classList.toggle("pixel", pix); over.classList.toggle("pixel", pix);
        setPos(pos);
      },
    };
  };

  // 숫자 표시
  AI.pct = (p, d = 0) => (p * 100).toFixed(d) + "%";
})();
