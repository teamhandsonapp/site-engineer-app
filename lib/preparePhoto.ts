import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Phone cameras produce 12-50 MP photos (often 4-10 MB as JPEG, ~33% more as
// base64). Shrink every photo before upload so it's small enough to send on a
// site network without running low-RAM phones out of memory: longest edge
// 1600px, JPEG quality 0.6 — typically ~200-400 KB, still clear for a DPR.
// The upload-dpr-photo function still receives base64 JPEG, as before.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.6;

export async function preparePhotoForUpload(asset: { uri: string; width: number; height: number }): Promise<{ base64: string; contentType: 'image/jpeg' }> {
  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width || 0, asset.height || 0);
  if (longest > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  if (!saved.base64) throw new Error('Could not prepare the photo for upload.');
  return { base64: saved.base64, contentType: 'image/jpeg' };
}
