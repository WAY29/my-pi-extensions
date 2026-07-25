// src/screenshot.ts
var SCREENSHOT_MAX_EDGE = 1280;
var SCREENSHOT_JPEG_QUALITY = 60;
function screenshotData(result) {
  if (!result || typeof result !== "object") return void 0;
  const data = result.data;
  return typeof data === "string" ? data : void 0;
}
function screenshotViewport(result) {
  if (!result || typeof result !== "object") return void 0;
  const viewport = result.cssVisualViewport ?? result.visualViewport;
  if (!viewport || typeof viewport !== "object") return void 0;
  const { pageX = 0, pageY = 0, clientWidth, clientHeight } = viewport;
  if (![pageX, pageY, clientWidth, clientHeight].every((value) => typeof value === "number" && Number.isFinite(value))) return void 0;
  if (clientWidth <= 0 || clientHeight <= 0) return void 0;
  return { x: pageX, y: pageY, width: clientWidth, height: clientHeight };
}
function screenshotCaptureParams(viewport) {
  const scale = Math.min(1, SCREENSHOT_MAX_EDGE / Math.max(viewport.width, viewport.height));
  return {
    format: "jpeg",
    quality: SCREENSHOT_JPEG_QUALITY,
    optimizeForSpeed: true,
    clip: { ...viewport, scale }
  };
}
function isScreenshotCdpMethod(method) {
  return method === "Page.captureScreenshot";
}
function isScreenshotCdpBatch(batchJson) {
  try {
    const batch = JSON.parse(batchJson);
    return Array.isArray(batch?.commands) && batch.commands.some((command) => isScreenshotCdpMethod(command?.method));
  } catch {
    return false;
  }
}

export { SCREENSHOT_JPEG_QUALITY, SCREENSHOT_MAX_EDGE, isScreenshotCdpBatch, isScreenshotCdpMethod, screenshotCaptureParams, screenshotData, screenshotViewport };
