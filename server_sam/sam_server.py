"""
FastAPI-сервер для SAM (Segment Anything Model).

Эндпоинты:
    GET /health
        Проверка живости. Возвращает {"status": "ok", "model": ..., "device": ...}

    POST /segment
        multipart/form-data:
            image: PNG-файл (скриншот сцены)
            x: float (0..1) — нормализованная координата клика
            y: float (0..1) — нормализованная координата клика
        Возвращает:
            image/png — RGBA-маска. Альфа-канал: 255 = объект, 0 = фон.
            Заголовки: X-SAM-Score, X-SAM-Time
"""
import io
import os
import time
from contextlib import asynccontextmanager

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from segment_anything import SamPredictor, sam_model_registry

# --- Конфигурация ---
MODEL_TYPE = os.environ.get("SAM_MODEL_TYPE", "vit_b")
MODEL_PATH = os.environ.get("SAM_MODEL_PATH", f"models/sam_{MODEL_TYPE}_01ec64.pth")
DEVICE = os.environ.get("SAM_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")

predictor: SamPredictor = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global predictor

    print(f"[SAM] Загрузка модели: {MODEL_PATH}")
    print(f"[SAM] Устройство: {DEVICE}")

    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(f"Модель не найдена: {MODEL_PATH}")

    t0 = time.time()
    sam = sam_model_registry[MODEL_TYPE](checkpoint=MODEL_PATH)
    sam.to(device=DEVICE)
    sam.eval()
    predictor = SamPredictor(sam)
    t1 = time.time()

    print(f"[SAM] Модель загружена за {t1 - t0:.1f} сек")
    print("[SAM] Готов к работе")

    yield

    print("[SAM] Остановка сервера")


app = FastAPI(title="SAM Server", lifespan=lifespan)

# CORS: разрешаем SuperSplat
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-SAM-Score", "X-SAM-Time"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": MODEL_TYPE,
        "device": DEVICE,
        "cuda_available": torch.cuda.is_available(),
    }


@app.post("/segment")
async def segment(
    image: UploadFile = File(..., description="PNG-скриншот сцены"),
    x: float = Form(..., description="Нормализованная X-координата клика (0..1)"),
    y: float = Form(..., description="Нормализованная Y-координата клика (0..1)"),
):
    if predictor is None:
        raise HTTPException(status_code=503, detail="Модель ещё не загружена")

    if not (0.0 <= x <= 1.0) or not (0.0 <= y <= 1.0):
        raise HTTPException(status_code=400, detail="x и y должны быть в диапазоне 0..1")

    # --- Читаем PNG ---
    try:
        contents = await image.read()
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось прочитать PNG: {e}")

    np_image = np.array(pil_image)
    h, w = np_image.shape[:2]

    # --- Нормализованные координаты → пиксели ---
    px = int(round(x * w))
    py = int(round(y * h))
    px = max(0, min(w - 1, px))
    py = max(0, min(h - 1, py))

    print(f"[SAM] image={w}x{h}, click=({px}, {py})")

    # --- Прогон SAM ---
    t0 = time.time()

    predictor.set_image(np_image)

    point_coords = np.array([[px, py]])
    point_labels = np.array([1])

    masks, scores, _ = predictor.predict(
        point_coords=point_coords,
        point_labels=point_labels,
        multimask_output=True,
    )

    best_idx = int(np.argmax(scores))
    best_mask = masks[best_idx]
    best_score = float(scores[best_idx])

    t1 = time.time()
    print(f"[SAM] Готово за {t1 - t0:.2f} сек, score={best_score:.3f}")

    # --- bool → RGBA (alpha = маска) ---
    mask_uint8 = (best_mask * 255).astype(np.uint8)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = 255
    rgba[..., 1] = 255
    rgba[..., 2] = 255
    rgba[..., 3] = mask_uint8
    out_img = Image.fromarray(rgba, mode="RGBA")

    buf = io.BytesIO()
    out_img.save(buf, format="PNG")
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={
            "X-SAM-Score": f"{best_score:.4f}",
            "X-SAM-Time": f"{t1 - t0:.3f}",
        },
    )