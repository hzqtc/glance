import type { PhotoItem, PhotosResponse } from '../types';

// Stock photos for the Photos slide's demo mode (open the dashboard with
// `?demo=photos`). Served from public/demo/photos/; see CREDITS.md there.
function demoPhoto(
  name: string,
  width: number,
  height: number,
  takenDate: string,
  location: string
): PhotoItem {
  var url = '/demo/photos/' + name + '.jpg';
  return {
    id: 'demo-' + name,
    fullUrl: url,
    tileUrl: url,
    width: width,
    height: height,
    aspect: width / height,
    takenDate: takenDate,
    location: location,
  };
}

var DEMO_PHOTOS: PhotoItem[] = [
  demoPhoto('l1015', 1400, 934, 'Aug 14, 2025', 'Geiranger, Norway'),
  demoPhoto('p1039', 800, 1200, 'Oct 3, 2025', 'Olympic National Park, WA'),
  demoPhoto('l1016', 1400, 934, 'Sep 19, 2025', 'Page, AZ'),
  demoPhoto('p15', 800, 1200, 'Jul 22, 2025', 'Banff, AB'),
  demoPhoto('l1018', 1400, 934, 'Jun 8, 2025', 'Isle of Skye, UK'),
  demoPhoto('p57', 800, 1200, 'Nov 12, 2025', 'New York City, NY'),
  demoPhoto('l1036', 1400, 934, 'Jan 27, 2026', 'Zermatt, Switzerland'),
  demoPhoto('p1047', 800, 1200, 'Apr 6, 2026', 'Lisbon, Portugal'),
  demoPhoto('l1043', 1400, 934, 'May 17, 2026', 'Yosemite Valley, CA'),
  demoPhoto('p1069', 800, 1200, 'Mar 29, 2026', 'Monterey, CA'),
  demoPhoto('l1050', 1400, 934, 'Feb 11, 2026', 'Big Sur, CA'),
  demoPhoto('p1044', 800, 1200, 'Jun 24, 2026', 'Vancouver, BC'),
  demoPhoto('l1051', 1400, 934, 'Jul 15, 2026', 'Lake Tahoe, CA'),
  demoPhoto('l1067', 1400, 934, 'Aug 30, 2026', 'San Francisco, CA'),
  demoPhoto('l29', 1400, 934, 'Oct 18, 2026', 'Dolomites, Italy'),
];

var PHOTOS_DEMO_MODE = (function () {
  try {
    return /[?&]demo=photos(&|$)/i.test(window.location.search || '');
  } catch (_err) {
    return false;
  }
})();

export function isPhotosDemoMode(): boolean {
  return PHOTOS_DEMO_MODE;
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
