export type AskRanaPageMode =
  | "dashboard"
  | "deliverable"
  | "project_evolution"
  | "comparison"
  | "general";

export type AskRanaPageContext = {
  mode: AskRanaPageMode;
  deliverableId?: string | null;
  deliverableName?: string | null;
  placeholder: string;
  suggestions: string[];
};

const DASHBOARD_SUGGESTIONS = [
  "What should I review first?",
  "What worries you most?",
  "Which work packages need attention?",
];

const DELIVERABLE_SUGGESTIONS = [
  "Why is this critical?",
  "Is this duration reasonable?",
  "What changed?",
];

const EVOLUTION_SUGGESTIONS = [
  "What changed between Update 3 and Update 8?",
  "Did any relationships change?",
  "Why did the float reduce?",
];

const COMPARISON_SUGGESTIONS = [
  "Which completed project is most similar?",
  "What usually happens?",
  "What should I learn from previous projects?",
];

export function detectAskRanaPageContext(args: {
  pathname: string;
  deliverableId?: string | null;
  deliverableName?: string | null;
  intelligenceDrawerOpen?: boolean;
}): AskRanaPageContext {
  const path = args.pathname.toLowerCase();

  if (args.intelligenceDrawerOpen && args.deliverableId) {
    const name = args.deliverableName?.trim() || "this deliverable";
    return {
      mode: "deliverable",
      deliverableId: args.deliverableId,
      deliverableName: args.deliverableName,
      placeholder: `Now discussing ${name}…`,
      suggestions: DELIVERABLE_SUGGESTIONS,
    };
  }

  if (path.includes("/intelligence/comparison")) {
    return {
      mode: "comparison",
      deliverableId: args.deliverableId,
      deliverableName: args.deliverableName,
      placeholder: "Ask about previous projects…",
      suggestions: COMPARISON_SUGGESTIONS,
    };
  }

  if (args.deliverableId) {
    const evolutionFocused =
      path.includes("/schedule") ||
      path.includes("/project");

    if (evolutionFocused) {
      return {
        mode: "project_evolution",
        deliverableId: args.deliverableId,
        deliverableName: args.deliverableName,
        placeholder: "Ask about this project's evolution…",
        suggestions: EVOLUTION_SUGGESTIONS,
      };
    }

    return {
      mode: "deliverable",
      deliverableId: args.deliverableId,
      deliverableName: args.deliverableName,
      placeholder: "Ask about this deliverable…",
      suggestions: DELIVERABLE_SUGGESTIONS,
    };
  }

  if (path === "/app" || path === "/app/" || path.includes("/intelligence")) {
    return {
      mode: "dashboard",
      placeholder: "Ask about this programme…",
      suggestions: DASHBOARD_SUGGESTIONS,
    };
  }

  return {
    mode: "general",
    placeholder: "Ask Rana…",
    suggestions: DASHBOARD_SUGGESTIONS,
  };
}
