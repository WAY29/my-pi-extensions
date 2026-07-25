import assert from 'node:assert/strict';
import test from 'node:test';
import { isScreenshotCdpBatch, isScreenshotCdpMethod, screenshotCaptureParams, screenshotViewport } from '../dist/screenshot.js';

test('screenshots are constrained to a 1280px JPEG viewport', () => {
  const viewport = screenshotViewport({
    cssVisualViewport: { pageX: 12, pageY: 34, clientWidth: 3840, clientHeight: 2160 },
  });
  assert.deepEqual(viewport, { x: 12, y: 34, width: 3840, height: 2160 });
  assert.deepEqual(screenshotCaptureParams(viewport), {
    format: 'jpeg',
    quality: 60,
    optimizeForSpeed: true,
    clip: { x: 12, y: 34, width: 3840, height: 2160, scale: 1 / 3 },
  });
});

test('generic CDP batches cannot return a raw screenshot', () => {
  assert.equal(isScreenshotCdpMethod('Page.captureScreenshot'), true);
  assert.equal(isScreenshotCdpMethod('Page.getLayoutMetrics'), false);
  assert.equal(isScreenshotCdpBatch('{"cmd":"batch","commands":[{"method":"Page.captureScreenshot"}]}'), true);
  assert.equal(isScreenshotCdpBatch('{"cmd":"batch","commands":[{"method":"Page.getLayoutMetrics"}]}'), false);
});
