FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

# Python 3.11 — стабильно поддерживается PyTorch и segment-anything
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3-pip \
    python3.11-dev \
    git \
    wget \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

WORKDIR /app

# Увеличиваем буфер и переключаемся на HTTP/1.1
RUN git config --global http.postBuffer 524288000 && \
    git config --global http.version HTTP/1.1

# PyTorch с CUDA 12.4 — ставим отдельно, чтобы не тянуть CPU-версию
RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir \
        torch==2.10.0 \
        torchvision==0.25.0 \
        --index-url https://download.pytorch.org/whl/cu128

# Остальные зависимости
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Код
COPY sam_server.py .
COPY download_model.py .

# Скачиваем чекпоинт SAM ViT-B (~375 МБ)
# RUN python download_model.py

EXPOSE 8000

# Один воркер: SAM держит модель в VRAM, несколько воркеров съедят память
CMD ["uvicorn", "sam_server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]