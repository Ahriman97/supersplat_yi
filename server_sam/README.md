markdown
# SAM Server для SuperSplat

Локальный сервер для сегментации объектов на скриншотах через SAM
(Segment Anything Model). Используется инструментом `SamSelection` в SuperSplat.

## Требования

- Docker
- NVIDIA GPU + nvidia-container-toolkit (рекомендуется)
- ~3 ГБ свободного места (образ + модель + VRAM)

## Установка nvidia-container-toolkit (Ubuntu/Debian)

```bash
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker