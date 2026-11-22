import type { PhotoItem, PhotosResponse } from '../types';

// Stock photos for the Photos slide's demo mode (open the dashboard with
// `?demo=photos`). Served from public/demo/photos/; see CREDITS.md there.
function demoPhoto(name: string, width: number, height: number): PhotoItem {
  var url = '/demo/photos/' + name + '.jpg';
  return {
    id: 'demo-' + name,
    fullUrl: url,
    tileUrl: url,
    width: width,
    height: height,
    aspect: width / height,
  };
}

var DEMO_PHOTOS: PhotoItem[] = [
  demoPhoto('l1015', 1400, 934),
  demoPhoto('p1039', 800, 1200),
  demoPhoto('l1016', 1400, 934),
  demoPhoto('p15', 800, 1200),
  demoPhoto('l1018', 1400, 934),
  demoPhoto('p57', 800, 1200),
  demoPhoto('l1036', 1400, 934),
  demoPhoto('p1047', 800, 1200),
  demoPhoto('l1043', 1400, 934),
  demoPhoto('p1069', 800, 1200),
  demoPhoto('l1050', 1400, 934),
  demoPhoto('p1044', 800, 1200),
  demoPhoto('l1051', 1400, 934),
  demoPhoto('l1067', 1400, 934),
  demoPhoto('l29', 1400, 934),
];

export function isPhotosDemoMode(): boolean {
  try {
    return /[?&]demo=photos(&|$)/i.test(window.location.search || '');
  } catch (_err) {
    return false;
  }
}

export function getDemoPhotosResponse(): PhotosResponse {
  return {
    fetchedAt: new Date().toISOString(),
    configured: true,
    albumCount: 1,
    photoCount: DEMO_PHOTOS.length,
    photos: DEMO_PHOTOS,
  };
}
