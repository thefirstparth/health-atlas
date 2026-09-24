// One line-icon set for the chapters, shared by the dashboard and the home page. 20 x 20 grid, 1.6 stroke.
export const ICON = {
  overview: '<circle cx="10" cy="10" r="7"/><path d="M10 3v2.4M10 14.6V17M3 10h2.4M14.6 10H17"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/>',
  heart: '<path d="M10 16.4S3.4 12.6 3.4 7.9A3.5 3.5 0 0 1 10 6a3.5 3.5 0 0 1 6.6 1.9c0 4.7-6.6 8.5-6.6 8.5Z"/>',
  stress: '<path d="M2 10.5h3.1l1.5-4.2 2.6 8.2 2-6.3 1.3 2.3H18"/>',
  sleep: '<path d="M15.8 12.4A6.6 6.6 0 0 1 7.6 4.2a6.6 6.6 0 1 0 8.2 8.2Z"/><path d="M14.2 3v2.6M12.9 4.3h2.6"/>',
  activity: '<path d="M10 2.6a7.4 7.4 0 1 1-7.4 7.4"/><path d="M10 5.4a4.6 4.6 0 1 1-4.6 4.6"/><path d="M10 8.2A1.8 1.8 0 1 1 8.2 10"/>',
  workouts: '<circle cx="10" cy="11.2" r="5.9"/><path d="M10 11.2V8.1M8.3 2.6h3.4M15 5.6l1.2-1.2"/>',
  mobility: '<ellipse cx="6.7" cy="6.2" rx="2.1" ry="3.1"/><circle cx="7.1" cy="11.6" r="1.3"/><ellipse cx="13.3" cy="9.4" rx="2.1" ry="3.1"/><circle cx="12.9" cy="14.8" r="1.3"/>',
  env: '<circle cx="7.2" cy="10" r="2.9"/><path d="M7.2 3.4v1.4M7.2 15.2v1.4M1.8 10h1.3M3.4 6.2l.9.9M3.4 13.8l.9-.9M13 7.2a4.2 4.2 0 0 1 0 5.6M15.6 5a7.4 7.4 0 0 1 0 10"/>',
  body: '<circle cx="10" cy="5.8" r="2.6"/><path d="M4.4 17.2a5.6 5.6 0 0 1 11.2 0"/>',
};
export const iconSvg = id => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[id]}</svg>`;
