import { cn } from "@/lib/cn";
import { DESTINATION_PHOTOS } from "@/lib/destinationPhotos";

/**
 * A generated, on-brand scene per town, used as the hero backdrop for any
 * town FYStay hasn't been supplied real photography of yet - the same
 * reasoning as the rest of this codebase's photography: never a
 * hotlinked or unlicensed stock photo standing in for a real place. Each
 * town gets a distinct, recognisable silhouette (Blackpool Tower and
 * illuminations, Lytham's windmill, St Annes' pier, Fleetwood's lighthouse,
 * Thornton-Cleveleys' open coast) drawn as a golden-hour scene in the same
 * warm terracotta/sand palette as the rest of the site (globals.css),
 * rather than a daytime teal sea, so every town's page still reads as one
 * brand. A town with real, licensed photography (see DESTINATION_PHOTOS)
 * uses that instead - see the early return below.
 *
 * Poulton-le-Fylde is the one genuinely inland town FYStay covers, and it
 * gets a different bottom half entirely - fields and a market-square
 * silhouette instead of sea, waves and sand (see INLAND_SLUGS below). A
 * real tourist site would slap the same beach photo on every town page;
 * deliberately not doing that for the one town that isn't on the coast is
 * a small, honest signal that FYStay actually knows the difference.
 */

const SKY_TOP: Record<string, string> = {
  blackpool: "#2a1410",
  lytham: "#241812",
  "st-annes": "#241511",
  "poulton-le-fylde": "#221a10",
  fleetwood: "#281712",
  "thornton-cleveleys": "#221510",
};

const INLAND_SLUGS = new Set(["poulton-le-fylde"]);

function Sky({ slug }: { slug: string }) {
  const top = SKY_TOP[slug] ?? "#2a1410";
  return (
    <linearGradient id="town-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={top} />
      <stop offset="45%" stopColor="#954328" />
      <stop offset="80%" stopColor="#d97757" />
      <stop offset="100%" stopColor="#fbbf24" />
    </linearGradient>
  );
}

function Gulls({ x, y }: { x: number; y: number }) {
  return (
    <g stroke="#fdf1e9" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" fill="none">
      <path d={`M${x} ${y}q14-16 28 0q14-16 28 0`} />
      <path d={`M${x + 70} ${y + 40}q10-11 20 0q10-11 20 0`} />
    </g>
  );
}

function Waves() {
  return (
    <>
      <path
        d="M0 300c60 14 120 14 180 0s120-14 180 0 120 14 180 0 120-14 180 0 120 14 180 0 120-14 180 0 120 14 180 0 120-14 180 0"
        fill="none"
        stroke="#e4b1a0"
        strokeOpacity="0.3"
        strokeWidth="3"
      />
      <path
        d="M0 330c60 12 120 12 180 0s120-12 180 0 120 12 180 0 120-12 180 0 120 12 180 0 120-12 180 0 120 12 180 0 120-12 180 0"
        fill="none"
        stroke="#e4b1a0"
        strokeOpacity="0.18"
        strokeWidth="3"
      />
    </>
  );
}

/** The inland equivalent of Waves() - a hedgerow/treeline silhouette along
 * the horizon instead of ripples, for Poulton-le-Fylde's fields rather than
 * a coastline. */
function Hedgerow() {
  return (
    <g fill="none" stroke="#e4b1a0" strokeOpacity="0.22" strokeWidth="3" strokeLinecap="round">
      <path d="M0 306q40-18 80 0t80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0 80 0" />
    </g>
  );
}

function BlackpoolScene() {
  const bulbColors = ["#fbbf24", "#f472b6", "#60a5fa", "#34d399"];
  return (
    <>
      {/* Big wheel, further back */}
      <g stroke="#22130f" strokeOpacity="0.7" strokeWidth="2.5" fill="none">
        <circle cx="1120" cy="230" r="70" />
        <circle cx="1120" cy="230" r="4" fill="#22130f" fillOpacity="0.7" stroke="none" />
        {Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4).map((a) => (
          <line
            key={a}
            x1={1120}
            y1={230}
            x2={1120 + 70 * Math.cos(a)}
            y2={230 + 70 * Math.sin(a)}
          />
        ))}
      </g>
      {/* Pier deck + struts */}
      <g stroke="#22130f" strokeWidth="4" strokeLinecap="round">
        <line x1="0" y1="296" x2="560" y2="296" />
        {Array.from({ length: 9 }, (_, i) => 60 + i * 62).map((x) => (
          <line key={x} x1={x} y1="296" x2={x - 22} y2="340" strokeWidth="3" />
        ))}
      </g>
      {/* Tower silhouette */}
      <g fill="none" stroke="#22130f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M340 296 300 90 260 296" />
        <path d="M275 210h50" />
        <path d="M285 150h30" />
        <line x1="300" y1="90" x2="300" y2="58" />
        <circle cx="300" cy="50" r="6" fill="#22130f" stroke="none" />
      </g>
      {/* Illumination bulb string along the prom */}
      <path
        d="M0 296q60 30 120 0t120 0 120 0 120 0 120 0 120 0 120 0"
        fill="none"
        stroke="#5c2323"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      {Array.from({ length: 14 }, (_, i) => i * 90).map((x, i) => (
        <circle key={x} cx={x} cy={296 + 22 * Math.sin((x / 720) * Math.PI * 2)} r="4.5" fill={bulbColors[i % bulbColors.length]} fillOpacity="0.85" />
      ))}
    </>
  );
}

function LythamScene() {
  return (
    <>
      {/* Pier posts, smaller/quieter than Blackpool's */}
      <g stroke="#22130f" strokeWidth="3" strokeLinecap="round">
        <line x1="1160" y1="296" x2="1440" y2="296" />
        {Array.from({ length: 5 }, (_, i) => 1200 + i * 60).map((x) => (
          <line key={x} x1={x} y1="296" x2={x + 16} y2="330" strokeWidth="2.5" />
        ))}
      </g>
      {/* Windmill on the green */}
      <g stroke="#22130f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M300 296V150" />
        <path d="M270 296h60" />
        <g strokeWidth="3.5">
          <path d="M300 150l52 18" />
          <path d="M300 150l-18 52" />
          <path d="M300 150l-52-18" />
          <path d="M300 150l18-52" />
        </g>
        <circle cx="300" cy="150" r="5" fill="#22130f" stroke="none" />
      </g>
      {/* Wide flat green foreground */}
      <rect y="296" width="1440" height="24" fill="#4a3220" fillOpacity="0.45" />
    </>
  );
}

function StAnnesScene() {
  return (
    <>
      {/* A longer, more prominent pier than Lytham's few posts - St Annes' own landmark */}
      <g stroke="#22130f" strokeWidth="3.5" strokeLinecap="round">
        <line x1="820" y1="296" x2="1440" y2="296" />
        {Array.from({ length: 10 }, (_, i) => 860 + i * 58).map((x) => (
          <line key={x} x1={x} y1="296" x2={x - 18} y2="336" strokeWidth="3" />
        ))}
        {/* A small pavilion at the pier head */}
        <path d="M1300 296V266h60v30" fill="none" />
      </g>
      {/* Ashton Gardens' bandstand, a domed cupola on the green */}
      <g stroke="#22130f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M240 296V246" />
        <path d="M210 246h60" />
        <path d="M205 246q30-26 70 0" />
        <line x1="240" y1="220" x2="240" y2="206" />
      </g>
      {/* Dune grass tufts */}
      <g stroke="#4a3220" strokeWidth="2.5" strokeLinecap="round" fill="none">
        {[420, 470, 520, 600, 650].map((x) => (
          <g key={x}>
            <path d={`M${x} 318q-6-14 0-22`} />
            <path d={`M${x + 8} 318q2-16 10-22`} />
            <path d={`M${x + 16} 318q10-10 8-20`} />
          </g>
        ))}
      </g>
    </>
  );
}

function CleveleysScene() {
  return (
    <>
      {/* Modern promenade shelters - simple angular canopies */}
      {[220, 420, 620].map((x) => (
        <g key={x} stroke="#22130f" strokeWidth="3.5" strokeLinecap="round" fill="none">
          <path d={`M${x} 296V250`} />
          <path d={`M${x - 46} 250h92l-14 -22h-64z`} />
        </g>
      ))}
      {/* Open, empty horizon - the point of Cleveleys is the lack of a landmark */}
      <g stroke="#e4b1a0" strokeOpacity="0.25" strokeWidth="2">
        <line x1="0" y1="300" x2="1440" y2="300" />
      </g>
      {/* Dune grass tufts */}
      <g stroke="#4a3220" strokeWidth="2.5" strokeLinecap="round" fill="none">
        {[900, 950, 1000, 1180, 1230].map((x) => (
          <g key={x}>
            <path d={`M${x} 318q-6-14 0-22`} />
            <path d={`M${x + 8} 318q2-16 10-22`} />
            <path d={`M${x + 16} 318q10-10 8-20`} />
          </g>
        ))}
      </g>
    </>
  );
}

function FleetwoodScene() {
  return (
    <>
      {/* Boat masts near the dock */}
      <g stroke="#22130f" strokeWidth="2.5" strokeLinecap="round">
        {[980, 1040, 1100].map((x, i) => (
          <line key={x} x1={x} y1="296" x2={x} y2={296 - 60 - i * 10} />
        ))}
      </g>
      {/* Lighthouse */}
      <g fill="none" stroke="#22130f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M280 296V140" />
        <path d="M270 296h20" />
        <path d="M264 150h32" />
        <path d="M270 140h20" />
        <rect x="271" y="105" width="18" height="20" fill="#22130f" stroke="none" />
      </g>
      {/* Lighthouse beam */}
      <path d="M300 112 L 460 60 L 460 90 Z" fill="#fef3c7" fillOpacity="0.22" />
      {/* Dock line */}
      <line x1="900" y1="296" x2="1440" y2="296" stroke="#22130f" strokeWidth="4" strokeLinecap="round" />
    </>
  );
}

/** Poulton-le-Fylde's own market square instead of a coastline - the
 * church tower, the market cross and stocks, and a row of market-town
 * gables where every other town's scene has a pier or a lighthouse. */
function PoultonScene() {
  return (
    <>
      {/* Terraced shopfront gables along the market square */}
      <g stroke="#22130f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {[880, 970, 1060, 1150].map((x) => (
          <path key={x} d={`M${x} 296V246l45-30 45 30v50`} />
        ))}
      </g>
      {/* St Chad's church tower, crenellated */}
      <g stroke="#22130f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M260 296V140h80V296" />
        <path d="M260 140v-16M282 140v-16M304 140v-16M326 140v-16M340 140v-16" />
        <path d="M285 296V220h30v76" />
      </g>
      {/* The market cross, with stocks alongside */}
      <g stroke="#22130f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M470 296V190" />
        <path d="M450 190h40l-20-24z" />
        <line x1="450" y1="296" x2="490" y2="296" />
      </g>
      <g stroke="#22130f" strokeWidth="3" strokeLinecap="round">
        <line x1="540" y1="296" x2="540" y2="266" />
        <line x1="600" y1="296" x2="600" y2="266" />
        <line x1="534" y1="266" x2="606" y2="266" />
        <line x1="534" y1="278" x2="606" y2="278" />
      </g>
    </>
  );
}

const SCENES: Record<string, () => React.ReactNode> = {
  blackpool: BlackpoolScene,
  lytham: LythamScene,
  "st-annes": StAnnesScene,
  "poulton-le-fylde": PoultonScene,
  fleetwood: FleetwoodScene,
  "thornton-cleveleys": CleveleysScene,
};

export function TownHeroArt({ slug, className }: { slug: string; className?: string }) {
  const Scene = SCENES[slug] ?? BlackpoolScene;
  const isInland = INLAND_SLUGS.has(slug);

  const photo = DESTINATION_PHOTOS[slug]?.hero;
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photo} alt="" className={cn("h-full w-full object-cover", className)} />
    );
  }

  return (
    <svg
      viewBox="0 0 1440 420"
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      className={cn("overflow-hidden", className)}
      aria-hidden
    >
      <defs>
        <Sky slug={slug} />
        <radialGradient id="town-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="town-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7a3a17" />
          <stop offset="100%" stopColor="#2a1410" />
        </linearGradient>
        <linearGradient id="town-sand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a3220" />
          <stop offset="100%" stopColor="#22130f" />
        </linearGradient>
        <linearGradient id="town-fields" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7a5a1f" />
          <stop offset="100%" stopColor="#2a2410" />
        </linearGradient>
      </defs>

      <rect width="1440" height="420" fill="url(#town-sky)" />
      <circle cx="180" cy="120" r="130" fill="url(#town-sun)" />
      <circle cx="180" cy="120" r="40" fill="#fef3c7" fillOpacity="0.9" />

      <g fill="#fdf1e9" fillOpacity="0.14">
        <ellipse cx="620" cy="80" rx="100" ry="26" />
        <ellipse cx="720" cy="65" rx="60" ry="18" />
        <ellipse cx="1220" cy="70" rx="110" ry="24" />
      </g>

      {!isInland && <Gulls x={520} y={130} />}

      {isInland ? (
        <>
          <rect y="300" width="1440" height="120" fill="url(#town-fields)" />
          <Hedgerow />
        </>
      ) : (
        <>
          <rect y="300" width="1440" height="120" fill="url(#town-sea)" />
          <Waves />
        </>
      )}

      <rect y="392" width="1440" height="28" fill="url(#town-sand)" />

      <Scene />
    </svg>
  );
}
