/**
 * Sector vocabulary for project type detection.
 * Phrases carry more weight than isolated keywords.
 * Generic terms (plant, services, mechanical) are excluded or require combinations.
 */

export type PatternKind = "phrase" | "keyword" | "combo";

export type VocabularyPattern = {
  pattern: RegExp;
  weight: number;
  kind: PatternKind;
  label: string;
};

export type SectorVocabulary = {
  sector: string;
  phrases: VocabularyPattern[];
  keywords: VocabularyPattern[];
  combos?: { patterns: RegExp[]; weight: number; label: string }[];
};

export const SECTOR_VOCABULARIES: SectorVocabulary[] = [
  {
    sector: "Healthcare",
    phrases: [
      { pattern: /\boperating\s+theatre\b/i, weight: 8, kind: "phrase", label: "operating theatre" },
      { pattern: /\bplant\s+room\b/i, weight: 7, kind: "phrase", label: "plant room" },
      { pattern: /\bmedical\s+gas\b/i, weight: 8, kind: "phrase", label: "medical gas" },
      { pattern: /\bemergency\s+care\b/i, weight: 8, kind: "phrase", label: "emergency care" },
      { pattern: /\bemergency\s+department\b/i, weight: 8, kind: "phrase", label: "emergency department" },
      { pattern: /\bhealth\s+centre\b/i, weight: 7, kind: "phrase", label: "health centre" },
      { pattern: /\binfection\s+control\b/i, weight: 7, kind: "phrase", label: "infection control" },
      { pattern: /\bclinical\s+area\b/i, weight: 7, kind: "phrase", label: "clinical area" },
      { pattern: /\bacute\s+hospital\b/i, weight: 8, kind: "phrase", label: "acute hospital" },
      { pattern: /\bhospital\s+ward\b/i, weight: 7, kind: "phrase", label: "hospital ward" },
      { pattern: /\bcare\s+building\b/i, weight: 6, kind: "phrase", label: "care building" },
    ],
    keywords: [
      { pattern: /\bhospital\b/i, weight: 5, kind: "keyword", label: "hospital" },
      { pattern: /\bhealthcare\b/i, weight: 5, kind: "keyword", label: "healthcare" },
      { pattern: /\bclinical\b/i, weight: 4, kind: "keyword", label: "clinical" },
      { pattern: /\bpatient\b/i, weight: 4, kind: "keyword", label: "patient" },
      { pattern: /\bmri\b/i, weight: 5, kind: "keyword", label: "mri" },
      { pattern: /\bicu\b/i, weight: 5, kind: "keyword", label: "icu" },
      { pattern: /\bward\b/i, weight: 3, kind: "keyword", label: "ward" },
      { pattern: /\btheatre\b/i, weight: 3, kind: "keyword", label: "theatre" },
      { pattern: /\bpharmacy\b/i, weight: 4, kind: "keyword", label: "pharmacy" },
      { pattern: /\bclinic\b/i, weight: 4, kind: "keyword", label: "clinic" },
    ],
  },
  {
    sector: "Education",
    phrases: [
      { pattern: /\bteaching\s+block\b/i, weight: 7, kind: "phrase", label: "teaching block" },
      { pattern: /\bstudent\s+accommodation\b/i, weight: 7, kind: "phrase", label: "student accommodation" },
      { pattern: /\blecture\s+theatre\b/i, weight: 7, kind: "phrase", label: "lecture theatre" },
    ],
    keywords: [
      { pattern: /\bschool\b/i, weight: 4, kind: "keyword", label: "school" },
      { pattern: /\buniversity\b/i, weight: 5, kind: "keyword", label: "university" },
      { pattern: /\bcollege\b/i, weight: 4, kind: "keyword", label: "college" },
      { pattern: /\bcampus\b/i, weight: 4, kind: "keyword", label: "campus" },
      { pattern: /\beducation\b/i, weight: 4, kind: "keyword", label: "education" },
      { pattern: /\bclassroom\b/i, weight: 4, kind: "keyword", label: "classroom" },
    ],
  },
  {
    sector: "Rail",
    phrases: [
      { pattern: /\bnetwork\s+rail\b/i, weight: 9, kind: "phrase", label: "network rail" },
      { pattern: /\btrack\s+renewal\b/i, weight: 7, kind: "phrase", label: "track renewal" },
      { pattern: /\bsignalling\s+system\b/i, weight: 7, kind: "phrase", label: "signalling system" },
      { pattern: /\bplatform\s+extension\b/i, weight: 6, kind: "phrase", label: "platform extension" },
    ],
    keywords: [
      { pattern: /\brail\b/i, weight: 4, kind: "keyword", label: "rail" },
      { pattern: /\btrack\b/i, weight: 3, kind: "keyword", label: "track" },
      { pattern: /\bstation\b/i, weight: 4, kind: "keyword", label: "station" },
      { pattern: /\bsignalling\b/i, weight: 4, kind: "keyword", label: "signalling" },
      { pattern: /\bdepot\b/i, weight: 4, kind: "keyword", label: "depot" },
      { pattern: /\bplatform\b/i, weight: 3, kind: "keyword", label: "platform" },
    ],
  },
  {
    sector: "Road",
    phrases: [
      { pattern: /\bnational\s+highways\b/i, weight: 8, kind: "phrase", label: "national highways" },
      { pattern: /\bhighways\s+england\b/i, weight: 8, kind: "phrase", label: "highways england" },
      { pattern: /\bmotorway\s+junction\b/i, weight: 7, kind: "phrase", label: "motorway junction" },
      { pattern: /\bcarriageway\s+construction\b/i, weight: 7, kind: "phrase", label: "carriageway construction" },
    ],
    keywords: [
      { pattern: /\bhighway\b/i, weight: 4, kind: "keyword", label: "highway" },
      { pattern: /\bmotorway\b/i, weight: 5, kind: "keyword", label: "motorway" },
      { pattern: /\bjunction\b/i, weight: 3, kind: "keyword", label: "junction" },
      { pattern: /\bpavement\b/i, weight: 3, kind: "keyword", label: "pavement" },
      { pattern: /\bcarriageway\b/i, weight: 4, kind: "keyword", label: "carriageway" },
      { pattern: /\broadworks\b/i, weight: 4, kind: "keyword", label: "roadworks" },
    ],
  },
  {
    sector: "Bridge",
    phrases: [
      { pattern: /\bbridge\s+deck\b/i, weight: 7, kind: "phrase", label: "bridge deck" },
      { pattern: /\babutment\s+construction\b/i, weight: 7, kind: "phrase", label: "abutment construction" },
    ],
    keywords: [
      { pattern: /\bbridge\b/i, weight: 5, kind: "keyword", label: "bridge" },
      { pattern: /\bviaduct\b/i, weight: 5, kind: "keyword", label: "viaduct" },
      { pattern: /\babutment\b/i, weight: 4, kind: "keyword", label: "abutment" },
      { pattern: /\bpier\b/i, weight: 3, kind: "keyword", label: "pier" },
    ],
  },
  {
    sector: "Commercial",
    phrases: [
      { pattern: /\boffice\s+building\b/i, weight: 6, kind: "phrase", label: "office building" },
      { pattern: /\bshopping\s+centre\b/i, weight: 7, kind: "phrase", label: "shopping centre" },
    ],
    keywords: [
      { pattern: /\boffice\b/i, weight: 3, kind: "keyword", label: "office" },
      { pattern: /\bcommercial\b/i, weight: 4, kind: "keyword", label: "commercial" },
      { pattern: /\bretail\b/i, weight: 3, kind: "keyword", label: "retail" },
      { pattern: /\btower\b/i, weight: 3, kind: "keyword", label: "tower" },
    ],
  },
  {
    sector: "Residential",
    phrases: [
      { pattern: /\bhousing\s+development\b/i, weight: 7, kind: "phrase", label: "housing development" },
      { pattern: /\bresidential\s+block\b/i, weight: 6, kind: "phrase", label: "residential block" },
    ],
    keywords: [
      { pattern: /\bresidential\b/i, weight: 4, kind: "keyword", label: "residential" },
      { pattern: /\bapartment\b/i, weight: 4, kind: "keyword", label: "apartment" },
      { pattern: /\bhousing\b/i, weight: 3, kind: "keyword", label: "housing" },
      { pattern: /\bdwellings\b/i, weight: 4, kind: "keyword", label: "dwellings" },
      { pattern: /\bflats\b/i, weight: 3, kind: "keyword", label: "flats" },
    ],
  },
  {
    sector: "Utilities",
    phrases: [
      { pattern: /\bwater\s+treatment\b/i, weight: 7, kind: "phrase", label: "water treatment" },
      { pattern: /\bpower\s+substation\b/i, weight: 7, kind: "phrase", label: "power substation" },
    ],
    keywords: [
      { pattern: /\butilities\b/i, weight: 4, kind: "keyword", label: "utilities" },
      { pattern: /\bsubstation\b/i, weight: 4, kind: "keyword", label: "substation" },
      { pattern: /\bpipeline\b/i, weight: 3, kind: "keyword", label: "pipeline" },
      { pattern: /\bsewer\b/i, weight: 3, kind: "keyword", label: "sewer" },
    ],
  },
  {
    sector: "Industrial",
    phrases: [
      { pattern: /\bprocess\s+plant\b/i, weight: 8, kind: "phrase", label: "process plant" },
      { pattern: /\bmanufacturing\s+plant\b/i, weight: 8, kind: "phrase", label: "manufacturing plant" },
      { pattern: /\bproduction\s+plant\b/i, weight: 8, kind: "phrase", label: "production plant" },
      { pattern: /\bindustrial\s+warehouse\b/i, weight: 7, kind: "phrase", label: "industrial warehouse" },
    ],
    keywords: [
      { pattern: /\bindustrial\b/i, weight: 5, kind: "keyword", label: "industrial" },
      { pattern: /\bfactory\b/i, weight: 5, kind: "keyword", label: "factory" },
      { pattern: /\bmanufacturing\b/i, weight: 5, kind: "keyword", label: "manufacturing" },
      { pattern: /\bwarehouse\b/i, weight: 3, kind: "keyword", label: "warehouse" },
    ],
    combos: [
      {
        label: "plant + industrial context",
        patterns: [/\bplant\b/i, /\b(?:factory|manufacturing|production|process|industrial)\b/i],
        weight: 10,
      },
    ],
  },
  {
    sector: "Airport",
    phrases: [
      { pattern: /\bairport\s+terminal\b/i, weight: 8, kind: "phrase", label: "airport terminal" },
      { pattern: /\brunway\s+extension\b/i, weight: 7, kind: "phrase", label: "runway extension" },
    ],
    keywords: [
      { pattern: /\bairport\b/i, weight: 5, kind: "keyword", label: "airport" },
      { pattern: /\brunway\b/i, weight: 5, kind: "keyword", label: "runway" },
      { pattern: /\bairfield\b/i, weight: 5, kind: "keyword", label: "airfield" },
    ],
  },
  {
    sector: "Marine",
    phrases: [
      { pattern: /\bmarine\s+works\b/i, weight: 7, kind: "phrase", label: "marine works" },
      { pattern: /\bjetty\s+construction\b/i, weight: 7, kind: "phrase", label: "jetty construction" },
    ],
    keywords: [
      { pattern: /\bmarine\b/i, weight: 5, kind: "keyword", label: "marine" },
      { pattern: /\bharbour\b/i, weight: 5, kind: "keyword", label: "harbour" },
      { pattern: /\bjetty\b/i, weight: 4, kind: "keyword", label: "jetty" },
      { pattern: /\bquay\b/i, weight: 4, kind: "keyword", label: "quay" },
    ],
  },
];

export const SECTOR_CONFLICT_PAIRS: [string, string][] = [
  ["Healthcare", "Industrial"],
  ["Healthcare", "Commercial"],
  ["Rail", "Commercial"],
  ["Education", "Healthcare"],
];

export type ClientPattern = {
  label: string;
  patterns: { pattern: RegExp; weight: number; kind: PatternKind }[];
};

export const CLIENT_VOCABULARY: ClientPattern[] = [
  {
    label: "NHS Trust",
    patterns: [
      { pattern: /\bnhs\s+trust\b/i, weight: 10, kind: "phrase" },
      { pattern: /\bnhs\s+foundation\s+trust\b/i, weight: 10, kind: "phrase" },
      { pattern: /\bfoundation\s+trust\b/i, weight: 8, kind: "phrase" },
      { pattern: /\buniversity\s+hospitals?\b/i, weight: 9, kind: "phrase" },
      { pattern: /\bnhs\b/i, weight: 5, kind: "keyword" },
      { pattern: /\bintegrated\s+care\s+board\b/i, weight: 8, kind: "phrase" },
      { pattern: /\bhealth\s+board\b/i, weight: 7, kind: "phrase" },
    ],
  },
  {
    label: "Network Rail",
    patterns: [
      { pattern: /\bnetwork\s+rail(?:\s+infrastructure)?(?:\s+ltd)?\b/i, weight: 10, kind: "phrase" },
    ],
  },
  {
    label: "National Highways",
    patterns: [
      { pattern: /\bnational\s+highways\b/i, weight: 10, kind: "phrase" },
      { pattern: /\bhighways\s+england\b/i, weight: 10, kind: "phrase" },
    ],
  },
  {
    label: "Transport for London",
    patterns: [
      { pattern: /\btransport\s+for\s+london\b/i, weight: 10, kind: "phrase" },
      { pattern: /\btfl\b/i, weight: 7, kind: "keyword" },
    ],
  },
  {
    label: "Crossrail",
    patterns: [
      { pattern: /\bcrossrail\b/i, weight: 10, kind: "phrase" },
      { pattern: /\belizabeth\s+line\b/i, weight: 9, kind: "phrase" },
    ],
  },
  {
    label: "HS2",
    patterns: [
      { pattern: /\bhigh\s+speed\s+2\b/i, weight: 10, kind: "phrase" },
      { pattern: /\bhs2\b/i, weight: 8, kind: "keyword" },
    ],
  },
  {
    label: "Ministry of Justice",
    patterns: [
      { pattern: /\bministry\s+of\s+justice\b/i, weight: 10, kind: "phrase" },
      { pattern: /\bmoj\b/i, weight: 6, kind: "keyword" },
    ],
  },
  {
    label: "Housing Association",
    patterns: [{ pattern: /\bhousing\s+association\b/i, weight: 9, kind: "phrase" }],
  },
  {
    label: "University",
    patterns: [
      { pattern: /\buniversity\s+of\b/i, weight: 8, kind: "phrase" },
      { pattern: /\buniversity\b/i, weight: 5, kind: "keyword" },
    ],
  },
  {
    label: "Airport Authority",
    patterns: [
      { pattern: /\bairport\s+authority\b/i, weight: 9, kind: "phrase" },
      { pattern: /\bheathrow\b/i, weight: 7, kind: "keyword" },
      { pattern: /\bgatwick\b/i, weight: 7, kind: "keyword" },
    ],
  },
  {
    label: "Local Authority",
    patterns: [
      { pattern: /\blocal\s+authority\b/i, weight: 8, kind: "phrase" },
      { pattern: /\bcity\s+council\b/i, weight: 7, kind: "phrase" },
      { pattern: /\bcounty\s+council\b/i, weight: 7, kind: "phrase" },
    ],
  },
];

export const STAGE_CONTENT_SIGNALS = {
  construction: [
    /\bsteelwork\b/i,
    /\breinforcement\b/i,
    /\bconcrete\b/i,
    /\bexcavation\b/i,
    /\bdrainage\b/i,
    /\bcivils?\b/i,
    /\bstructures?\b/i,
    /\bfacade\b/i,
    /\bfoundations?\b/i,
    /\bpiling\b/i,
    /\bsuperstructure\b/i,
  ],
  planning: [
    /\bfeasibility\b/i,
    /\bplanning\s+application\b/i,
    /\bconcept\s+design\b/i,
    /\bmasterplan\b/i,
  ],
  procurement: [/\btender\b/i, /\bprocurement\b/i, /\bcontract\s+award\b/i, /\bpre-?qualification\b/i],
  commissioning: [/\bcommissioning\b/i, /\bhandover\b/i, /\bpractical\s+completion\b/i],
};
