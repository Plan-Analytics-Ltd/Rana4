/**
 * Hierarchical taxonomy data: Discipline → Category → Work Package.
 * Extend by adding categories, work packages, aliases, and keywords here.
 */

import type { DisciplineDefinition } from "./workPackageTaxonomy.types.js";

export const WORK_PACKAGE_TAXONOMY: DisciplineDefinition[] = [
  {
    id: "structural",
    label: "Structural",
    fragnetPatterns: ["structural", "structures", "steelwork", "foundations", "reinforcement"],
    activityCodePatterns: ["structural", "structures", "steel"],
    keywords: [
      { pattern: "structural", priority: 10 },
      { pattern: "steel", priority: 9 },
      { pattern: "concrete", priority: 8 },
      { pattern: "rebar", priority: 9 },
      { pattern: "reinforcement", priority: 9 },
      { pattern: "wall", priority: 6 },
      { pattern: "column", priority: 7 },
      { pattern: "beam", priority: 7 },
      { pattern: "foundation", priority: 8 },
    ],
    namePatterns: ["structural", "reinforcement", "steelwork", "foundation"],
    categories: [
      {
        id: "design",
        label: "Design",
        workPackages: [
          { id: "general_arrangements", label: "General Arrangements", deliverablePatterns: ["general arrangements", "ga drawings", "core general arrangement"] },
          { id: "wall_elevations", label: "Wall Elevations", deliverablePatterns: ["wall elevation", "wall elevations"] },
          { id: "column_elevations", label: "Column Elevations", deliverablePatterns: ["column elevation", "column elevations"] },
          { id: "structural_design", label: "Structural Design", deliverablePatterns: ["structural design", "foundation design", "analysis and design"] },
        ],
      },
      {
        id: "detailing",
        label: "Detailing",
        workPackages: [
          { id: "reinforcement_detailing", label: "Reinforcement Detailing", deliverablePatterns: ["reinforcement detailing", "reinforcement detail", "rebar detailing", "reinforcement intent", "reinforcement review", "reinforcement check", "reinforcement update"] },
          { id: "steelwork", label: "Steelwork", deliverablePatterns: ["steelwork", "primary steelwork", "secondary steelwork", "structural steel"] },
        ],
      },
      {
        id: "bim",
        label: "BIM",
        workPackages: [
          { id: "model_drawing_development", label: "Model / Drawing Development", deliverablePatterns: ["model drawing development", "model drawing", "model development", "drawing development"] },
        ],
      },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    fragnetPatterns: ["architectural", "architecture", "arch"],
    activityCodePatterns: ["architectural", "architecture", "arch"],
    keywords: [{ pattern: "architectural", priority: 10 }, { pattern: "architecture", priority: 10 }],
    namePatterns: ["architectural", "architecture", "room data", "door schedule"],
    categories: [
      {
        id: "design",
        label: "Design",
        workPackages: [
          { id: "general_arrangements", label: "General Arrangements", deliverablePatterns: ["general arrangements", "setting out", "architectural setting out"] },
          { id: "wall_elevations", label: "Wall Elevations", deliverablePatterns: ["wall elevation", "wall elevations"] },
          { id: "room_data", label: "Room Data", deliverablePatterns: ["room data", "room schedule"] },
          { id: "door_schedules", label: "Door Schedules", deliverablePatterns: ["door schedule", "door schedules"] },
        ],
      },
      {
        id: "documentation",
        label: "Documentation",
        workPackages: [
          { id: "specifications", label: "Specifications", deliverablePatterns: ["specification", "specifications", "equipment specification"] },
        ],
      },
    ],
  },
  {
    id: "mechanical",
    label: "Mechanical",
    fragnetPatterns: ["mechanical", "hvac", "building services"],
    activityCodePatterns: ["mechanical", "hvac", "mep"],
    keywords: [
      { pattern: "mechanical", priority: 10 },
      { pattern: "\\bmep\\b", priority: 11, type: "regex" },
      { pattern: "hvac", priority: 9 },
      { pattern: "building services", priority: 8 },
      { pattern: "piping", priority: 8 },
      { pattern: "pipe", priority: 7 },
      { pattern: "ventilation", priority: 8 },
      { pattern: "plant", priority: 7 },
    ],
    namePatterns: ["mechanical", "hvac", "ventilation", "mep", "building services"],
    categories: [
      {
        id: "documentation",
        label: "Documentation",
        workPackages: [
          { id: "design_drawings", label: "Design Drawings", deliverablePatterns: ["design drawings", "mechanical drawing", "services drawing"] },
          { id: "design_reports", label: "Design Reports", deliverablePatterns: ["design reports"] },
          { id: "design_schedules", label: "Design Schedules", deliverablePatterns: ["design schedules"] },
          { id: "technical_notes", label: "Technical Notes", deliverablePatterns: ["technical notes"] },
        ],
      },
      {
        id: "bim",
        label: "BIM",
        workPackages: [
          { id: "model_drawing_development", label: "Model / Drawing Development", deliverablePatterns: ["model drawing development", "model development", "drawing development"] },
          { id: "models_3d", label: "3D Models", deliverablePatterns: ["3d model", "bim model"] },
        ],
      },
      {
        id: "coordination",
        label: "Coordination",
        workPackages: [
          { id: "model_coordination", label: "Model Coordination", deliverablePatterns: ["model coordination", "bim coordination", "clash detection"] },
        ],
      },
    ],
  },
  {
    id: "electrical",
    label: "Electrical",
    fragnetPatterns: ["electrical", "lighting", "power"],
    activityCodePatterns: ["electrical", "lighting"],
    keywords: [
      { pattern: "electrical", priority: 10 },
      { pattern: "power", priority: 8 },
      { pattern: "lighting", priority: 8 },
      { pattern: "\\blv\\b", priority: 8, type: "regex" },
      { pattern: "\\bhv\\b", priority: 8, type: "regex" },
      { pattern: "elv", priority: 8 },
      { pattern: "cable", priority: 7 },
      { pattern: "cabling", priority: 7 },
    ],
    namePatterns: ["electrical", "lighting", "power", "elv"],
    categories: [
      {
        id: "documentation",
        label: "Documentation",
        workPackages: [
          { id: "design_drawings", label: "Design Drawings", deliverablePatterns: ["design drawings", "electrical drawing"] },
          { id: "technical_notes", label: "Technical Notes", deliverablePatterns: ["technical notes"] },
          { id: "design_reports", label: "Design Reports", deliverablePatterns: ["design reports"] },
        ],
      },
    ],
  },
  {
    id: "public_health",
    label: "Public Health",
    fragnetPatterns: ["public health", "ph ", "drainage design", "drainage"],
    activityCodePatterns: ["public health", "ph", "drainage"],
    keywords: [
      { pattern: "public health", priority: 10 },
      { pattern: "\\bph\\b", priority: 9, type: "regex" },
      { pattern: "drainage", priority: 9 },
      { pattern: "sanitary", priority: 8 },
      { pattern: "water services", priority: 8 },
      { pattern: "plumbing", priority: 8 },
      { pattern: "above ground drainage", priority: 9 },
      { pattern: "below ground drainage", priority: 9 },
    ],
    namePatterns: ["public health", "drainage", "above ground drainage", "below ground drainage"],
    categories: [
      {
        id: "design",
        label: "Design",
        workPackages: [
          { id: "drainage_design", label: "Drainage Design", deliverablePatterns: ["drainage design", "drainage", "additional drainage", "drainage works"] },
        ],
      },
      {
        id: "documentation",
        label: "Documentation",
        workPackages: [
          { id: "design_drawings", label: "Design Drawings", deliverablePatterns: ["design drawings", "drainage drawing"] },
          { id: "technical_notes", label: "Technical Notes", deliverablePatterns: ["technical notes"] },
        ],
      },
    ],
  },
  {
    id: "fire_engineering",
    label: "Fire Engineering",
    fragnetPatterns: ["fire", "fire engineering"],
    activityCodePatterns: ["fire"],
    keywords: [
      { pattern: "fire and safety", priority: 11 },
      { pattern: "fire safety", priority: 10 },
      { pattern: "fire strategy", priority: 10 },
      { pattern: "fire report", priority: 9 },
      { pattern: "fire engineering", priority: 10 },
      { pattern: "\\bfire\\b", priority: 8, type: "regex" },
      { pattern: "smoke", priority: 7 },
      { pattern: "evacuation", priority: 7 },
    ],
    namePatterns: ["fire strategy", "fire engineering", "fire safety", "fire and safety", "fire"],
    categories: [
      {
        id: "documentation",
        label: "Documentation",
        workPackages: [
          { id: "fire_strategy", label: "Fire Strategy", deliverablePatterns: ["fire strategy"] },
          { id: "fire_reports", label: "Fire Reports", deliverablePatterns: ["fire report", "fire engineering report", "fire reports"] },
          { id: "fire_drawings", label: "Fire Drawings", deliverablePatterns: ["fire drawing", "fire drawings", "fire protection drawing"] },
        ],
      },
    ],
  },
  {
    id: "acoustics",
    label: "Acoustics",
    fragnetPatterns: ["acoustic", "acoustics"],
    activityCodePatterns: ["acoustic", "acoustics"],
    keywords: [{ pattern: "acoustic", priority: 10 }, { pattern: "noise", priority: 8 }, { pattern: "vibration", priority: 8 }],
    namePatterns: ["acoustic", "acoustics"],
    categories: [
      {
        id: "documentation",
        label: "Documentation",
        workPackages: [
          { id: "acoustic_reports", label: "Acoustic Reports", deliverablePatterns: ["acoustic report", "acoustics report"] },
          { id: "technical_notes", label: "Technical Notes", deliverablePatterns: ["technical notes"] },
        ],
      },
    ],
  },
  {
    id: "civil",
    label: "Civil",
    fragnetPatterns: ["civil", "civils", "earthworks", "enabling works"],
    activityCodePatterns: ["civil", "civils"],
    keywords: [{ pattern: "civil", priority: 10 }, { pattern: "enabling works", priority: 8 }],
    namePatterns: ["civil", "enabling works", "earthworks", "external works"],
    categories: [
      {
        id: "works",
        label: "Works",
        workPackages: [
          { id: "enabling_works", label: "Enabling Works", deliverablePatterns: ["enabling works", "enabling work"] },
          { id: "external_works", label: "External Works", deliverablePatterns: ["external works", "additional structural works"] },
        ],
      },
    ],
  },
  {
    id: "ground_investigation",
    label: "Ground Investigation",
    fragnetPatterns: ["ground investigation", "gi ", "geotechnical"],
    activityCodePatterns: ["ground investigation", "geotechnical", "gi"],
    keywords: [
      { pattern: "ground investigation", priority: 10 },
      { pattern: "geotechnical", priority: 9 },
      { pattern: "\\bgi\\b", priority: 8, type: "regex" },
      { pattern: "borehole", priority: 8 },
    ],
    namePatterns: ["ground investigation", "geotechnical", "\\bgi\\b"],
    categories: [
      {
        id: "investigation",
        label: "Investigation",
        workPackages: [
          { id: "ground_investigation", label: "Ground Investigation", deliverablePatterns: ["ground investigation", "\\bgi\\b", "additional ground investigation"] },
          { id: "boreholes", label: "Boreholes", deliverablePatterns: ["borehole", "boreholes"] },
          { id: "trial_pits", label: "Trial Pits", deliverablePatterns: ["trial pit", "trial pits"] },
        ],
      },
      {
        id: "documentation",
        label: "Documentation",
        workPackages: [
          { id: "gi_reports", label: "GI Reports", deliverablePatterns: ["gi report", "ground investigation report", "factual report"] },
        ],
      },
    ],
  },
  {
    id: "sustainability",
    label: "Sustainability",
    fragnetPatterns: ["sustainability", "breeam", "net zero", "environment"],
    activityCodePatterns: ["sustainability", "breeam", "environment"],
    keywords: [
      { pattern: "sustainability", priority: 10 },
      { pattern: "breeam", priority: 10 },
      { pattern: "net zero", priority: 9 },
      { pattern: "carbon", priority: 8 },
      { pattern: "embodied carbon", priority: 9 },
      { pattern: "environmental", priority: 7 },
      { pattern: "environment", priority: 7 },
    ],
    namePatterns: ["sustainability", "breeam", "net zero", "environmental"],
    categories: [
      {
        id: "assessments",
        label: "Assessments",
        workPackages: [
          { id: "breeam", label: "BREEAM", deliverablePatterns: ["breeam", "report sustainability breeam", "sustainability breeam"] },
          { id: "net_zero_carbon", label: "Net Zero Carbon", deliverablePatterns: ["net zero carbon", "net zero", "report sustainability net zero"] },
          { id: "environmental_sustainability", label: "Environmental Sustainability", deliverablePatterns: ["environmental sustainability", "environment sustainability", "sustainability report", "sustainability assessment"] },
        ],
      },
    ],
  },
  {
    id: "project_management",
    label: "Project Management",
    fragnetPatterns: ["project management", "programme management", "pm ", "governance"],
    activityCodePatterns: ["project management", "programme management", "management"],
    keywords: [
      { pattern: "meeting", priority: 9 },
      { pattern: "contract award", priority: 9 },
      { pattern: "milestone", priority: 8 },
      { pattern: "due diligence", priority: 9 },
      { pattern: "programme", priority: 7 },
      { pattern: "commercial", priority: 7 },
    ],
    namePatterns: ["meeting", "milestone", "contract award", "due diligence", "programme review", "tender period"],
    categories: [
      {
        id: "commercial",
        label: "Commercial",
        workPackages: [
          { id: "contract_award", label: "Contract Award", deliverablePatterns: ["contract award", "award of contract"] },
          { id: "due_diligence", label: "Due Diligence", deliverablePatterns: ["due diligence"] },
          { id: "tender_period", label: "Tender Period", deliverablePatterns: ["tender period", "tendering", "tender process"] },
        ],
      },
      {
        id: "programme",
        label: "Programme",
        workPackages: [
          { id: "meetings", label: "Meetings", deliverablePatterns: ["meeting", "meetings", "design meeting", "coordination meeting", "progress meeting"] },
          { id: "milestones", label: "Milestones", deliverablePatterns: ["milestone", "milestones", "key milestone"] },
          { id: "programme_review", label: "Programme Review", deliverablePatterns: ["programme review", "program review", "schedule review"] },
        ],
      },
    ],
  },
];

/** Deterministic planner order (not alphabetical). */
export const DISCIPLINE_DISPLAY_ORDER = [
  "architecture",
  "structural",
  "civil",
  "ground_investigation",
  "mechanical",
  "electrical",
  "public_health",
  "fire_engineering",
  "acoustics",
  "sustainability",
  "project_management",
];

export const CATEGORY_DISPLAY_ORDER: Record<string, string[]> = {
  structural: ["design", "detailing", "bim"],
  architecture: ["design", "documentation"],
  mechanical: ["documentation", "bim", "coordination"],
  electrical: ["documentation"],
  public_health: ["design", "documentation"],
  fire_engineering: ["documentation"],
  acoustics: ["documentation"],
  civil: ["works"],
  ground_investigation: ["investigation", "documentation"],
  sustainability: ["assessments"],
  project_management: ["commercial", "programme"],
};
