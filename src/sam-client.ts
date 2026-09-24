// src/sam-client.ts
// const SAM_SERVER_URL = 'http://localhost:8000';
// Порт SAM-сервера читается из URL (передаёт лаунчер через ?samPort=)
// По умолчанию — 8000.
const getSamServerUrl = (): string => {
    const params = new URLSearchParams(window.location.search);
    const port = params.get('samPort') ?? '8000';
    return `http://localhost:${port}`;
};

const SAM_SERVER_URL = getSamServerUrl();

/**
 * Отправляет PNG-скриншот + точку клика на SAM-сервер.
 * Возвращает Blob с RGBA-маской (alpha = маска).
 */
export async function segmentImage(
    pngBlob: Blob,
    x: number,   // 0..1
    y: number    // 0..1
): Promise<{ maskBlob: Blob, score: number, time: number }> {
    const formData = new FormData();
    formData.append('image', pngBlob, 'screenshot.png');
    formData.append('x', x.toString());
    formData.append('y', y.toString());

    const response = await fetch(`${SAM_SERVER_URL}/segment`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        throw new Error(`SAM server error: ${response.status} ${response.statusText}`);
    }

    const maskBlob = await response.blob();
    const score = parseFloat(response.headers.get('X-SAM-Score') ?? '0');
    const time = parseFloat(response.headers.get('X-SAM-Time') ?? '0');

    return { maskBlob, score, time };
}

/**
 * Проверка, что SAM-сервер доступен.
 */
export async function checkSamServer(): Promise<boolean> {
    try {
        const response = await fetch(`${SAM_SERVER_URL}/health`, { method: 'GET' });
        return response.ok;
    } catch {
        return false;
    }
}