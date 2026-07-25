export const SCREENSHOT_MAX_EDGE = 1280;
export const SCREENSHOT_JPEG_QUALITY = 60;

export interface ScreenshotViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function screenshotData(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const data = (result as { data?: unknown }).data;
  return typeof data === 'string' ? data : undefined;
}

export function screenshotViewport(result: unknown): ScreenshotViewport | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const viewport = (result as { cssVisualViewport?: unknown; visualViewport?: unknown }).cssVisualViewport
    ?? (result as { visualViewport?: unknown }).visualViewport;
  if (!viewport || typeof viewport !== 'object') return undefined;
  const { pageX = 0, pageY = 0, clientWidth, clientHeight } = viewport as Record<string, unknown>;
  if (![pageX, pageY, clientWidth, clientHeight].every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined;
  if ((clientWidth as number) <= 0 || (clientHeight as number) <= 0) return undefined;
  return { x: pageX as number, y: pageY as number, width: clientWidth as number, height: clientHeight as number };
}

export function screenshotCaptureParams(viewport: ScreenshotViewport) {
  const scale = Math.min(1, SCREENSHOT_MAX_EDGE / Math.max(viewport.width, viewport.height));
  return {
    format: 'jpeg' as const,
    quality: SCREENSHOT_JPEG_QUALITY,
    optimizeForSpeed: true,
    clip: { ...viewport, scale },
  };
}

export function isScreenshotCdpMethod(method: unknown) {
  return method === 'Page.captureScreenshot';
}

export function isScreenshotCdpBatch(batchJson: string) {
  try {
    const batch = JSON.parse(batchJson);
    return Array.isArray(batch?.commands) && batch.commands.some((command: { method?: unknown }) => isScreenshotCdpMethod(command?.method));
  } catch {
    return false;
  }
}
