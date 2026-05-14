"use client";

import { motion } from "framer-motion";
import { FileStack, GitBranch, Gauge, FileSpreadsheet } from "lucide-react";

const features = [
  {
    title: "Standard Libraries",
    description: "Define and maintain scheduling standards that drive consistency across programmes.",
    icon: FileStack,
    accent: "cyan",
  },
  {
    title: "Fragnet Builder",
    description: "Build fragment networks per standard with clear structure and relationships.",
    icon: GitBranch,
    accent: "teal",
  },
  {
    title: "Dual Duration Control",
    description: "Model best and likely durations for robust scenario planning and export.",
    icon: Gauge,
    accent: "violet",
  },
  {
    title: "Structured Export",
    description: "ZIP export: P6-ready Excel (TASK, TASKPRED, RSRC) plus XER shell with WBS and activity code definitions.",
    icon: FileSpreadsheet,
    accent: "amber",
  },
];

const accentStyles: Record<string, string> = {
  cyan: "border-l-cyan-500 bg-cyan-500/5 dark:bg-cyan-500/10 [&_.icon-box]:bg-cyan-500/20 [&_.icon-box]:text-cyan-400 dark:[&_.icon-box]:bg-cyan-500/20 dark:[&_.icon-box]:text-cyan-300",
  teal: "border-l-teal-500 bg-teal-500/5 dark:bg-teal-500/10 [&_.icon-box]:bg-teal-500/20 [&_.icon-box]:text-teal-400 dark:[&_.icon-box]:bg-teal-500/20 dark:[&_.icon-box]:text-teal-300",
  violet: "border-l-violet-500 bg-violet-500/5 dark:bg-violet-500/10 [&_.icon-box]:bg-violet-500/20 [&_.icon-box]:text-violet-400 dark:[&_.icon-box]:bg-violet-500/20 dark:[&_.icon-box]:text-violet-300",
  amber: "border-l-amber-500 bg-amber-500/5 dark:bg-amber-500/10 [&_.icon-box]:bg-amber-500/20 [&_.icon-box]:text-amber-400 dark:[&_.icon-box]:bg-amber-500/20 dark:[&_.icon-box]:text-amber-300",
};

export function FeatureGrid() {
  return (
    <section
      id="features"
      className="relative border-t border-slate-800 bg-slate-950 px-6 py-20 md:py-28 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,hsl(187_85%_50%_/_0.04),transparent)]" />
      <div className="relative mx-auto max-w-6xl">
        <motion.h2
          className="text-center text-2xl font-semibold tracking-tight text-white md:text-3xl"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          Built for programme control
        </motion.h2>
        <motion.p
          className="mx-auto mt-3 max-w-xl text-center text-slate-400"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          Everything you need to own your schedule structure.
        </motion.p>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((item, i) => (
            <motion.div
              key={item.title}
              className={`rounded-2xl border border-slate-800 border-l-4 p-6 transition-all duration-200 hover:border-slate-700 hover:shadow-lg hover:shadow-cyan-500/5 dark:border-slate-800 ${accentStyles[item.accent]}`}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <div className="icon-box flex h-11 w-11 items-center justify-center rounded-xl">
                <item.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold tracking-tight text-white">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
