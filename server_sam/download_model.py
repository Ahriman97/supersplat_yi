"""
Скачивает чекпоинт SAM ViT-B (~375 МБ) в ./models/, если его ещё нет.
Модель качается один раз при сборке образа.
"""
import os
import urllib.request

MODEL_URL = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
MODEL_PATH = "models/sam_vit_b_01ec64.pth"


def download():
    os.makedirs("models", exist_ok=True)

    if os.path.exists(MODEL_PATH):
        size_mb = os.path.getsize(MODEL_PATH) / (1024 * 1024)
        print(f"Модель уже есть: {MODEL_PATH} ({size_mb:.1f} МБ)")
        return

    print(f"Скачиваю {MODEL_URL} ...")
    print("Размер ~375 МБ, это займёт минуту-две.")

    def progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        percent = min(100, downloaded * 100 / total_size) if total_size > 0 else 0
        print(f"\r  {percent:.1f}% ({downloaded / 1024 / 1024:.1f} МБ)", end="")

    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH, reporthook=progress)
    print(f"\nГотово: {MODEL_PATH}")


if __name__ == "__main__":
    download()