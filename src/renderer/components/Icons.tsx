/** Line icons, drawn on a 20×20 grid to stay crisp at rail size. */

interface P { size?: number; className?: string }
const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 20 20',
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
});

export const IconBible = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 3.5h9a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H4z" />
    <path d="M4 3.5v13" /><path d="M9.5 7v5M7.5 9.5h4" />
  </svg>
);

export const IconSong = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7.5 14.5V4.8l7-1.4v9.6" />
    <circle cx="5.8" cy="14.8" r="1.9" /><circle cx="12.8" cy="13" r="1.9" />
  </svg>
);

export const IconPlan = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="4" width="13" height="12.5" rx="1.8" />
    <path d="M3.5 7.6h13M7 2.5v2.6M13 2.5v2.6M6.6 11h2M6.6 13.7h5" />
  </svg>
);

export const IconTheme = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="10" cy="10" r="6.8" />
    <path d="M10 3.2c3 2.4 3 11.2 0 13.6" /><path d="M3.4 8.4h13.2M3.4 11.6h13.2" />
  </svg>
);

export const IconMedia = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4.5" width="14" height="11" rx="1.8" />
    <path d="m3 12.5 3.4-3a1.4 1.4 0 0 1 1.9 0L12 13" />
    <circle cx="12.9" cy="8.2" r="1.3" />
  </svg>
);

export const IconDetect = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="7.6" y="2.6" width="4.8" height="9" rx="2.4" />
    <path d="M4.6 9.6a5.4 5.4 0 0 0 10.8 0M10 15v2.4" />
  </svg>
);

export const IconDisplays = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2.5" y="4" width="10.5" height="8" rx="1.5" />
    <path d="M15 6.5h2.5v8H8.5M6.5 15.5h4" />
  </svg>
);

export const IconStudy = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="9" r="5.4" /><path d="m13 13 4 4" /><path d="M9 6.6v4.8M6.6 9h4.8" />
  </svg>
);

export const IconSettings = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.6v2M10 15.4v2M17.4 10h-2M4.6 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2 4.8 4.8" />
  </svg>
);

export const IconSearch = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="8.6" cy="8.6" r="5.4" /><path d="m12.8 12.8 4 4" /></svg>
);

export const IconPlus = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}><path d="M10 4.5v11M4.5 10h11" /></svg>
);

export const IconTrash = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3.6 5.4h12.8M8 5.4V3.8h4v1.6M5.4 5.4l.7 10.2h7.8l.7-10.2" />
  </svg>
);

export const IconChevron = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}><path d="m7.5 4.5 5 5.5-5 5.5" /></svg>
);

export const IconDown = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}><path d="m4.5 7.5 5.5 5 5.5-5" /></svg>
);

export const IconClose = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}><path d="m5 5 10 10M15 5 5 15" /></svg>
);

export const IconImport = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}><path d="M10 3v9M6.4 8.6 10 12.2l3.6-3.6M3.6 15.4h12.8" /></svg>
);

export const IconCheck = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}><path d="m4.5 10.4 3.6 3.6 7.4-8" /></svg>
);
