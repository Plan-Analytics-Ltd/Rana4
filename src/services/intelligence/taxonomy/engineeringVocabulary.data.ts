/**
 * Engineering-language concepts used to interpret what physical asset or
 * system a deliverable concerns. This is vocabulary, not a comparison table:
 * matching policy consumes the resolved concept and never checks raw wording.
 */
export type EngineeringObjectRule = {
  id: string;
  label: string;
  patterns: string[];
  disciplines?: string[];
  priority?: number;
};

export const ENGINEERING_OBJECT_RULES: EngineeringObjectRule[] = [
  {
    id: "lift_cladding",
    label: "Lift Cladding",
    patterns: ["\\blifts?\\s+cladding\\b", "\\beop\\s+lifts?\\s+cladding\\b"],
    priority: 40,
  },
  {
    id: "link_bridge",
    label: "Link Bridge",
    patterns: ["\\blink\\s+bridge\\b", "\\blink\\s+structure\\b"],
    priority: 38,
  },
  {
    id: "primary_steelwork",
    label: "Primary Steelwork",
    patterns: ["\\bprimary\\s+(?:structural\\s+)?steel(?:work)?\\b"],
    disciplines: ["structural"],
    priority: 38,
  },
  {
    id: "plant_room",
    label: "Plant Room",
    patterns: ["\\bplant\\s*rooms?\\b"],
    priority: 36,
  },
  {
    id: "fire_safety",
    label: "Fire Safety",
    patterns: ["\\bfire\\s+safety\\b", "\\bfire\\s+engineering\\b", "\\bfse\\b"],
    disciplines: ["fire_engineering"],
    priority: 36,
  },
  {
    id: "public_health_system",
    label: "Public Health Systems",
    patterns: ["\\bpublic\\s+health\\b", "\\bphe\\b"],
    disciplines: ["public_health"],
    priority: 36,
  },
  {
    id: "reinforcement",
    label: "Reinforcement",
    patterns: ["\\breinforcement\\b", "\\brebar\\b", "\\brc\\s+frame\\b"],
    disciplines: ["structural"],
    priority: 34,
  },
  {
    id: "stockpile",
    label: "Stockpile",
    patterns: ["\\bstockpiles?\\b"],
    priority: 34,
  },
  {
    id: "foundations",
    label: "Foundations",
    patterns: ["\\bfoundations?\\b", "\\bfootings?\\b", "\\bpile\\s+caps?\\b"],
    disciplines: ["structural", "civil"],
    priority: 32,
  },
  {
    id: "steelwork",
    label: "Steelwork",
    patterns: ["\\bsteelwork\\b", "\\bstructural\\s+steel\\b", "\\bsteel\\s+frame\\b"],
    disciplines: ["structural"],
    priority: 28,
  },
  {
    id: "core",
    label: "Core",
    patterns: ["\\bcores?\\b"],
    disciplines: ["structural", "architecture"],
    priority: 28,
  },
  {
    id: "drainage",
    label: "Drainage",
    patterns: ["\\bdrainage\\b", "\\bsanitary\\b"],
    disciplines: ["public_health", "civil"],
    priority: 28,
  },
  {
    id: "columns",
    label: "Columns",
    patterns: ["\\bcolumns?\\b"],
    disciplines: ["structural"],
    priority: 26,
  },
  {
    id: "walls",
    label: "Walls",
    patterns: ["\\bwalls?\\b"],
    disciplines: ["structural", "architecture"],
    priority: 24,
  },
  {
    id: "roof",
    label: "Roof",
    patterns: ["\\broofs?\\b"],
    priority: 24,
  },
  {
    id: "beams",
    label: "Beams",
    patterns: ["\\bbeams?\\b"],
    disciplines: ["structural"],
    priority: 24,
  },
  {
    id: "slabs",
    label: "Slabs",
    patterns: ["\\bslabs?\\b", "\\bpt\\s+slabs?\\b"],
    disciplines: ["structural"],
    priority: 24,
  },
  {
    id: "piles",
    label: "Piles",
    patterns: ["\\bpiles?\\b", "\\bpiling\\b"],
    disciplines: ["structural", "civil"],
    priority: 24,
  },
  {
    id: "lift",
    label: "Lift",
    patterns: ["\\blifts?\\b", "\\belevators?\\b"],
    priority: 20,
  },
];

export const DISCIPLINE_OBJECT_FALLBACKS: Record<string, { id: string; label: string }> = {
  fire_engineering: { id: "fire_safety", label: "Fire Safety" },
  public_health: { id: "public_health_system", label: "Public Health Systems" },
  acoustics: { id: "acoustics", label: "Acoustics" },
  mechanical: { id: "mechanical_systems", label: "Mechanical Systems" },
  electrical: { id: "electrical_systems", label: "Electrical Systems" },
  project_management: { id: "project_management", label: "Project Management" },
};

export const WORK_PACKAGE_OBJECT_FALLBACKS: Record<string, { id: string; label: string }> = {
  reinforcement_detailing: { id: "reinforcement", label: "Reinforcement" },
  steelwork: { id: "steelwork", label: "Steelwork" },
  wall_elevations: { id: "walls", label: "Walls" },
  column_elevations: { id: "columns", label: "Columns" },
  drainage_design: { id: "drainage", label: "Drainage" },
  meetings: { id: "project_management", label: "Project Management" },
  milestones: { id: "project_management", label: "Project Management" },
};
